// QuantPerfector — Cloud Sync Engine (Firestore)
// Optimistic local writes + async cloud sync

import { SYNC_CONFIG } from './config.js';
import { getUser, isOffline, getDb, getFirestoreModule } from './firebase.js';

const QUEUE_KEY = 'quantperfector_sync_queue';

let syncQueue = [];
let flushTimer = null;
let _syncing = false;
let _lastSyncStatus = 'idle'; // idle | syncing | synced | error | offline

// ─── Status ───

export function getSyncStatus() { return _lastSyncStatus; }

function setSyncStatus(status) {
    _lastSyncStatus = status;
    window.dispatchEvent(new CustomEvent('qp:sync-status', { detail: { status } }));
}

// ─── Queue Management ───

function loadQueue() {
    try {
        const raw = localStorage.getItem(QUEUE_KEY);
        syncQueue = raw ? JSON.parse(raw) : [];
    } catch { syncQueue = []; }
}

function persistQueue() {
    try {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(syncQueue));
    } catch (e) {
        console.warn('[QP Sync] Queue persist failed:', e.message);
    }
}

/**
 * Enqueue a write operation for cloud sync.
 * Synchronous — returns immediately. Actual sync happens async.
 */
export function enqueue(collection, data) {
    if (isOffline()) return;

    syncQueue.push({
        collection,
        data,
        timestamp: Date.now(),
        retries: 0
    });
    persistQueue();
    debouncedFlush();
}

/**
 * Enqueue a profile update (settings, XP, personal bests).
 */
export function enqueueProfile(profileData) {
    enqueue('_profile', profileData);
}

function debouncedFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), SYNC_CONFIG.debounceMs);
}

/**
 * Force immediate sync flush.
 */
export async function flushNow() {
    if (flushTimer) clearTimeout(flushTimer);
    await flush();
}

// ─── Flush Queue to Firestore ───

async function flush() {
    if (_syncing || isOffline() || syncQueue.length === 0) return;

    const user = getUser();
    if (!user) return;

    const db = getDb();
    const fs = getFirestoreModule();
    if (!db || !fs) return;

    _syncing = true;
    setSyncStatus('syncing');

    const batch = syncQueue.splice(0, SYNC_CONFIG.maxBatchSize);
    const failed = [];

    try {
        const writeBatch = fs.writeBatch(db);
        let batchCount = 0;

        for (const item of batch) {
            try {
                if (item.collection === '_profile') {
                    // Profile is a single doc: users/{uid}
                    const ref = fs.doc(db, 'users', user.uid);
                    writeBatch.set(ref, {
                        ...camelToSnake(item.data),
                        updated_at: fs.serverTimestamp()
                    }, { merge: true });
                    batchCount++;
                } else if (item.collection === 'problemRecords') {
                    // Problem records: users/{uid}/problem_records/{problemKey}
                    const docId = sanitizeDocId(item.data.key);
                    const ref = fs.doc(db, 'users', user.uid, 'problem_records', docId);
                    writeBatch.set(ref, {
                        ...camelToSnake(item.data),
                        updated_at: fs.serverTimestamp()
                    }, { merge: true });
                    batchCount++;
                } else if (item.collection === 'sessions') {
                    // Sessions: users/{uid}/sessions/{clientId}
                    const docId = sanitizeDocId(item.data.id);
                    const ref = fs.doc(db, 'users', user.uid, 'sessions', docId);
                    writeBatch.set(ref, camelToSnake(item.data), { merge: true });
                    batchCount++;
                } else if (item.collection === 'attempts') {
                    // Attempts: users/{uid}/attempts/{clientId}
                    const docId = sanitizeDocId(item.data.id);
                    const ref = fs.doc(db, 'users', user.uid, 'attempts', docId);
                    writeBatch.set(ref, camelToSnake(item.data), { merge: true });
                    batchCount++;
                }
            } catch (err) {
                console.warn('[QP Sync] Item prep failed:', err.message);
                if (item.retries < SYNC_CONFIG.maxRetries) {
                    item.retries++;
                    failed.push(item);
                }
            }
        }

        if (batchCount > 0) {
            await writeBatch.commit();
        }

        setSyncStatus('synced');
    } catch (err) {
        console.error('[QP Sync] Batch flush failed:', err.message);
        // Re-queue failed items
        for (const item of batch) {
            if (item.retries < SYNC_CONFIG.maxRetries) {
                item.retries++;
                failed.push(item);
            }
        }
        setSyncStatus('error');
    }

    // Put failed items back
    if (failed.length > 0) {
        syncQueue.unshift(...failed);
        // Retry after delay
        setTimeout(() => flush(), SYNC_CONFIG.retryDelayMs);
    }

    persistQueue();
    _syncing = false;

    // If more items queued during flush, schedule another
    if (syncQueue.length > 0) {
        debouncedFlush();
    }
}

// ─── Pull from Cloud ───

/**
 * Pull all user data from Firestore and merge into local storage.
 * Called once on load after auth is ready.
 * Returns merged data or null if offline/failed.
 */
