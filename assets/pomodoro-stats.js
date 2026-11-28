/* AnkiNOS Pomodoro Statistics — Stacked Bar (Study + Break) + Overlay Line Graph + Period & Multi-Filters. */
(function initNOSPomodoroStats() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNOSPomodoroStats, {once: true});
    return;
  }
  const root = document.getElementById('nos-pomodoro-stats');
  if (!root || window.NOSPomodoroStats) return;

  const $ = id => document.getElementById(id);
  const tr = text => (window.NOSI18n ? window.NOSI18n.t(text) : text);
  const fmtNum = v => (window.NOSI18n ? window.NOSI18n.numberFormat() : new Intl.NumberFormat('vi-VN')).format(v || 0);

  let loaded = false;
  let loadedRevision = null;
  let lastData = null;
  let isPreview = false;

  const queryState = {
    period: 'week',      // week | month | year
    anchor: null,        // YYYY-MM-DD
    mode: 'all',         // all | classic | long | custom | stopwatch
    status: 'all',       // all | completed | stopped
    deck_id: 'all',
    line_metric: 'total', // total | ratio | cards
    show_study: true,
    show_break: true,
    show_line: true,
  };

  const currentRevision = () => window.AnkiNOS?.getSnapshot?.()?.support_revision ?? null;

  function fmtDuration(seconds) {
    const sec = Math.max(0, Math.round(Number(seconds) || 0));
    if (sec === 0) return tr('0 phút');
    if (sec < 60) return tr(`${sec} giây`);
    const mins = Math.round(sec / 60);
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return m ? tr(`${h} giờ ${String(m).padStart(2, '0')} phút`) : tr(`${h} giờ`);
    }
    return tr(`${mins} phút`);
  }

  function fmtAxisTime(seconds) {
    const mins = Math.round((seconds || 0) / 60);
    if (mins >= 60) {
      const h = mins / 60;
      return (Number.isInteger(h) ? h : h.toFixed(1)) + 'h';
    }
    return mins + 'm';
  }

  function fmtDateTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    return window.NOSI18n
      ? window.NOSI18n.dateFormat({day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}).format(d)
      : d.toLocaleString('vi-VN');
  }

  function modeBadge(m) {
    if (m === 'classic') return '25/5';
    if (m === 'long') return '50/10';
    if (m === 'stopwatch') return tr('Timer đếm');
    return tr('Tùy chỉnh');
  }

  /* ---------- Standalone Offline Preview Dataset ---------- */
  const PREVIEW_SESSIONS = (() => {
    const out = [];
    const today = new Date();
    const modes = ['classic', 'classic', 'long', 'custom', 'stopwatch'];
    const decks = [
      {id: '101', name: 'Tiếng Anh — Từ vựng'},
      {id: '102', name: 'Tiếng Nhật — Kanji N3'},
      {id: '103', name: 'Y khoa — Giải phẫu'},
    ];
    for (let i = 0; i < 160; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Math.floor(i * 1.4));
      const iso = d.toISOString().slice(0, 10) + 'T09:15:00+07:00';
      const m = modes[i % modes.length];
      const dk = decks[i % decks.length];
      const studySec = m === 'long' ? 3000 : m === 'classic' ? 1500 : m === 'custom' ? 2100 : 1800 + (i % 4) * 300;
      const breakSec = m === 'long' ? 600 : m === 'classic' ? 300 : m === 'custom' ? 420 : 360;
      const st = i % 6 === 0 ? 'stopped' : 'completed';
      out.push({
        started_at: iso,
        phase: 'study',
        mode: m,
        seconds: st === 'stopped' ? Math.round(studySec * 0.72) : studySec,
        target_seconds: m === 'stopwatch' ? 0 : studySec,
        cards: 18 + (i % 24),
        deck_id: dk.id,
        deck_name: dk.name,
        status: st,
      });
      out.push({
        started_at: iso,
        phase: 'break',
        mode: m,
        seconds: breakSec,
        target_seconds: m === 'stopwatch' ? 0 : breakSec,
        cards: 0,
        deck_id: dk.id,
        deck_name: dk.name,
        status: 'completed',
      });
    }
    return out;
  })();

  function buildPreviewAnalytics() {
    const today = new Date();
    const toIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const todayIso = toIso(today);
    const anchor = queryState.anchor ? new Date(queryState.anchor + 'T00:00:00') : new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const period = queryState.period;
    let start, end, prevAnchor, nextAnchor, periodLabel, keyLen;
    const bucketDefs = [];

    if (period === 'week') {
      const wd = (anchor.getDay() + 6) % 7;
      start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - wd);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      prevAnchor = toIso(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7));
      nextAnchor = toIso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7));
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const iso = toIso(d);
        bucketDefs.push([iso, `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, iso]);
      }
      periodLabel = `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')} – ${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}/${end.getFullYear()}`;
      keyLen = 10;
    } else if (period === 'month') {
      const dim = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      end = new Date(anchor.getFullYear(), anchor.getMonth(), dim);
      prevAnchor = toIso(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
      nextAnchor = toIso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
      for (let d = 1; d <= dim; d++) {
        const iso = toIso(new Date(anchor.getFullYear(), anchor.getMonth(), d));
        bucketDefs.push([iso, String(d), iso]);
      }
      periodLabel = `Tháng ${anchor.getMonth() + 1}/${anchor.getFullYear()}`;
      keyLen = 10;
    } else {
      start = new Date(anchor.getFullYear(), 0, 1);
      end = new Date(anchor.getFullYear(), 11, 31);
      prevAnchor = `${anchor.getFullYear() - 1}-01-01`;
      nextAnchor = `${anchor.getFullYear() + 1}-01-01`;
      for (let m = 1; m <= 12; m++) {
        bucketDefs.push([`${anchor.getFullYear()}-${String(m).padStart(2, '0')}`, `Th${m}`, `Tháng ${m}/${anchor.getFullYear()}`]);
      }
      periodLabel = `Năm ${anchor.getFullYear()}`;
      keyLen = 7;
    }

    const startIso = toIso(start);
    const endIso = toIso(end);
    const map = new Map(bucketDefs.map(([key, label, full_label]) => [
      key,
      {key, label, full_label, study_seconds: 0, break_seconds: 0, total_seconds: 0, focus_ratio: null, cards: 0, study_sessions: 0, break_sessions: 0, completed_sessions: 0},
    ]));
    const decksSeen = new Map();
    let totalStudy = 0, totalBreak = 0, totalCards = 0, studySess = 0, breakSess = 0, compSess = 0, todayStudy = 0, todayBreak = 0;
    const matched = [];
    for (const row of PREVIEW_SESSIONS) {
      if (row.deck_id) decksSeen.set(row.deck_id, row.deck_name);
      const day = row.started_at.slice(0, 10);
      if (day === todayIso) {
        if (row.phase === 'study') todayStudy += row.seconds;
        else todayBreak += row.seconds;
      }
      if (queryState.mode !== 'all' && row.mode !== queryState.mode) continue;
      if (queryState.status === 'completed' && row.status !== 'completed') continue;
      if (queryState.status === 'stopped' && row.status === 'completed') continue;
      if (queryState.deck_id !== 'all' && row.deck_id !== queryState.deck_id) continue;
      if (day < startIso || day > endIso) continue;
      const b = map.get(row.started_at.slice(0, keyLen));
      if (b) {
        if (row.phase === 'study') { b.study_seconds += row.seconds; b.study_sessions++; b.cards += row.cards; }
        else { b.break_seconds += row.seconds; b.break_sessions++; }
        if (row.status === 'completed') b.completed_sessions++;
      }
      if (row.phase === 'study') { totalStudy += row.seconds; studySess++; totalCards += row.cards; }
      else { totalBreak += row.seconds; breakSess++; }
      if (row.status === 'completed') compSess++;
      if (matched.length < 60) matched.push(row);
    }
    const buckets = Array.from(map.values()).map(b => {
      b.total_seconds = b.study_seconds + b.break_seconds;
      b.focus_ratio = b.total_seconds > 0 ? Math.round((b.study_seconds / b.total_seconds) * 1000) / 10 : null;
      return b;
    });
    const totalAll = totalStudy + totalBreak;
    return {
      period,
      anchor: toIso(anchor),
      today: todayIso,
      period_label: periodLabel,
      prev_anchor: prevAnchor,
      next_anchor: nextAnchor,
      can_next: endIso < todayIso,
      filters: {mode: queryState.mode, status: queryState.status, deck_id: queryState.deck_id},
      summary: {
        study_seconds: totalStudy,
        break_seconds: totalBreak,
        total_seconds: totalAll,
        focus_ratio: totalAll > 0 ? Math.round((totalStudy / totalAll) * 1000) / 10 : null,
        study_sessions: studySess,
        break_sessions: breakSess,
        total_sessions: studySess + breakSess,
        completed_sessions: compSess,
        avg_study_seconds: studySess > 0 ? Math.round(totalStudy / studySess) : 0,
        total_cards: totalCards,
        today_study_seconds: todayStudy,
        today_break_seconds: todayBreak,
      },
      buckets,
      decks: Array.from(decksSeen, ([id, name]) => ({id, name})),
      sessions: matched,
    };
  }

  function request() {
    if (typeof window.pycmd === 'function' && document.getElementById('nos-app')?.dataset.native === 'true') {
      window.pycmd('nos:' + JSON.stringify({
        action: 'pomodoro_analytics',
        period: queryState.period,
        anchor: queryState.anchor,
        mode: queryState.mode,
        status: queryState.status,
        deck_id: queryState.deck_id,
      }));
    } else {
      render(buildPreviewAnalytics(), true);
    }
  }

  function niceMax(val, minVal) {
    const v = Math.max(minVal, val || 0);
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const frac = v / exp;
    const step = frac <= 1.2 ? 1.2 : frac <= 1.5 ? 1.5 : frac <= 2 ? 2 : frac <= 2.5 ? 2.5 : frac <= 3 ? 3 : frac <= 4 ? 4 : frac <= 5 ? 5 : frac <= 6 ? 6 : frac <= 8 ? 8 : 10;
    return Math.ceil(step * exp);
  }

  function drawComboChart(data) {
    const wrap = $('pomo-chart-wrap');
    const tooltip = $('pomo-chart-tooltip');
    if (!wrap) return;
    const buckets = Array.isArray(data.buckets) ? data.buckets : [];
    const showStudy = queryState.show_study;
    const showBreak = queryState.show_break;
    const showLine = queryState.show_line;
    const lineMetric = queryState.line_metric;

    const W = 680;
    const H = 248;
    const padL = 44;
    const padR = showLine && lineMetric !== 'total' ? 44 : 16;
    const padT = 18;
    const padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const barMaxRaw = Math.max(
      0,
      ...buckets.map(b => (showStudy ? b.study_seconds : 0) + (showBreak ? b.break_seconds : 0)),
      showLine && lineMetric === 'total' ? Math.max(0, ...buckets.map(b => b.total_seconds || 0)) : 0,
    );
    const maxSec = niceMax(Math.max(1800, barMaxRaw), 1800);
    const maxLineRight = lineMetric === 'ratio'
      ? 100
      : niceMax(Math.max(10, ...buckets.map(b => b.cards || 0)), 10);

    const ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs = {}, text = '') => {
      const n = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (text) n.textContent = text;
      return n;
    };

    const svg = el('svg', {class: 'pomo-combo-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': tr('Biểu đồ cột chồng giờ học và giờ nghỉ kết hợp đường phân tích')});

    // Horizontal grid & Y axes
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const frac = i / ticks;
      const y = padT + plotH * (1 - frac);
      svg.append(el('line', {class: 'pomo-grid-line', x1: padL, y1: y.toFixed(1), x2: W - padR, y2: y.toFixed(1)}));
      svg.append(el('text', {class: 'pomo-axis-text', x: padL - 7, y: (y + 3.5).toFixed(1), 'text-anchor': 'end'}, fmtAxisTime(maxSec * frac)));
      if (showLine && lineMetric !== 'total') {
        const rightLbl = lineMetric === 'ratio' ? `${Math.round(frac * 100)}%` : String(Math.round(maxLineRight * frac));
        svg.append(el('text', {class: 'pomo-axis-text', x: W - padR + 7, y: (y + 3.5).toFixed(1), 'text-anchor': 'start'}, rightLbl));
      }
    }

    const n = Math.max(1, buckets.length);
    const step = plotW / n;
    const barW = Math.max(5, Math.min(34, step * 0.62));
    const labelEvery = n > 20 ? 5 : n > 12 ? 2 : 1;

    const linePts = [];
    buckets.forEach((b, i) => {
      const cx = padL + step * (i + 0.5);
      const bx = cx - barW / 2;
      const studyVal = showStudy ? (b.study_seconds || 0) : 0;
      const breakVal = showBreak ? (b.break_seconds || 0) : 0;
      const studyH = (studyVal / maxSec) * plotH;
      const breakH = (breakVal / maxSec) * plotH;
      const g = el('g', {class: 'pomo-col', 'data-idx': i});

      if (studyH > 0) {
        g.append(el('rect', {
          class: 'pomo-bar-study',
          x: bx.toFixed(1),
          y: (padT + plotH - studyH).toFixed(1),
          width: barW.toFixed(1),
          height: Math.max(1.5, studyH).toFixed(1),
          rx: breakH > 0 ? 1.5 : 3.5,
        }));
      }
      if (breakH > 0) {
        g.append(el('rect', {
          class: 'pomo-bar-break',
          x: bx.toFixed(1),
          y: (padT + plotH - studyH - breakH).toFixed(1),
          width: barW.toFixed(1),
          height: Math.max(1.5, breakH).toFixed(1),
          rx: 3.5,
        }));
      }
      g.append(el('rect', {
        class: 'pomo-bar-hit',
        x: (padL + step * i).toFixed(1),
        y: padT,
        width: step.toFixed(1),
        height: plotH,
      }));
      if (i % labelEvery === 0 || i === n - 1) {
        g.append(el('text', {
          class: 'pomo-axis-text',
          x: cx.toFixed(1),
          y: H - 8,
          'text-anchor': 'middle',
        }, tr(b.label)));
      }
      svg.append(g);

      if (showLine) {
        let ly = null;
        if (lineMetric === 'total') {
          ly = padT + plotH - ((b.total_seconds || 0) / maxSec) * plotH;
        } else if (lineMetric === 'ratio' && b.focus_ratio !== null && b.focus_ratio !== undefined) {
          ly = padT + plotH - (Math.min(100, Math.max(0, b.focus_ratio)) / 100) * plotH;
        } else if (lineMetric === 'cards') {
          ly = padT + plotH - ((b.cards || 0) / maxLineRight) * plotH;
        }
        if (ly !== null) linePts.push({x: cx, y: ly, idx: i});
      }
    });

    if (showLine && linePts.length >= 1) {
      if (linePts.length >= 2) {
        const dPath = linePts.map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
        svg.append(el('path', {class: 'pomo-line-path', d: dPath}));
      }
      for (const pt of linePts) {
        svg.append(el('circle', {class: 'pomo-line-dot', cx: pt.x.toFixed(1), cy: pt.y.toFixed(1), r: n > 20 ? 2.8 : 3.8}));
      }
    }

    const oldSvg = wrap.querySelector('svg');
    if (oldSvg) oldSvg.replaceWith(svg);
    else wrap.prepend(svg);

    svg.addEventListener('pointermove', e => {
      const col = e.target.closest('.pomo-col');
      if (!col || !tooltip) { if (tooltip) tooltip.hidden = true; return; }
      const b = buckets[Number(col.dataset.idx)];
      if (!b) return;
      const ratioTxt = b.focus_ratio !== null && b.focus_ratio !== undefined ? `${b.focus_ratio}%` : '—';
      tooltip.innerHTML = `
        <strong data-i18n-skip>${tr(b.full_label)}</strong>
        <div class="pomo-tip-row"><span>${tr('Giờ học')}</span><span>${fmtDuration(b.study_seconds)}</span></div>
        <div class="pomo-tip-row"><span>${tr('Giờ nghỉ')}</span><span>${fmtDuration(b.break_seconds)}</span></div>
        <div class="pomo-tip-row total"><span>${tr('Tổng cả 2')}</span><span>${fmtDuration(b.total_seconds)}</span></div>
        <div class="pomo-tip-row"><span>${tr('Tỷ lệ tập trung')}</span><span>${ratioTxt}</span></div>
        <div class="pomo-tip-row"><span>${tr('Lượt ôn')}</span><span>${fmtNum(b.cards)}</span></div>`;
      tooltip.hidden = false;
      const r = wrap.getBoundingClientRect();
      const x = Math.min(r.width - tooltip.offsetWidth - 8, Math.max(8, e.clientX - r.left + 12));
      const y = Math.min(r.height - tooltip.offsetHeight - 8, Math.max(8, e.clientY - r.top - 12));
      tooltip.style.left = `${Math.round(x)}px`;
      tooltip.style.top = `${Math.round(y)}px`;
    });
    svg.addEventListener('pointerleave', () => {
      if (tooltip) tooltip.hidden = true;
    });
  }

  function render(data, preview = false) {
    if (!data || !data.summary) return;
    loaded = true;
    lastData = data;
    isPreview = preview;
    loadedRevision = currentRevision();
    queryState.period = data.period || queryState.period;
    queryState.anchor = data.anchor || queryState.anchor;

    root.querySelectorAll('[data-pomo-period]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.pomoPeriod === queryState.period));
    });
    if ($('pomo-period-label')) $('pomo-period-label').textContent = tr(data.period_label || '');
    if ($('pomo-nav-next')) $('pomo-nav-next').disabled = !data.can_next;

    // Populate deck filter while keeping user selection
    const deckSel = $('pomo-filter-deck');
    if (deckSel && Array.isArray(data.decks)) {
      const key = JSON.stringify(data.decks);
      if (deckSel.dataset.key !== key) {
        deckSel.dataset.key = key;
        deckSel.replaceChildren();
        const allOpt = document.createElement('option');
        allOpt.value = 'all';
        allOpt.textContent = tr('Mọi bộ thẻ');
        deckSel.append(allOpt);
        for (const dk of data.decks) {
          const opt = document.createElement('option');
          opt.value = dk.id;
          opt.textContent = dk.name;
          opt.setAttribute('data-i18n-skip', '');
          deckSel.append(opt);
        }
      }
      deckSel.value = Array.from(deckSel.options).some(o => o.value === queryState.deck_id) ? queryState.deck_id : 'all';
    }

    const s = data.summary;
    const studyShare = s.total_seconds > 0 ? Math.round((s.study_seconds / s.total_seconds) * 100) : 0;
    const breakShare = s.total_seconds > 0 ? Math.max(0, 100 - studyShare) : 0;

    if ($('pomo-kpi-total')) $('pomo-kpi-total').textContent = fmtDuration(s.total_seconds);
    if ($('pomo-kpi-total-sub')) $('pomo-kpi-total-sub').textContent = tr(`Hôm nay: ${fmtDuration((s.today_study_seconds || 0) + (s.today_break_seconds || 0))}`);
    if ($('pomo-kpi-study')) $('pomo-kpi-study').textContent = fmtDuration(s.study_seconds);
    if ($('pomo-kpi-study-sub')) $('pomo-kpi-study-sub').textContent = s.total_seconds > 0 ? tr(`${studyShare}% tổng thời gian`) : tr('Chưa có phiên học');
    if ($('pomo-kpi-break')) $('pomo-kpi-break').textContent = fmtDuration(s.break_seconds);
    if ($('pomo-kpi-break-sub')) $('pomo-kpi-break-sub').textContent = s.total_seconds > 0 ? tr(`${breakShare}% tổng thời gian`) : tr('Chưa có phiên nghỉ');
    if ($('pomo-kpi-sessions')) $('pomo-kpi-sessions').textContent = `${fmtNum(s.completed_sessions)} / ${fmtNum(s.total_sessions)}`;
    if ($('pomo-kpi-avg')) $('pomo-kpi-avg').textContent = fmtDuration(s.avg_study_seconds);
    if ($('pomo-kpi-cards')) $('pomo-kpi-cards').textContent = fmtNum(s.total_cards);

    const lineHintMap = {
      total: tr('Đường vàng: Tổng thời gian (Học + Nghỉ)'),
      ratio: tr('Đường vàng: Tỷ lệ tập trung (% Học / Tổng)'),
      cards: tr('Đường vàng: Số lượt ôn trong Pomodoro'),
    };
    if ($('pomo-chart-sub')) $('pomo-chart-sub').textContent = lineHintMap[queryState.line_metric] || '';

    drawComboChart(data);

    // Recent Sessions List
    const list = $('pomo-session-list');
    if (list) {
      list.replaceChildren();
      const rows = Array.isArray(data.sessions) ? data.sessions : [];
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'pomo-session-meta';
        empty.textContent = preview
          ? tr('Không có phiên nào khớp bộ lọc minh họa.')
          : tr('Chưa có phiên Pomodoro nào trong khoảng thời gian này.');
        list.append(empty);
      } else {
        for (const item of rows) {
          const row = document.createElement('div');
          row.className = 'pomo-session-row';
          const statusLbl = item.status === 'completed'
            ? tr('Hoàn thành')
            : item.status === 'skipped'
              ? tr('Chuyển pha')
              : item.status === 'interrupted'
                ? tr('Gián đoạn')
                : tr('Dừng sớm');
          const main = document.createElement('div');
          main.className = 'pomo-session-main';
          const top = document.createElement('div');
          top.className = 'pomo-session-top';
          const phTag = document.createElement('span');
          phTag.className = 'pomo-tag ' + (item.phase === 'break' ? 'break' : 'study');
          phTag.textContent = tr(item.phase === 'break' ? 'Nghỉ' : 'Học');
          const mTag = document.createElement('span');
          mTag.className = 'pomo-tag mode';
          mTag.textContent = modeBadge(item.mode);
          const dt = document.createElement('span');
          dt.className = 'pomo-session-meta';
          dt.setAttribute('data-i18n-skip', '');
          dt.textContent = fmtDateTime(item.started_at);
          top.append(phTag, mTag, dt);

          const sub = document.createElement('div');
          sub.className = 'pomo-session-meta';
          sub.setAttribute('data-i18n-skip', '');
          const parts = [statusLbl];
          if (item.phase === 'study' && item.cards > 0) parts.push(tr(`${fmtNum(item.cards)} lượt ôn`));
          if (item.deck_name) parts.push(item.deck_name);
          sub.textContent = parts.join(' · ');

          main.append(top, sub);
          const dur = document.createElement('span');
          dur.className = 'pomo-session-dur';
          dur.textContent = fmtDuration(item.seconds);
          row.append(main, dur);
          list.append(row);
        }
      }
    }

    if ($('pomo-stats-status')) {
      $('pomo-stats-status').textContent = preview
        ? tr('Bản xem trước · Dữ liệu Pomodoro minh họa')
        : tr('Dữ liệu Pomodoro lưu cục bộ theo hồ sơ, không đồng bộ AnkiWeb');
    }
  }

  /* ---------- Event Wiring ---------- */
  root.addEventListener('click', e => {
    const pBtn = e.target.closest('[data-pomo-period]');
    if (pBtn) {
      queryState.period = pBtn.dataset.pomoPeriod;
      queryState.anchor = null;
      request();
      return;
    }
    if (e.target.closest('#pomo-nav-prev') && lastData?.prev_anchor) {
      queryState.anchor = lastData.prev_anchor;
      request();
      return;
    }
    if (e.target.closest('#pomo-nav-next') && lastData?.can_next && lastData?.next_anchor) {
      queryState.anchor = lastData.next_anchor;
      request();
      return;
    }
    if (e.target.closest('#pomo-nav-today')) {
      queryState.anchor = null;
      request();
      return;
    }
    if (e.target.closest('#pomo-stats-refresh')) {
      request();
      return;
    }
    const seriesBtn = e.target.closest('[data-pomo-series]');
    if (seriesBtn) {
      const key = 'show_' + seriesBtn.dataset.pomoSeries;
      queryState[key] = !queryState[key];
      seriesBtn.setAttribute('aria-pressed', String(queryState[key]));
      if (lastData) drawComboChart(lastData);
    }
  });

  $('pomo-filter-mode')?.addEventListener('change', e => { queryState.mode = e.target.value; request(); });
  $('pomo-filter-status')?.addEventListener('change', e => { queryState.status = e.target.value; request(); });
  $('pomo-filter-deck')?.addEventListener('change', e => { queryState.deck_id = e.target.value; request(); });
  $('pomo-line-metric')?.addEventListener('change', e => {
    queryState.line_metric = e.target.value;
    if (lastData) render(lastData, isPreview);
  });

  document.addEventListener('nos:language', () => {
    if (lastData) render(lastData, isPreview);
  });

  window.NOSPomodoroStats = {
    request,
    render,
    open() {
      if (loaded && loadedRevision === currentRevision()) return;
      request();
    },
  };
})();
