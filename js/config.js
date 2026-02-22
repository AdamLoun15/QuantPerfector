// QuantPerfector — Firebase Configuration
// These values are safe to expose publicly — Firestore Security Rules handle authorization

export const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyAU1-K4bruII9ipPfuT4ViilgdFG5jfqUc',
    authDomain: 'quantperfector.firebaseapp.com',
    projectId: 'quantperfector',
    storageBucket: 'quantperfector.firebasestorage.app',
    messagingSenderId: '819141558268',
    appId: '1:819141558268:web:115a73d0476bd357c37c79'
};

export const SYNC_CONFIG = {
    debounceMs: 5000,       // flush sync queue every 5s
    maxBatchSize: 100,      // max items per flush
    retryDelayMs: 10000,    // retry failed syncs after 10s
    maxRetries: 3           // max retries per item
};