export async function pullFromCloud() {
    if (isOffline()) return null;

    const user = getUser();
    if (!user) return null;

    const db = getDb();
    const fs = getFirestoreModule();
    if (!db || !fs) return null;

    try {
        setSyncStatus('syncing');

        // Fetch profile, problem records, sessions, attempts in parallel
        const [profileSnap, recordsSnap, sessionsSnap, attemptsSnap] = await Promise.all([
            fs.getDoc(fs.doc(db, 'users', user.uid)),
            fs.getDocs(fs.collection(db, 'users', user.uid, 'problem_records')),
            fs.getDocs(fs.collection(db, 'users', user.uid, 'sessions')),
            fs.getDocs(fs.collection(db, 'users', user.uid, 'attempts'))
        ]);

        const cloudData = {
            profile: profileSnap.exists() ? snakeToCamel(profileSnap.data()) : null,
            problemRecords: {},
            sessions: [],
            attempts: []
        };

        recordsSnap.forEach(doc => {
            const data = snakeToCamel(doc.data());
            cloudData.problemRecords[data.key || doc.id] = data;
        });

        sessionsSnap.forEach(doc => {
            cloudData.sessions.push(snakeToCamel(doc.data()));
        });

        attemptsSnap.forEach(doc => {
            cloudData.attempts.push(snakeToCamel(doc.data()));
        });

        setSyncStatus('synced');
        return cloudData;
    } catch (err) {
        console.error('[QP Sync] Pull failed:', err.message);
        setSyncStatus('error');
        return null;
    }
}

/**
 * Merge cloud data into local storage cache.
 * Conflict resolution:
 *   - XP: max(local, cloud)
 *   - Settings: cloud wins (last save wins)
 *   - Personal bests: max of each field
 *   - Problem records: more attempts wins
 *   - Sessions/attempts: deduplicate by id
 */
export function mergeCloudIntoLocal(localData, cloudData) {
    if (!cloudData) return localData;

    // Profile merge
    if (cloudData.profile) {
        // XP: take max
        localData.profile.totalXp = Math.max(
            localData.profile.totalXp || 0,
            cloudData.profile.totalXp || 0
        );

        // Settings: cloud wins if present
        if (cloudData.profile.settings && Object.keys(cloudData.profile.settings).length > 0) {
            localData.profile.settings = cloudData.profile.settings;
        }

        // Personal bests: max of each
        const lpb = localData.profile.personalBests;
        const cpb = cloudData.profile.personalBests || {};
        lpb.longestStreak = Math.max(lpb.longestStreak || 0, cpb.longestStreak || 0);
        lpb.highestSessionAccuracy = Math.max(lpb.highestSessionAccuracy || 0, cpb.highestSessionAccuracy || 0);
        lpb.mostProblemsInSession = Math.max(lpb.mostProblemsInSession || 0, cpb.mostProblemsInSession || 0);
        if (cpb.fastestCorrect) {
            if (!lpb.fastestCorrect || cpb.fastestCorrect.timeMs < lpb.fastestCorrect.timeMs) {
                lpb.fastestCorrect = cpb.fastestCorrect;
            }
        }
    }

    // Problem records merge: more attempts wins
    for (const [key, cloudRec] of Object.entries(cloudData.problemRecords)) {
        const localRec = localData.problemRecords[key];
        if (!localRec) {
            localData.problemRecords[key] = cloudRec;
        } else if ((cloudRec.totalAttempts || 0) > (localRec.totalAttempts || 0)) {
            localData.problemRecords[key] = cloudRec;
        }
    }

    // Sessions: deduplicate by id
    const localSessionIds = new Set(localData.sessions.map(s => s.id));
    for (const cloudSession of cloudData.sessions) {
        if (cloudSession.id && !localSessionIds.has(cloudSession.id)) {
            localData.sessions.push(cloudSession);
        }
    }
    // Sort by start time and keep latest MAX
    localData.sessions.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    if (localData.sessions.length > 100) {
        localData.sessions = localData.sessions.slice(-100);
    }

    // Attempts: deduplicate by id
    const localAttemptIds = new Set(localData.attemptLog.map(a => a.id));
    for (const cloudAttempt of cloudData.attempts) {
        if (cloudAttempt.id && !localAttemptIds.has(cloudAttempt.id)) {
            localData.attemptLog.push(cloudAttempt);
        }
    }
    // Sort by timestamp and keep latest MAX
    localData.attemptLog.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    if (localData.attemptLog.length > 5000) {
        localData.attemptLog = localData.attemptLog.slice(-5000);
    }

    return localData;
}

// ─── Online/Offline Listeners ───

export function setupConnectivityListeners() {
    window.addEventListener('online', () => {
        console.log('[QP Sync] Back online — flushing queue');
        setSyncStatus('idle');
        loadQueue();
        if (syncQueue.length > 0) flush();
    });

    window.addEventListener('offline', () => {
        console.log('[QP Sync] Went offline');
        setSyncStatus('offline');
    });

    if (!navigator.onLine) {
        setSyncStatus('offline');
    }
}

// ─── camelCase ↔ snake_case converters ───

function camelToSnake(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(camelToSnake);

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const snakeKey = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
        result[snakeKey] = (typeof value === 'object' && value !== null && !(value instanceof Date))
            ? camelToSnake(value) : value;
    }
    return result;
}

function snakeToCamel(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(snakeToCamel);

    const result = {};
    for (const [key, value] of Object.entries(obj)) {
        const camelKey = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
        result[camelKey] = (typeof value === 'object' && value !== null && !(value instanceof Date))
            ? snakeToCamel(value) : value;
    }
    return result;
}

/** Sanitize a string for use as a Firestore document ID. */
function sanitizeDocId(id) {
    return id.replace(/[/\\]/g, '_');
}

// Load queue from localStorage on module init
loadQueue();
