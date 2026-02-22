// QuantPerfector — UI Layer (DOM, animations, Web Audio sounds)

import { getOperatorSymbol, STREAK_LEVELS, generateHint, getLevel, xpProgress, xpForLevel } from './constants.js';
import { getProfile, getTotalXp } from './storage.js';

// ─── Screen Navigation ───

const screens = ['screen-home', 'screen-session', 'screen-review', 'screen-dashboard', 'screen-drill', 'screen-settings'];

export function showScreen(id) {
    for (const s of screens) {
        const el = document.getElementById(s);
        if (el) el.classList.toggle('hidden', s !== id);
    }
}

// ─── Problem Display ───

export function displayProblem(problem) {
    const el = document.getElementById('problem-text');
    if (!el) return;
    el.innerHTML = `
        <span class="operand-a">${problem.a}</span>
        <span class="operator">${getOperatorSymbol(problem.operation)}</span>
        <span class="operand-b">${problem.b}</span>
        <span class="equals">=</span>
        <span class="answer-display" id="answer-display">?</span>
    `;
}

export function updateAnswerDisplay(text) {
    const el = document.getElementById('answer-display');
    if (el) el.textContent = text || '?';
}

// ─── Countdown Bar ───

let countdownAnim = null;

export function startCountdownBar(durationMs) {
    const fill = document.getElementById('countdown-bar-fill');
    if (!fill) return;
    fill.style.transition = 'none';
    fill.style.width = '100%';
    fill.className = 'countdown-bar-fill';

    // Force reflow
    fill.offsetWidth;

    fill.style.transition = `width ${durationMs}ms linear`;
    fill.style.width = '0%';

    // Color transitions
    clearTimeout(countdownAnim);
    const warningAt = durationMs * 0.4;
    const criticalAt = durationMs * 0.2;

    setTimeout(() => fill.classList.add('warning'), durationMs - warningAt);
    countdownAnim = setTimeout(() => fill.classList.add('critical'), durationMs - criticalAt);
}

export function resetCountdownBar() {
    clearTimeout(countdownAnim);
    const fill = document.getElementById('countdown-bar-fill');
    if (fill) {
        fill.style.transition = 'none';
        fill.style.width = '100%';
        fill.className = 'countdown-bar-fill';
    }
}

// ─── Session Timer ───

export function updateSessionTimer(remainingMs) {
    const el = document.getElementById('session-timer-text');
    if (!el) return;
    const totalSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    el.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
}

export function updateSessionProgress(ratio) {
    const fill = document.getElementById('session-progress-fill');
    if (fill) fill.style.width = `${Math.min(100, ratio * 100)}%`;
}

// ─── Streak Display ───

export function updateStreak(count) {
    const countEl = document.getElementById('streak-count');
    const fireEl = document.getElementById('streak-fire');
    if (countEl) countEl.textContent = count;

    if (fireEl) {
        let level = STREAK_LEVELS[0];
        for (const l of STREAK_LEVELS) {
            if (count >= l.min) level = l;
        }
        fireEl.textContent = level.label;
        fireEl.className = `streak-fire ${level.css}`;
    }
}

// ─── XP / Level Display ───

export function updateXpDisplay() {
    const xp = getTotalXp();
    const level = getLevel(xp);
    const progress = xpProgress(xp);
    const nextXp = xpForLevel(level);

    const levelEl = document.getElementById('level-display');
    if (levelEl) levelEl.textContent = `Lv.${level}`;

    const xpBarFill = document.getElementById('xp-bar-fill');
    if (xpBarFill) xpBarFill.style.width = `${progress * 100}%`;

    const xpText = document.getElementById('xp-text');
    if (xpText) xpText.textContent = `${xp} / ${nextXp} XP`;

    // Home screen level
    const homeLevelEl = document.getElementById('home-level');
    if (homeLevelEl) homeLevelEl.textContent = `Level ${level}`;

    const homeXpEl = document.getElementById('home-xp');
    if (homeXpEl) homeXpEl.textContent = `${xp} XP`;
}

// ─── Feedback Overlay ───

let feedbackTimeout = null;

