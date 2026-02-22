// QuantPerfector — Main Controller & Session State Machine

import { SESSION_MODES, calculateXP, getLevel, getOperatorSymbol, canonicalizeProblemKey } from './constants.js';
import { loadAll, getSettings, saveSettings, addXp, getTotalXp, logAttempt, saveSession,
         updatePersonalBestSpeed, getProblemRecord, saveProblemRecord, createProblemRecord,
         exportData, importData, resetAll, syncOnLoad } from './storage.js';
import { initFirebase, signInAnonymously, completeSignInWithLink } from './firebase.js';
import { initAuthUI } from './auth-ui.js';
import { buildProblemPool, selectNextProblem, recordAttempt, generateRandomProblem,
         getDrillProblems, selectDrillProblem } from './engine.js';
import { showScreen, displayProblem, updateAnswerDisplay, startCountdownBar, resetCountdownBar,
         updateSessionTimer, updateSessionProgress, updateStreak, updateXpDisplay, showFeedback,
         updateModeBadge, showCountdown, showPause, hidePause, renderReview, showXpGain,
         showLevelUp, sound, populateSettings, readSettings, applyTheme, updateHomeStats } from './ui.js';
import { getOperationStats, getWeakestProblems, getSessionHistory, getImprovementTrend,
         getFocusRecommendation, getWeaknessMap, getAllTimeStats } from './stats.js';
import { drawLineChart, drawHeatmapGrid, drawBarChart, setupHeatmapTooltip } from './charts.js';

// ─── State ───

let state = 'IDLE'; // IDLE | STARTING | WARMUP | CORE | CHALLENGE | PAUSED | REVIEWING | DRILLING
let pausedState = null;

let sessionMode = 'flow';
let sessionStartTime = 0;
let sessionDurationMs = 0;
let sessionTimerInterval = null;
let problemTimerTimeout = null;
let problemStartTime = 0;

let currentProblem = null;
let answerBuffer = '';
let isNegative = false;
let streak = 0;
let sessionXp = 0;
let sessionAttempts = [];
let sessionTotalCorrect = 0;
let sessionStreakPeak = 0;

let drillPool = [];

// ─── Init ───

export function init() {
    // 1. Load from localStorage (instant)
    loadAll();
    const settings = getSettings();
    applyTheme(settings.theme);
    sound.setEnabled(settings.soundEnabled);

    buildProblemPool();

    // 2. Bind all event handlers (instant)
    bindHomeButtons();
    bindSessionInput();
    bindReviewButtons();
    bindDashboardButtons();
    bindSettingsButtons();
    bindDrillButtons();
    bindPauseButton();

    // Page visibility — auto-pause
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && (state === 'WARMUP' || state === 'CORE' || state === 'CHALLENGE' || state === 'DRILLING')) {
            pauseSession();
        }
    });

    // 3. Show home screen with local data (instant)
    showScreen('screen-home');
    updateHomeScreen();

    // 4. Firebase bootstrap (non-blocking, background)
    bootstrapCloud();
}

async function bootstrapCloud() {
    try {
        await initFirebase();
    } catch (err) {
        console.warn('[QP] initFirebase failed:', err.message);
        return;
    }

    try {
        await completeSignInWithLink();
    } catch (err) {
        console.warn('[QP] completeSignInWithLink failed:', err.message);
    }

    try {
        await signInAnonymously();
    } catch (err) {
        console.warn('[QP] signInAnonymously failed:', err.message);
    }

    initAuthUI();

    try {
        const merged = await syncOnLoad();
        if (merged) {
            buildProblemPool();
            updateHomeScreen();
        }
    } catch (err) {
        console.warn('[QP] syncOnLoad failed:', err.message);
    }
}

// ─── Home Screen ───

function updateHomeScreen() {
    updateHomeStats();

    const rec = getFocusRecommendation();
    const recEl = document.getElementById('focus-rec');
    if (recEl) {
        if (rec) {
            recEl.innerHTML = `Focus: <strong>${rec.symbol} ${rec.operation}</strong> — ${rec.reason}`;
            recEl.classList.remove('hidden');
        } else {
            recEl.classList.add('hidden');
        }
    }

    // Drill button — show count
    const drillBtn = document.getElementById('btn-drill');
    if (drillBtn) {
        const drills = getDrillProblems();
        if (drills.length > 0) {
            drillBtn.textContent = `Mistake Drill (${drills.length})`;
            drillBtn.disabled = false;
        } else {
            drillBtn.textContent = 'Mistake Drill';
            drillBtn.disabled = false;
        }
    }
}

