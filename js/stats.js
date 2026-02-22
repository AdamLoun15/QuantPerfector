// QuantPerfector — Statistics & Analytics

import { getSessions, getAttemptLog, getAllProblemRecords, getPersonalBests, getSettings } from './storage.js';
import { getOperatorSymbol } from './constants.js';

export function getOperationStats(operation) {
    const records = Object.values(getAllProblemRecords()).filter(r => r.operation === operation);
    if (records.length === 0) return null;

    let totalAttempts = 0, totalCorrect = 0, totalTimeMs = 0;
    for (const r of records) {
        totalAttempts += r.totalAttempts;
        totalCorrect += r.totalCorrect;
        totalTimeMs += r.totalTimeMs;
    }

    const accuracy = totalAttempts > 0 ? totalCorrect / totalAttempts : 0;
    const avgTimeMs = totalAttempts > 0 ? totalTimeMs / totalAttempts : 0;

    // Trend: compare last 7 days vs previous 7 days
    const log = getAttemptLog();
    const now = Date.now();
    const weekMs = 7 * 86400000;
    const recent = log.filter(a => a.operation === operation && (now - new Date(a.timestamp).getTime()) < weekMs);
    const prev = log.filter(a => a.operation === operation &&
        (now - new Date(a.timestamp).getTime()) >= weekMs &&
        (now - new Date(a.timestamp).getTime()) < 2 * weekMs);

    const recentAcc = recent.length > 0 ? recent.filter(a => a.isCorrect).length / recent.length : null;
    const prevAcc = prev.length > 0 ? prev.filter(a => a.isCorrect).length / prev.length : null;

    let trend = 'stable';
    if (recentAcc !== null && prevAcc !== null) {
        if (recentAcc > prevAcc + 0.05) trend = 'improving';
        else if (recentAcc < prevAcc - 0.05) trend = 'declining';
    }

    return { totalAttempts, totalCorrect, accuracy, avgTimeMs, trend };
}

export function getWeakestProblems(limit = 5) {
    const records = Object.values(getAllProblemRecords()).filter(r => r.totalAttempts >= 2);

    const scored = records.map(r => {
        const accuracy = r.totalCorrect / r.totalAttempts;
        const avgTime = r.totalTimeMs / r.totalAttempts;
        const weakness = (1 - accuracy) * 50 + (avgTime / 1000) * 10 + (r.easeFactor < 2 ? 20 : 0);
        return { record: r, weakness };
    });

    scored.sort((a, b) => b.weakness - a.weakness);
    return scored.slice(0, limit).map(s => s.record);
}

export function getSessionHistory(limit = 20) {
    return getSessions().slice(-limit).reverse();
}

export function getImprovementTrend(days = 30) {
    const log = getAttemptLog();
    const now = Date.now();
    const result = { dates: [], accuracy: [], speed: [] };

    for (let d = days - 1; d >= 0; d--) {
        const dayStart = now - (d + 1) * 86400000;
        const dayEnd = now - d * 86400000;
        const dayAttempts = log.filter(a => {
            const t = new Date(a.timestamp).getTime();
            return t >= dayStart && t < dayEnd;
        });

        const date = new Date(dayEnd);
        result.dates.push(`${date.getMonth() + 1}/${date.getDate()}`);

        if (dayAttempts.length > 0) {
            result.accuracy.push(dayAttempts.filter(a => a.isCorrect).length / dayAttempts.length);
            result.speed.push(dayAttempts.reduce((s, a) => s + a.responseTimeMs, 0) / dayAttempts.length / 1000);
        } else {
            result.accuracy.push(null);
            result.speed.push(null);
        }
    }

    return result;
}

export function getFocusRecommendation() {
    const settings = getSettings();
    const enabledOps = Object.keys(settings.operationRanges).filter(op => settings.operationRanges[op].enabled);

    let worstOp = null;
    let worstScore = -1;

    for (const op of enabledOps) {
        const stats = getOperationStats(op);
        if (!stats) continue;

        let score = 0;
        if (stats.totalAttempts < 10) {
            score += 30; // Underexplored
        } else {
            score += (1 - stats.accuracy) * 50;
            score += Math.min(20, stats.avgTimeMs / 500);
        }

        if (stats.trend === 'declining') score += 15;

        if (score > worstScore) {
            worstScore = score;
            worstOp = op;
        }
    }

    if (!worstOp) return null;

    const stats = getOperationStats(worstOp);
    let reason = 'Needs more practice';
    if (stats) {
        if (stats.totalAttempts < 10) reason = 'Not enough practice yet';
        else if (stats.accuracy < 0.7) reason = `Only ${Math.round(stats.accuracy * 100)}% accuracy`;
        else if (stats.avgTimeMs > 5000) reason = `Slow average: ${(stats.avgTimeMs / 1000).toFixed(1)}s`;
        else if (stats.trend === 'declining') reason = 'Declining performance';
    }

    return { operation: worstOp, reason, symbol: getOperatorSymbol(worstOp) };
}

export function getWeaknessMap(operation) {
    const settings = getSettings();
    const range = settings.operationRanges[operation];
    if (!range) return null;

    const records = getAllProblemRecords();
    const grid = [];

    if (operation === 'mul' || operation === 'div') {
        for (let a = range.minA; a <= range.maxA; a++) {
            const row = [];
            for (let b = range.minB; b <= range.maxB; b++) {
                let key;
                if (operation === 'mul') {
                    const lo = Math.min(a, b), hi = Math.max(a, b);
                    key = `mul:${lo}x${hi}`;
                } else {
                    key = `div:${a * b}x${b}`;
                }

                const r = records[key];
                if (!r || r.totalAttempts === 0) {
                    row.push({ value: null, label: operation === 'mul' ? `${a * b}` : `${a}`, attempts: 0 });
                } else {
                    const acc = r.totalCorrect / r.totalAttempts;
                    const avgTime = r.totalTimeMs / r.totalAttempts;
                    // Composite score: accuracy weighted 70%, speed 30%
                    const speedScore = Math.max(0, 1 - avgTime / 10000);
                    const value = acc * 0.7 + speedScore * 0.3;
                    row.push({
                        value,
                        label: operation === 'mul' ? `${a * b}` : `${a}`,
                        attempts: r.totalAttempts,
                        accuracy: Math.round(acc * 100),
                        avgTime: (avgTime / 1000).toFixed(1)
                    });
                }
            }
            grid.push(row);
        }
    }

    return {
        rows: Array.from({ length: range.maxA - range.minA + 1 }, (_, i) => range.minA + i),
        cols: Array.from({ length: range.maxB - range.minB + 1 }, (_, i) => range.minB + i),
        grid
    };
}

export function getAllTimeStats() {
    const sessions = getSessions();
    const pb = getPersonalBests();

    return {
        totalSessions: sessions.length,
        totalProblems: sessions.reduce((s, sess) => s + sess.totalProblems, 0),
        overallAccuracy: sessions.length > 0
            ? sessions.reduce((s, sess) => s + sess.accuracy, 0) / sessions.length
            : 0,
        personalBests: pb
    };
}