export function showFeedback(isCorrect, problem, userAnswer) {
    const overlay = document.getElementById('feedback-overlay');
    if (!overlay) return;

    clearTimeout(feedbackTimeout);

    const icon = overlay.querySelector('.feedback-icon');
    const text = overlay.querySelector('.feedback-text');
    const hint = overlay.querySelector('.feedback-hint');

    overlay.className = `feedback-overlay ${isCorrect ? 'correct' : 'wrong'}`;

    if (isCorrect) {
        icon.textContent = '\u2713';
        text.textContent = '';
        hint.textContent = '';
        feedbackTimeout = setTimeout(() => {
            overlay.className = 'feedback-overlay hidden';
        }, 250);
    } else {
        icon.textContent = '\u2717';
        text.textContent = `${problem.a} ${getOperatorSymbol(problem.operation)} ${problem.b} = ${problem.answer}`;
        hint.textContent = generateHint(problem.operation, problem.a, problem.b, problem.answer);
        feedbackTimeout = setTimeout(() => {
            overlay.className = 'feedback-overlay hidden';
        }, 1800);
    }
}

// ─── Session Mode Badge ───

export function updateModeBadge(mode) {
    const el = document.getElementById('session-mode-badge');
    if (el) el.textContent = mode.toUpperCase();
}

// ─── 3-2-1 Countdown ───

export function showCountdown(onComplete) {
    const overlay = document.getElementById('countdown-overlay');
    if (!overlay) { onComplete(); return; }

    overlay.classList.remove('hidden');
    const numEl = overlay.querySelector('.countdown-number');
    let count = 3;

    function tick() {
        if (count > 0) {
            numEl.textContent = count;
            numEl.className = 'countdown-number countdown-pop';
            // Reset animation
            numEl.offsetWidth;
            numEl.className = 'countdown-number countdown-pop animate';
            count--;
            setTimeout(tick, 800);
        } else {
            numEl.textContent = 'GO!';
            numEl.className = 'countdown-number countdown-pop animate';
            setTimeout(() => {
                overlay.classList.add('hidden');
                onComplete();
            }, 500);
        }
    }
    tick();
}

// ─── Pause Overlay ───

export function showPause(onResume) {
    const overlay = document.getElementById('pause-overlay');
    if (!overlay) return;
    overlay.classList.remove('hidden');

    const resumeBtn = document.getElementById('btn-resume');
    const handler = () => {
        overlay.classList.add('hidden');
        resumeBtn.removeEventListener('click', handler);
        onResume();
    };
    resumeBtn.addEventListener('click', handler);
}

export function hidePause() {
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// ─── Review Screen ───

export function renderReview(session) {
    const el = document.getElementById('review-content');
    if (!el) return;

    const accuracy = session.totalProblems > 0
        ? Math.round(session.accuracy * 100)
        : 0;

    const avgTime = session.totalProblems > 0
        ? (session.avgResponseTimeMs / 1000).toFixed(1)
        : '0.0';

    el.innerHTML = `
        <div class="review-stats-grid">
            <div class="review-stat">
                <div class="review-stat-value">${session.totalProblems}</div>
                <div class="review-stat-label">Problems</div>
            </div>
            <div class="review-stat">
                <div class="review-stat-value">${session.totalCorrect}</div>
                <div class="review-stat-label">Correct</div>
            </div>
            <div class="review-stat">
                <div class="review-stat-value">${accuracy}%</div>
                <div class="review-stat-label">Accuracy</div>
            </div>
            <div class="review-stat">
                <div class="review-stat-value">${avgTime}s</div>
                <div class="review-stat-label">Avg Time</div>
            </div>
            <div class="review-stat">
                <div class="review-stat-value">${session.streakPeak}</div>
                <div class="review-stat-label">Best Streak</div>
            </div>
            <div class="review-stat">
                <div class="review-stat-value">+${session.xpEarned}</div>
                <div class="review-stat-label">XP Earned</div>
            </div>
        </div>
        ${renderWeakestProblems(session.weakestProblems)}
        ${renderOperationBreakdown(session.operationBreakdown)}
    `;
}

function renderWeakestProblems(problems) {
    if (!problems || problems.length === 0) return '';
    return `
        <div class="review-section">
            <h3>Focus Areas</h3>
            <div class="weak-problems-list">
                ${problems.map(p => `<span class="weak-problem-tag">${p}</span>`).join('')}
            </div>
        </div>
    `;
}

function renderOperationBreakdown(breakdown) {
    if (!breakdown) return '';
    const ops = Object.entries(breakdown).filter(([, v]) => v.count > 0);
    if (ops.length === 0) return '';

    return `
        <div class="review-section">
            <h3>By Operation</h3>
            <div class="op-breakdown">
                ${ops.map(([op, data]) => {
                    const acc = data.count > 0 ? Math.round((data.correct / data.count) * 100) : 0;
                    const avg = data.count > 0 ? (data.avgTimeMs / 1000).toFixed(1) : '0.0';
                    return `
                        <div class="op-breakdown-row">
                            <span class="op-name">${getOperatorSymbol(op)} ${op}</span>
                            <span class="op-acc">${acc}%</span>
                            <span class="op-speed">${avg}s</span>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

// ─── XP Gain Animation ───

export function showXpGain(amount) {
    if (amount <= 0) return;
    const el = document.createElement('div');
    el.className = 'xp-float';
    el.textContent = `+${amount} XP`;
    const container = document.getElementById('xp-float-container');
    if (!container) return;
    container.appendChild(el);
    setTimeout(() => el.remove(), 1000);
}

// ─── Level Up Animation ───

export function showLevelUp(newLevel) {
    const overlay = document.getElementById('levelup-overlay');
    if (!overlay) return;
    const levelText = overlay.querySelector('.levelup-level');
    if (levelText) levelText.textContent = `Level ${newLevel}!`;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 2000);
}

// ─── Sound Engine (Web Audio API) ───

class SoundEngine {
    constructor() {
        this.ctx = null;
        this.enabled = true;
    }

    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.warn('Web Audio not available');
        }
    }

    setEnabled(on) {
        this.enabled = on;
    }

    playTone(freq, duration, type = 'sine', delay = 0, volume = 0.3) {
        if (!this.enabled || !this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, this.ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + delay + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + delay);
        osc.stop(this.ctx.currentTime + delay + duration + 0.05);
    }

    playCorrect() {
        this.playTone(523.25, 0.1, 'sine', 0, 0.25);
        this.playTone(659.25, 0.1, 'sine', 0.08, 0.25);
    }

    playWrong() {
        this.playTone(174.61, 0.25, 'triangle', 0, 0.15);
    }

    playStreak(count) {
        if (count < 3) return;
        const baseFreq = 440;
        const steps = Math.min(count - 2, 5);
        for (let i = 0; i < steps; i++) {
            this.playTone(baseFreq * Math.pow(1.1225, i), 0.08, 'sine', i * 0.06, 0.2);
        }
    }

    playLevelUp() {
        const notes = [523.25, 659.25, 783.99, 1046.50];
        notes.forEach((f, i) => {
            this.playTone(f, 0.15, 'sine', i * 0.12, 0.25);
        });
    }

    playCountdownTick() {
        this.playTone(800, 0.05, 'sine', 0, 0.1);
    }

    playGo() {
        this.playTone(1046.50, 0.15, 'sine', 0, 0.3);
    }
}