function bindHomeButtons() {
    for (const mode of Object.keys(SESSION_MODES)) {
        const btn = document.getElementById(`btn-mode-${mode}`);
        if (btn) btn.addEventListener('click', () => startSession(mode));
    }

    const drillBtn = document.getElementById('btn-drill');
    if (drillBtn) drillBtn.addEventListener('click', startDrill);

    const dashBtn = document.getElementById('btn-dashboard');
    if (dashBtn) dashBtn.addEventListener('click', showDashboard);

    const settingsBtn = document.getElementById('btn-settings');
    if (settingsBtn) settingsBtn.addEventListener('click', showSettingsScreen);
}

// ─── Session ───

function startSession(mode) {
    sessionMode = mode;
    const modeConfig = SESSION_MODES[mode];
    sessionDurationMs = modeConfig.duration * 1000;

    // Init audio on user gesture
    sound.init();

    resetSessionState();
    updateModeBadge(mode);
    showScreen('screen-session');
    state = 'STARTING';

    showCountdown(() => {
        sessionStartTime = Date.now();
        state = 'WARMUP';
        startSessionTimer();
        nextProblem();
    });
}

function resetSessionState() {
    answerBuffer = '';
    isNegative = false;
    streak = 0;
    sessionXp = 0;
    sessionAttempts = [];
    sessionTotalCorrect = 0;
    sessionStreakPeak = 0;
    currentProblem = null;
    updateStreak(0);
    updateSessionProgress(0);
    updateXpDisplay();
}

function startSessionTimer() {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = setInterval(() => {
        const elapsed = Date.now() - sessionStartTime;
        const remaining = sessionDurationMs - elapsed;
        updateSessionTimer(remaining);
        updateSessionProgress(elapsed / sessionDurationMs);

        // Phase transitions
        if (state === 'WARMUP') {
            const warmupTarget = SESSION_MODES[sessionMode].warmupCount;
            if (sessionAttempts.length >= warmupTarget) {
                state = 'CORE';
            }
        } else if (state === 'CORE') {
            if (elapsed >= sessionDurationMs * 0.80) {
                state = 'CHALLENGE';
            }
        }

        if (remaining <= 0) {
            endSession();
        }
    }, 200);
}

function nextProblem() {
    if (state === 'REVIEWING' || state === 'IDLE') return;

    answerBuffer = '';
    isNegative = false;
    updateAnswerDisplay('?');

    const phase = state.toLowerCase();

    if (state === 'DRILLING') {
        currentProblem = selectDrillProblem(drillPool, sessionAttempts);
        if (!currentProblem) {
            endSession();
            return;
        }
    } else {
        currentProblem = selectNextProblem(sessionAttempts, phase);
        if (!currentProblem) {
            // Fallback: random problem
            const settings = getSettings();
            const ops = Object.keys(settings.operationRanges).filter(op => settings.operationRanges[op].enabled);
            if (ops.length === 0) { endSession(); return; }
            currentProblem = generateRandomProblem(ops[Math.floor(Math.random() * ops.length)]);
        }
    }

    displayProblem(currentProblem);
    problemStartTime = Date.now();

    // Per-problem timer
    const settings = getSettings();
    const timerMs = settings.timerSeconds * 1000;
    startCountdownBar(timerMs);
    clearTimeout(problemTimerTimeout);
    problemTimerTimeout = setTimeout(() => handleTimeout(), timerMs);
}

function submitAnswer() {
    if (!currentProblem) return;

    clearTimeout(problemTimerTimeout);
    resetCountdownBar();

    const responseTimeMs = Date.now() - problemStartTime;
    const userAnswer = isNegative ? -parseInt(answerBuffer, 10) : parseInt(answerBuffer, 10);
    const isCorrect = userAnswer === currentProblem.answer;
    const settings = getSettings();
    const timerLimitMs = settings.timerSeconds * 1000;

    processAnswer(isCorrect, userAnswer, responseTimeMs, timerLimitMs, false);
}

function handleTimeout() {
    if (!currentProblem) return;
    resetCountdownBar();
    const responseTimeMs = getSettings().timerSeconds * 1000;
    processAnswer(false, null, responseTimeMs, responseTimeMs, true);
}

