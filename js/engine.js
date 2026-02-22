// QuantPerfector — Problem Engine (SM-2, interleaving, problem generation)

import { canonicalizeProblemKey, SM2_DEFAULTS } from './constants.js';
import { getProblemRecord, saveProblemRecord, createProblemRecord, getAllProblemRecords, getSettings } from './storage.js';

// ─── SM-2 Algorithm ───

export function gradeResponse(isCorrect, responseTimeMs, timerLimitMs, timedOut) {
    if (timedOut) return 0;
    if (!isCorrect) return 1;
    const ratio = responseTimeMs / timerLimitMs;
    if (ratio <= 0.25) return 5;
    if (ratio <= 0.50) return 4;
    return 3;
}

function addDays(dateStr, days) {
    const d = dateStr ? new Date(dateStr) : new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
}

function today() {
    return new Date().toISOString().split('T')[0];
}

export function updateSM2(record, quality) {
    if (quality >= 3) {
        if (record.repetitions === 0) {
            record.interval = SM2_DEFAULTS.INITIAL_INTERVAL;
        } else if (record.repetitions === 1) {
            record.interval = SM2_DEFAULTS.SECOND_INTERVAL;
        } else {
            record.interval = Math.round(record.interval * record.easeFactor);
        }
        record.repetitions += 1;
    } else {
        record.repetitions = 0;
        record.interval = 0;
    }

    record.easeFactor = record.easeFactor +
        (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

    record.easeFactor = Math.max(SM2_DEFAULTS.MIN_EASE, Math.min(SM2_DEFAULTS.MAX_EASE, record.easeFactor));
    record.nextReviewDate = addDays(today(), record.interval);

    return record;
}

export function recordAttempt(record, isCorrect, responseTimeMs, timerLimitMs, timedOut) {
    const quality = gradeResponse(isCorrect, responseTimeMs, timerLimitMs, timedOut);

    record.totalAttempts += 1;
    record.totalTimeMs += responseTimeMs;
    record.lastAttemptDate = new Date().toISOString();
    record.lastResponseTimeMs = responseTimeMs;

    if (isCorrect) {
        record.totalCorrect += 1;
        record.streak += 1;
        if (record.streak > record.bestStreak) record.bestStreak = record.streak;
    } else {
        record.streak = 0;
    }

    updateSM2(record, quality);
    saveProblemRecord(record.key, record);

    return { quality, record };
}

// ─── Problem Pool ───

// In-memory pool — the full set of candidate problems
let currentPool = [];

function ensureRecord(operation, a, b, answer) {
    const key = canonicalizeProblemKey(operation, a, b);
    let rec = getProblemRecord(key);
    if (!rec) {
        rec = createProblemRecord(key, operation, a, b, answer);
        // Don't persist yet — only persist when the user actually attempts it
    }
    return rec;
}

export function buildProblemPool() {
    const settings = getSettings();
    currentPool = [];

    for (const op of ['add', 'sub', 'mul', 'div']) {
        const range = settings.operationRanges[op];
        if (!range.enabled) continue;

        if (op === 'mul') {
            for (let a = range.minA; a <= range.maxA; a++) {
                for (let b = a; b <= range.maxB; b++) {
                    currentPool.push(ensureRecord('mul', a, b, a * b));
                }
            }
        } else if (op === 'div') {
            for (let divisor = range.minB; divisor <= range.maxB; divisor++) {
                for (let quotient = range.minA; quotient <= range.maxA; quotient++) {
                    const dividend = divisor * quotient;
                    currentPool.push(ensureRecord('div', dividend, divisor, quotient));
                }
            }
        } else if (op === 'add') {
            const problems = generateRangeProblems('add', range);
            for (const p of problems) {
                currentPool.push(ensureRecord('add', p.a, p.b, p.a + p.b));
            }
        } else if (op === 'sub') {
            const problems = generateRangeProblems('sub', range);
            for (const p of problems) {
                currentPool.push(ensureRecord('sub', p.a, p.b, p.a - p.b));
            }
        }
    }

    return currentPool;
}

export function getPool() {
    return currentPool;
}

function generateRangeProblems(operation, range) {
    const problems = [];
    const bucketSize = 10;

    for (let tensA = Math.floor(range.minA / bucketSize); tensA <= Math.floor(range.maxA / bucketSize); tensA++) {
        for (let tensB = Math.floor(range.minB / bucketSize); tensB <= Math.floor(range.maxB / bucketSize); tensB++) {
            // Generate a few representative problems per bucket
            for (let i = 0; i < 3; i++) {
                const a = Math.min(range.maxA, tensA * bucketSize + Math.floor(Math.random() * bucketSize));
                const b = Math.min(range.maxB, tensB * bucketSize + Math.floor(Math.random() * bucketSize));
                if (a < range.minA || b < range.minB) continue;
                if (operation === 'sub' && a <= b) continue;
                problems.push({ a, b });
            }
        }
    }

    return problems;
}

// ─── On-the-fly problem generation (for add/sub with large ranges) ───

export function generateRandomProblem(operation) {
    const settings = getSettings();
    const range = settings.operationRanges[operation];

    const a = randInt(range.minA, range.maxA);
    const b = randInt(range.minB, range.maxB);

    switch (operation) {
        case 'add':
            return { operation, a, b, answer: a + b, key: canonicalizeProblemKey('add', a, b) };
        case 'sub': {
            const big = Math.max(a, b);
            const small = Math.min(a, b);
            if (big === small) return generateRandomProblem('sub'); // avoid 0
            return { operation, a: big, b: small, answer: big - small, key: canonicalizeProblemKey('sub', big, small) };
        }
        case 'mul':
            return { operation, a, b, answer: a * b, key: canonicalizeProblemKey('mul', a, b) };
        case 'div': {
            const divisor = randInt(range.minB, range.maxB);
            const quotient = randInt(range.minA, range.maxA);
            const dividend = divisor * quotient;
            return { operation, a: dividend, b: divisor, answer: quotient, key: canonicalizeProblemKey('div', dividend, divisor) };
        }
    }
}

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ─── Priority Scoring ───

function calculatePriority(record, sessionAttempts, totalSessionProblems) {
    let score = 50;

    // Factor 1: Due for review
    if (!record.nextReviewDate) {
        score += 20; // Never seen
    } else {
        const todayStr = today();
        if (todayStr >= record.nextReviewDate) {
            const overdueDays = Math.floor((new Date(todayStr) - new Date(record.nextReviewDate)) / 86400000);
            score += Math.min(30, 10 + overdueDays * 5);
        }
    }

    // Factor 2: Low accuracy
    if (record.totalAttempts > 0) {
        const accuracy = record.totalCorrect / record.totalAttempts;
        score += (1 - accuracy) * 40;
    }

    // Factor 3: Low ease factor (hard for user)
    score += (SM2_DEFAULTS.MAX_EASE - record.easeFactor) * 10;

    // Factor 4: Recently wrong in this session
    const sessionWrong = sessionAttempts.filter(a => a.problemKey === record.key && !a.isCorrect).length;
    score += sessionWrong * 15;

    // Factor 5: Recency penalty — don't repeat too soon
    if (sessionAttempts.length > 0) {
        let lastIdx = -1;
        for (let i = sessionAttempts.length - 1; i >= 0; i--) {
            if (sessionAttempts[i].problemKey === record.key) { lastIdx = i; break; }
        }
        if (lastIdx >= 0) {
            const problemsSince = totalSessionProblems - lastIdx - 1;
            if (problemsSince < 5) {
                score -= (5 - problemsSince) * 20;
            }
        }
    }

    // Factor 6: Slow responses
    if (record.totalAttempts > 0) {
        const avgTime = record.totalTimeMs / record.totalAttempts;
        if (avgTime > 7000) score += 10;
    }

    return Math.max(0, score);
}

// ─── Problem Selection ───

export function selectNextProblem(sessionAttempts, phase) {
    const settings = getSettings();
    const enabledOps = Object.keys(settings.operationRanges).filter(op => settings.operationRanges[op].enabled);

    if (enabledOps.length === 0) return null;

    // Use the in-memory pool (built at startup / settings change).
    // Merge with any persisted records so SM-2 state is up to date.
    const persisted = getAllProblemRecords();
    let candidates = currentPool.map(r => persisted[r.key] || r)
        .filter(r => enabledOps.includes(r.operation));

    if (candidates.length === 0) {
        // Absolute fallback
        const op = enabledOps[Math.floor(Math.random() * enabledOps.length)];
        return generateRandomProblem(op);
    }

    // Phase-based filtering
    if (phase === 'warmup') {
        // Prefer easy or new problems
        const easy = candidates.filter(r => r.easeFactor >= 2.3 || r.totalAttempts === 0);
        if (easy.length >= 5) candidates = easy;
    } else if (phase === 'challenge') {
        // Prefer hard problems — ones user has struggled with
        const hard = candidates.filter(r => {
            if (r.totalAttempts === 0) return false;
            const acc = r.totalCorrect / r.totalAttempts;
            return r.easeFactor < 2.0 || acc < 0.7;
        });
        if (hard.length >= 3) candidates = hard;
    }

    // Score all candidates
    const scored = candidates.map(r => ({
        record: r,
        score: calculatePriority(r, sessionAttempts, sessionAttempts.length)
    }));

    // Apply interleaving
    const interleaved = applyInterleaving(scored, sessionAttempts);

    // Balance operations
    const balanced = balanceOperations(interleaved, sessionAttempts, enabledOps);

    // Weighted random from top 10
    balanced.sort((a, b) => b.score - a.score);
    const top = balanced.slice(0, Math.min(10, balanced.length));
    const selected = weightedRandom(top);

    return {
        operation: selected.record.operation,
        a: selected.record.operandA,
        b: selected.record.operandB,
        answer: selected.record.correctAnswer,
        key: selected.record.key
    };
}

function applyInterleaving(scored, sessionAttempts) {
    if (sessionAttempts.length === 0) return scored;

    const last2 = sessionAttempts.slice(-2);
    if (last2.length === 2 && last2[0].operation === last2[1].operation) {
        // Must pick different operation
        const blocked = last2[0].operation;
        const filtered = scored.filter(s => s.record.operation !== blocked);
        if (filtered.length > 0) return filtered;
        return scored;
    }

    // Soft penalty for same operation as last
    if (sessionAttempts.length >= 1) {
        const lastOp = sessionAttempts[sessionAttempts.length - 1].operation;
        return scored.map(s =>
            s.record.operation === lastOp
                ? { ...s, score: s.score * 0.5 }
                : s
        );
    }

    return scored;
}

function balanceOperations(scored, sessionAttempts, enabledOps) {
    if (sessionAttempts.length < 4) return scored;

    const counts = {};
    for (const op of enabledOps) counts[op] = 0;
    for (const a of sessionAttempts) {
        if (counts[a.operation] !== undefined) counts[a.operation]++;
    }

    const total = sessionAttempts.length;
    const expected = 1 / enabledOps.length;

    return scored.map(s => {
        const actual = counts[s.record.operation] / total;
        if (actual < expected * 0.7) {
            return { ...s, score: s.score * 1.5 };
        } else if (actual > expected * 1.3) {
            return { ...s, score: s.score * 0.6 };
        }
        return s;
    });
}

function weightedRandom(items) {
    const totalWeight = items.reduce((sum, item) => sum + Math.max(1, item.score), 0);
    let r = Math.random() * totalWeight;
    for (const item of items) {
        r -= Math.max(1, item.score);
        if (r <= 0) return item;
    }
    return items[items.length - 1];
}

// ─── Mistake Drill ───

export function getDrillProblems() {
    const allRecords = getAllProblemRecords();
    const settings = getSettings();
    const enabledOps = Object.keys(settings.operationRanges).filter(op => settings.operationRanges[op].enabled);

    return Object.values(allRecords).filter(r => {
        if (!enabledOps.includes(r.operation)) return false;
        if (r.totalAttempts < 2) return false;
        const acc = r.totalCorrect / r.totalAttempts;
        return acc < 0.7 || r.easeFactor < 1.8;
    }).sort((a, b) => {
        const accA = a.totalCorrect / a.totalAttempts;
        const accB = b.totalCorrect / b.totalAttempts;
        return accA - accB; // Worst first
    });
}

export function selectDrillProblem(drillPool, sessionAttempts) {
    if (drillPool.length === 0) return null;

    const scored = drillPool.map(r => ({
        record: r,
        score: calculatePriority(r, sessionAttempts, sessionAttempts.length)
    }));

    const interleaved = applyInterleaving(scored, sessionAttempts);
    interleaved.sort((a, b) => b.score - a.score);
    const top = interleaved.slice(0, Math.min(8, interleaved.length));
    const selected = weightedRandom(top);

    return {
        operation: selected.record.operation,
        a: selected.record.operandA,
        b: selected.record.operandB,
        answer: selected.record.correctAnswer,
        key: selected.record.key
    };
}
