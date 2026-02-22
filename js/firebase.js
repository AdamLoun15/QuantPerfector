// QuantPerfector — Firebase Client & Auth

import { FIREBASE_CONFIG } from './config.js';

let app = null;
let auth = null;
let db = null;
let _user = null;
let _initialized = false;
let _offline = false;

// Firebase SDK modules (loaded dynamically from CDN)
let firebaseApp, firebaseAuth, firebaseFirestore;

/**
 * Initialize Firebase via CDN dynamic import.
 * If CDN fails (offline, blocked), app runs in local-only mode.
 */
export async function initFirebase() {
    if (_initialized) return db;

    const isConfigured = FIREBASE_CONFIG.apiKey !== 'YOUR_API_KEY' &&
                         FIREBASE_CONFIG.projectId !== 'YOUR_PROJECT_ID';
    if (!isConfigured) {
        console.warn('[QP] Firebase not configured — running in local-only mode');
        _offline = true;
        _initialized = true;
        return null;
    }

    try {
        // Dynamic imports from Firebase CDN (ESM)
        const [appMod, authMod, firestoreMod] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js'),
            import('https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js')
        ]);

        firebaseApp = appMod;
        firebaseAuth = authMod;
        firebaseFirestore = firestoreMod;

        app = firebaseApp.initializeApp(FIREBASE_CONFIG);
        auth = firebaseAuth.getAuth(app);
        db = firebaseFirestore.getFirestore(app);

        // Enable offline persistence
        try {
            await firebaseFirestore.enableIndexedDbPersistence(db);
        } catch (e) {
            // Multi-tab persistence may fail — that's ok
            if (e.code !== 'failed-precondition' && e.code !== 'unimplemented') {
                console.warn('[QP] Firestore persistence error:', e.message);
            }
        }

        // Listen for auth state changes
        firebaseAuth.onAuthStateChanged(auth, (user) => {
            _user = user;
            window.dispatchEvent(new CustomEvent('qp:auth-change', {
                detail: { user: _user }
            }));
        });

        _initialized = true;
        _offline = false;
        console.log('[QP] Firebase initialized');
        return db;
    } catch (err) {
        console.warn('[QP] Firebase CDN failed — running in local-only mode', err.message);
        _offline = true;
        _initialized = true;
        return null;
    }
}

/**
 * Sign in anonymously. Creates a temporary user that can be upgraded later.
 */
export async function signInAnonymously() {
    if (!auth) return null;
    if (_user) return _user;

    try {
        const result = await firebaseAuth.signInAnonymously(auth);
        _user = result.user;
        return _user;
    } catch (err) {
        console.error('[QP] Anonymous sign-in failed:', err.message);
        return null;
    }
}

/**
 * Send a magic link email to upgrade anonymous account or sign in.
 */
export async function sendSignInLink(email) {
    if (!auth) return { error: 'Firebase not available' };

    try {
        const actionCodeSettings = {
            url: window.location.origin + window.location.pathname,
            handleCodeInApp: true
        };
        await firebaseAuth.sendSignInLinkToEmail(auth, email, actionCodeSettings);
        // Store email locally for when user clicks the link
        localStorage.setItem('qp_signin_email', email);
        return { error: null };
    } catch (err) {
        console.error('[QP] Send sign-in link failed:', err.message);
        return { error: err.message };
    }
}

/**
 * Complete magic link sign-in (called on page load if URL has sign-in link).
 */
export async function completeSignInWithLink() {
    if (!auth) return null;
    if (!firebaseAuth.isSignInWithEmailLink(auth, window.location.href)) return null;

    let email = localStorage.getItem('qp_signin_email');
    if (!email) {
        email = window.prompt('Please enter your email to confirm sign-in:');
    }
    if (!email) return null;

    try {
        // If currently anonymous, link the email credential instead
        if (_user && _user.isAnonymous) {
            const credential = firebaseAuth.EmailAuthProvider.credentialWithLink(email, window.location.href);
            const result = await firebaseAuth.linkWithCredential(_user, credential);
            _user = result.user;
        } else {
            const result = await firebaseAuth.signInWithEmailLink(auth, email, window.location.href);
            _user = result.user;
        }
        localStorage.removeItem('qp_signin_email');
        // Clean the URL
        window.history.replaceState(null, '', window.location.pathname);
        return _user;
    } catch (err) {
        console.error('[QP] Complete sign-in failed:', err.message);
        // If linking fails (e.g. email already used), sign in normally
        if (err.code === 'auth/credential-already-in-use' || err.code === 'auth/email-already-in-use') {
            try {
                const result = await firebaseAuth.signInWithEmailLink(auth, email, window.location.href);
                _user = result.user;
                localStorage.removeItem('qp_signin_email');
                window.history.replaceState(null, '', window.location.pathname);
                return _user;
            } catch (e2) {
                console.error('[QP] Fallback sign-in also failed:', e2.message);
            }
        }
        return null;
    }
}

/**
 * Sign out and clear session.
 */
export async function signOut() {
    if (!auth) return;
    try {
        await firebaseAuth.signOut(auth);
        _user = null;
    } catch (err) {
        console.error('[QP] Sign out failed:', err.message);
    }
}

/** Get current user (or null). */
export function getUser() { return _user; }

/** Check if there's an authenticated user. */
export function isAuthenticated() { return _user !== null; }

/** Check if the current user is anonymous. */
export function isAnonymous() { return _user?.isAnonymous === true; }

/** Check if we're in offline/local-only mode. */
export function isOffline() { return _offline || !db; }

/** Get the Firestore DB instance. */
export function getDb() { return db; }

/** Get Firestore module functions (for sync.js). */
export function getFirestoreModule() { return firebaseFirestore; }
