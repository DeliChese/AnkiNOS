(function initDailySchedule() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDailySchedule, {once: true});
    return;
  }
  const page = document.getElementById('daily-page');
  if (!page || window.NOSDaily) return;

  const app = document.getElementById('nos-app');
  const native = app?.dataset.native === 'true' || typeof window.pycmd === 'function';
  const $ = id => document.getElementById('daily-' + id);
  const fmt = new Intl.NumberFormat('vi-VN');
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  let seq = 0;
  let pending = null;
  let state = null;
  let scopeOpen = false;
  let previewOpen = false;
  let todayTab = 'decks'; // 'decks' | 'cohorts' | 'cards'
  let horizonLimit = 14;
  let inspectedOffset = null;
  let lastAppliedBatchId = '';
  let scopeDraft = {scope_mode: 'all', deck_names: [], include_children: true, daily_cap: 40};
  let scopeQuery = '';
  let busy = false;
  let previewMock = null;
  let loadedRevision = null;
  const currentRevision = () => window.AnkiNOS?.getSnapshot?.()?.support_revision ?? null;

  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .toLowerCase();
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function svgEl(tag, attrs = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  }

  function parseIso(isoStr) {
    const [y, m, d] = String(isoStr || '2026-01-01').split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function formatShortDate(isoStr) {
    const dt = parseIso(isoStr);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  }

  function formatFullDate(isoStr) {
    const dt = parseIso(isoStr);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    return `${dayNames[dt.getDay()]}, ${dd}/${mm}/${dt.getFullYear()}`;
  }

  function setStatus(msg = '', isError = false) {
    const box = $('status');
    if (!box) return;
    box.textContent = msg;
    box.hidden = !msg;
    box.classList.toggle('is-error', isError);
  }

  function estimateMinutes(cards) {
    if (!cards) return '';
    // Roughly 14s per review card when no personal timing sample is attached.
    const mins = Math.max(1, Math.round((cards * 14) / 60));
    return `≈ ${fmt.format(mins)} phút`;
  }

  /* ---------- Standalone preview fixture (outside Anki only) ---------- */
  function buildPreviewMock() {
    const today = new Date();
    const isoOf = offset => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const decks = [
      {id: '101', name: 'Tiếng Anh'},
      {id: '111', name: 'Tiếng Anh::Từ vựng'},
      {id: '112', name: 'Tiếng Anh::Ngữ pháp'},
      {id: '102', name: 'Y học cơ sở'},
      {id: '121', name: 'Y học cơ sở::Giải phẫu'},
    ];
    const cards = [];
    for (let i = 0; i < 18; i++) {
      const deck = decks[i % decks.length];
      cards.push({
        card_id: 5000 + i,
        deck_id: deck.id,
        deck_name: deck.name,
        preview: `Thẻ quá hạn minh họa #${i + 1} (${deck.name.split('::').pop()})`,
        first_studied_day: isoOf(-12 - (i % 7)),
        due_offset: -(1 + (i % 4)),
        ivl: i < 6 ? 2 + i : 14 + i * 3,
        stability: i < 6 ? 2.5 + i * 0.6 : 22 + i * 4,
        r_before: i < 6 ? 62 + i * 2.5 : 84 + (i % 7),
      });
    }
    const baseFuture = {};
    for (let offset = 0; offset <= 45; offset++) {
      baseFuture[offset] = offset === 0 ? 26 : ((offset * 11 + 5) % 28);
    }
    return {
      isoOf,
      decks,
      config: {scope_mode: 'all', deck_names: [], include_children: true, daily_cap: 40, auto_reschedule: false, active_preset_id: ''},
      presets: [
        {id: 'p-en', name: 'Tiếng Anh', scope_mode: 'decks', deck_names: ['Tiếng Anh'], include_children: true, daily_cap: 35},
      ],
      batches: [],
      overdueCards: cards,
      baseFuture,
    };
  }

  function computePreviewPayload() {
    if (!previewMock) previewMock = buildPreviewMock();
    const {isoOf, decks, config, presets, batches, overdueCards, baseFuture} = previewMock;
    const cap = Math.max(1, Math.min(2000, Number(config.daily_cap) || 40));
    const matchesDeck = name => {
      if (config.scope_mode !== 'decks') return true;
      return (config.deck_names || []).some(sel => name === sel || (config.include_children && name.startsWith(sel + '::')));
    };
    const filteredOverdue = overdueCards.filter(c => matchesDeck(c.deck_name));
    const factor = config.scope_mode === 'decks' ? (config.deck_names.length ? 0.55 : 0) : 1;
    const loads = {};
    for (let offset = 0; offset <= 45; offset++) loads[offset] = Math.round((baseFuture[offset] || 0) * factor);

    // Mini client-side mirror of adaptive window planner for interactive preview.
    let win = 14;
    const freeSlots = w => {
      let s = 0;
      for (let d = 0; d <= w; d++) s += Math.max(0, cap - (loads[d] || 0));
      return s;
    };
    while (freeSlots(win) < filteredOverdue.length && win < 90) win += 7;
    const projected = {...loads};
    const moves = [];
    const sorted = [...filteredOverdue].sort((a, b) => a.r_before - b.r_before);
    for (const c of sorted) {
      let bestD = 0, bestScore = Infinity;
      for (let d = 0; d <= win; d++) {
        if ((projected[d] || 0) >= cap) continue;
        const rTarget = Math.max(25, c.r_before - (d * (100 - c.r_before)) / Math.max(c.stability, 2));
        const loss = Math.max(0, (c.r_before - rTarget) / 100);
        const score = 3.2 * loss + 1.15 * ((projected[d] || 0) / cap) + 0.08 * (d / Math.max(1, win));
        if (score < bestScore) { bestScore = score; bestD = d; }
      }
      projected[bestD] = (projected[bestD] || 0) + 1;
      const rTarget = Math.round(Math.max(25, c.r_before - (bestD * (100 - c.r_before)) / Math.max(c.stability, 2)) * 10) / 10;
      moves.push({
        card_id: c.card_id, deck_id: c.deck_id, deck_name: c.deck_name, preview: c.preview,
        first_studied_day: c.first_studied_day, old_due: c.due_offset, new_due: bestD,
        old_date: isoOf(c.due_offset), new_date: isoOf(bestD), target_offset: bestD,
        ivl: c.ivl, stability: c.stability, r_before: c.r_before, r_target: rTarget,
        reason: bestD === 0 ? `R thấp (${Math.round(c.r_before)}%) — ưu tiên ôn hôm nay` : 'Ổn định tốt — dời sang ngày tương lai ít thẻ nhất',
      });
    }
    const chartDays = [];
    const chartEnd = Math.max(14, ...moves.map(m => m.target_offset));
    for (let d = 0; d <= chartEnd; d++) {
      const before = loads[d] || 0, after = projected[d] || before;
      chartDays.push({offset: d, date: isoOf(d), before, added: after - before, after, cap});
    }
    const todayCount = loads[0] || 0;
    const futureDays = [];
    for (let d = 1; d <= 45; d++) {
      const cnt = loads[d] || 0;
      futureDays.push({
        offset: d, date: isoOf(d), locked: true, count: cnt, review_count: cnt, day_learn_count: 0,
        avg_r: cnt ? 88.5 : null, min_r: cnt ? 79.0 : null,
        tiers: {critical: 0, due: Math.round(cnt * 0.4), strong: cnt - Math.round(cnt * 0.4)},
        decks: cnt ? [{name: 'Tiếng Anh::Từ vựng', count: Math.ceil(cnt * 0.6)}, {name: 'Y học cơ sở::Giải phẫu', count: Math.floor(cnt * 0.4)}].filter(x => x.count > 0) : [],
        cohorts: cnt ? [{day: isoOf(-d - 3), count: cnt}] : [],
        cards: cnt ? [{card_id: 9000 + d, deck_name: 'Tiếng Anh::Từ vựng', preview: `Thẻ đã xếp cho ngày ${formatShortDate(isoOf(d))} (minh họa)`, first_studied_day: isoOf(-d - 3), ivl: d + 4, stability: d + 6, retrievability: 88.5, queue: 2}] : [],
      });
    }
    const label = config.scope_mode !== 'decks' ? 'Toàn bộ bộ sưu tập'
      : !config.deck_names.length ? 'Chưa chọn bộ thẻ'
      : config.deck_names.length === 1 ? config.deck_names[0] + (config.include_children ? ' (+ bộ con)' : '')
      : `${config.deck_names.length} bộ thẻ đã chọn`;
    return {
      config: {...config},
      scope_label: label,
      presets: [...presets],
      batches: [...batches],
      schedule: {
        today: isoOf(0), daily_cap: cap, scope_mode: config.scope_mode,
        total_tracked: todayCount + futureDays.reduce((s, d) => s + d.count, 0) + filteredOverdue.length,
        pending_first_study: 42,
        overdue: {count: filteredOverdue.length, movable_count: filteredOverdue.length, non_movable_count: 0, days_count: filteredOverdue.length ? 4 : 0, days: []},
        today_bucket: {
          date: isoOf(0), locked: false, count: todayCount, review_count: todayCount, day_learn_count: 0,
          avg_r: todayCount ? 82.4 : null, min_r: todayCount ? 64.0 : null,
          tiers: {critical: Math.round(todayCount * 0.25), due: Math.round(todayCount * 0.5), strong: todayCount - Math.round(todayCount * 0.25) - Math.round(todayCount * 0.5)},
          decks: todayCount ? [{name: 'Tiếng Anh::Từ vựng', count: Math.ceil(todayCount * 0.55)}, {name: 'Y học cơ sở::Giải phẫu', count: Math.floor(todayCount * 0.45)}].filter(x => x.count > 0) : [],
          cohorts: todayCount ? [{day: isoOf(-1), count: Math.ceil(todayCount * 0.4)}, {day: isoOf(-7), count: Math.floor(todayCount * 0.6)}].filter(x => x.count > 0) : [],
          cards: todayCount ? [
            {card_id: 7001, deck_name: 'Tiếng Anh::Từ vựng', preview: 'resilience — khả năng phục hồi (minh họa)', first_studied_day: isoOf(-7), ivl: 7, stability: 6.8, retrievability: 68.2, queue: 2},
            {card_id: 7002, deck_name: 'Y học cơ sở::Giải phẫu', preview: 'Cơ hoành (Diaphragm) — chi phối thần kinh (minh họa)', first_studied_day: isoOf(-14), ivl: 14, stability: 15.2, retrievability: 84.5, queue: 2},
          ] : [],
          card_ids: todayCount ? [7001, 7002] : [],
        },
        future: {horizon_days: 45, total_in_horizon: futureDays.reduce((s, d) => s + d.count, 0), beyond_horizon_count: 118, days: futureDays},
        plan: {
          total_movable: moves.length, daily_cap: cap, initial_window: 14, expanded_window: win,
          window_expanded: win > 14,
          today_added: moves.filter(m => m.target_offset === 0).length,
          future_added: moves.filter(m => m.target_offset > 0).length,
          future_days_used: new Set(moves.filter(m => m.target_offset > 0).map(m => m.target_offset)).size,
          moves, days: chartDays,
          summary: moves.length ? `Đề xuất dời ${moves.length} thẻ quá hạn · ${moves.filter(m => m.target_offset === 0).length} thẻ R thấp về Hôm nay · rải phần còn lại sang các ngày ít thẻ nhất (trần ${cap} thẻ/ngày).` : 'Không có thẻ quá hạn cần điều phối.',
        },
        decks,
      },
    };
  }

  function handlePreviewCommand(method, args) {
    if (!previewMock) previewMock = buildPreviewMock();
    if (method === 'save_config' && args.config) {
      previewMock.config = {...previewMock.config, ...args.config};
    } else if (method === 'save_preset') {
      const id = 'p-' + (++seq);
      const item = {id, name: String(args.name || 'Phạm vi').trim(), ...args.config};
      previewMock.presets.unshift(item);
      previewMock.config = {...previewMock.config, ...args.config, active_preset_id: id};
    } else if (method === 'delete_preset') {
      previewMock.presets = previewMock.presets.filter(p => p.id !== args.preset_id);
      if (previewMock.config.active_preset_id === args.preset_id) previewMock.config.active_preset_id = '';
    } else if (method === 'apply_plan') {
      const current = computePreviewPayload();
      const moves = current.schedule.plan.moves;
      for (const m of moves) previewMock.baseFuture[m.target_offset] = (previewMock.baseFuture[m.target_offset] || 0) + 1;
      const movedIds = new Set(moves.map(m => m.card_id));
      const snapshot = previewMock.overdueCards.filter(c => movedIds.has(c.card_id));
      previewMock.overdueCards = previewMock.overdueCards.filter(c => !movedIds.has(c.card_id));
      const batch = {
        id: 'b-' + (++seq), created_at: new Date().toISOString().slice(0, 19) + 'Z',
        scope_label: current.scope_label, daily_cap: current.schedule.plan.daily_cap,
        window_days: current.schedule.plan.expanded_window, card_count: moves.length,
        summary: current.schedule.plan.summary, rolled_back_at: null,
        _snapshot: snapshot, _moves: moves,
      };
      previewMock.batches.unshift(batch);
      const next = computePreviewPayload();
      next.apply_result = {applied: moves.length, skipped: 0, batch};
      return Promise.resolve(next);
    } else if (method === 'rollback_batch') {
      const batch = previewMock.batches.find(b => b.id === args.batch_id);
      if (batch && !batch.rolled_back_at) {
        batch.rolled_back_at = new Date().toISOString().slice(0, 19) + 'Z';
        for (const m of (batch._moves || [])) {
          previewMock.baseFuture[m.target_offset] = Math.max(0, (previewMock.baseFuture[m.target_offset] || 0) - 1);
        }
        previewMock.overdueCards.push(...(batch._snapshot || []));
      }
      const next = computePreviewPayload();
      next.rollback_result = {batch_id: args.batch_id, restored: batch?._moves?.length || 0, skipped_reviewed: 0, skipped_changed: 0};
      return Promise.resolve(next);
    } else if (method === 'study_today') {
      setStatus('Bản xem trước: Mở Anki để vào phiên ôn Hôm nay với reviewer gốc của Anki.');
      return Promise.resolve(computePreviewPayload());
    }
    return Promise.resolve(computePreviewPayload());
  }

  /* ---------- Bridge request / receive ---------- */
  function request(method, args = {}) {
    if (!native) return handlePreviewCommand(method, args);
    if (pending) return Promise.reject(new Error('Đang xử lý yêu cầu trước. Hãy chờ giây lát.'));
    return new Promise((resolve, reject) => {
      const request_id = ++seq;
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error('Lịch ôn chưa phản hồi. Hãy thử làm mới.'));
      }, 25000);
      pending = {request_id, resolve, reject, timer};
      window.AnkiNOS.dailyCommand({method, request_id, ...args});
    });
  }

  function receive(payload) {
    if (!payload || payload.request_id !== pending?.request_id) return;
    const {resolve, reject, timer} = pending;
    pending = null;
    clearTimeout(timer);
    if (payload.error) reject(new Error(payload.error));
    else resolve(payload.data);
  }

  async function runAction(label, task) {
    if (busy) return;
    busy = true;
    setStatus(label);
    try {
      const data = await task();
      if (data && data.schedule) {
        state = data;
        loadedRevision = currentRevision();
        scopeDraft = {
          scope_mode: data.config.scope_mode,
          deck_names: [...(data.config.deck_names || [])],
          include_children: data.config.include_children !== false,
          daily_cap: data.config.daily_cap || 40,
        };
        if (data.apply_result?.batch) {
          lastAppliedBatchId = data.apply_result.batch.id;
          setStatus(`Đã dời ${fmt.format(data.apply_result.applied)} thẻ quá hạn sang ngày tối ưu (due thật).`);
        } else if (data.rollback_result) {
          if (lastAppliedBatchId === data.rollback_result.batch_id) lastAppliedBatchId = '';
          const r = data.rollback_result;
          const extra = r.skipped_reviewed ? ` (bỏ qua ${r.skipped_reviewed} thẻ bạn đã ôn)` : '';
          setStatus(`Đã hoàn tác ${fmt.format(r.restored)} thẻ về ngày cũ${extra}.`);
        } else if ($('status').textContent === label) {
          setStatus('');
        }
        render();
      } else if ($('status').textContent === label) {
        setStatus('');
      }
    } catch (error) {
      setStatus(error.message || 'Không thể tải Lịch ôn.', true);
    } finally {
      busy = false;
    }
  }

  /* ---------- Rendering ---------- */
  function renderScopeControls() {
    const cfg = state.config;
    $('scope-label').textContent = state.scope_label || 'Toàn bộ bộ sưu tập';
    $('scope-toggle').setAttribute('aria-expanded', String(scopeOpen));
    $('scope-panel').hidden = !scopeOpen;

    // Preset chips
    const presetsBox = $('presets');
    presetsBox.replaceChildren();
    const allChip = el('button', 'Toàn bộ', 'daily-chip');
    allChip.type = 'button';
    allChip.dataset.dailyPreset = '__all__';
    allChip.setAttribute('aria-pressed', String(cfg.scope_mode === 'all' && !cfg.active_preset_id));
    presetsBox.append(allChip);
    for (const preset of state.presets || []) {
      const chip = el('button', `${preset.name} · ${preset.daily_cap}/ngày`, 'daily-chip');
      chip.type = 'button';
      chip.dataset.dailyPreset = preset.id;
      chip.setAttribute('aria-pressed', String(cfg.active_preset_id === preset.id));
      presetsBox.append(chip);
    }

    // Daily cap controls
    const cap = Number(cfg.daily_cap) || 40;
    $('cap-input').value = String(cap);
    $('cap-hint').textContent = `Tự mở rộng cửa sổ rải khi quá hạn vượt trần · ${estimateMinutes(cap)}`;
    page.querySelectorAll('[data-daily-cap]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.dailyCap) === cap));
    });

    if (scopeOpen) renderScopeTree();
  }

  function renderScopeTree() {
    $('scope-mode-all').checked = scopeDraft.scope_mode !== 'decks';
    $('scope-mode-decks').checked = scopeDraft.scope_mode === 'decks';
    $('scope-children').checked = scopeDraft.include_children !== false;
    $('scope-tree-wrap').hidden = scopeDraft.scope_mode !== 'decks';

    const list = $('scope-tree');
    list.replaceChildren();
    const q = fold(scopeQuery.trim());
    const selected = new Set(scopeDraft.deck_names || []);
    const decks = state.schedule?.decks || [];
    let rendered = 0;
    for (const deck of decks) {
      if (q && !fold(deck.name).includes(q)) continue;
      const depth = (deck.name.match(/::/g) || []).length;
      const row = el('label', '', 'daily-tree-row');
      row.style.paddingLeft = `${8 + depth * 18}px`;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = deck.name;
      box.checked = selected.has(deck.name);
      box.dataset.dailyDeck = deck.name;
      const label = el('span', deck.name.split('::').pop(), 'daily-tree-name');
      label.title = deck.name;
      row.append(box, label);
      list.append(row);
      rendered++;
    }
    if (!rendered) list.append(el('p', 'Không tìm thấy bộ thẻ phù hợp.', 'daily-muted'));
  }

  function renderBeforeAfterChart(plan) {
    const wrap = $('plan-chart');
    wrap.replaceChildren();
    const days = plan.days || [];
    if (!days.length) return;

    const width = Math.max(360, days.length * 36 + 44);
    const height = 152;
    const padL = 30, padR = 12, padT = 18, padB = 28;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxVal = Math.max(plan.daily_cap || 10, ...days.map(d => d.after), 1);
    const barSlot = plotW / days.length;
    const barW = Math.max(10, Math.min(24, barSlot * 0.64));

    const svg = svgEl('svg', {class: 'daily-chart-svg', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'So sánh tải thẻ trước và sau khi dời'});
    // Cap reference line
    const capY = padT + plotH - (plan.daily_cap / maxVal) * plotH;
    svg.append(svgEl('line', {
      x1: padL, y1: capY, x2: width - padR, y2: capY,
      stroke: '#f5b971', 'stroke-width': 1.2, 'stroke-dasharray': '4 3',
    }));
    const capTxt = svgEl('text', {x: padL + 4, y: Math.max(11, capY - 4), fill: '#f5b971', 'font-size': 9.5});
    capTxt.textContent = `Trần ${plan.daily_cap}`;
    svg.append(capTxt);

    days.forEach((d, idx) => {
      const x = padL + idx * barSlot + (barSlot - barW) / 2;
      const beforeH = (d.before / maxVal) * plotH;
      const addedH = (d.added / maxVal) * plotH;
      const beforeY = padT + plotH - beforeH;
      const addedY = beforeY - addedH;

      const g = svgEl('g');
      const title = svgEl('title');
      title.textContent = `${d.offset === 0 ? 'Hôm nay' : formatShortDate(d.date)}: sẵn có ${d.before}, thêm +${d.added} → tổng ${d.after} thẻ`;
      g.append(title);

      if (d.before > 0) {
        g.append(svgEl('rect', {
          x, y: beforeY, width: barW, height: Math.max(1, beforeH), rx: 3,
          fill: 'var(--accent, #83b8ff)', opacity: '0.68',
        }));
      }
      if (d.added > 0) {
        g.append(svgEl('rect', {
          x, y: addedY, width: barW, height: Math.max(1, addedH), rx: 3,
          fill: 'var(--success, #8de6c5)', opacity: '0.92',
        }));
      }
      if (d.after > 0) {
        const val = svgEl('text', {
          x: x + barW / 2, y: Math.max(11, addedY - 3),
          'text-anchor': 'middle', fill: 'var(--text, #eef5ff)', 'font-size': 9,
        });
        val.textContent = String(d.after);
        g.append(val);
      }
      const lbl = svgEl('text', {
        x: x + barW / 2, y: height - 9,
        'text-anchor': 'middle', fill: 'var(--muted, #9fb2cc)', 'font-size': 9,
      });
      lbl.textContent = d.offset === 0 ? 'Nay' : formatShortDate(d.date);
      g.append(lbl);
      svg.append(g);
    });

    wrap.append(svg);
    const legend = el('div', '', 'daily-chart-legend');
    const mk = (color, text) => {
      const span = el('span');
      const i = el('i');
      i.style.background = color;
      span.append(i, document.createTextNode(text));
      return span;
    };
    legend.append(
      mk('var(--accent, #83b8ff)', 'Đã có sẵn'),
      mk('var(--success, #8de6c5)', 'Thẻ quá hạn dời thêm'),
      mk('#f5b971', `Trần ${plan.daily_cap} thẻ/ngày${plan.window_expanded ? ` · Tự mở rộng cửa sổ ${plan.expanded_window} ngày` : ''}`)
    );
    wrap.append(legend);
  }

  function renderOverdue() {
    const overdue = state.schedule.overdue;
    const plan = state.schedule.plan;
    const panel = $('overdue-panel');
    const undoBanner = $('undo-banner');

    undoBanner.hidden = !lastAppliedBatchId;
    panel.hidden = overdue.count === 0;
    if (overdue.count === 0) return;

    $('overdue-title').textContent = `${fmt.format(overdue.count)} thẻ quá hạn từ các ngày đã qua`;
    const nonMovableNote = overdue.non_movable_count
      ? ` (${fmt.format(overdue.non_movable_count)} thẻ đang học theo ngày/bộ lọc được giữ nguyên)`
      : '';
    $('overdue-summary').textContent = plan.summary + nonMovableNote;
    $('apply-plan').disabled = busy || plan.total_movable === 0;
    $('toggle-preview').setAttribute('aria-expanded', String(previewOpen));
    $('toggle-preview').textContent = previewOpen ? 'Ẩn xem trước' : 'Xem trước Trước / Sau';
    $('preview-box').hidden = !previewOpen;

    if (!previewOpen) return;
    renderBeforeAfterChart(plan);
    const tbody = $('plan-tbody');
    tbody.replaceChildren();
    for (const move of (plan.moves || []).slice(0, 120)) {
      const tr = document.createElement('tr');
      tr.append(
        el('td', move.preview || `Thẻ #${move.card_id}`),
        el('td', move.deck_name),
        el('td', `${formatShortDate(move.old_date)} → ${move.target_offset === 0 ? 'Hôm nay' : formatShortDate(move.new_date)}`),
        el('td', `${move.r_before}% → ${move.r_target}%`),
        el('td', move.reason)
      );
      tbody.append(tr);
    }
    if ((plan.moves || []).length > 120) {
      const tr = document.createElement('tr');
      const td = el('td', `… và ${fmt.format(plan.moves.length - 120)} thẻ khác trong cùng đợt điều phối.`);
      td.colSpan = 5;
      tr.append(td);
      tbody.append(tr);
    }
  }

  function renderToday() {
    const today = state.schedule.today_bucket;
    $('today-date').textContent = `Hôm nay · ${formatFullDate(today.date)}`;
    $('today-count').textContent = fmt.format(today.count);
    $('today-meta').textContent = today.count
      ? `${estimateMinutes(today.count)} · R trung bình ${today.avg_r != null ? today.avg_r + '%' : '—'}`
      : 'Hôm nay đã hoàn tất hoặc chưa có thẻ đến hạn.';
    $('tracked-note').textContent = `Đang theo dõi ${fmt.format(state.schedule.total_tracked)} thẻ đã học theo ngày · ${fmt.format(state.schedule.pending_first_study)} thẻ mới/học phút vẫn ở bộ thẻ gốc.`;

    $('tier-critical').textContent = fmt.format(today.tiers?.critical || 0);
    $('tier-due').textContent = fmt.format(today.tiers?.due || 0);
    $('tier-strong').textContent = fmt.format(today.tiers?.strong || 0);

    $('study-today').disabled = busy || today.count === 0;
    $('focus-today').disabled = busy || today.count === 0;

    page.querySelectorAll('[data-today-tab]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.todayTab === todayTab));
    });

    const list = $('today-list');
    list.replaceChildren();
    if (todayTab === 'decks') {
      if (!today.decks?.length) list.append(el('li', 'Chưa có thẻ đến hạn hôm nay.'));
      for (const item of today.decks || []) {
        const li = el('li');
        li.append(el('span', item.name, 'daily-mini-main'), el('strong', `${fmt.format(item.count)} thẻ`));
        list.append(li);
      }
    } else if (todayTab === 'cohorts') {
      if (!today.cohorts?.length) list.append(el('li', 'Chưa có lô ngày học đầu tiên.'));
      for (const item of today.cohorts || []) {
        const li = el('li');
        li.append(el('span', `Học lần đầu: ${formatFullDate(item.day)}`, 'daily-mini-main'), el('strong', `${fmt.format(item.count)} thẻ`));
        list.append(li);
      }
    } else {
      if (!today.cards?.length) list.append(el('li', 'Chưa có thẻ đến hạn hôm nay.'));
      for (const card of today.cards || []) {
        const li = el('li');
        const main = el('span', `${card.preview || 'Thẻ #' + card.card_id} · ${card.deck_name}`, 'daily-mini-main');
        main.title = `${card.preview}\nBộ thẻ: ${card.deck_name}\nHọc lần đầu: ${card.first_studied_day}`;
        li.append(main, el('strong', `R ${card.retrievability}%`));
        list.append(li);
      }
    }
  }

  function renderFuture() {
    const future = state.schedule.future;
    const cap = state.schedule.daily_cap || 40;
    const days = (future.days || []).slice(0, horizonLimit);

    $('future-caption').textContent = `${fmt.format(future.total_in_horizon)} thẻ trong ${future.horizon_days} ngày tới${future.beyond_horizon_count ? ` · ${fmt.format(future.beyond_horizon_count)} thẻ xa hơn` : ''}. Các ngày chưa đến đều bị khóa để bảo vệ khoảng cách lặp lại.`;
    page.querySelectorAll('[data-daily-horizon]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.dailyHorizon) === horizonLimit));
    });

    const grid = $('future-grid');
    grid.replaceChildren();
    for (const day of days) {
      const tile = el('button', '', 'daily-day-tile' + (day.count === 0 ? ' is-empty' : ''));
      tile.type = 'button';
      tile.dataset.futureOffset = String(day.offset);
      tile.setAttribute('aria-pressed', String(inspectedOffset === day.offset));
      const dt = parseIso(day.date);

      const top = el('div', '', 'daily-tile-top');
      top.append(el('span', day.offset === 1 ? 'Ngày mai' : dayNames[dt.getDay()]), el('span', '🔒 Khóa'));
      const dateLbl = el('div', formatShortDate(day.date), 'daily-tile-date');
      const count = el('div', `${fmt.format(day.count)} thẻ`, 'daily-tile-count');

      const ratio = Math.min(100, Math.round((day.count / Math.max(1, cap)) * 100));
      const bar = el('div', '', 'daily-tile-bar' + (day.count > cap ? ' is-over' : ratio >= 80 ? ' is-heavy' : ''));
      const fill = el('i');
      fill.style.width = `${day.count ? Math.max(6, ratio) : 0}%`;
      bar.append(fill);

      const foot = el('span', day.decks?.[0]?.name.split('::').pop() || 'Trống', 'daily-muted');
      tile.append(top, dateLbl, count, bar, foot);
      grid.append(tile);
    }

    renderInspector();
  }

  function renderInspector() {
    const box = $('day-inspector');
    const day = (state.schedule.future?.days || []).find(d => d.offset === inspectedOffset);
    box.hidden = !day;
    if (!day) return;

    $('inspector-title').textContent = `🔒 ${formatFullDate(day.date)} · ${fmt.format(day.count)} thẻ (Đã khóa)`;
    $('inspector-note').textContent = day.count
      ? `Ngày này chưa đến hạn nên hệ thống khóa ôn sớm. R dự kiến trung bình ${day.avg_r != null ? day.avg_r + '%' : '—'}.`
      : 'Ngày này hiện đang trống — rất phù hợp để hứng thẻ quá hạn nếu cần cân bằng tải.';
    const list = $('inspector-list');
    list.replaceChildren();
    for (const card of (day.cards || []).slice(0, 30)) {
      const li = el('li');
      li.append(
        el('span', `${card.preview || 'Thẻ #' + card.card_id} · ${card.deck_name}`, 'daily-mini-main'),
        el('span', `Đầu: ${formatShortDate(card.first_studied_day)} · ivl ${card.ivl}d`, 'daily-muted')
      );
      list.append(li);
    }
    if (!day.cards?.length && day.count === 0) {
      list.append(el('li', 'Chưa có thẻ nào hẹn vào ngày này.'));
    }
  }

  function renderLedger() {
    const body = $('ledger-body');
    body.replaceChildren();
    const batches = state?.batches || [];
    if (!batches.length) {
      body.append(el('p', 'Chưa có đợt điều phối due thật nào được thực hiện.', 'daily-muted'));
      return;
    }
    for (const batch of batches) {
      const card = el('div', '', 'daily-batch-item');
      const top = el('div', '', 'daily-batch-top');
      top.append(
        el('strong', `${batch.scope_label} · ${fmt.format(batch.card_count)} thẻ`),
        el('span', batch.rolled_back_at ? 'Đã hoàn tác' : 'Đang áp dụng', 'daily-badge' + (batch.rolled_back_at ? '' : ' unlocked'))
      );
      card.append(
        top,
        el('p', batch.summary, 'daily-muted'),
        el('p', `Lúc ${batch.created_at.replace('T', ' ').replace('Z', ' UTC')} · Trần ${batch.daily_cap} thẻ/ngày · Cửa sổ ${batch.window_days} ngày`, 'daily-muted')
      );
      if (!batch.rolled_back_at) {
        const btn = el('button', 'Hoàn tác đợt này', 'subtle-button');
        btn.type = 'button';
        btn.dataset.rollbackBatch = batch.id;
        card.append(btn);
      }
      body.append(card);
    }
  }

  function render() {
    if (!state?.schedule) return;
    renderScopeControls();
    renderOverdue();
    renderToday();
    renderFuture();
    if ($('ledger-dialog')?.open) renderLedger();
  }

  /* ---------- Events ---------- */
  $('refresh').addEventListener('click', () => runAction('Đang tải Lịch ôn…', () => request('load')));
  $('scope-toggle').addEventListener('click', () => {
    scopeOpen = !scopeOpen;
    renderScopeControls();
  });
  $('scope-close').addEventListener('click', () => {
    scopeOpen = false;
    renderScopeControls();
  });
  $('scope-mode-all').addEventListener('change', () => {
    scopeDraft.scope_mode = 'all';
    renderScopeTree();
  });
  $('scope-mode-decks').addEventListener('change', () => {
    scopeDraft.scope_mode = 'decks';
    renderScopeTree();
  });
  $('scope-children').addEventListener('change', e => {
    scopeDraft.include_children = e.target.checked;
  });
  $('scope-search').addEventListener('input', e => {
    scopeQuery = e.target.value;
    renderScopeTree();
  });
  $('scope-tree').addEventListener('change', e => {
    const name = e.target.dataset?.dailyDeck;
    if (!name) return;
    const set = new Set(scopeDraft.deck_names || []);
    if (e.target.checked) set.add(name);
    else set.delete(name);
    scopeDraft.deck_names = Array.from(set);
  });
  $('scope-apply').addEventListener('click', () => {
    scopeOpen = false;
    runAction('Đang cập nhật phạm vi…', () => request('save_config', {
      config: {...scopeDraft, active_preset_id: ''},
    }));
  });
  $('preset-save').addEventListener('click', () => {
    const name = $('preset-name').value.trim();
    if (!name) { setStatus('Hãy nhập tên cho phạm vi muốn lưu.', true); return; }
    $('preset-name').value = '';
    scopeOpen = false;
    runAction('Đang lưu phạm vi…', () => request('save_preset', {name, config: scopeDraft}));
  });
  $('presets').addEventListener('click', e => {
    const btn = e.target.closest('[data-daily-preset]');
    if (!btn || !state) return;
    const id = btn.dataset.dailyPreset;
    if (id === '__all__') {
      runAction('Đang chuyển sang Toàn bộ…', () => request('save_config', {
        config: {scope_mode: 'all', deck_names: [], include_children: true, active_preset_id: ''},
      }));
      return;
    }
    const preset = (state.presets || []).find(p => p.id === id);
    if (!preset) return;
    runAction(`Đang mở phạm vi "${preset.name}"…`, () => request('save_config', {
      config: {
        scope_mode: preset.scope_mode,
        deck_names: preset.deck_names,
        include_children: preset.include_children,
        daily_cap: preset.daily_cap,
        active_preset_id: preset.id,
      },
    }));
  });

  page.addEventListener('click', e => {
    const capBtn = e.target.closest('[data-daily-cap]');
    if (capBtn) {
      const cap = Number(capBtn.dataset.dailyCap);
      runAction('Đang tính lại lịch theo trần mới…', () => request('save_config', {config: {daily_cap: cap}}));
      return;
    }
    const tabBtn = e.target.closest('[data-today-tab]');
    if (tabBtn) {
      todayTab = tabBtn.dataset.todayTab;
      renderToday();
      return;
    }
    const hBtn = e.target.closest('[data-daily-horizon]');
    if (hBtn) {
      horizonLimit = Number(hBtn.dataset.dailyHorizon);
      renderFuture();
      return;
    }
    const tile = e.target.closest('[data-future-offset]');
    if (tile) {
      const off = Number(tile.dataset.futureOffset);
      inspectedOffset = inspectedOffset === off ? null : off;
      renderFuture();
      return;
    }
  });

  $('cap-input').addEventListener('change', e => {
    const cap = Math.max(1, Math.min(2000, Math.round(Number(e.target.value) || 40)));
    e.target.value = String(cap);
    runAction('Đang tính lại lịch theo trần mới…', () => request('save_config', {config: {daily_cap: cap}}));
  });

  $('toggle-preview').addEventListener('click', () => {
    previewOpen = !previewOpen;
    renderOverdue();
  });
  $('apply-plan').addEventListener('click', () => {
    const count = state?.schedule?.plan?.total_movable || 0;
    if (!count) return;
    runAction(`Đang dời ${fmt.format(count)} thẻ quá hạn…`, () => request('apply_plan'));
  });
  $('undo-last').addEventListener('click', () => {
    if (!lastAppliedBatchId) return;
    const bid = lastAppliedBatchId;
    runAction('Đang hoàn tác đợt dời gần nhất…', () => request('rollback_batch', {batch_id: bid}));
  });
  $('inspector-close').addEventListener('click', () => {
    inspectedOffset = null;
    renderFuture();
  });

  $('study-today').addEventListener('click', () => {
    runAction('Đang mở phiên ôn Hôm nay…', () => request('study_today', {minutes: null}));
  });
  $('focus-today').addEventListener('click', () => {
    const minutes = Number($('focus-budget').value) || 30;
    runAction(`Đang mở Focus ${minutes} phút cho Hôm nay…`, () => request('study_today', {minutes}));
  });

  $('open-ledger').addEventListener('click', () => {
    renderLedger();
    $('ledger-dialog').showModal();
  });
  $('ledger-close').addEventListener('click', () => $('ledger-dialog').close());
  $('ledger-body').addEventListener('click', e => {
    const btn = e.target.closest('[data-rollback-batch]');
    if (!btn) return;
    const bid = btn.dataset.rollbackBatch;
    runAction('Đang hoàn tác đợt điều phối…', () => request('rollback_batch', {batch_id: bid}));
  });

  function open() {
    const rev = currentRevision();
    if (state && loadedRevision === rev) {
      render();
      return;
    }
    if (state) {
      // Keep cached schedule visible while refreshing silently in the background.
      render();
      runAction('', () => request('load'));
      return;
    }
    runAction('Đang tải Lịch ôn…', () => request('load'));
  }

  function sync() {
    const rev = currentRevision();
    if (!page.hidden && !busy && (!state || loadedRevision !== rev)) open();
  }

  window.NOSDaily = {open, sync, receive};
})();