function processAnswer(isCorrect, userAnswer, responseTimeMs, timerLimitMs, timedOut) {
    const prevLevel = getLevel(getTotalXp());

    // Update SM-2 record
    let rec = getProblemRecord(currentProblem.key);
    if (!rec) {
        rec = createProblemRecord(currentProblem.key, currentProblem.operation,
            currentProblem.a, currentProblem.b, currentProblem.answer);
    }
    recordAttempt(rec, isCorrect, responseTimeMs, timerLimitMs, timedOut);

    // XP
    const xp = calculateXP(isCorrect, responseTimeMs, timerLimitMs, streak);
    if (xp > 0) {
        addXp(xp);
        sessionXp += xp;
        showXpGain(xp);
    }

    // Streak
    if (isCorrect) {
        streak++;
        sessionTotalCorrect++;
        if (streak > sessionStreakPeak) sessionStreakPeak = streak;
        updatePersonalBestSpeed(currentProblem.key, responseTimeMs);
        sound.playCorrect();
        if (streak >= 3) sound.playStreak(streak);
    } else {
        streak = 0;
        sound.playWrong();
    }
    updateStreak(streak);
    updateXpDisplay();

    // Log attempt
    const attempt = {
        id: `a_${Date.now()}_${sessionAttempts.length}`,
        sessionId: `s_${sessionStartTime}`,
        problemKey: currentProblem.key,
        operation: currentProblem.operation,
        operandA: currentProblem.a,
        operandB: currentProblem.b,
        correctAnswer: currentProblem.answer,
        userAnswer,
        isCorrect,
        responseTimeMs,
        timestamp: new Date().toISOString(),
        timedOut,
        phase: state.toLowerCase()
    };
    sessionAttempts.push(attempt);
    logAttempt(attempt);

    // Level up check
    const newLevel = getLevel(getTotalXp());
    if (newLevel > prevLevel) {
        showLevelUp(newLevel);
        sound.playLevelUp();
    }

    // Show feedback then advance
    showFeedback(isCorrect, currentProblem, userAnswer);

    const delay = isCorrect ? 300 : 2000;
    setTimeout(() => nextProblem(), delay);
}

function endSession() {
    clearInterval(sessionTimerInterval);
    clearTimeout(problemTimerTimeout);
    resetCountdownBar();

    state = 'REVIEWING';

    // Build session record
    const totalProblems = sessionAttempts.length;
    const accuracy = totalProblems > 0 ? sessionTotalCorrect / totalProblems : 0;
    const totalTimeMs = sessionAttempts.reduce((s, a) => s + a.responseTimeMs, 0);
    const avgResponseTimeMs = totalProblems > 0 ? totalTimeMs / totalProblems : 0;

    // Operation breakdown
    const opBreakdown = {};
    for (const a of sessionAttempts) {
        if (!opBreakdown[a.operation]) {
            opBreakdown[a.operation] = { count: 0, correct: 0, totalTimeMs: 0, avgTimeMs: 0 };
        }
        opBreakdown[a.operation].count++;
        if (a.isCorrect) opBreakdown[a.operation].correct++;
        opBreakdown[a.operation].totalTimeMs += a.responseTimeMs;
    }
    for (const op of Object.keys(opBreakdown)) {
        opBreakdown[op].avgTimeMs = opBreakdown[op].count > 0
            ? opBreakdown[op].totalTimeMs / opBreakdown[op].count : 0;
    }

    // Weakest problems (most wrong in this session)
    const wrongCounts = {};
    for (const a of sessionAttempts) {
        if (!a.isCorrect) {
            wrongCounts[a.problemKey] = (wrongCounts[a.problemKey] || 0) + 1;
        }
    }
    const weakest = Object.entries(wrongCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key]) => key);

    const session = {
        id: `s_${sessionStartTime}`,
        mode: sessionMode,
        startTime: new Date(sessionStartTime).toISOString(),
        endTime: new Date().toISOString(),
        durationMs: Date.now() - sessionStartTime,
        totalProblems,
        totalCorrect: sessionTotalCorrect,
        accuracy,
        avgResponseTimeMs,
        xpEarned: sessionXp,
        streakPeak: sessionStreakPeak,
        operationBreakdown: opBreakdown,
        weakestProblems: weakest
    };

    saveSession(session);
    renderReview(session);
    showScreen('screen-review');
}

function pauseSession() {
    if (state === 'PAUSED') return;
    pausedState = state;
    state = 'PAUSED';
    clearInterval(sessionTimerInterval);
    clearTimeout(problemTimerTimeout);
    resetCountdownBar();

    // Adjust session start to account for pause duration
    const pauseStart = Date.now();

    showPause(() => {
        const pauseDuration = Date.now() - pauseStart;
        sessionStartTime += pauseDuration; // Shift start forward by pause duration
        state = pausedState;
        startSessionTimer();
        // Restart problem timer with remaining time
        const elapsed = Date.now() - problemStartTime;
        const settings = getSettings();
        const remaining = settings.timerSeconds * 1000 - elapsed;
        if (remaining > 0) {
            startCountdownBar(remaining);
            problemTimerTimeout = setTimeout(() => handleTimeout(), remaining);
        } else {
            handleTimeout();
        }
    });
}

