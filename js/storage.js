// QuantPerfector — Storage Layer (localStorage with in-memory cache)

import { DEFAULT_SETTINGS, SM2_DEFAULTS } from './constants.js';
import { enqueue, enqueueProfile, flushNow, pullFromCloud, mergeCloudIntoLocal, setupConnectivityListeners } from './sync.js';
import { isOffline } from './firebase.js';

const STORAGE_KEY = 'quantperfector_data';
const MAX_SESSIONS = 100;
const MAX_ATTEMPTS = 5000;

let cache = null;

function defaultData() {
    return {
        version: 1,
        profile: {
            createdAt: new Date().toISOString(),
            totalXp: 0,
            settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
            personalBests: {
                longestStreak: 0,
                fastestCorrect: null,
                highestSessionAccuracy: 0,
                mostProblemsInSession: 0
            }
        },
        problemRecords: {},
        sessions: [],
        attemptLog: []
    };
}

function persist() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
    } catch (e) {
        console.warn('QuantPerfector: localStorage write failed', e);
    }
}

export function loadAll() {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            cache = JSON.parse(raw);
            // Ensure all fields exist (schema migration)
            if (!cache.profile) cache.profile = defaultData().profile;
            if (!cache.problemRecords) cache.problemRecords = {};
            if (!cache.sessions) cache.sessions = [];
            if (!cache.attemptLog) cache.attemptLog = [];
            if (!cache.profile.settings) cache.profile.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
            if (!cache.profile.personalBests) cache.profile.personalBests = defaultData().profile.personalBests;
            return cache;
        }
    } catch (e) {
        console.warn('QuantPerfector: localStorage read failed, using defaults', e);
    }
    cache = defaultData();
    persist();
    return cache;
}

export function saveAll(data) {
    cache = data;
    persist();
}

export function getProfile() {
    return loadAll().profile;
}

export function getSettings() {
    return loadAll().profile.settings;
}

export function saveSettings(settings) {
    loadAll().profile.settings = settings;
    persist();
    enqueueProfile({ settings: loadAll().profile.settings });
}

export function addXp(amount) {
    loadAll().profile.totalXp += amount;
    persist();
}

export function getTotalXp() {
    return loadAll().profile.totalXp;
}

export function getProblemRecord(key) {
    return loadAll().problemRecords[key] || null;
}

export function getAllProblemRecords() {
    return loadAll().problemRecords;
}

export function saveProblemRecord(key, record) {
    loadAll().problemRecords[key] = record;
    persist();
    enqueue('problemRecords', record);
}

export function createProblemRecord(key, operation, a, b, answer) {
    return {
        key,
        operation,
        operandA: a,
        operandB: b,
        correctAnswer: answer,
        easeFactor: SM2_DEFAULTS.EASE_FACTOR,
        interval: 0,
        repetitions: 0,
        nextReviewDate: null,
        totalAttempts: 0,
        totalCorrect: 0,
        totalTimeMs: 0,
        lastAttemptDate: null,
        lastResponseTimeMs: null,
        streak: 0,
        bestStreak: 0
    };
}

export function logAttempt(attempt) {
    const data = loadAll();
    data.attemptLog.push(attempt);
    if (data.attemptLog.length > MAX_ATTEMPTS) {
        data.attemptLog = data.attemptLog.slice(-MAX_ATTEMPTS);
    }
    persist();
    enqueue('attempts', attempt);
}

export function getAttemptLog() {
    return loadAll().attemptLog;
}

export function saveSession(session) {
    const data = loadAll();
    data.sessions.push(session);
    if (data.sessions.length > MAX_SESSIONS) {
        data.sessions = data.sessions.slice(-MAX_SESSIONS);
    }
    // Update personal bests
    const pb = data.profile.personalBests;
    if (session.streakPeak > pb.longestStreak) pb.longestStreak = session.streakPeak;
    if (session.accuracy > pb.highestSessionAccuracy) pb.highestSessionAccuracy = session.accuracy;
    if (session.totalProblems > pb.mostProblemsInSession) pb.mostProblemsInSession = session.totalProblems;
    persist();
    enqueue('sessions', session);
    // Sync profile (XP + personal bests) and flush immediately at session end
    enqueueProfile({
        totalXp: data.profile.totalXp,
        personalBests: data.profile.personalBests
    });
    flushNow();
}

export function updatePersonalBestSpeed(key, timeMs) {
    const pb = loadAll().profile.personalBests;
    if (!pb.fastestCorrect || timeMs < pb.fastestCorrect.timeMs) {
        pb.fastestCorrect = { key, timeMs };
        persist();
    }
}

export function getSessions() {
    return loadAll().sessions;
}

export function getPersonalBests() {
    return loadAll().profile.personalBests;
}

export function exportData() {
    return JSON.stringify(loadAll(), null, 2);
}

export function importData(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data.version || !data.profile || !data.problemRecords) {
        throw new Error('Invalid QuantPerfector data format');
    }
    cache = data;
    persist();
    return cache;
}

export function resetAll() {
    cache = defaultData();
    persist();
    return cache;
}

/**
 * Sync on load: pull cloud data, merge into local, persist.
 * Called once during init after auth is ready.
 * Returns true if cloud data was merged.
 */
export async function syncOnLoad() {
    if (isOffline()) return false;
    setupConnectivityListeners();
    try {
        const cloudData = await pullFromCloud();
        if (cloudData) {
            const local = loadAll();
            mergeCloudIntoLocal(local, cloudData);
            persist();
            return true;
        }
    } catch (err) {
        console.warn('[QP] syncOnLoad failed:', err.message);
    }
    return false;
}
