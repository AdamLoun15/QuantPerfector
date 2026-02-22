// QuantPerfector — Auth UI Controller

import { getUser, isAnonymous, isOffline, sendSignInLink, signOut } from './firebase.js';
import { getSyncStatus } from './sync.js';

let _accountBtn = null;
let _syncDot = null;
let _authModal = null;

export function initAuthUI() {
    _accountBtn = document.getElementById('account-btn');
    _syncDot = document.getElementById('sync-dot');
    _authModal = document.getElementById('auth-modal');

    if (!_accountBtn) return;

    // Account button click → show modal
    _accountBtn.addEventListener('click', () => {
        if (_authModal) _authModal.classList.remove('hidden');
    });

    // Close modal
    const closeBtn = document.getElementById('auth-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Backdrop click to close
    if (_authModal) {
        _authModal.addEventListener('click', (e) => {
            if (e.target === _authModal) closeModal();
        });
    }

    // Email form submit
    const emailForm = document.getElementById('auth-email-form');
    if (emailForm) {
        emailForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const emailInput = document.getElementById('auth-email-input');
            const submitBtn = document.getElementById('auth-submit-btn');
            const email = emailInput?.value?.trim();
            if (!email) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';

            const { error } = await sendSignInLink(email);

            if (error) {
                showAuthMessage(`Error: ${error}`, true);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Send Magic Link';
            } else {
                showAuthMessage('Check your email! Click the link to sign in.', false);
                submitBtn.textContent = 'Sent!';
                // Re-enable after a delay
                setTimeout(() => {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Send Magic Link';
                }, 5000);
            }
        });
    }

    // Sign out button
    const signOutBtn = document.getElementById('auth-signout-btn');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', async () => {
            await signOut();
            updateAuthUI();
            closeModal();
        });
    }

    // Listen for auth/sync events
    window.addEventListener('qp:auth-change', () => updateAuthUI());
    window.addEventListener('qp:sync-status', () => updateSyncDot());

    updateAuthUI();
    updateSyncDot();
}

function closeModal() {
    if (_authModal) _authModal.classList.add('hidden');
    clearAuthMessage();
}

function showAuthMessage(msg, isError) {
    const el = document.getElementById('auth-message');
    if (el) {
        el.textContent = msg;
        el.className = 'auth-message' + (isError ? ' auth-message-error' : '');
        el.classList.remove('hidden');
    }
}

function clearAuthMessage() {
    const el = document.getElementById('auth-message');
    if (el) el.classList.add('hidden');
}

export function updateAuthUI() {
    if (!_accountBtn) return;

    const user = getUser();
    const accountLabel = document.getElementById('account-label');

    if (isOffline()) {
        if (accountLabel) accountLabel.textContent = 'Offline';
    } else if (!user) {
        if (accountLabel) accountLabel.textContent = 'Guest';
    } else if (isAnonymous()) {
        if (accountLabel) accountLabel.textContent = 'Guest';
    } else {
        // Signed in with email
        const email = user.email || '';
        if (accountLabel) accountLabel.textContent = email.split('@')[0] || 'Signed In';
    }

    // Update modal content
    updateModalContent();
}

function updateModalContent() {
    const user = getUser();
    const guestSection = document.getElementById('auth-guest-section');
    const signedInSection = document.getElementById('auth-signedin-section');
    const signedInEmail = document.getElementById('auth-signedin-email');

    if (!guestSection || !signedInSection) return;

    if (user && !isAnonymous()) {
        // Signed in with email
        guestSection.classList.add('hidden');
        signedInSection.classList.remove('hidden');
        if (signedInEmail) signedInEmail.textContent = user.email || 'Unknown';
    } else {
        // Guest or anonymous
        guestSection.classList.remove('hidden');
        signedInSection.classList.add('hidden');
    }
}

function updateSyncDot() {
    if (!_syncDot) return;

    const status = getSyncStatus();
    _syncDot.className = 'sync-dot';
    _syncDot.classList.add(`sync-${status}`);

    const titles = {
        idle: 'Ready',
        syncing: 'Syncing...',
        synced: 'Synced',
        error: 'Sync error',
        offline: 'Offline'
    };
    _syncDot.title = titles[status] || '';
}