// ─── Drill Mode ───

function startDrill() {
    drillPool = getDrillProblems();
    if (drillPool.length === 0) {
        // Show empty state
        showScreen('screen-drill');
        const content = document.getElementById('drill-content');
        if (content) content.innerHTML = `
            <div class="drill-empty">
                <h3>No Weak Spots!</h3>
                <p>You don't have enough mistake data yet. Keep practicing and problems you get wrong will appear here.</p>
            </div>
        `;
        return;
    }

    sound.init();
    resetSessionState();
    sessionMode = 'drill';
    sessionDurationMs = 300000; // 5 min max for drill
    updateModeBadge('drill');
    showScreen('screen-session');
    state = 'DRILLING';
    sessionStartTime = Date.now();
    startSessionTimer();
    nextProblem();
}

// ─── Input Handling ───

function bindSessionInput() {
    // Keyboard
    document.addEventListener('keydown', (e) => {
        if (state !== 'WARMUP' && state !== 'CORE' && state !== 'CHALLENGE' && state !== 'DRILLING') return;

        if (e.key >= '0' && e.key <= '9') {
            appendDigit(e.key);
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            deleteLastDigit();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (answerBuffer.length > 0) submitAnswer();
        } else if (e.key === 'Escape') {
            pauseSession();
        } else if (e.key === '-') {
            toggleNegative();
        }
    });

    // Numpad clicks
    const numpad = document.querySelector('.numpad');
    if (numpad) {
        numpad.addEventListener('click', (e) => {
            const btn = e.target.closest('.numpad-key');
            if (!btn) return;
            const key = btn.dataset.key;

            if (state !== 'WARMUP' && state !== 'CORE' && state !== 'CHALLENGE' && state !== 'DRILLING') return;

            if (key === 'delete') deleteLastDigit();
            else if (key === 'enter') { if (answerBuffer.length > 0) submitAnswer(); }
            else if (key === 'negative') toggleNegative();
            else appendDigit(key);
        });
    }
}

function appendDigit(d) {
    if (answerBuffer.length >= 6) return; // Max digits
    answerBuffer += d;
    updateAnswerDisplay((isNegative ? '-' : '') + answerBuffer);
}

function deleteLastDigit() {
    answerBuffer = answerBuffer.slice(0, -1);
    if (answerBuffer.length === 0) isNegative = false;
    updateAnswerDisplay(answerBuffer.length > 0 ? (isNegative ? '-' : '') + answerBuffer : '?');
}

function toggleNegative() {
    isNegative = !isNegative;
    if (answerBuffer.length > 0) {
        updateAnswerDisplay((isNegative ? '-' : '') + answerBuffer);
    }
}

// ─── Review ───

function bindReviewButtons() {
    const doneBtn = document.getElementById('btn-review-done');
    if (doneBtn) doneBtn.addEventListener('click', () => {
        state = 'IDLE';
        showScreen('screen-home');
        updateHomeScreen();
    });

    const againBtn = document.getElementById('btn-review-again');
    if (againBtn) againBtn.addEventListener('click', () => {
        startSession(sessionMode === 'drill' ? 'flow' : sessionMode);
    });
}

// ─── Dashboard ───

function showDashboard() {
    showScreen('screen-dashboard');
    renderDashboard();
}