export const sound = new SoundEngine();

// ─── Home Screen ───

export function updateHomeStats() {
    updateXpDisplay();
}

// ─── Settings Screen ───

export function populateSettings(settings, onSave) {
    // Timer
    const timerSlider = document.getElementById('setting-timer');
    const timerVal = document.getElementById('setting-timer-val');
    if (timerSlider && timerVal) {
        timerSlider.value = settings.timerSeconds;
        timerVal.textContent = `${settings.timerSeconds}s`;
        timerSlider.oninput = () => {
            timerVal.textContent = `${timerSlider.value}s`;
        };
    }

    // Sound
    const soundToggle = document.getElementById('setting-sound');
    if (soundToggle) soundToggle.checked = settings.soundEnabled;

    // Theme
    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) themeSelect.value = settings.theme;

    // Operations
    for (const op of ['add', 'sub', 'mul', 'div']) {
        const toggle = document.getElementById(`setting-${op}-enabled`);
        if (toggle) toggle.checked = settings.operationRanges[op].enabled;

        for (const param of ['minA', 'maxA', 'minB', 'maxB']) {
            const input = document.getElementById(`setting-${op}-${param}`);
            if (input) input.value = settings.operationRanges[op][param];
        }
    }
}

export function readSettings(currentSettings) {
    const s = JSON.parse(JSON.stringify(currentSettings));

    const timerSlider = document.getElementById('setting-timer');
    if (timerSlider) s.timerSeconds = parseInt(timerSlider.value, 10);

    const soundToggle = document.getElementById('setting-sound');
    if (soundToggle) s.soundEnabled = soundToggle.checked;

    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) s.theme = themeSelect.value;

    for (const op of ['add', 'sub', 'mul', 'div']) {
        const toggle = document.getElementById(`setting-${op}-enabled`);
        if (toggle) s.operationRanges[op].enabled = toggle.checked;

        for (const param of ['minA', 'maxA', 'minB', 'maxB']) {
            const input = document.getElementById(`setting-${op}-${param}`);
            if (input) {
                const val = parseInt(input.value, 10);
                if (!isNaN(val) && val > 0) s.operationRanges[op][param] = val;
            }
        }
    }

    return s;
}

// ─── Theme ───

export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}
