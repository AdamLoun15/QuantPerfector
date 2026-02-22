// QuantPerfector — Lightweight Canvas Charts

export function drawLineChart(canvas, { data, color = '#6366f1', fillColor = 'rgba(99,102,241,0.15)', yLabel = '', xLabels = [] }) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 20, right: 20, bottom: 30, left: 45 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Filter null values but keep indices
    const points = data.map((v, i) => ({ i, v })).filter(p => p.v !== null);
    if (points.length < 2) {
        ctx.fillStyle = '#606070';
        ctx.font = '14px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Not enough data yet', w / 2, h / 2);
        return;
    }

    const minV = Math.min(...points.map(p => p.v));
    const maxV = Math.max(...points.map(p => p.v));
    const range = maxV - minV || 1;

    function toX(i) { return pad.left + (i / (data.length - 1)) * plotW; }
    function toY(v) { return pad.top + plotH - ((v - minV) / range) * plotH; }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH / 4) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(w - pad.right, y);
        ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = '#606070';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const v = minV + (range / 4) * (4 - i);
        const y = pad.top + (plotH / 4) * i;
        ctx.fillText(v.toFixed(v < 1 ? 2 : 1), pad.left - 8, y + 4);
    }

    // X-axis labels
    if (xLabels.length > 0) {
        ctx.textAlign = 'center';
        const step = Math.max(1, Math.floor(xLabels.length / 6));
        for (let i = 0; i < xLabels.length; i += step) {
            ctx.fillText(xLabels[i], toX(i), h - 8);
        }
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(toX(points[0].i), toY(points[0].v));
    for (let j = 1; j < points.length; j++) {
        ctx.lineTo(toX(points[j].i), toY(points[j].v));
    }
    ctx.lineTo(toX(points[points.length - 1].i), pad.top + plotH);
    ctx.lineTo(toX(points[0].i), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(toX(points[0].i), toY(points[0].v));
    for (let j = 1; j < points.length; j++) {
        ctx.lineTo(toX(points[j].i), toY(points[j].v));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Dots
    for (const p of points) {
        ctx.beginPath();
        ctx.arc(toX(p.i), toY(p.v), 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    }

    // Y label
    if (yLabel) {
        ctx.save();
        ctx.fillStyle = '#9898a8';
        ctx.font = '11px Inter, sans-serif';
        ctx.translate(12, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();
    }
}

export function drawHeatmapGrid(canvas, { rows, cols, grid, cellSize = 40 }) {
    if (!canvas || !grid || grid.length === 0) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const headerSize = 30;
    const totalW = headerSize + cols.length * cellSize;
    const totalH = headerSize + rows.length * cellSize;

    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    // Column headers
    ctx.fillStyle = '#9898a8';
    ctx.font = `bold 12px Inter, sans-serif`;
    ctx.textAlign = 'center';
    for (let c = 0; c < cols.length; c++) {
        ctx.fillText(cols[c], headerSize + c * cellSize + cellSize / 2, 20);
    }

    // Row headers
    ctx.textAlign = 'right';
    for (let r = 0; r < rows.length; r++) {
        ctx.fillText(rows[r], headerSize - 8, headerSize + r * cellSize + cellSize / 2 + 4);
    }

    // Cells
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
            const cell = grid[r][c];
            const x = headerSize + c * cellSize;
            const y = headerSize + r * cellSize;

            // Background color
            ctx.fillStyle = getCellColor(cell.value);
            ctx.beginPath();
            ctx.roundRect(x + 2, y + 2, cellSize - 4, cellSize - 4, 4);
            ctx.fill();

            // Label
            ctx.fillStyle = cell.value === null ? '#606070' : '#e8e8f0';
            ctx.font = `bold 12px JetBrains Mono, monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(cell.label, x + cellSize / 2, y + cellSize / 2 + 4);
        }
    }

    // Store grid data for hover
    canvas._heatmapData = { rows, cols, grid, cellSize, headerSize };
}

function getCellColor(value) {
    if (value === null) return 'rgba(55, 65, 81, 0.5)'; // Gray — never attempted

    // Green (high) to Red (low) gradient
    if (value >= 0.85) return 'rgba(34, 197, 94, 0.6)';   // Strong green
    if (value >= 0.7)  return 'rgba(34, 197, 94, 0.35)';  // Light green
    if (value >= 0.5)  return 'rgba(234, 179, 8, 0.4)';   // Yellow
    if (value >= 0.3)  return 'rgba(249, 115, 22, 0.4)';  // Orange
    return 'rgba(239, 68, 68, 0.5)';                       // Red
}

export function drawBarChart(canvas, { labels, values, colors, yLabel = '' }) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 15, right: 15, bottom: 30, left: 40 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    const maxV = Math.max(...values, 1);
    const barW = plotW / values.length * 0.6;
    const gap = plotW / values.length * 0.4;

    for (let i = 0; i < values.length; i++) {
        const barH = (values[i] / maxV) * plotH;
        const x = pad.left + i * (barW + gap) + gap / 2;
        const y = pad.top + plotH - barH;

        ctx.fillStyle = colors[i] || '#6366f1';
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
        ctx.fill();

        // Value on top
        ctx.fillStyle = '#e8e8f0';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(values[i].toString(), x + barW / 2, y - 5);

        // Label below
        ctx.fillStyle = '#9898a8';
        ctx.font = '11px Inter, sans-serif';
        ctx.fillText(labels[i], x + barW / 2, h - 8);
    }
}

// Tooltip helper for heatmap hover
export function setupHeatmapTooltip(canvas, tooltipEl) {
    if (!canvas || !tooltipEl) return;

    canvas.addEventListener('mousemove', (e) => {
        const data = canvas._heatmapData;
        if (!data) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const col = Math.floor((x - data.headerSize) / data.cellSize);
        const row = Math.floor((y - data.headerSize) / data.cellSize);

        if (row >= 0 && row < data.grid.length && col >= 0 && col < data.grid[row].length) {
            const cell = data.grid[row][col];
            if (cell.attempts > 0) {
                tooltipEl.style.display = 'block';
                tooltipEl.style.left = `${e.clientX + 12}px`;
                tooltipEl.style.top = `${e.clientY - 30}px`;
                tooltipEl.innerHTML = `
                    <strong>${data.rows[row]} × ${data.cols[col]}</strong><br>
                    Accuracy: ${cell.accuracy}%<br>
                    Avg: ${cell.avgTime}s<br>
                    Attempts: ${cell.attempts}
                `;
            } else {
                tooltipEl.style.display = 'block';
                tooltipEl.style.left = `${e.clientX + 12}px`;
                tooltipEl.style.top = `${e.clientY - 30}px`;
                tooltipEl.textContent = 'Not attempted';
            }
        } else {
            tooltipEl.style.display = 'none';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        tooltipEl.style.display = 'none';
    });
}
