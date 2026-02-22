// QuantPerfector — Constants & Configuration

export const OPERATIONS = {
    add: { symbol: '+', name: 'Addition', commutative: true },
    sub: { symbol: '\u2212', name: 'Subtraction', commutative: false },
    mul: { symbol: '\u00D7', name: 'Multiplication', commutative: true },
    div: { symbol: '\u00F7', name: 'Division', commutative: false }
};

export const DEFAULT_SETTINGS = {
    theme: 'dark',
    soundEnabled: true,
    timerSeconds: 10,
    sessionDurations: {
        sprint: 120,
        flow: 900,
        deep: 1800
    },
    operationRanges: {
        add: { minA: 10, maxA: 99, minB: 10, maxB: 99, enabled: true },
        sub: { minA: 20, maxA: 99, minB: 10, maxB: 99, enabled: true },
        mul: { minA: 2, maxA: 12, minB: 2, maxB: 12, enabled: true },
        div: { minA: 2, maxA: 12, minB: 2, maxB: 12, enabled: true }
    }
};

export const SESSION_MODES = {
    sprint: { label: 'Sprint', duration: 120, warmupCount: 3, description: '2 min — quick burst' },
    flow:   { label: 'Flow',   duration: 900, warmupCount: 6, description: '15 min — build focus' },
    deep:   { label: 'Deep',   duration: 1800, warmupCount: 8, description: '30 min — deep practice' }
};

export const XP = {
    BASE: 5,
    SPEED_THRESHOLDS: [
        { ratio: 0.25, bonus: 5 },
        { ratio: 0.50, bonus: 3 },
        { ratio: 0.75, bonus: 1 }
    ],
    STREAK_MULTIPLIER: 2,
    STREAK_CAP: 20
};

export const SM2_DEFAULTS = {
    EASE_FACTOR: 2.5,
    MIN_EASE: 1.3,
    MAX_EASE: 3.0,
    INITIAL_INTERVAL: 1,
    SECOND_INTERVAL: 3
};

export const STREAK_LEVELS = [
    { min: 0,  label: '',    css: '' },
    { min: 3,  label: '🔥',  css: 'level-2' },
    { min: 5,  label: '🔥🔥', css: 'level-3' },
    { min: 8,  label: '🔥🔥🔥', css: 'level-4' },
    { min: 10, label: '🔥💥⭐', css: 'level-5' }
];

// Mental math hints for specific tricky problems
const MANUAL_HINTS = {
    'mul:7x8':  '5, 6, 7, 8 → 56 = 7 × 8',
    'mul:6x7':  '6 × 7 = 42 — the answer to everything',
    'mul:6x8':  '6 × 8 = 48 — think 6, 8 → 4, 8 → 48',
    'mul:7x9':  '7 × 9 = 63 — digits sum to 9: 6+3',
    'mul:8x9':  '8 × 9 = 72 — digits sum to 9: 7+2',
    'mul:4x7':  '4 × 7 = 28 — days in February',
    'mul:3x7':  '3 × 7 = 21 — blackjack!',
    'mul:6x9':  '6 × 9 = 54 — think: 54 = 6 × 9',
    'mul:7x7':  '7 × 7 = 49 — a perfect square',
    'mul:8x8':  '8 × 8 = 64 — a chessboard',
    'mul:9x9':  '9 × 9 = 81 — 8+1=9, it\'s a 9-pattern',
    'mul:11x11': '11 × 11 = 121 — palindrome!',
    'mul:12x12': '12 × 12 = 144 — a gross',
};

export function generateHint(operation, a, b, correctAnswer) {
    const key = canonicalizeProblemKey(operation, a, b);
    if (MANUAL_HINTS[key]) {
        return MANUAL_HINTS[key];
    }

    switch (operation) {
        case 'mul': {
            if (a === 9 || b === 9) {
                const other = a === 9 ? b : a;
                return `9 × ${other}: tens digit = ${other - 1}, ones = ${9 - (other - 1)} → ${correctAnswer}`;
            }
            if (a === 11 || b === 11) {
                const other = a === 11 ? b : a;
                if (other <= 9) return `11 × ${other} = ${other}${other} → ${correctAnswer}`;
                return `11 × ${other} = (10 × ${other}) + ${other} = ${10 * other} + ${other} = ${correctAnswer}`;
            }
            const larger = Math.max(a, b);
            const smaller = Math.min(a, b);
            if (larger > 10) {
                const tens = Math.floor(larger / 10) * 10;
                const ones = larger - tens;
                return `${larger} × ${smaller} = (${tens}×${smaller}) + (${ones}×${smaller}) = ${tens * smaller} + ${ones * smaller} = ${correctAnswer}`;
            }
            if (a === 5 || b === 5) {
                const other = a === 5 ? b : a;
                return `5 × ${other} = ${other * 10} ÷ 2 = ${correctAnswer}`;
            }
            return `${a} × ${b} = ${correctAnswer}`;
        }
        case 'add': {
            const roundedB = Math.round(b / 10) * 10;
            const diff = b - roundedB;
            if (diff === 0) return `${a} + ${b} = ${correctAnswer}`;
            const sign = diff > 0 ? '+' : '';
            return `${a} + ${b} = ${a} + ${roundedB} ${sign}${diff} = ${a + roundedB} ${sign}${diff} = ${correctAnswer}`;
        }
        case 'sub': {
            const roundedB2 = Math.round(b / 10) * 10;
            const diff2 = b - roundedB2;
            if (diff2 === 0) return `${a} − ${b} = ${correctAnswer}`;
            const adjust = diff2 > 0 ? `− ${diff2}` : `+ ${Math.abs(diff2)}`;
            // If we round b up, we subtracted too much, so add back
            // If we round b down, we subtracted too little, so subtract more
            const adjustSign = diff2 > 0 ? '+' : '−';
            const adjustVal = Math.abs(diff2);
            return `${a} − ${b} = ${a} − ${roundedB2} ${adjustSign} ${adjustVal} = ${a - roundedB2} ${adjustSign} ${adjustVal} = ${correctAnswer}`;
        }
        case 'div':
            return `${a} ÷ ${b} → think: ${b} × ? = ${a} → ${b} × ${correctAnswer} = ${a}`;
        default:
            return `= ${correctAnswer}`;
    }
}

export function canonicalizeProblemKey(operation, a, b) {
    if (operation === 'add' || operation === 'mul') {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return `${operation}:${lo}x${hi}`;
    }
    return `${operation}:${a}x${b}`;
}

export function getOperatorSymbol(operation) {
    return OPERATIONS[operation]?.symbol || '?';
}

export function getLevel(totalXP) {
    return Math.floor(Math.sqrt(totalXP / 50)) + 1;
}

export function xpForLevel(level) {
    return level * level * 50;
}

export function xpProgress(totalXP) {
    const level = getLevel(totalXP);
    const currentLevelXP = (level - 1) * (level - 1) * 50;
    const nextLevelXP = level * level * 50;
    const range = nextLevelXP - currentLevelXP;
    if (range === 0) return 0;
    return (totalXP - currentLevelXP) / range;
}

export function calculateXP(isCorrect, responseTimeMs, timerLimitMs, currentStreak) {
    if (!isCorrect) return 0;
    let xp = XP.BASE;
    const speedRatio = responseTimeMs / timerLimitMs;
    for (const t of XP.SPEED_THRESHOLDS) {
        if (speedRatio <= t.ratio) {
            xp += t.bonus;
            break;
        }
    }
    xp += Math.min(XP.STREAK_CAP, currentStreak * XP.STREAK_MULTIPLIER);
    return xp;
}