function renderDashboard() {
    // All-time stats
    const allTime = getAllTimeStats();
    const statsEl = document.getElementById('all-time-stats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="all-time-stat">
                <div class="all-time-stat-value">${allTime.totalSessions}</div>
                <div class="all-time-stat-label">Sessions</div>
            </div>
            <div class="all-time-stat">
                <div class="all-time-stat-value">${allTime.totalProblems}</div>
                <div class="all-time-stat-label">Problems</div>
            </div>
            <div class="all-time-stat">
                <div class="all-time-stat-value">${Math.round(allTime.overallAccuracy * 100)}%</div>
                <div class="all-time-stat-label">Avg Accuracy</div>
            </div>
            <div class="all-time-stat">
                <div class="all-time-stat-value">${allTime.personalBests.longestStreak}</div>
                <div class="all-time-stat-label">Best Streak</div>
            </div>
        `;
    }

    // Accuracy trend
    const trend = getImprovementTrend(30);
    const accCanvas = document.getElementById('chart-accuracy');
    if (accCanvas) {
        drawLineChart(accCanvas, {
            data: trend.accuracy,
            color: '#22c55e',
            fillColor: 'rgba(34,197,94,0.1)',
            yLabel: 'Accuracy',
            xLabels: trend.dates
        });
    }

    // Speed trend
    const speedCanvas = document.getElementById('chart-speed');
    if (speedCanvas) {
        drawLineChart(speedCanvas, {
            data: trend.speed,
            color: '#6366f1',
            fillColor: 'rgba(99,102,241,0.1)',
            yLabel: 'Avg Time (s)',
            xLabels: trend.dates
        });
    }

    // Weakness heatmap (multiplication)
    const settings = getSettings();
    if (settings.operationRanges.mul.enabled) {
        const map = getWeaknessMap('mul');
        const heatCanvas = document.getElementById('chart-heatmap');
        const tooltip = document.getElementById('heatmap-tooltip');
        if (heatCanvas && map) {
            drawHeatmapGrid(heatCanvas, map);
            setupHeatmapTooltip(heatCanvas, tooltip);
        }
    }

    // Session history
    const histEl = document.getElementById('session-history');
    if (histEl) {
        const sessions = getSessionHistory(15);
        if (sessions.length === 0) {
            histEl.innerHTML = '<p style="color: var(--text-muted); text-align: center;">No sessions yet</p>';
        } else {
            histEl.innerHTML = sessions.map(s => {
                const date = new Date(s.startTime);
                const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
                return `<div class="session-item">
                    <span class="session-item-date">${dateStr}</span>
                    <span class="session-item-mode">${s.mode}</span>
                    <span class="session-item-acc">${Math.round(s.accuracy * 100)}%</span>
                    <span class="session-item-count">${s.totalProblems}</span>
                </div>`;
            }).join('');
        }
    }

    // Operation performance
    const opEl = document.getElementById('op-performance');
    if (opEl) {
        const ops = ['add', 'sub', 'mul', 'div'].filter(op => settings.operationRanges[op].enabled);
        const labels = ops.map(op => getOperatorSymbol(op));
        const values = ops.map(op => {
            const s = getOperationStats(op);
            return s ? Math.round(s.accuracy * 100) : 0;
        });
        const colors = ops.map(() => '#6366f1');
        const barCanvas = document.getElementById('chart-ops');
        if (barCanvas) drawBarChart(barCanvas, { labels, values, colors });
    }
}

function bindDashboardButtons() {
    const backBtn = document.getElementById('btn-dash-back');
    if (backBtn) backBtn.addEventListener('click', () => {
        showScreen('screen-home');
        updateHomeScreen();
    });
}

// ─── Settings ───

function showSettingsScreen() {
    const settings = getSettings();
    populateSettings(settings);
    showScreen('screen-settings');
}

function bindSettingsButtons() {
    const backBtn = document.getElementById('btn-settings-back');
    if (backBtn) backBtn.addEventListener('click', () => {
        // Save settings
        const settings = getSettings();
        const newSettings = readSettings(settings);
        saveSettings(newSettings);
        applyTheme(newSettings.theme);
        sound.setEnabled(newSettings.soundEnabled);
        buildProblemPool();
        showScreen('screen-home');
        updateHomeScreen();
    });

    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', () => {
        const json = exportData();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quantperfector_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    const importBtn = document.getElementById('btn-import');
    if (importBtn) importBtn.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    importData(reader.result);
                    alert('Data imported successfully!');
                    showSettingsScreen();
                } catch (err) {
                    alert('Import failed: ' + err.message);
                }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    const resetBtn = document.getElementById('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        if (confirm('Reset ALL data? This cannot be undone.')) {
            if (confirm('Are you absolutely sure? All progress will be lost.')) {
                resetAll();
                buildProblemPool();
                showScreen('screen-home');
                updateHomeScreen();
            }
        }
    });
}

function bindDrillButtons() {
    const drillBackBtn = document.getElementById('btn-drill-back');
    if (drillBackBtn) {
        drillBackBtn.addEventListener('click', () => {
            state = 'IDLE';
            clearInterval(sessionTimerInterval);
            clearTimeout(problemTimerTimeout);
            showScreen('screen-home');
            updateHomeScreen();
        });
    }
}

function bindPauseButton() {
    const pauseBtn = document.getElementById('btn-session-pause');
    if (pauseBtn) {
        pauseBtn.addEventListener('click', () => {
            if (state === 'WARMUP' || state === 'CORE' || state === 'CHALLENGE' || state === 'DRILLING') {
                pauseSession();
            }
        });
    }
}

// ─── Start ───
document.addEventListener('DOMContentLoaded', init);
