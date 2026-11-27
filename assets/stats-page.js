/* AnkiNOS statistics workspace.
 * Uses the native Anki GraphsResponse, never estimates scheduling data.
 * Pure SVG: complete Anki statistics sections, per-card interactive controls,
 * deck chooser, card search filter, and Anki-default PDF export. */
(function initNOSStats() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNOSStats, { once: true });
    return;
  }
  const app = document.getElementById('nos-app');
  if (!app || window.NOSStats) return;

  const $ = id => document.getElementById(id);
  const fmtInt = window.NOSI18n.numberFormat({ maximumFractionDigits: 0 });
  const fmt1 = window.NOSI18n.numberFormat({ maximumFractionDigits: 1 });
  const fmt2 = window.NOSI18n.numberFormat({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct1 = window.NOSI18n.numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt = n => fmt1.format(Number(n) || 0);
  const fmtWhole = n => fmtInt.format(Math.round(Number(n) || 0));
  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

  const native = app.dataset.native === 'true';
  const cache = new Map();
  let loading = false;
  let metricData = null;
  let activePayload = null;
  let reportedKey = '';
  let renderedKey = '';
  let paintingKey = '';
  let renderEpoch = 0;

  // Deck chooser & search filter state
  let availableDecks = [];
  let selectedDeckId = '';
  let selectedDeckName = 'Bộ thẻ hiện tại';
  let customSearch = null; // null => derive from scope ('deck:current' or '')
  let deckDraftId = '';

  // Per-card interactive filter state (pure client-side re-rendering of native payload)
  const cardState = {
    future: { backlog: true, range: '1m' },
    calendar: { year: null },
    reviews: { time: false, range: '1m' },
    counts: { separateInactive: true },
    intervals: { range: '95' },
    stability: { range: '95' },
    difficulty: { range: 'all' },
    retrievability: { range: 'all' },
    retention: { mode: 'all' },
    hours: { range: '1y' },
    buttons: { range: '1y' },
    added: { range: '1m' },
  };

  const scope = () => $('stats-scope')?.value || 'deck';
  const days = () => Number($('stats-period')?.value ?? 365);
  const effectiveSearch = () => {
    if (customSearch !== null) return customSearch;
    return scope() === 'collection' ? '' : 'deck:current';
  };
  const cacheKey = () => `${scope()}/${days()}/${selectedDeckId}/${effectiveSearch()}`;

  const getField = (object, key) => num(object?.[key]);
  const sum = arr => arr.reduce((total, n) => total + num(n), 0);
  const mapRows = object => Object.entries(object || {}).map(([key, value]) => ({
    x: Number(key), value: num(value)
  })).filter(p => Number.isFinite(p.x)).sort((a, b) => a.x - b.x);
  const totals = (v, keys) => sum(keys.map(k => getField(v, k)));
  const emptyBox = (label = 'KHÔNG CÓ DỮ LIỆU') => `<div class="stats-empty-box">${esc(label)}</div>`;

  const minutes = millis => {
    const m = num(millis) / 60000;
    return m < 1 ? fmt(m * 60) + ' giây' : fmt(m) + ' phút';
  };
  const percent = (passed, failed, decimals = 1) => {
    const total = num(passed) + num(failed);
    if (!total) return 'Không xác định';
    const ratio = (100 * num(passed)) / total;
    return (decimals === 1 ? fmtPct1.format(ratio) : fmt2.format(ratio)) + '%';
  };
  const weightedStats = rows => {
    let total = 0, weightedSum = 0;
    for (const r of rows) {
      const c = num(r.value);
      total += c;
      weightedSum += r.x * c;
    }
    if (!total) return { total: 0, average: null, median: null };
    const half = total / 2;
    let acc = 0, median = rows[0].x;
    for (const r of rows) {
      acc += num(r.value);
      if (acc >= half) { median = r.x; break; }
    }
    return { total, average: weightedSum / total, median };
  };
  const weightedPercentile = (rows, pct) => {
    const total = sum(rows.map(r => r.value));
    if (!total) return 0;
    const target = total * (pct / 100);
    let acc = 0;
    for (const r of rows) {
      acc += num(r.value);
      if (acc >= target) return r.x;
    }
    return rows.length ? rows[rows.length - 1].x : 0;
  };

  function radioGroup(section, field, options, current) {
    return `<div class="stats-card-radios" role="radiogroup">${options.map(([value, label]) => {
      const active = String(current) === String(value);
      return `<button type="button" class="stats-mini-radio${active ? ' active' : ''}" data-card-section="${section}" data-card-field="${field}" data-card-value="${esc(value)}" role="radio" aria-checked="${active}"><i aria-hidden="true"></i>${esc(label)}</button>`;
    }).join('')}</div>`;
  }
  function checkToggle(section, field, label, checked) {
    return `<button type="button" class="stats-mini-check${checked ? ' active' : ''}" data-card-section="${section}" data-card-field="${field}" data-card-toggle="true" role="checkbox" aria-checked="${!!checked}"><i aria-hidden="true">${checked ? '✓' : ''}</i>${esc(label)}</button>`;
  }

  function frame(sectionKey, title, caption, controls, body, footer = '', opts = {}) {
    const wide = !!opts.wide;
    const help = opts.help ? `<span class="stats-help-badge" tabindex="0" title="${esc(opts.help)}" aria-label="${esc(opts.help)}">?</span>` : '';
    return `<article class="stats-native-card${wide ? ' stats-card-wide' : ''}" data-stats-section="${esc(sectionKey)}">` +
      `<div class="stats-card-head"><h3>${esc(title)}</h3>${help}</div>` +
      (caption ? `<p class="stats-card-caption">${esc(caption)}</p>` : '') +
      (controls ? `<div class="stats-card-controls">${controls}</div>` : '') +
      `<div class="stats-card-body">${body}</div>` +
      (footer ? `<footer class="stats-card-foot">${footer}</footer>` : '') +
      `</article>`;
  }

  function legend(items) {
    return '<div class="stats-legend">' + items.map(([name, color]) =>
      `<span><i style="background:${color}"></i>${esc(name)}</span>`).join('') + '</div>';
  }

  // Group dense daily series into clean buckets while preserving exact totals.
  function groupRows(items, maxBars = 62, kinds = null) {
    if (items.length <= maxBars) return items;
    const stride = Math.ceil(items.length / maxBars);
    const result = [];
    for (let i = 0; i < items.length; i += stride) {
      const slice = items.slice(i, i + stride);
      const first = slice[0], last = slice[slice.length - 1];
      const label = first.label && last.label
        ? (first.label === last.label ? first.label : `${first.label} – ${last.label}`)
        : (first.x === last.x ? String(first.x) : `${first.x}–${last.x}`);
      const axisLabel = first.axisLabel ?? String(first.x);
      if (kinds) {
        const values = Object.fromEntries(kinds.map(k => [k, sum(slice.map(p => p.values?.[k]))]));
        result.push({ x: first.x, xEnd: last.x, label, axisLabel, values });
      } else {
        const color = slice.find(p => p.color)?.color;
        result.push({ x: first.x, xEnd: last.x, label, axisLabel, value: sum(slice.map(p => p.value)), color });
      }
    }
    return result;
  }

  function niceMax(value) {
    if (value <= 0) return 4;
    if (value <= 4) return 4;
    if (value <= 8) return 8;
    if (value <= 12) return 12;
    if (value <= 16) return 16;
    if (value <= 20) return 20;
    const exp = Math.pow(10, Math.floor(Math.log10(value)));
    const frac = value / exp;
    const nice = frac <= 1.2 ? 1.2 : frac <= 1.6 ? 1.6 : frac <= 2 ? 2 : frac <= 2.4 ? 2.4 : frac <= 3.2 ? 3.2 : frac <= 4 ? 4 : frac <= 6 ? 6 : frac <= 8 ? 8 : 10;
    return Math.ceil((nice * exp) / 4) * 4;
  }

  // Dual-axis bar chart (optional cumulative translucent area on right Y-axis, or % area curve).
  function barPlot(input, opts = {}) {
    const rows = groupRows(input, opts.maxBars || 62);
    if (!rows.length) return emptyBox(opts.emptyLabel);
    const rawMax = Math.max(0, ...rows.map(x => num(x.value)));
    if (rawMax === 0 && !opts.allowEmptyBars) return emptyBox(opts.emptyLabel);
    const max = niceMax(Math.max(1, rawMax));
    const hasRightAxis = !!(opts.cumulative || opts.percentArea);
    const W = 660, H = 228, L = 52, R = hasRightAxis ? 56 : 16, T = 14, B = 30;
    const h = H - T - B, w = W - L - R;
    const bw = w / rows.length;

    let svg = `<svg class="stats-chart" role="img" aria-label="${esc(opts.aria || 'Biểu đồ cột')}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
    // Horizontal grid + left Y ticks
    const steps = 4;
    for (let j = 0; j <= steps; j++) {
      const y = T + (h * j) / steps;
      const tickVal = (max * (steps - j)) / steps;
      svg += `<line class="stats-plot-grid" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}"/>`;
      svg += `<text class="stats-axis-txt" text-anchor="end" x="${L - 6}" y="${(y + 3).toFixed(1)}">${esc(opts.tick ? opts.tick(tickVal) : fmt(tickVal))}</text>`;
    }

    // Background cumulative area (behind bars, just like Anki)
    let cumValues = [];
    if (opts.cumulative) {
      let acc = 0;
      cumValues = rows.map(r => (acc += num(r.value)));
      const cumMax = niceMax(Math.max(1, acc));
      for (let j = 0; j <= steps; j++) {
        const y = T + (h * j) / steps;
        const v = (cumMax * (steps - j)) / steps;
        svg += `<text class="stats-axis-txt stats-axis-right" text-anchor="start" x="${W - R + 6}" y="${(y + 3).toFixed(1)}">${esc(opts.cumTick ? opts.cumTick(v) : fmtWhole(v))}</text>`;
      }
      let linePts = '';
      rows.forEach((r, i) => {
        const x = L + (i + 0.5) * bw;
        const y = T + h - (cumValues[i] / cumMax) * h;
        linePts += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      const firstX = (L + 0.5 * bw).toFixed(1);
      const lastX = (L + (rows.length - 0.5) * bw).toFixed(1);
      const baseY = (T + h).toFixed(1);
      svg += `<path class="stats-cum-area" d="${linePts} L${lastX} ${baseY} L${firstX} ${baseY} Z"/>`;
      svg += `<path class="stats-cum-line" d="${linePts}"/>`;
    }

    // Background percentage area (for Hourly Breakdown)
    if (opts.percentArea && Array.isArray(opts.percentArea) && opts.percentArea.length === rows.length) {
      for (let j = 0; j <= steps; j++) {
        const y = T + (h * j) / steps;
        const pct = Math.round((100 * (steps - j)) / steps);
        svg += `<text class="stats-axis-txt stats-axis-right" text-anchor="start" x="${W - R + 6}" y="${(y + 3).toFixed(1)}">${pct}%</text>`;
      }
      const baseY = T + h;
      let seg = [];
      const flushSeg = () => {
        if (!seg.length) return;
        const line = seg.map((p, idx) => (idx ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
        const x0 = seg.length === 1 ? seg[0][0] - bw * 0.45 : seg[0][0];
        const x1 = seg.length === 1 ? seg[0][0] + bw * 0.45 : seg[seg.length - 1][0];
        const area = seg.length === 1
          ? `M${x0.toFixed(1)} ${seg[0][1].toFixed(1)} L${x1.toFixed(1)} ${seg[0][1].toFixed(1)} L${x1.toFixed(1)} ${baseY.toFixed(1)} L${x0.toFixed(1)} ${baseY.toFixed(1)} Z`
          : `${line} L${x1.toFixed(1)} ${baseY.toFixed(1)} L${x0.toFixed(1)} ${baseY.toFixed(1)} Z`;
        svg += `<path class="stats-cum-area" d="${area}"/>`;
        if (seg.length > 1) svg += `<path class="stats-cum-line" d="${line}"/>`;
        seg = [];
      };
      opts.percentArea.forEach((ratio, i) => {
        if (ratio === null || !Number.isFinite(Number(ratio))) { flushSeg(); return; }
        const x = L + (i + 0.5) * bw;
        const y = T + h - (Math.max(0, Math.min(100, Number(ratio))) / 100) * h;
        seg.push([x, y]);
      });
      flushSeg();
    }

    // Bars
    const gapRatio = rows.length > 35 ? 0.14 : 0.2;
    rows.forEach((r, i) => {
      const v = num(r.value);
      if (v <= 0) return;
      const height = Math.max(2, (v / max) * h);
      const x = L + i * bw + bw * (gapRatio / 2);
      const barW = Math.max(1.8, bw * (1 - gapRatio));
      const y = T + h - height;
      const fill = r.color || (typeof opts.colorFn === 'function' ? opts.colorFn(r, i, rawMax) : (opts.color || '#7db8f5'));
      const label = String(r.label ?? r.x);
      let tip = opts.tooltip ? opts.tooltip(r, v, cumValues[i]) : `${label}: ${fmt(v)}`;
      if (!opts.tooltip && opts.cumulative) tip += ` (tích lũy: ${fmtWhole(cumValues[i])})`;
      svg += `<rect class="stats-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${height.toFixed(2)}" rx="1.6" style="fill:${esc(fill)}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    });

    // X-axis labels
    if (opts.fixedXLabels) {
      opts.fixedXLabels.forEach(([posRatio, text]) => {
        const x = L + posRatio * w;
        svg += `<text class="stats-axis-txt" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 8}">${esc(text)}</text>`;
      });
    } else if (opts.everyXLabel) {
      rows.forEach((r, i) => {
        const x = L + (i + 0.5) * bw;
        svg += `<text class="stats-axis-txt" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 8}">${esc(r.axisLabel ?? r.label ?? r.x)}</text>`;
      });
    } else {
      const tickCount = Math.min(7, rows.length);
      const seen = new Set();
      for (let i = 0; i < tickCount; i++) {
        const idx = Math.round((i * (rows.length - 1)) / Math.max(1, tickCount - 1));
        if (seen.has(idx)) continue;
        seen.add(idx);
        const x = L + (idx + 0.5) * bw;
        const text = String(rows[idx].axisLabel ?? rows[idx].label ?? rows[idx].x).slice(0, 14);
        svg += `<text class="stats-axis-txt" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 8}">${esc(text)}</text>`;
      }
    }
    return svg + '</svg>';
  }

  // Stacked bar chart with optional right cumulative area curve (used for Ôn tập).
  function stackPlot(input, kinds, opts = {}) {
    const rows = groupRows(input, opts.maxBars || 62, kinds.map(k => k.key));
    if (!rows.length) return emptyBox(opts.emptyLabel);
    const rowSums = rows.map(r => sum(kinds.map(k => getField(r.values, k.key))));
    const rawMax = Math.max(0, ...rowSums);
    if (rawMax === 0) return emptyBox(opts.emptyLabel);
    const max = niceMax(Math.max(1, rawMax));
    const hasCum = !!opts.cumulative;
    const W = 660, H = 228, L = 52, R = hasCum ? 56 : 16, T = 14, B = 30;
    const h = H - T - B, w = W - L - R;
    const bw = w / rows.length;

    let svg = `<svg class="stats-chart" role="img" aria-label="${esc(opts.aria || 'Biểu đồ chồng')}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
    const steps = 4;
    for (let j = 0; j <= steps; j++) {
      const y = T + (h * j) / steps;
      const tickVal = (max * (steps - j)) / steps;
      svg += `<line class="stats-plot-grid" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}"/>`;
      svg += `<text class="stats-axis-txt" text-anchor="end" x="${L - 6}" y="${(y + 3).toFixed(1)}">${esc(opts.tick ? opts.tick(tickVal) : fmt(tickVal))}</text>`;
    }

    let cumValues = [];
    if (hasCum) {
      let acc = 0;
      cumValues = rowSums.map(v => (acc += v));
      const cumMax = niceMax(Math.max(1, acc));
      for (let j = 0; j <= steps; j++) {
        const y = T + (h * j) / steps;
        const v = (cumMax * (steps - j)) / steps;
        svg += `<text class="stats-axis-txt stats-axis-right" text-anchor="start" x="${W - R + 6}" y="${(y + 3).toFixed(1)}">${esc(opts.cumTick ? opts.cumTick(v) : fmtWhole(v))}</text>`;
      }
      let linePts = '';
      rows.forEach((_, i) => {
        const x = L + (i + 0.5) * bw;
        const y = T + h - (cumValues[i] / cumMax) * h;
        linePts += (i ? ' L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      });
      const firstX = (L + 0.5 * bw).toFixed(1);
      const lastX = (L + (rows.length - 0.5) * bw).toFixed(1);
      const baseY = (T + h).toFixed(1);
      svg += `<path class="stats-cum-area" d="${linePts} L${lastX} ${baseY} L${firstX} ${baseY} Z"/>`;
      svg += `<path class="stats-cum-line" d="${linePts}"/>`;
    }

    const gapRatio = rows.length > 35 ? 0.14 : 0.2;
    rows.forEach((r, i) => {
      let bottom = T + h;
      const x = L + i * bw + bw * (gapRatio / 2);
      const barW = Math.max(1.8, bw * (1 - gapRatio));
      for (const k of kinds) {
        const v = getField(r.values, k.key);
        if (!v) continue;
        const height = Math.max(1.8, (v / max) * h);
        bottom -= height;
        const y = Math.max(T, bottom);
        const valText = opts.tooltip ? opts.tooltip(v) : fmt(v);
        const totalText = opts.tooltip ? opts.tooltip(rowSums[i]) : fmt(rowSums[i]);
        const tip = `${r.label ?? r.x} · ${k.name}: ${valText} (Tổng: ${totalText})`;
        svg += `<rect class="stats-stack-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${height.toFixed(2)}" rx="1" style="fill:${k.color}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
      }
    });

    const tickCount = Math.min(7, rows.length);
    const seen = new Set();
    for (let i = 0; i < tickCount; i++) {
      const idx = Math.round((i * (rows.length - 1)) / Math.max(1, tickCount - 1));
      if (seen.has(idx)) continue;
      seen.add(idx);
      const x = L + (idx + 0.5) * bw;
      svg += `<text class="stats-axis-txt" text-anchor="middle" x="${x.toFixed(1)}" y="${H - 8}">${esc(String(rows[idx].axisLabel ?? rows[idx].label ?? rows[idx].x).slice(0, 14))}</text>`;
    }
    return svg + '</svg>' + legend(kinds.map(k => [k.name, k.color]));
  }

  // Grouped side-by-side bar chart (for Nút Trả lời).
  function groupedBarPlot(groups, series, opts = {}) {
    const allVals = groups.flatMap(g => series.map(s => num(g.values[s.key])));
    const rawMax = Math.max(0, ...allVals);
    if (rawMax === 0) return emptyBox();
    const max = niceMax(Math.max(1, rawMax));
    const W = 640, H = 228, L = 42, R = 16, T = 14, B = 32;
    const h = H - T - B, w = W - L - R;
    const gw = w / groups.length;

    let svg = `<svg class="stats-chart" role="img" aria-label="${esc(opts.aria || 'Biểu đồ nhóm')}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">`;
    for (let j = 0; j <= 4; j++) {
      const y = T + (h * j) / 4;
      svg += `<line class="stats-plot-grid" x1="${L}" y1="${y.toFixed(1)}" x2="${W - R}" y2="${y.toFixed(1)}"/>`;
      svg += `<text class="stats-axis-txt" text-anchor="end" x="${L - 6}" y="${(y + 3).toFixed(1)}">${esc(fmtWhole((max * (4 - j)) / 4))}</text>`;
    }
    const clusterW = Math.min(gw * 0.62, 132);
    const barGap = 4;
    const barW = (clusterW - barGap * (series.length - 1)) / series.length;
    groups.forEach((g, gi) => {
      const cx = L + (gi + 0.5) * gw;
      const startX = cx - clusterW / 2;
      const gTotal = sum(series.map(s => num(g.values[s.key])));
      series.forEach((s, si) => {
        const v = num(g.values[s.key]);
        if (!v) return;
        const height = Math.max(2.5, (v / max) * h);
        const x = startX + si * (barW + barGap);
        const y = T + h - height;
        const pct = gTotal ? fmtPct1.format((v / gTotal) * 100) + '%' : '0%';
        const tip = `${g.label} · ${s.name}: ${fmtWhole(v)} lần (${pct})`;
        svg += `<rect class="stats-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barW.toFixed(2)}" height="${height.toFixed(2)}" rx="2.5" style="fill:${s.color}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
      });
      svg += `<text class="stats-axis-txt" text-anchor="middle" x="${cx.toFixed(1)}" y="${H - 9}">${esc(g.label)}</text>`;
    });
    return svg + '</svg>' + legend(series.map(s => [s.name, s.color]));
  }

  // === SECTION 1: Hôm nay ===
  function todaySection(g) {
    const data = g.today || {};
    const answered = getField(data, 'answer_count');
    const millis = getField(data, 'answer_millis');
    const correct = getField(data, 'correct_count');
    const again = Math.max(0, answered - correct);
    const againPct = answered ? fmt((again / answered) * 100) : '0';
    const matureCount = getField(data, 'mature_count');
    const matureCorrect = getField(data, 'mature_correct');
    const mins = millis / 60000;
    const secsPerCard = answered ? millis / 1000 / answered : 0;

    const summaryLines = answered > 0
      ? `<div class="stats-today-prose">
          <p>Đã học <strong>${fmtWhole(answered)} thẻ</strong> trong <strong>${fmt2.format(mins)} phút</strong> hôm nay (${fmt2.format(secsPerCard)} giây/thẻ)</p>
          <p>Học lại: <strong>${fmtWhole(again)}</strong> (${againPct}%)</p>
          <p>Học: <strong>${fmtWhole(getField(data, 'learn_count'))}</strong>, Ôn: <strong>${fmtWhole(getField(data, 'review_count'))}</strong>, Học lại: <strong>${fmtWhole(getField(data, 'relearn_count'))}</strong>, Lọc: <strong>${fmtWhole(getField(data, 'early_review_count'))}</strong></p>
          <p>${matureCount > 0
            ? `Thẻ trưởng thành trả lời đúng: <strong>${fmtWhole(matureCorrect)}/${fmtWhole(matureCount)}</strong> (${percent(matureCorrect, matureCount - matureCorrect)})`
            : 'Chưa có thẻ trưởng thành học trong hôm nay.'}</p>
        </div>`
      : `<div class="stats-today-prose">
          <p>Hôm nay chưa học thẻ nào.</p>
          <p>Học: <strong>0</strong>, Ôn: <strong>0</strong>, Học lại: <strong>0</strong>, Lọc: <strong>0</strong></p>
          <p>Chưa có thẻ trưởng thành học trong hôm nay.</p>
        </div>`;

    const blocks = [
      ['Đã học hôm nay', `${fmtWhole(answered)} thẻ`],
      ['Tổng thời gian', minutes(millis)],
      ['Tốc độ trung bình', answered ? `${fmt2.format(secsPerCard)} giây/thẻ` : '—'],
      ['Đúng thẻ trưởng thành', matureCount ? percent(matureCorrect, matureCount - matureCorrect) : '—'],
    ];
    const grid = `<div class="stats-today-grid">${blocks.map(([label, value]) =>
      `<div class="stats-today-value"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('')}</div>`;

    return frame('today', 'Hôm nay', '', '', summaryLines + grid, '', { wide: true });
  }

  // === SECTION 2: Dự báo ===
  function futureSection(g) {
    const f = g.future_due || {};
    const d = f.future_due || {};
    const entries = Object.entries(d).map(([k, v]) => [Number(k), num(v)]).filter(([k]) => Number.isInteger(k));
    const lookup = new Map(entries);
    const backlogDays = entries.filter(([k, v]) => k < 0 && v > 0).map(([k]) => k);
    const futureDays = entries.filter(([k, v]) => k > 0 && v > 0).map(([k]) => k);

    const state = cardState.future;
    const rangeDays = state.range === '1m' ? 30 : state.range === '3m' ? 90 : state.range === '1y' ? 365 : Math.max(30, ...futureDays, 30);
    const startDay = state.backlog && backlogDays.length
      ? Math.min(-1, ...backlogDays)
      : 0;
    const list = [];
    for (let day = startDay; day <= rangeDays; day++) {
      const value = lookup.get(day) || 0;
      const color = day < 0 ? '#50bd6c' : day === 0 ? '#6ce088' : '#a8e3ab';
      const label = day < 0 ? `${day} ngày (tồn đọng)` : day === 0 ? 'Hôm nay (0)' : `+${day} ngày`;
      list.push({ x: day, label, axisLabel: String(day), value, color });
    }
    const totalDue = sum(list.map(r => r.value));
    const avgPerDay = list.length > 0 ? Math.round(totalDue / list.length) : 0;
    const dueTomorrow = lookup.get(1) || 0;
    const dailyLoad = getField(f, 'daily_load');

    const controls =
      checkToggle('future', 'backlog', 'Tồn đọng', state.backlog) +
      radioGroup('future', 'range', [
        ['1m', '1 tháng'], ['3m', '3 tháng'], ['1y', '1 năm'], ['all', 'dòng đời bộ thẻ']
      ], state.range);

    const plot = barPlot(list, {
      maxBars: 76,
      cumulative: true,
      aria: 'Số thẻ ôn tập đến hạn trong tương lai',
      tooltip: (r, v, cum) => `${r.label}: ${fmtWhole(v)} thẻ (tích lũy: ${fmtWhole(cum)})`,
    });
    const footer =
      `<span>Tổng: <strong>${fmtWhole(totalDue)} thẻ ôn tập</strong></span>` +
      `<span>Trung bình: <strong>${fmtWhole(avgPerDay)} thẻ ôn tập/ngày</strong></span>` +
      `<span>Đến hạn ngày mai: <strong>${fmtWhole(dueTomorrow)} thẻ ôn tập</strong></span>` +
      `<span>Số lượng trong ngày: <strong>${fmtWhole(dailyLoad)} thẻ ôn tập/ngày</strong></span>`;

    return frame('future', 'Dự báo', 'Số thẻ ôn tập đến hạn trong tương lai.', controls, plot, footer, { wide: true });
  }

  // === SECTION 3: Lịch (Anki scoped Calendar heatmap) ===
  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function shiftDay(date, delta) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta, 12, 0, 0);
    return d;
  }

  function calendarSection(g, payload) {
    const baseStr = payload?.metrics?.today;
    const baseDate = baseStr ? new Date(baseStr + 'T12:00:00') : new Date();
    const currentYear = baseDate.getFullYear();
    const countsByDate = new Map();
    let earliestDataYear = currentYear;

    if (payload?.calendar_days && typeof payload.calendar_days === 'object') {
      for (const [dateStr, cnt] of Object.entries(payload.calendar_days)) {
        const c = num(cnt);
        if (c <= 0) continue;
        countsByDate.set(dateStr, c);
        const y = Number(dateStr.slice(0, 4));
        if (Number.isInteger(y) && y >= 2006 && y < earliestDataYear) earliestDataYear = y;
      }
    } else {
      const reviewCounts = g.reviews?.count || {};
      const typeKeys = ['learn', 'relearn', 'young', 'mature', 'filtered'];
      for (const [k, obj] of Object.entries(reviewCounts)) {
        const off = Number(k);
        if (!Number.isInteger(off) || off > 0) continue;
        const total = totals(obj, typeKeys);
        if (total <= 0) continue;
        const d = shiftDay(baseDate, off);
        const y = d.getFullYear();
        if (y < earliestDataYear) earliestDataYear = y;
        countsByDate.set(isoDate(d), total);
      }
    }

    const minYear = Math.min(2006, earliestDataYear);
    const maxYear = currentYear;
    if (!cardState.calendar.year || cardState.calendar.year < minYear || cardState.calendar.year > maxYear) {
      cardState.calendar.year = maxYear;
    }
    const year = cardState.calendar.year;

    // Build 53-week calendar grid for `year`, rows = CN(0)..T7(6)
    const jan1 = new Date(year, 0, 1, 12, 0, 0);
    const dec31 = new Date(year, 11, 31, 12, 0, 0);
    const startPad = jan1.getDay(); // 0=Sunday .. 6=Saturday
    let yearMax = 0, yearTotal = 0, activeDays = 0, longestStreak = 0, currentStreak = 0;
    const cells = [];
    for (let d = new Date(jan1); d <= dec31; d = shiftDay(d, 1)) {
      const key = isoDate(d);
      const count = countsByDate.get(key) || 0;
      if (count > yearMax) yearMax = count;
      yearTotal += count;
      if (count > 0) {
        activeDays++;
        currentStreak++;
        if (currentStreak > longestStreak) longestStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
      const dayOfYear = Math.round((d - jan1) / 86400000);
      const idx = startPad + dayOfYear;
      const col = Math.floor(idx / 7);
      const row = idx % 7;
      cells.push({
        col, row, count,
        dateLabel: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${year}`,
        month: d.getMonth(),
        dayOfMonth: d.getDate(),
      });
    }
    const totalCols = Math.max(53, (cells[cells.length - 1]?.col || 52) + 1);
    const cellSize = 11, gap = 2, step = cellSize + gap;
    const padL = 28, padT = 18, padR = 6, padB = 6;
    const svgW = padL + totalCols * step + padR;
    const svgH = padT + 7 * step + padB;

    const levelOf = count => {
      if (count <= 0) return 0;
      const ratio = yearMax > 0 ? count / yearMax : 0;
      if (ratio <= 0.25) return 1;
      if (ratio <= 0.5) return 2;
      if (ratio <= 0.75) return 3;
      return 4;
    };

    const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    let svg = `<div class="stats-cal-scroll"><svg class="stats-cal-svg" viewBox="0 0 ${svgW} ${svgH}" role="img" aria-label="Lịch ôn tập năm ${year}">`;
    dayNames.forEach((name, r) => {
      const y = padT + r * step + cellSize - 2;
      svg += `<text class="stats-axis-txt" text-anchor="end" x="${padL - 5}" y="${y}">${name}</text>`;
    });
    const monthPlaced = new Set();
    for (const c of cells) {
      if (c.dayOfMonth <= 7 && !monthPlaced.has(c.month)) {
        monthPlaced.add(c.month);
        const x = padL + c.col * step;
        svg += `<text class="stats-axis-txt" text-anchor="start" x="${x}" y="${padT - 5}">Th${c.month + 1}</text>`;
      }
    }
    for (const c of cells) {
      const x = padL + c.col * step;
      const y = padT + c.row * step;
      const lv = levelOf(c.count);
      const tip = c.count > 0 ? `${c.dateLabel}: ${fmtWhole(c.count)} lượt ôn` : `${c.dateLabel}: Không có lượt ôn`;
      svg += `<rect class="stats-cal-cell stats-cal-lv${lv}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2.2" data-tip="${esc(tip)}"><title>${esc(tip)}</title></rect>`;
    }
    svg += '</svg></div>';

    const yearOptions = [];
    for (let y = maxYear; y >= minYear; y--) {
      yearOptions.push(`<option value="${y}"${y === year ? ' selected' : ''}>${y}</option>`);
    }
    const controls =
      `<div class="stats-cal-nav">` +
      `<button type="button" class="stats-cal-btn" data-cal-step="-1" ${year <= minYear ? 'disabled' : ''} aria-label="Năm trước">◄</button>` +
      `<select class="stats-cal-select" data-cal-select aria-label="Chọn năm lịch ôn tập">${yearOptions.join('')}</select>` +
      `<button type="button" class="stats-cal-btn" data-cal-step="1" ${year >= maxYear ? 'disabled' : ''} aria-label="Năm sau">►</button>` +
      `</div>`;

    const footer =
      `<span>Tổng năm ${year}: <strong>${fmtWhole(yearTotal)} lượt ôn</strong></span>` +
      `<span>Số ngày đã học: <strong>${fmtWhole(activeDays)} ngày</strong></span>` +
      `<span>Chuỗi dài nhất: <strong>${fmtWhole(longestStreak)} ngày</strong></span>`;

    return frame('calendar', 'Lịch', 'Hoạt động ôn tập theo từng ngày trong năm cho bộ lọc đang chọn.', controls, svg, footer, { wide: true });
  }

  // === SECTION 4: Ôn tập ===
  const REVIEW_TYPES = [
    { key: 'young', name: 'Trẻ', color: '#8cd98e' },
    { key: 'mature', name: 'Trưởng thành', color: '#45a862' },
    { key: 'learn', name: 'Đang học', color: '#f4a261' },
    { key: 'relearn', name: 'Học lại', color: '#e76f51' },
    { key: 'filtered', name: 'Lọc', color: '#a78bfa' },
  ];

  function formatDurationMinutes(totalMinutes) {
    if (totalMinutes >= 60) {
      return fmt2.format(totalMinutes / 60) + ' giờ';
    }
    return fmt(totalMinutes) + ' phút';
  }

  function reviewSection(g, period) {
    const state = cardState.reviews;
    const isTime = !!state.time;
    const typeKeys = REVIEW_TYPES.map(t => t.key);
    const countSource = g.reviews?.count || {};
    const timeSource = g.reviews?.time || {};
    const activeSource = isTime ? timeSource : countSource;

    const countEntries = Object.entries(countSource)
      .map(([k, v]) => [Number(k), v])
      .filter(([k, v]) => Number.isInteger(k) && k <= 0 && totals(v, typeKeys) > 0);
    const activeEntries = Object.entries(activeSource)
      .map(([k, v]) => [Number(k), v])
      .filter(([k]) => Number.isInteger(k) && k <= 0);
    const countLookup = new Map(countEntries);
    const activeLookup = new Map(activeEntries);
    const earliest = countEntries.length ? Math.min(0, ...countEntries.map(([k]) => k)) : 0;

    let rangeLen = 31;
    if (state.range === '3m') rangeLen = 91;
    else if (state.range === '1y') rangeLen = 365;
    else if (state.range === 'all') rangeLen = Math.min(12000, Math.max(1, -earliest + 1));
    const minDay = -(rangeLen - 1);

    const rows = [];
    let daysStudied = 0;
    for (let day = minDay; day <= 0; day++) {
      if (countLookup.has(day)) daysStudied++;
      const obj = activeLookup.get(day);
      const values = Object.fromEntries(REVIEW_TYPES.map(k => [
        k.key,
        isTime ? getField(obj, k.key) / 60000 : getField(obj, k.key)
      ]));
      rows.push({
        x: day,
        label: day === 0 ? 'Hôm nay (0)' : `${day} ngày`,
        axisLabel: String(day),
        values,
      });
    }
    const totalVal = sum(rows.map(r => totals(r.values, typeKeys)));
    const studiedPct = rangeLen ? fmt2.format((daysStudied / rangeLen) * 100) : fmt2.format(0);
    const avgIfDaily = rangeLen ? totalVal / rangeLen : 0;
    const avgStudiedDays = daysStudied ? totalVal / daysStudied : 0;

    const rangeOptions = [['1m', '1 tháng'], ['3m', '3 tháng'], ['1y', '1 năm'], ['all', 'tất cả']];
    const controls =
      checkToggle('reviews', 'time', 'Thời gian', isTime) +
      radioGroup('reviews', 'range', rangeOptions, state.range);

    const isEn = window.NOSI18n?.language() === 'en';
    const minTick = isEn ? 'm' : 'p';
    const hrTick = isEn ? 'h' : 'g';
    const plot = stackPlot(rows, REVIEW_TYPES, {
      maxBars: 64,
      cumulative: true,
      aria: isTime ? 'Thời gian ôn tập theo ngày' : 'Số câu hỏi đã trả lời theo ngày',
      tick: isTime ? v => fmt(v) + minTick : undefined,
      cumTick: isTime ? v => (v >= 60 ? fmt(v / 60) + hrTick : fmtWhole(v) + minTick) : undefined,
      tooltip: isTime ? v => fmt(v) + ' phút' : v => fmtWhole(v) + ' thẻ',
    });

    const footer = isTime
      ? `<span>Số ngày đã học: <strong>${fmtWhole(daysStudied)} trong ${fmtWhole(rangeLen)} (${studiedPct}%)</strong></span>` +
        `<span>Tổng: <strong>${formatDurationMinutes(totalVal)}</strong></span>` +
        `<span>Nếu học hàng ngày thì: <strong>${formatDurationMinutes(avgIfDaily)}/ngày</strong></span>` +
        `<span>Số ngày trung bình đã học: <strong>${formatDurationMinutes(avgStudiedDays)}/ngày</strong></span>`
      : `<span>Số ngày đã học: <strong>${fmtWhole(daysStudied)} trong ${fmtWhole(rangeLen)} (${studiedPct}%)</strong></span>` +
        `<span>Tổng: <strong>${fmtWhole(totalVal)} thẻ ôn tập</strong></span>` +
        `<span>Nếu học hàng ngày thì: <strong>${fmtWhole(Math.round(avgIfDaily))} thẻ ôn tập/ngày</strong></span>` +
        `<span>Số ngày trung bình đã học: <strong>${fmtWhole(Math.round(avgStudiedDays))} thẻ ôn tập/ngày</strong></span>`;

    return frame(
      'reviews',
      'Ôn tập',
      isTime ? 'Thời gian trả lời câu hỏi.' : 'Số câu hỏi đã trả lời.',
      controls,
      plot,
      footer,
      { wide: true }
    );
  }

  // === SECTION 5: Số lượng thẻ ===
  function countSection(g) {
    const separate = !!cardState.counts.separateInactive;
    const data = separate
      ? (g.card_counts?.excluding_inactive || {})
      : (g.card_counts?.including_inactive || {});
    const defs = [
      ['newCards', 'Mới', '#66add9'],
      ['learn', 'Đang học', '#f28c38'],
      ['relearn', 'Đang học lại', '#e25c47'],
      ['young', 'Trẻ', '#74c668'],
      ['mature', 'Trưởng thành', '#2d9348'],
      ...(separate ? [
        ['suspended', 'Dừng', '#e5c138'],
        ['buried', 'Đã tạm hoãn', '#7a8499'],
      ] : []),
    ];
    const items = defs.map(([key, name, color]) => ({ key, name, color, value: getField(data, key) }));
    const total = sum(items.map(i => i.value));
    const controls = checkToggle('counts', 'separateInactive', 'Tách riêng thẻ đã ngừng/tạm hoãn', separate);

    if (!total) {
      return frame('counts', 'Số lượng thẻ', '', controls, emptyBox());
    }

    // Crisp Pie / Donut SVG
    const cx = 104, cy = 104, r = 90;
    let startAngle = -Math.PI / 2;
    const slices = items.filter(i => i.value > 0).map(item => {
      const frac = item.value / total;
      const pctStr = fmt2.format(frac * 100) + '%';
      const tip = `${item.name}: ${fmtWhole(item.value)} thẻ (${pctStr})`;
      if (frac >= 0.9999) {
        return `<circle class="stats-slice" cx="${cx}" cy="${cy}" r="${r}" fill="${item.color}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></circle>`;
      }
      const endAngle = startAngle + frac * Math.PI * 2;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
      const large = frac > 0.5 ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      startAngle = endAngle;
      return `<path class="stats-slice" d="${d}" fill="${item.color}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></path>`;
    }).join('');
    const svg = `<svg class="stats-pie" viewBox="0 0 208 208" role="img" aria-label="Phân bố số lượng thẻ">${slices}</svg>`;

    const tableRows = items.map(item => {
      const pct = total ? fmt2.format((item.value / total) * 100) + '%' : '0%';
      return `<tr>
        <td><i class="stats-swatch" style="background:${item.color}"></i>${esc(item.name)}</td>
        <td class="stats-num">${fmtWhole(item.value)}</td>
        <td class="stats-num stats-pct">${item.value ? pct : '0%'}</td>
      </tr>`;
    }).join('') + `<tr class="stats-total-row">
      <td>Tổng số thẻ</td>
      <td class="stats-num"><strong>${fmtWhole(total)}</strong></td>
      <td class="stats-num"></td>
    </tr>`;

    const body = `<div class="stats-counts-shell">${svg}<table class="stats-counts-table"><tbody>${tableRows}</tbody></table></div>`;
    return frame('counts', 'Số lượng thẻ', '', controls, body, '', { wide: true });
  }

  // === SECTIONS 6 & 7: Khoảng cách & Độ ổn định của thẻ ===
  function intervalStyleSection(sectionKey, title, subtitle, mapping, medianLabel, avgLabel) {
    const raw = mapRows(mapping).filter(r => r.value > 0);
    const state = cardState[sectionKey];
    const controls = radioGroup(sectionKey, 'range', [
      ['1m', '1 tháng'], ['50', '50%'], ['95', '95%'], ['all', 'dòng đời bộ thẻ']
    ], state.range);

    if (!raw.length) {
      return frame(sectionKey, title, subtitle, controls, emptyBox());
    }
    const stats = weightedStats(raw);
    const maxKey = raw[raw.length - 1].x;
    let limit = maxKey;
    if (state.range === '1m') limit = Math.min(maxKey, 31);
    else if (state.range === '50') limit = Math.max(1, weightedPercentile(raw, 50));
    else if (state.range === '95') limit = Math.max(1, weightedPercentile(raw, 95));

    const lookup = new Map(raw.map(r => [r.x, r.value]));
    const minDay = raw[0].x === 0 ? 0 : 1;
    const dense = [];
    for (let day = minDay; day <= Math.max(minDay, limit); day++) {
      const ratio = limit > 0 ? (day - minDay) / Math.max(1, limit - minDay) : 0;
      const fill = `hsl(${Math.round(205 + ratio * 6)}, ${Math.round(62 + ratio * 16)}%, ${Math.round(76 - ratio * 24)}%)`;
      dense.push({
        x: day,
        label: `${fmtWhole(day)} ngày`,
        axisLabel: String(day),
        value: lookup.get(day) || 0,
        color: fill,
      });
    }
    const plot = barPlot(dense, {
      maxBars: 64,
      cumulative: true,
      aria: title,
      tooltip: (r, v, cum) => `${r.label}: ${fmtWhole(v)} thẻ (tích lũy: ${fmtWhole(cum)})`,
    });
    const footer =
      `<span>${esc(medianLabel)}: <strong>${fmtWhole(stats.median)} ngày</strong></span>` +
      (stats.average !== null ? `<span>${esc(avgLabel)}: <strong>${fmt(stats.average)} ngày</strong></span>` : '') +
      `<span>Số thẻ: <strong>${fmtWhole(stats.total)}</strong></span>`;
    return frame(sectionKey, title, subtitle, controls, plot, footer);
  }

  // === SECTION 8 (non-FSRS): Độ dễ của thẻ (SM-2) ===
  function easeSection(g) {
    const raw = mapRows(g.eases?.eases).filter(r => r.value > 0);
    if (!raw.length) return frame('ease', 'Độ dễ của thẻ', 'Phân bố hệ số độ dễ SM-2 (%).', '', emptyBox());
    const rows = raw.map(r => ({ ...r, label: `${fmtWhole(r.x)}%`, axisLabel: `${fmtWhole(r.x)}%`, color: '#f2b866' }));
    const stats = weightedStats(raw);
    const avg = g.eases?.average ?? stats.average;
    const footer =
      (avg !== null && Number.isFinite(Number(avg)) ? `<span>Độ dễ trung bình: <strong>${fmt(avg)}%</strong></span>` : '') +
      `<span>Số thẻ: <strong>${fmtWhole(stats.total)}</strong></span>`;
    return frame('ease', 'Độ dễ của thẻ', 'Phân bố hệ số độ dễ SM-2 (%).', '', barPlot(rows, { aria: 'Độ dễ của thẻ' }), footer);
  }

  // === Helper for 5%-binned 0..100% histograms (Độ khó & Khả năng truy xuất) ===
  function percentBins(mapping, colorFn, clipRange) {
    const raw = mapRows(mapping).filter(r => r.value > 0);
    if (!raw.length) return { bins: [], stats: { total: 0, average: null, median: null } };
    const stats = weightedStats(raw);
    let maxPct = 100;
    if (clipRange === '50') maxPct = Math.max(5, weightedPercentile(raw, 50));
    else if (clipRange === '95') maxPct = Math.max(5, weightedPercentile(raw, 95));
    const bins = Array.from({ length: 20 }, (_, i) => ({
      x: i * 5,
      xEnd: (i + 1) * 5,
      label: `${i * 5}%–${(i + 1) * 5}%`,
      axisLabel: `${i * 5}%`,
      value: 0,
      color: colorFn(i * 5 + 2.5),
    }));
    for (const r of raw) {
      if (r.x > maxPct) continue;
      const idx = Math.min(19, Math.max(0, Math.floor(r.x / 5)));
      bins[idx].value += r.value;
    }
    return { bins, stats };
  }

  // === SECTION 8 (FSRS): Độ khó của thẻ ===
  function difficultySection(g) {
    const state = cardState.difficulty;
    const controls = radioGroup('difficulty', 'range', [
      ['50', '50%'], ['95', '95%'], ['100', '100%'], ['all', 'dòng đời bộ thẻ']
    ], state.range);
    const colorFn = pct => {
      // Green (0%) -> Yellow (50%) -> Orange (75%) -> Red (100%)
      const hue = Math.max(4, Math.round(140 - (pct / 100) * 136));
      const sat = pct > 35 && pct < 60 ? 74 : 68;
      const light = pct > 35 && pct < 60 ? 64 : 50;
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    };
    const { bins, stats } = percentBins(g.difficulty?.eases, colorFn, state.range);
    const hasData = stats.total > 0;
    const plot = hasData
      ? barPlot(bins, {
          maxBars: 20,
          aria: 'Độ khó của thẻ',
          fixedXLabels: [[0, '0%'], [0.2, '20%'], [0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']],
          tooltip: (r, v) => `Độ khó ${r.label}: ${fmtWhole(v)} thẻ`,
        })
      : emptyBox();
    const avg = g.difficulty?.average ?? stats.average;
    const footer = hasData
      ? `<span>Độ khó trung vị: <strong>${fmtWhole(stats.median)}%</strong></span>` +
        (avg !== null && Number.isFinite(Number(avg)) ? `<span>Trung bình: <strong>${fmt(avg)}%</strong></span>` : '')
      : '';
    return frame('difficulty', 'Độ khó của thẻ', 'Độ khó càng cao, độ ổn định tăng càng chậm.', controls, plot, footer);
  }

  // === SECTION 9 (FSRS): Khả năng truy xuất của thẻ ===
  function retrievabilitySection(g) {
    const state = cardState.retrievability;
    const controls = radioGroup('retrievability', 'range', [
      ['50', '50%'], ['95', '95%'], ['100', '100%'], ['all', 'dòng đời bộ thẻ']
    ], state.range);
    const colorFn = pct => {
      // Soft yellow-green (low) -> Deep emerald green (100%)
      const t = Math.max(0, Math.min(1, (pct - 40) / 60));
      const hue = Math.round(78 + t * 68);
      const sat = Math.round(62 + t * 14);
      const light = Math.round(70 - t * 34);
      return `hsl(${hue}, ${sat}%, ${light}%)`;
    };
    const { bins, stats } = percentBins(g.retrievability?.retrievability, colorFn, state.range);
    const hasData = stats.total > 0;
    const plot = hasData
      ? barPlot(bins, {
          maxBars: 20,
          aria: 'Khả năng truy xuất của thẻ',
          fixedXLabels: [[0, '0%'], [0.2, '20%'], [0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']],
          tooltip: (r, v) => `Khả năng nhớ ${r.label}: ${fmtWhole(v)} thẻ`,
        })
      : emptyBox();
    const avg = g.retrievability?.average ?? stats.average;
    const sumCard = g.retrievability?.sum_by_card;
    const sumNote = g.retrievability?.sum_by_note;
    let footer = '';
    if (hasData) {
      if (avg !== null && Number.isFinite(Number(avg))) {
        footer += `<span>Khả năng truy xuất trung bình: <strong>${fmtWhole(avg)}%</strong></span>`;
      }
      if (Number.isFinite(Number(sumCard)) && Number.isFinite(Number(sumNote))) {
        footer += `<span>Ước tính tổng kiến thức: <strong>${fmtWhole(sumCard)} thẻ / ${fmtWhole(sumNote)} ghi chú</strong></span>`;
      }
    }
    return frame('retrievability', 'Khả năng truy xuất của thẻ', 'Xác suất nhớ lại thẻ hôm nay.', controls, plot, footer);
  }

  // === SECTION 10: Đã nhớ (True Retention) ===
  function trueRetentionSection(g, period) {
    const mode = cardState.retention.mode;
    const controls = radioGroup('retention', 'mode', [
      ['young', 'Trẻ'], ['mature', 'Trưởng thành'], ['all', 'Tất cả']
    ], mode);

    const keys = [
      ['today', 'Hôm nay'],
      ['yesterday', 'Hôm qua'],
      ['week', 'Tuần trước'],
      ['month', 'Tháng trước'],
      ['year', 'Năm trước'],
    ];
    if (period === 0) keys.push(['all_time', 'Tất cả lịch sử']);

    const rows = keys.map(([key, title]) => {
      const data = g.true_retention?.[key] || {};
      const yp = getField(data, 'young_passed'), yf = getField(data, 'young_failed');
      const mp = getField(data, 'mature_passed'), mf = getField(data, 'mature_failed');
      const youngTotal = yp + yf;
      const matureTotal = mp + mf;
      const allTotal = youngTotal + matureTotal;
      const shownCount = mode === 'young' ? youngTotal : mode === 'mature' ? matureTotal : allTotal;
      return `<tr>
        <td><strong>${esc(title)}</strong></td>
        <td class="stats-ret-young${youngTotal ? '' : ' is-undef'}">${percent(yp, yf)}</td>
        <td class="stats-ret-mature${matureTotal ? '' : ' is-undef'}">${percent(mp, mf)}</td>
        <td class="${allTotal ? '' : 'is-undef'}"><strong>${percent(yp + mp, yf + mf)}</strong></td>
        <td class="stats-num">${fmtWhole(shownCount)}</td>
      </tr>`;
    }).join('');

    const table = `<div class="stats-table-scroll"><table class="stats-mini-table">
      <thead><tr>
        <th></th>
        <th class="stats-ret-young">Trẻ</th>
        <th class="stats-ret-mature">Trưởng thành</th>
        <th>Tổng số thẻ</th>
        <th>Số lượng</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;

    return frame(
      'retention',
      'Đã nhớ',
      'Độ nhớ của thẻ với khoảng thời gian ≥ 1 ngày',
      controls,
      table,
      '',
      {
        wide: true,
        help: 'True Retention chỉ tính tỷ lệ trả lời đạt (Khó/Tốt/Dễ) trên các thẻ ôn tập có khoảng cách ≥ 1 ngày, không tính các lần học lại trong ngày.',
      }
    );
  }

  // === SECTION 11: Chia nhỏ Theo giờ ===
  function hoursSection(g, period) {
    const state = cardState.hours;
    const rangeOptions = [['1m', '1 tháng'], ['3m', '3 tháng'], ['1y', '1 năm'], ['all', 'tất cả']];

    const fieldMap = { '1m': 'one_month', '3m': 'three_months', '1y': 'one_year', 'all': 'all_time' };
    const source = g.hours?.[fieldMap[state.range]] || g.hours?.one_year || [];
    const arr = Array.isArray(source) ? source : [];
    const maxHour = Math.max(1, ...arr.map(d => getField(d, 'total')));
    const rows = Array.from({ length: 24 }, (_, i) => {
      const total = getField(arr[i], 'total');
      const correct = getField(arr[i], 'correct');
      const intensity = total / maxHour;
      const fill = `hsl(208, ${Math.round(58 + intensity * 22)}%, ${Math.round(80 - intensity * 34)}%)`;
      return {
        x: i,
        label: `${i}:00 – ${i + 1}:00`,
        axisLabel: String(i),
        value: total,
        correct,
        color: fill,
      };
    });
    const totalReviews = sum(rows.map(r => r.value));
    const totalCorrect = sum(rows.map(r => r.correct));
    const controls = radioGroup('hours', 'range', rangeOptions, state.range);

    if (!totalReviews) {
      return frame('hours', 'Chia nhỏ Theo giờ', 'Tỷ lệ ôn tập thành công mỗi giờ trong ngày', controls, emptyBox(), '', { wide: true });
    }
    const ratios = rows.map(r => (r.value > 0 ? (r.correct / r.value) * 100 : null));
    const plot = barPlot(rows, {
      maxBars: 24,
      everyXLabel: true,
      percentArea: ratios,
      aria: 'Tỷ lệ ôn tập thành công mỗi giờ trong ngày',
      tooltip: r => `${r.label}: ${fmtWhole(r.value)} lượt · Đúng ${fmtWhole(r.correct)} (${percent(r.correct, r.value - r.correct)})`,
    });
    const footer =
      `<span>Tổng lượt ôn: <strong>${fmtWhole(totalReviews)} lượt</strong></span>` +
      `<span>Tỷ lệ thành công chung: <strong>${percent(totalCorrect, totalReviews - totalCorrect)}</strong></span>`;
    return frame('hours', 'Chia nhỏ Theo giờ', 'Tỷ lệ ôn tập thành công mỗi giờ trong ngày', controls, plot, footer, { wide: true });
  }

  // === SECTION 12: Nút Trả lời ===
  function buttonsSection(g, period) {
    const state = cardState.buttons;
    const rangeOptions = [['1m', '1 tháng'], ['3m', '3 tháng'], ['1y', '1 năm'], ['all', 'tất cả']];

    const fieldMap = { '1m': 'one_month', '3m': 'three_months', '1y': 'one_year', 'all': 'all_time' };
    const source = g.buttons?.[fieldMap[state.range]] || g.buttons?.one_year || {};
    const cats = [
      ['learning', 'Đang học'],
      ['young', 'Trẻ'],
      ['mature', 'Trưởng thành'],
    ];
    const series = [
      { key: 'b0', name: 'Lại (1)', color: '#b52336' },
      { key: 'b1', name: 'Khó (2)', color: '#dfa458' },
      { key: 'b2', name: 'Tốt (3)', color: '#9ac667' },
      { key: 'b3', name: 'Dễ (4)', color: '#1a8b4b' },
    ];
    const groups = cats.map(([key, label]) => ({
      label,
      values: {
        b0: num(source?.[key]?.[0]),
        b1: num(source?.[key]?.[1]),
        b2: num(source?.[key]?.[2]),
        b3: num(source?.[key]?.[3]),
      },
    }));
    const sumAll = sum(groups.map(gr => totals(gr.values, ['b0', 'b1', 'b2', 'b3'])));
    const controls = radioGroup('buttons', 'range', rangeOptions, state.range);

    const footerParts = groups.map(gr => {
      const again = gr.values.b0;
      const passed = gr.values.b1 + gr.values.b2 + gr.values.b3;
      const tot = again + passed;
      return `<span>${esc(gr.label)}: <strong>${tot ? percent(passed, again) : '—'}</strong> (${fmtWhole(tot)})</span>`;
    });

    return frame(
      'buttons',
      'Nút Trả lời',
      'Số lần nhấn mỗi nút.',
      controls,
      sumAll ? groupedBarPlot(groups, series, { aria: 'Số lần nhấn nút trả lời' }) : emptyBox(),
      sumAll ? footerParts.join('') : ''
    );
  }

  // === SECTION 13: Đã thêm ===
  function addedSection(g) {
    const state = cardState.added;
    const source = g.added?.added || {};
    const entries = Object.entries(source)
      .map(([k, v]) => [Number(k), num(v)])
      .filter(([k, v]) => Number.isInteger(k) && k <= 0 && v > 0);
    const lookup = new Map(entries);
    const earliest = entries.length ? Math.min(0, ...entries.map(([k]) => k)) : 0;

    let rangeLen = 31;
    if (state.range === '3m') rangeLen = 91;
    else if (state.range === '1y') rangeLen = 365;
    else if (state.range === 'all') rangeLen = Math.min(12000, Math.max(1, -earliest + 1));

    const minDay = -(rangeLen - 1);
    const rows = [];
    for (let day = minDay; day <= 0; day++) {
      rows.push({
        x: day,
        label: day === 0 ? 'Hôm nay (0)' : `${day} ngày`,
        axisLabel: String(day),
        value: lookup.get(day) || 0,
        color: '#a78bfa',
      });
    }
    const total = sum(rows.map(r => r.value));
    const controls = radioGroup('added', 'range', [
      ['1m', '1 tháng'], ['3m', '3 tháng'], ['1y', '1 năm'], ['all', 'dòng đời bộ thẻ']
    ], state.range);

    const plot = total > 0
      ? barPlot(rows, {
          maxBars: 62,
          cumulative: true,
          aria: 'Số thẻ mới đã thêm',
          tooltip: (r, v, cum) => `${r.label}: ${fmtWhole(v)} thẻ mới (tích lũy: ${fmtWhole(cum)})`,
        })
      : emptyBox('KHÔNG CÓ DỮ LIỆU');

    const footer = total > 0
      ? `<span>Tổng: <strong>${fmtWhole(total)} thẻ</strong></span><span>Trung bình: <strong>${fmt(total / rangeLen)} thẻ/ngày</strong></span>`
      : '';
    return frame('added', 'Đã thêm', 'Số thẻ mới bạn đã thêm.', controls, plot, footer);
  }

  function buildSections(payload) {
    const g = payload?.data || {};
    const period = payload.days;
    const fsrs = !!g.fsrs;
    return [
      { key: 'today', build: () => todaySection(g) },
      { key: 'future', build: () => futureSection(g) },
      { key: 'calendar', build: () => calendarSection(g, payload) },
      { key: 'reviews', build: () => reviewSection(g, period) },
      { key: 'counts', build: () => countSection(g) },
      { key: 'intervals', build: () => intervalStyleSection('intervals', 'Khoảng cách', 'Thời gian giãn cách đến khi hiện thẻ ôn tập lần nữa', g.intervals?.intervals, 'Khoảng cách trung vị', 'Trung bình') },
      ...(fsrs ? [
        { key: 'stability', build: () => intervalStyleSection('stability', 'Độ ổn định của thẻ', 'Thời gian giãn cách khi khả năng truy xuất xuống dưới 90%.', g.stability?.intervals, 'Độ ổn định trung vị', 'Trung bình') },
        { key: 'difficulty', build: () => difficultySection(g) },
        { key: 'retrievability', build: () => retrievabilitySection(g) },
      ] : [
        { key: 'ease', build: () => easeSection(g) },
      ]),
      { key: 'retention', build: () => trueRetentionSection(g, period) },
      { key: 'hours', build: () => hoursSection(g, period) },
      { key: 'buttons', build: () => buttonsSection(g, period) },
      { key: 'added', build: () => addedSection(g) },
    ];
  }

  function rerenderCard(sectionKey) {
    if (!activePayload) return;
    const report = $('stats-report');
    const existing = report?.querySelector(`.stats-native-card[data-stats-section="${sectionKey}"]`);
    if (!existing) return;
    const def = buildSections(activePayload).find(s => s.key === sectionKey);
    if (!def) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = def.build();
    const fresh = tmp.firstElementChild;
    if (fresh) {
      // Preserve the outer article DOM node so references to existing cards remain stable.
      existing.className = fresh.className;
      existing.replaceChildren(...fresh.childNodes);
    }
  }

  function syncToolbarUI() {
    const curScope = scope();
    const curPeriod = String(days());
    document.querySelectorAll('[data-stats-scope]').forEach(btn => {
      const active = btn.dataset.statsScope === curScope;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    document.querySelectorAll('[data-stats-period]').forEach(btn => {
      const active = btn.dataset.statsPeriod === curPeriod;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    const searchInput = $('stats-search');
    if (searchInput && document.activeElement !== searchInput) {
      searchInput.value = effectiveSearch();
    }
    const deckLabel = $('stats-deck-name');
    if (deckLabel) {
      const isCustom = !!(selectedDeckName && selectedDeckName !== 'Bộ thẻ hiện tại');
      if (isCustom) deckLabel.setAttribute('data-i18n-skip', '');
      else deckLabel.removeAttribute('data-i18n-skip');
      deckLabel.textContent = selectedDeckName || 'Bộ thẻ hiện tại';
    }
  }

  function scopeBannerText(payload) {
    const s = payload.scope;
    const period = payload.days;
    const query = (payload.search ?? effectiveSearch()).trim();
    const deckLabel = payload.deck_name || selectedDeckName;
    let base;
    if (s === 'collection' && !query) {
      base = 'toàn bộ bộ sưu tập';
    } else if (s === 'deck' && (!query || query === 'deck:current')) {
      base = deckLabel && deckLabel !== 'Bộ thẻ hiện tại'
        ? `bộ thẻ “${deckLabel}” và các bộ con`
        : 'bộ thẻ hiện tại và các bộ con';
    } else {
      base = `bộ lọc “${query || 'tất cả'}”`;
    }
    return `Đang xem ${base} · ${period === 0 ? 'toàn bộ lịch sử' : '12 tháng'}`;
  }

  function render(payload) {
    activePayload = payload;
    if (Array.isArray(payload.decks) && payload.decks.length) {
      availableDecks = payload.decks;
    }
    if (payload.deck_id) selectedDeckId = String(payload.deck_id);
    if (payload.deck_name) selectedDeckName = String(payload.deck_name);
    syncToolbarUI();

    const sections = buildSections(payload);
    const key = cacheKey();
    const epoch = ++renderEpoch;
    renderedKey = '';
    paintingKey = key;
    const report = $('stats-report');
    report.replaceChildren();
    $('stats-metric-scope').textContent = scopeBannerText(payload);

    // Update the numeric KPI cards immediately; graphs paint incrementally.
    updateMetricCards(payload);
    if (native) {
      $('stats-loading').hidden = false;
      $('stats-loading').textContent = 'Đang vẽ biểu đồ…';
    }
    let offset = 0;
    const paintBatch = () => {
      if (epoch !== renderEpoch || key !== cacheKey()) return;
      const end = native ? Math.min(offset + 4, sections.length) : sections.length;
      let markup = '';
      for (; offset < end; offset++) markup += sections[offset].build();
      report.insertAdjacentHTML('beforeend', markup);
      if (offset < sections.length) {
        requestAnimationFrame(paintBatch);
      } else {
        renderedKey = key;
        paintingKey = '';
        $('stats-loading').hidden = true;
        if (!native) $('stats-metric-scope').textContent += ' · Dữ liệu minh họa';
      }
    };
    if (native) requestAnimationFrame(paintBatch);
    else paintBatch();
  }

  const change = (current, previous, comparison) => ({
    current, previous, comparison,
    percent: current == null || previous == null || previous === 0
      ? null
      : Math.round(((current - previous) / previous) * 1000) / 10
  });
  const emptyDay = { reviews: 0, milliseconds: 0, tested: 0, passed: 0 };

  function updateMetricCards(payload) {
    metricData = payload;
    const g = payload?.data || {}, m = payload?.metrics;
    const t = g.today || {};
    const reviews = getField(t, 'answer_count'), ms = getField(t, 'answer_millis');
    const pace = ms ? Math.round((reviews / ms) * 3600000) : null;
    const month = g.true_retention?.month || {};
    const passed = getField(month, 'young_passed') + getField(month, 'mature_passed');
    const failed = getField(month, 'young_failed') + getField(month, 'mature_failed');
    const tested = passed + failed;
    const retention = tested ? (passed / tested) * 100 : null;
    if ($('stat-retention')) $('stat-retention').textContent = retention === null ? '—' : fmt(retention) + '%';
    if ($('retention-detail')) $('retention-detail').textContent = tested
      ? 'True Retention · 30 ngày · ' + fmt(tested) + ' lượt kiểm tra'
      : 'Chưa có lượt kiểm tra trong 30 ngày';
    if ($('stat-pace')) $('stat-pace').innerHTML = (pace === null ? '—' : fmt(pace)) + ' <small>lượt/giờ</small>';
    if ($('pace-detail')) $('pace-detail').textContent = reviews
      ? 'Tốc độ ôn hôm nay · ' + fmt(reviews) + ' lượt' + (reviews < 20 ? ' (mẫu nhỏ)' : '')
      : 'Hôm nay chưa ôn thẻ nào';
    if ($('stat-time')) $('stat-time').textContent = minutes(ms);
    if ($('stat-studied')) $('stat-studied').innerHTML = fmt(reviews) + ' <small>lượt</small>';
    drawMetricCharts(g, m, { reviews, ms, pace });
  }

  function drawMetricCharts(g, m, now) {
    const charts = window.NOSMetricCharts;
    if (!charts) return;
    if (!m?.days && !native) return;
    const base = m?.today ? new Date(m.today + 'T12:00:00') : new Date();
    const typeKeys = REVIEW_TYPES.map(k => k.key);
    const dayOf = i => {
      const date = isoDate(shiftDay(base, i - 13));
      if (i === 13) {
        return {
          date, reviews: now.reviews, milliseconds: now.ms,
          tested: (m?.days?.[date] || emptyDay).tested,
          passed: (m?.days?.[date] || emptyDay).passed,
        };
      }
      if (m?.days) return { date, ...(m.days[date] || emptyDay) };
      const off = i - 13;
      return {
        date,
        reviews: totals(g.reviews?.count?.[off], typeKeys),
        milliseconds: totals(g.reviews?.time?.[off], typeKeys),
        tested: 0, passed: 0,
      };
    };
    const recent = Array.from({ length: 14 }, (_, i) => dayOf(i));
    const sum30 = (from, to) => {
      let tested = 0, passed = 0;
      for (let i = from; i <= to; i++) {
        const d = m.days[isoDate(shiftDay(base, -i))];
        if (d) { tested += d.tested; passed += d.passed; }
      }
      return { tested, passed, rate: tested ? (passed / tested) * 100 : null };
    };
    let trends = {};
    if (m?.days) {
      const cur = sum30(0, 29), prev = sum30(30, 59);
      const p = m.previous || { reviews: 0, milliseconds: 0 };
      trends = {
        retention: change(
          cur.rate == null ? null : Math.round(cur.rate * 10) / 10,
          prev.rate == null ? null : Math.round(prev.rate * 10) / 10,
          '30 ngày trước'
        ),
        pace: change(now.pace, p.milliseconds ? Math.round(p.reviews / (p.milliseconds / 3600000)) : null, 'cùng giờ hôm qua'),
        milliseconds: change(now.ms, p.milliseconds, 'cùng giờ hôm qua'),
        reviews: change(now.reviews, p.reviews, 'cùng giờ hôm qua'),
      };
    }
    const series = {
      retention: ['%', d => d.tested ? Math.max(0, Math.min(100, (d.passed / d.tested) * 100)) : null],
      pace: ['lượt/giờ', d => d.milliseconds > 0 ? d.reviews / (d.milliseconds / 3600000) : null],
      time: ['phút', d => d.milliseconds / 60000],
      studied: ['lượt ôn', d => d.reviews],
    };
    const trendKey = { retention: 'retention', pace: 'pace', time: 'milliseconds', studied: 'reviews' };
    for (const id of Object.keys(series)) {
      const trend = trends[trendKey[id]];
      if ($('trend-' + id)) charts.renderTrend(id, trend);
      if ($('spark-' + id)) {
        charts.sparkline(
          'spark-' + id,
          recent.map(d => ({ date: d.date, value: series[id][1](d) })),
          series[id][0],
          trend?.percent
        );
      }
    }
  }

  function preview() {
    const futureMap = {};
    for (let i = -30; i < 0; i++) if (i % 3 === 0) futureMap[i] = 1 + Math.abs(i % 4);
    for (let i = 0; i <= 90; i++) futureMap[i] = Math.round(2 + 10 * Math.abs(Math.sin(i * 0.37)));
    const count = {}, time = {}, added = {};
    for (let d = -364; d <= 0; d++) {
      if (d % 3 === 0 || d > -15) {
        count[d] = { learn: 4 + ((d % 7) + 7) % 7, young: 11, mature: 7, relearn: 2, filtered: 0 };
        time[d] = { learn: 240000, young: 350000, mature: 245000, relearn: 60000, filtered: 0 };
      }
      if (d % 5 === 0) added[d] = Math.abs(d % 11) + 1;
    }
    const hourSeries = scale => Array.from({ length: 24 }, (_, i) => {
      const tot = Math.max(0, Math.round(scale * Math.sin(((i - 6) / 15) * Math.PI)));
      return { total: tot, correct: Math.round(tot * (0.82 + 0.12 * Math.sin(i))) };
    });
    const previewDecks = [
      { id: '101', name: 'Tiếng Trung' },
      { id: '111', name: 'Tiếng Trung::1000 từ cực thường dùng' },
      { id: '112', name: 'Tiếng Trung::1000 từ cực thường dùng::Công nghệ' },
      { id: '113', name: 'Tiếng Trung::1000 từ cực thường dùng::Gia đình' },
      { id: '102', name: 'Tiếng Anh — Từ vựng' },
      { id: '103', name: 'Tiếng Nhật — N3' },
    ];
    const activeDeck = previewDecks.find(d => d.id === selectedDeckId) || previewDecks[0];
    return {
      scope: scope(),
      days: days(),
      search: effectiveSearch(),
      deck_id: activeDeck.id,
      deck_name: activeDeck.name,
      decks: previewDecks,
      data: {
        today: {
          answer_count: 24, answer_millis: 960000, correct_count: 20,
          mature_count: 12, mature_correct: 11,
          learn_count: 7, review_count: 15, relearn_count: 2, early_review_count: 0,
        },
        future_due: { future_due: futureMap, daily_load: 28, have_backlog: true },
        reviews: { count, time },
        added: { added },
        card_counts: {
          excluding_inactive: { newCards: 110, learn: 20, relearn: 9, young: 120, mature: 310, suspended: 11, buried: 4 },
          including_inactive: { newCards: 118, learn: 22, relearn: 9, young: 123, mature: 312, suspended: 0, buried: 0 },
        },
        intervals: { intervals: { '1': 26, '3': 31, '7': 41, '14': 32, '21': 50, '30': 70, '45': 28, '90': 20 } },
        eases: { eases: { '130': 9, '180': 20, '200': 45, '220': 64, '250': 50, '280': 25 }, average: 224 },
        difficulty: { eases: { '10': 14, '22': 18, '42': 32, '55': 24, '65': 38, '78': 29, '88': 15 }, average: 56 },
        stability: { intervals: { '1': 22, '4': 37, '9': 56, '15': 42, '25': 29, '40': 18, '60': 10 } },
        retrievability: { retrievability: { '55': 8, '65': 16, '75': 34, '85': 48, '92': 66, '98': 82 }, average: 85, sum_by_card: 218, sum_by_note: 210 },
        fsrs: true,
        true_retention: {
          today: { young_passed: 9, young_failed: 2, mature_passed: 8, mature_failed: 1 },
          yesterday: { young_passed: 14, young_failed: 2, mature_passed: 12, mature_failed: 1 },
          week: { young_passed: 78, young_failed: 11, mature_passed: 65, mature_failed: 5 },
          month: { young_passed: 222, young_failed: 36, mature_passed: 210, mature_failed: 18 },
          year: { young_passed: 410, young_failed: 69, mature_passed: 390, mature_failed: 38 },
          all_time: { young_passed: 520, young_failed: 80, mature_passed: 480, mature_failed: 45 },
        },
        hours: {
          one_month: hourSeries(14),
          three_months: hourSeries(24),
          one_year: hourSeries(38),
          all_time: hourSeries(46),
        },
        buttons: {
          one_month: { learning: [6, 12, 34, 5], young: [5, 16, 42, 7], mature: [2, 8, 35, 9] },
          three_months: { learning: [12, 26, 72, 11], young: [10, 29, 85, 14], mature: [5, 18, 79, 17] },
          one_year: { learning: [18, 98, 106, 8], young: [12, 29, 81, 11], mature: [4, 17, 77, 16] },
          all_time: { learning: [24, 112, 134, 12], young: [18, 38, 108, 16], mature: [6, 22, 95, 22] },
        },
      },
    };
  }

  function request(force = false) {
    syncToolbarUI();
    const key = cacheKey();
    if (!force && cache.has(key)) {
      loading = false;
      if (renderedKey !== key && paintingKey !== key) render(cache.get(key));
      return;
    }
    if (loading && reportedKey === key && !force) return;
    loading = true;
    reportedKey = key;
    ++renderEpoch;
    renderedKey = '';
    paintingKey = '';
    $('stats-loading').hidden = false;
    $('stats-loading').textContent = 'Đang tổng hợp toàn bộ biểu đồ từ Anki…';
    if (!force) $('stats-report').replaceChildren();
    if (!native) {
      const payload = preview();
      cache.set(key, payload);
      loading = false;
      render(payload);
      return;
    }
    if (typeof window.pycmd !== 'function') {
      loading = false;
      $('stats-loading').textContent = 'Cầu nối Anki chưa sẵn sàng. Nhấn Làm mới để thử lại.';
      return;
    }
    window.pycmd('nos:' + JSON.stringify({
      action: 'graphs',
      scope: scope(),
      days: days(),
      search: effectiveSearch(),
      deck_id: selectedDeckId || undefined,
    }));
  }

  function receive(event, payload) {
    if (event === 'graphs_error') {
      loading = false;
      $('stats-loading').hidden = false;
      $('stats-loading').textContent = String(payload);
      return;
    }
    if (event !== 'graphs' || !payload || !payload.data) return;
    if (Array.isArray(payload.decks) && payload.decks.length) {
      availableDecks = payload.decks;
    }
    if (payload.deck_id) selectedDeckId = String(payload.deck_id);
    if (payload.deck_name) selectedDeckName = String(payload.deck_name);
    const key = `${payload.scope}/${payload.days}/${selectedDeckId}/${payload.search ?? effectiveSearch()}`;
    cache.set(key, payload);
    if (payload.scope !== scope() || Number(payload.days) !== days()) return;
    if (payload.search !== undefined && payload.search !== effectiveSearch()) return;
    loading = false;
    render(payload);
  }

  // === Deck Chooser Dialog (Chọn Bộ thẻ) ===
  function renderDeckChooserList() {
    const list = $('stats-deck-list');
    const filter = fold($('stats-deck-filter')?.value || '').trim();
    const words = filter ? filter.split(/\s+/) : [];
    const filtered = availableDecks.filter(d => {
      if (!words.length) return true;
      const hay = fold(d.name);
      return words.every(w => hay.includes(w));
    });
    if ($('stats-deck-count')) {
      $('stats-deck-count').textContent = `${fmtWhole(filtered.length)} bộ thẻ`;
    }
    if (!filtered.length) {
      list.innerHTML = '<p class="stats-deck-empty">Không tìm thấy bộ thẻ phù hợp.</p>';
      return;
    }
    if (!filtered.some(d => d.id === deckDraftId)) {
      deckDraftId = filtered[0].id;
    }
    list.innerHTML = filtered.map(d => {
      const selected = d.id === deckDraftId;
      const depth = Math.max(0, d.name.split('::').length - 1);
      return `<button type="button" class="stats-deck-option${selected ? ' active' : ''}" role="option" aria-selected="${selected}" data-deck-id="${esc(d.id)}" style="--depth:${depth}">` +
        `<span class="stats-deck-option-name" data-i18n-skip>${esc(d.name)}</span>` +
        `</button>`;
    }).join('');
  }

  function openDeckDialog() {
    const dialog = $('stats-deck-dialog');
    if (!dialog) return;
    if (!availableDecks.length && !native) {
      availableDecks = preview().decks;
    }
    deckDraftId = selectedDeckId || availableDecks[0]?.id || '';
    if ($('stats-deck-filter')) $('stats-deck-filter').value = '';
    renderDeckChooserList();
    if (!dialog.open) dialog.showModal();
    $('stats-deck-filter')?.focus();
  }

  function confirmDeckSelection(deckId) {
    const chosen = availableDecks.find(d => d.id === String(deckId));
    const dialog = $('stats-deck-dialog');
    if (dialog?.open) dialog.close();
    if (!chosen) return;
    selectedDeckId = chosen.id;
    selectedDeckName = chosen.name;
    if ($('stats-scope')) $('stats-scope').value = 'deck';
    customSearch = 'deck:current';
    syncToolbarUI();
    cache.clear();
    if (!native) {
      request(true);
      return;
    }
    if (typeof window.pycmd === 'function') {
      loading = true;
      reportedKey = cacheKey();
      $('stats-loading').hidden = false;
      $('stats-loading').textContent = `Đang chuyển thống kê sang “${chosen.name}”…`;
      window.pycmd('nos:' + JSON.stringify({
        action: 'stats_select_deck',
        deck_id: chosen.id,
        scope: 'deck',
        days: days(),
        search: 'deck:current',
      }));
    }
  }

  // === Event delegation for per-card controls & tooltips ===
  const reportEl = $('stats-report');
  reportEl?.addEventListener('click', event => {
    const radio = event.target.closest('[data-card-section][data-card-field]');
    if (radio) {
      const sec = radio.dataset.cardSection;
      const field = radio.dataset.cardField;
      if (!cardState[sec]) return;
      if (radio.dataset.cardToggle === 'true') {
        cardState[sec][field] = !cardState[sec][field];
      } else {
        cardState[sec][field] = radio.dataset.cardValue;
      }
      // If user picks "all" (tất cả / dòng đời) on a history-bounded card while global period is 12 months,
      // automatically upgrade global period to all history (0) so Anki returns full totals.
      if (
        field === 'range' &&
        cardState[sec][field] === 'all' &&
        ['reviews', 'added', 'hours', 'buttons'].includes(sec) &&
        days() !== 0
      ) {
        if ($('stats-period')) $('stats-period').value = '0';
        syncToolbarUI();
        request(false);
        return;
      }
      rerenderCard(sec);
      return;
    }
    const calBtn = event.target.closest('[data-cal-step]');
    if (calBtn && !calBtn.disabled) {
      const step = Number(calBtn.dataset.calStep) || 0;
      cardState.calendar.year = (cardState.calendar.year || new Date().getFullYear()) + step;
      rerenderCard('calendar');
    }
  });
  reportEl?.addEventListener('change', event => {
    const sel = event.target.closest('[data-cal-select]');
    if (sel) {
      const picked = Number(sel.value);
      if (Number.isInteger(picked) && picked >= 2006) {
        cardState.calendar.year = picked;
        rerenderCard('calendar');
      }
    }
  });

  // Floating glass tooltip for SVG bars, slices, and calendar cells
  const tipEl = $('stats-tooltip');
  function positionTip(event) {
    if (!tipEl || tipEl.hidden) return;
    const pad = 12;
    const tw = tipEl.offsetWidth || 160;
    const th = tipEl.offsetHeight || 32;
    let x = event.clientX + 14;
    let y = event.clientY - th - 12;
    if (x + tw + pad > window.innerWidth) x = Math.max(pad, event.clientX - tw - 14);
    if (y < pad) y = event.clientY + 16;
    tipEl.style.left = x + 'px';
    tipEl.style.top = y + 'px';
  }
  reportEl?.addEventListener('pointermove', event => {
    if (!tipEl) return;
    const target = event.target.closest('[data-tip]');
    if (!target) {
      tipEl.hidden = true;
      return;
    }
    const text = target.getAttribute('data-tip');
    if (!text) { tipEl.hidden = true; return; }
    const translated = window.NOSI18n ? window.NOSI18n.t(text) : text;
    if (tipEl.textContent !== translated) tipEl.textContent = translated;
    tipEl.hidden = false;
    positionTip(event);
  });
  reportEl?.addEventListener('pointerleave', () => {
    if (tipEl) tipEl.hidden = true;
  });

  // === Top Anki Filter Bar events ===
  document.querySelectorAll('[data-stats-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.statsScope;
      if ($('stats-scope')) $('stats-scope').value = next;
      customSearch = next === 'collection' ? '' : 'deck:current';
      syncToolbarUI();
      request(false);
    });
  });
  document.querySelectorAll('[data-stats-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = btn.dataset.statsPeriod;
      if ($('stats-period')) $('stats-period').value = next;
      syncToolbarUI();
      request(false);
    });
  });

  $('stats-scope')?.addEventListener('change', () => {
    customSearch = scope() === 'collection' ? '' : 'deck:current';
    syncToolbarUI();
    request(false);
  });
  $('stats-period')?.addEventListener('change', () => {
    syncToolbarUI();
    request(false);
  });

  $('stats-search-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const raw = ($('stats-search')?.value || '').trim();
    customSearch = raw;
    if (raw === '' && $('stats-scope')) {
      $('stats-scope').value = 'collection';
    } else if (raw === 'deck:current' && $('stats-scope')) {
      $('stats-scope').value = 'deck';
    }
    syncToolbarUI();
    request(false);
  });

  $('stats-search-reset')?.addEventListener('click', () => {
    customSearch = scope() === 'collection' ? '' : 'deck:current';
    if ($('stats-search')) $('stats-search').value = customSearch;
    syncToolbarUI();
    request(false);
  });

  $('stats-browse-query')?.addEventListener('click', () => {
    if (!native || typeof window.pycmd !== 'function') {
      $('stats-loading').hidden = false;
      $('stats-loading').textContent = 'Mở Trình duyệt thẻ chỉ hỗ trợ trong Anki.';
      return;
    }
    const query = ($('stats-search')?.value ?? effectiveSearch()).trim();
    window.pycmd('nos:' + JSON.stringify({ action: 'stats_browser_search', query }));
  });

  // Deck chooser modal wiring
  $('stats-deck-picker')?.addEventListener('click', openDeckDialog);
  $('stats-deck-close')?.addEventListener('click', () => $('stats-deck-dialog')?.close());
  $('stats-deck-cancel')?.addEventListener('click', () => $('stats-deck-dialog')?.close());
  $('stats-deck-confirm')?.addEventListener('click', () => confirmDeckSelection(deckDraftId));
  $('stats-deck-filter')?.addEventListener('input', renderDeckChooserList);
  $('stats-deck-filter')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmDeckSelection(deckDraftId);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const opts = [...document.querySelectorAll('#stats-deck-list .stats-deck-option')];
      if (!opts.length) return;
      const idx = Math.max(0, opts.findIndex(o => o.dataset.deckId === deckDraftId));
      const next = opts[(idx + (event.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
      deckDraftId = next.dataset.deckId;
      opts.forEach(o => {
        const active = o === next;
        o.classList.toggle('active', active);
        o.setAttribute('aria-selected', String(active));
      });
      next.scrollIntoView({ block: 'nearest' });
    }
  });
  $('stats-deck-list')?.addEventListener('click', event => {
    const opt = event.target.closest('.stats-deck-option');
    if (!opt) return;
    deckDraftId = opt.dataset.deckId;
    document.querySelectorAll('#stats-deck-list .stats-deck-option').forEach(o => {
      const active = o === opt;
      o.classList.toggle('active', active);
      o.setAttribute('aria-selected', String(active));
    });
  });
  $('stats-deck-list')?.addEventListener('dblclick', event => {
    const opt = event.target.closest('.stats-deck-option');
    if (opt) confirmDeckSelection(opt.dataset.deckId);
  });
  $('stats-deck-dialog')?.addEventListener('click', event => {
    if (event.target === $('stats-deck-dialog')) $('stats-deck-dialog').close();
  });

  function open() {
    if (!$('stats-page').hidden) request(false);
  }
  function reload() {
    cache.delete(cacheKey());
    request(true);
  }
  function refreshMetrics() {
    if (metricData && app.dataset.page === 'stats') updateMetricCards(metricData);
  }

  $('stats-refresh')?.addEventListener('click', reload);
  $('stats-save-pdf')?.addEventListener('click', () => {
    if (!native) {
      $('stats-loading').hidden = false;
      $('stats-loading').textContent = 'Lưu PDF chỉ hỗ trợ trong Anki. Đây là bản xem trước.';
      return;
    }
    if (loading || renderedKey !== cacheKey()) {
      $('stats-loading').hidden = false;
      $('stats-loading').textContent = 'Đang hoàn thiện biểu đồ. Thử xuất PDF sau khi tải xong.';
      return;
    }
    if (typeof window.pycmd === 'function') {
      window.pycmd('nos:' + JSON.stringify({ action: 'stats_pdf' }));
    }
  });

  document.addEventListener('nos:language', () => {
    if (activePayload) render(activePayload);
  });

  window.NOSStats = { open, reload, receive, refreshMetrics };
})();
