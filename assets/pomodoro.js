/* AnkiNOS Pomodoro — cross-surface timer, offline alert sounds and floating window. */
(function initNOSPomodoro() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNOSPomodoro, {once: true});
    return;
  }
  if (window.NOSPomodoro) return;

  const isFloatWindow = !!document.getElementById('nos-pomo-float-root');
  const isReviewer = !!document.getElementById('nos-review-shell');
  const isOverview = !!document.getElementById('overview-hero');
  const isDashboard = !!document.getElementById('nos-app') && !isOverview;
  if (!isFloatWindow && !isReviewer && !isOverview && !isDashboard) return;

  const tr = text => (window.NOSI18n ? window.NOSI18n.t(text) : text);
  const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);
  const assetsURL = document.querySelector('script[src$="/pomodoro.js"]')?.src || new URL('assets/pomodoro.js', document.baseURI);
  const MAX_ALERT_MS = 15000;
  const DEFAULT_SOUNDS = Object.freeze({study: 'afterstudy', break: 'afterrest'});

  const DEFAULT_CONFIG = {
    mode: 'classic',
    ui_mode: 'pill',
    study_minutes: 25,
    break_minutes: 5,
    long_break_minutes: 15,
    cycles_before_long: 4,
    long_break_enabled: false,
    auto_start_break: false,
    auto_start_study: false,
    pause_on_blur: false,
    sound_study_end: DEFAULT_SOUNDS.study,
    sound_break_end: DEFAULT_SOUNDS.break,
    sound_volume: 75,
    custom_study_sound: null,
    custom_break_sound: null,
    widget_corner: 'bottom-right',
  };

  const DEFAULT_STATE = {
    active: false,
    paused: false,
    phase: 'study',
    mode: 'classic',
    seconds: 0,
    target_seconds: 1500,
    cards: 0,
    cycle_count: 0,
    deck_id: '',
    deck_name: '',
    awaiting_phase: null,
    awaiting_target_seconds: 0,
    awaiting_mode: 'classic',
    last_session: null,
    last_event: null,
  };

  let config = {...DEFAULT_CONFIG};
  let state = {...DEFAULT_STATE};
  let floatOpen = false;
  let floatMinimized = false;
  let anchorMs = performance.now();
  let lastPlayedEventId = 0;
  let completionSent = false;
  let popoverOpen = false;
  let zenOpen = false;
  let dockCollapsed = false;
  let lastNativeBoot = null;

  const isNative = () => {
    if (isFloatWindow) return !!(lastNativeBoot && lastNativeBoot.native && typeof window.pycmd === 'function');
    if (isReviewer) return typeof window.pycmd === 'function';
    return document.getElementById('nos-app')?.dataset.native === 'true' && typeof window.pycmd === 'function';
  };

  /* ---------- Offline Audio Alerts ---------- */
  let audioCtx = null;
  let decoded = null;
  let stopAlert = () => {};
  let stopSoundTest = () => {};
  const customSoundKey = slot => `custom_${slot}_sound`;
  const soundKey = slot => `sound_${slot}_end`;
  const soundVolume = () => clamp(config.sound_volume, 0, 100, 75) / 100;

  function loadSound(url) {
    if (decoded?.url === url) return decoded.buffer;
    const buffer = (async () => {
      audioCtx ||= new AudioContext();
      const response = await fetch(url);
      if (!response.ok) throw new Error('Audio fetch failed');
      return audioCtx.decodeAudioData(await response.arrayBuffer());
    })();
    decoded = {url, buffer};
    buffer.catch(() => { if (decoded?.buffer === buffer) decoded = null; });
    return buffer;
  }

  function playClip(entry, volume, onError) {
    let stopped = false;
    let source;
    const buffer = loadSound(entry.url);
    const ready = audioCtx?.state === 'suspended' ? audioCtx.resume() : undefined;
    Promise.all([buffer, ready]).then(([audio]) => {
      if (stopped) return;
      const start = (entry.start_ms || 0) / 1000;
      const duration = Math.min(entry.duration_ms || MAX_ALERT_MS, MAX_ALERT_MS) / 1000;
      if (start >= audio.duration) throw new Error('Audio offset exceeds file duration');
      const gain = audioCtx.createGain();
      gain.gain.value = volume;
      gain.connect(audioCtx.destination);
      source = audioCtx.createBufferSource();
      source.buffer = audio;
      source.connect(gain);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        source = null;
      };
      source.start(0, start, Math.min(duration, audio.duration - start));
    }).catch(() => { if (!stopped) onError?.(); });
    return () => {
      stopped = true;
      if (source) source.stop();
    };
  }

  function playDefault(kind, volume) {
    const url = new URL(`${kind}.mp3`, assetsURL);
    if (url.protocol !== 'file:') {
      return playClip({url: url.href}, volume);
    }
    // File previews can load local media even when fetch() cannot read file URLs.
    url.hash = `t=0,${MAX_ALERT_MS / 1000}`;
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
    return () => audio.pause();
  }

  function playSound(slot) {
    const selected = config[soundKey(slot)];
    const entry = config[customSoundKey(slot)];
    const volume = soundVolume();
    if (selected === 'none' || !volume) return () => {};
    const preset = Object.values(DEFAULT_SOUNDS).includes(selected) ? selected : DEFAULT_SOUNDS[slot];
    if (selected !== 'custom' || !entry?.url) return playDefault(preset, volume);
    let stop = playClip(entry, volume, () => { stop = playDefault(preset, volume); });
    return () => stop();
  }

  function playAlert(slot) {
    stopSoundTest();
    stopAlert();
    stopAlert = playSound(slot);
  }

  /* ---------- Command Bridge + Standalone Offline Simulator ---------- */
  function modeTargetSeconds(mode, phase) {
    if (mode === 'stopwatch') return 0;
    const longNow = !!config.long_break_enabled && state.cycle_count > 0 && (state.cycle_count % Math.max(2, config.cycles_before_long || 4) === 0);
    if (mode === 'classic') return (phase === 'study' ? 25 : (longNow ? 15 : 5)) * 60;
    if (mode === 'long') return (phase === 'study' ? 50 : (longNow ? 20 : 10)) * 60;
    return (phase === 'study' ? config.study_minutes : (longNow ? config.long_break_minutes : config.break_minutes)) * 60;
  }

  function sendCommand(payload) {
    if (isNative()) {
      if (isFloatWindow) window.pycmd('nospomo:' + JSON.stringify(payload));
      else if (isReviewer) window.pycmd('nos-review:pomodoro:' + JSON.stringify(payload));
      else window.pycmd('nos:' + JSON.stringify({action: 'pomodoro', ...payload}));
      return;
    }
    simulateOffline(payload);
  }

  function simulateOffline(payload) {
    const op = payload.op;
    const nowSec = liveElapsedSeconds();
    if (op === 'start') {
      const m = payload.mode || config.mode;
      const ph = payload.phase || 'study';
      config = {
        ...config,
        mode: m,
        study_minutes: payload.study_minutes ?? config.study_minutes,
        break_minutes: payload.break_minutes ?? config.break_minutes,
      };
      state = {
        ...state,
        active: true,
        paused: false,
        phase: ph,
        mode: m,
        seconds: 0,
        target_seconds: modeTargetSeconds(m, ph),
        cards: 0,
        awaiting_phase: null,
        awaiting_target_seconds: 0,
      };
      anchorMs = performance.now();
    } else if (op === 'pause' && state.active && !state.paused) {
      state = {...state, seconds: nowSec, paused: true};
      anchorMs = performance.now();
    } else if (op === 'resume' && state.active && state.paused) {
      state = {...state, paused: false};
      anchorMs = performance.now();
    } else if (op === 'stop') {
      state = {
        ...state,
        active: false,
        paused: false,
        seconds: 0,
        awaiting_phase: null,
        awaiting_target_seconds: 0,
        target_seconds: modeTargetSeconds(config.mode, 'study'),
      };
      zenOpen = false;
      anchorMs = performance.now();
    } else if (op === 'switch') {
      const nextPh = payload.phase || state.awaiting_phase || (state.phase === 'study' ? 'break' : 'study');
      const m = state.awaiting_phase ? state.awaiting_mode : state.mode;
      state = {
        ...state,
        active: true,
        paused: false,
        phase: nextPh,
        mode: m,
        seconds: 0,
        target_seconds: modeTargetSeconds(m, nextPh),
        awaiting_phase: null,
        awaiting_target_seconds: 0,
      };
      anchorMs = performance.now();
    } else if (op === 'extend') {
      const add = (payload.minutes || 5) * 60;
      if (state.active && state.target_seconds > 0) {
        state = {...state, seconds: nowSec, target_seconds: state.target_seconds + add};
      } else {
        state = {...state, active: true, paused: false, phase: 'study', mode: 'custom', seconds: 0, target_seconds: add, awaiting_phase: null};
      }
      anchorMs = performance.now();
    } else if (op === 'dismiss') {
      state = {...state, awaiting_phase: null, awaiting_target_seconds: 0};
    } else if (op === 'complete' && state.active && state.target_seconds > 0) {
      const finishedPhase = state.phase;
      const nextPhase = finishedPhase === 'study' ? 'break' : 'study';
      const nextCycle = finishedPhase === 'study' ? state.cycle_count + 1 : state.cycle_count;
      const nextTarget = modeTargetSeconds(state.mode, nextPhase);
      const evtId = (state.last_event?.event_id || 0) + 1;
      state = {
        ...state,
        active: false,
        paused: false,
        seconds: 0,
        cycle_count: nextCycle,
        awaiting_phase: nextPhase,
        awaiting_target_seconds: nextTarget,
        awaiting_mode: state.mode,
        last_event: {
          event_id: evtId,
          kind: finishedPhase === 'study' ? 'study_done' : 'break_done',
          phase: finishedPhase,
          mode: state.mode,
          seconds: state.target_seconds,
          cards: state.cards,
          next_phase: nextPhase,
          next_target_seconds: nextTarget,
        },
      };
      anchorMs = performance.now();
      handleCompletionEvent(state.last_event);
    } else if (op === 'config' && payload.values) {
      config = {...config, ...payload.values};
      if (!state.active) {
        state = {...state, mode: config.mode, target_seconds: modeTargetSeconds(config.mode, 'study')};
      }
    } else if (op === 'trim_sound') {
      const entry = config[customSoundKey(payload.slot)];
      if (entry?.id === payload.id) {
        config = {...config, [customSoundKey(payload.slot)]: {
          ...entry, start_ms: payload.start_ms, duration_ms: payload.duration_ms,
        }};
      }
    } else if (op === 'clear_sound') {
      const {slot} = payload;
      discardPreviewSound(slot);
      const selected = config[soundKey(slot)];
      config = {...config, [soundKey(slot)]: selected === 'custom' ? DEFAULT_SOUNDS[slot] : selected, [customSoundKey(slot)]: null};
    } else if (op === 'toggle_float') {
      floatOpen = !floatOpen;
    }
    renderAll();
    document.dispatchEvent(new CustomEvent('nos:pomodoro', {detail: {state, config}}));
  }

  /* ---------- Time & Formatting ---------- */
  function liveElapsedSeconds() {
    if (!state.active) return 0;
    const raw = (state.seconds || 0) + (state.paused ? 0 : Math.max(0, (performance.now() - anchorMs) / 1000));
    return state.target_seconds > 0 ? Math.min(state.target_seconds, raw) : raw;
  }

  function displayClock() {
    const isStopwatch = (state.active ? state.mode : config.mode) === 'stopwatch' || (state.active && state.target_seconds === 0);
    if (!state.active) {
      if (isStopwatch) return {mm: '00', ss: '00', text: '00:00', progress: 0, remaining: 0, isStopwatch: true};
      const tgt = modeTargetSeconds(config.mode, 'study');
      const m = Math.floor(tgt / 60);
      const s = tgt % 60;
      const mm = String(m).padStart(2, '0');
      const ss = String(s).padStart(2, '0');
      return {mm, ss, text: `${mm}:${ss}`, progress: 0, remaining: tgt, isStopwatch: false};
    }
    const elapsed = liveElapsedSeconds();
    if (isStopwatch) {
      const total = Math.floor(elapsed);
      const hrs = Math.floor(total / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      const mm = hrs > 0 ? String(hrs * 60 + mins).padStart(2, '0') : String(mins).padStart(2, '0');
      const ss = String(secs).padStart(2, '0');
      const pulse = (elapsed % 60) / 60;
      return {mm, ss, text: hrs > 0 ? `${hrs}:${String(mins).padStart(2, '0')}:${ss}` : `${mm}:${ss}`, progress: pulse, remaining: 1, isStopwatch: true};
    }
    const rem = Math.max(0, state.target_seconds - elapsed);
    const ceilRem = Math.ceil(rem);
    const mm = String(Math.floor(ceilRem / 60)).padStart(2, '0');
    const ss = String(ceilRem % 60).padStart(2, '0');
    const prog = state.target_seconds > 0 ? Math.min(1, Math.max(0, elapsed / state.target_seconds)) : 0;
    return {mm, ss, text: `${mm}:${ss}`, progress: prog, remaining: rem, isStopwatch: false};
  }

  function phaseLabel(ph = state.phase) {
    return tr(ph === 'break' ? 'Nghỉ ngơi' : 'Đang học');
  }

  function modeShortLabel(m = config.mode) {
    if (m === 'classic') return '25/5';
    if (m === 'long') return '50/10';
    if (m === 'stopwatch') return tr('Timer đếm');
    return `${config.study_minutes}/${config.break_minutes}`;
  }

  /* ---------- Clock Markup Builder (All 4 UI Modes) ---------- */
  function buildClockHTML(uiMode, clk, ph, paused) {
    const p = ph || 'study';
    const pct = Math.round(clk.progress * 100);
    if (uiMode === 'ring') {
      const r = 62;
      const c = 2 * Math.PI * r;
      const offset = c * (1 - clk.progress);
      return `<div class="nos-pomo-clock-ring" data-phase="${p}" data-paused="${paused}">
        <svg viewBox="0 0 148 148" aria-hidden="true">
          <circle class="ring-bg" cx="74" cy="74" r="${r}"></circle>
          <circle class="ring-fg" cx="74" cy="74" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"></circle>
        </svg>
        <div class="nos-pomo-ring-center">
          <span class="pomo-digits" data-i18n-skip>${clk.text}</span>
          <small>${state.active ? (paused ? tr('Tạm dừng') : phaseLabel(p)) : tr('Sẵn sàng')}</small>
        </div>
      </div>`;
    }
    if (uiMode === 'flip') {
      return `<div class="nos-pomo-clock-flip" data-phase="${p}" data-paused="${paused}">
        <div class="nos-pomo-flip-card"><span data-i18n-skip>${clk.mm}</span></div>
        <span class="nos-pomo-flip-sep">:</span>
        <div class="nos-pomo-flip-card"><span data-i18n-skip>${clk.ss}</span></div>
      </div>`;
    }
    if (uiMode === 'ambient') {
      return `<div class="nos-pomo-clock-ambient" data-phase="${p}" data-paused="${paused}">
        <div class="nos-pomo-ambient-meta">
          <span>${state.active ? phaseLabel(p) : tr('Thanh Zen siêu mảnh')}</span>
          <strong data-i18n-skip>${clk.text}</strong>
        </div>
        <div class="nos-pomo-ambient-track"><i style="width:${clk.isStopwatch ? 100 : pct}%"></i></div>
      </div>`;
    }
    return `<div class="nos-pomo-clock-pill" data-phase="${p}" data-paused="${paused}">
      <span class="nos-pomo-chip-dot"></span>
      <span class="pomo-digits" data-i18n-skip>${clk.text}</span>
    </div>`;
  }

  /* ---------- Dedicated Floating Window (ankios-pomodoro.html) ---------- */
  if (isFloatWindow) {
    const root = document.getElementById('nos-pomo-float-root');
    const boot = JSON.parse(document.getElementById('nos-pomo-float-bootstrap')?.textContent || '{}');
    lastNativeBoot = boot;
    const initTheme = boot.settings || {theme: 'dusk', color_theme: 'nos', language: 'vi'};
    window.NOSTheme?.watch(root, () => initTheme, true);
    window.NOSI18n?.set(initTheme.language || 'vi');
    if (boot.pomodoro) {
      config = {...DEFAULT_CONFIG, ...(boot.pomodoro.config || {})};
      state = {...DEFAULT_STATE, ...(boot.pomodoro.state || {})};
      lastPlayedEventId = state.last_event?.event_id || 0;
      anchorMs = performance.now();
    }

    function renderFloat() {
      const clk = displayClock();
      const ui = config.ui_mode || 'pill';
      root.dataset.uiMode = ui;
      root.dataset.minimized = String(floatMinimized);
      root.dataset.phase = state.phase;
      if (floatMinimized) {
        root.innerHTML = `
          <span class="nos-pomo-chip-dot" style="background:var(${state.phase === 'break' ? '--success' : '--blue'})"></span>
          <strong style="font-variant-numeric:tabular-nums;font-size:14px;cursor:move;flex:1" data-pomo-drag data-i18n-skip>${clk.text}</strong>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-op="${state.active ? (state.paused ? 'resume' : 'pause') : 'start'}" title="${tr(state.active ? (state.paused ? 'Tiếp tục' : 'Tạm dừng') : 'Bắt đầu')}">${state.active && !state.paused ? '⏸' : '▶'}</button>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-float="restore" title="${tr('Mở rộng')}">⤢</button>`;
        return;
      }
      if (ui === 'pill') {
        root.innerHTML = `
          <span class="nos-pomo-chip-dot" style="background:var(${state.phase === 'break' ? '--success' : '--blue'})"></span>
          <div style="display:flex;flex-direction:column;cursor:move;flex:1;min-width:0" data-pomo-drag>
            <strong style="font-size:15px;font-variant-numeric:tabular-nums;line-height:1.1" data-i18n-skip>${clk.text}</strong>
            <small style="font-size:10.5px;color:var(--muted)">${state.active ? phaseLabel() : modeShortLabel()}</small>
          </div>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-op="${state.active ? (state.paused ? 'resume' : 'pause') : 'start'}" title="${tr(state.active ? (state.paused ? 'Tiếp tục' : 'Tạm dừng') : 'Bắt đầu')}">${state.active && !state.paused ? '⏸' : '▶'}</button>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-op="switch" title="${tr(state.phase === 'study' ? 'Chuyển sang nghỉ' : 'Quay lại học')}">⇄</button>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-float="minimize" title="${tr('Thu vào góc')}">–</button>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-op="close_float" title="${tr('Đóng cửa sổ nổi')}">×</button>`;
        return;
      }
      if (ui === 'ambient') {
        const pct = clk.isStopwatch ? 100 : Math.round(clk.progress * 100);
        root.innerHTML = `
          <div class="nos-pomo-float-drag" data-pomo-drag>
            <span>${state.active ? phaseLabel() : 'Pomodoro'} · <strong data-i18n-skip>${clk.text}</strong></span>
            <span class="pomo-float-btns">
              <button type="button" class="nos-pomo-icon-btn" style="width:22px;height:22px" data-pomo-op="${state.active ? (state.paused ? 'resume' : 'pause') : 'start'}">${state.active && !state.paused ? '⏸' : '▶'}</button>
              <button type="button" class="nos-pomo-icon-btn" style="width:22px;height:22px" data-pomo-op="close_float">×</button>
            </span>
          </div>
          <div class="nos-pomo-ambient-track" style="height:5px;margin-top:3px"><i style="width:${pct}%;background:var(${state.phase === 'break' ? '--success' : '--blue'})"></i></div>`;
        return;
      }
      root.innerHTML = `
        <div class="nos-pomo-float-drag" data-pomo-drag>
          <span class="nos-pomo-phase-badge" data-phase="${state.phase}">${state.active ? phaseLabel() : modeShortLabel()}</span>
          <span class="pomo-float-btns">
            <button type="button" class="nos-pomo-icon-btn" data-pomo-cycle-ui title="${tr('Đổi kiểu đồng hồ')}">◷</button>
            <button type="button" class="nos-pomo-icon-btn" data-pomo-float="minimize" title="${tr('Thu vào góc')}">–</button>
            <button type="button" class="nos-pomo-icon-btn" data-pomo-op="close_float" title="${tr('Đóng cửa sổ nổi')}">×</button>
          </span>
        </div>
        <div style="display:grid;place-items:center;flex:1">${buildClockHTML(ui, clk, state.phase, state.paused)}</div>
        <div class="nos-pomo-controls">
          <button type="button" class="nos-pomo-btn small primary" data-pomo-op="${state.active ? (state.paused ? 'resume' : 'pause') : 'start'}">${tr(state.active ? (state.paused ? 'Tiếp tục' : 'Tạm dừng') : 'Bắt đầu')}</button>
          <button type="button" class="nos-pomo-btn small" data-pomo-op="switch">${tr(state.phase === 'study' ? 'Nghỉ' : 'Học')}</button>
          ${state.active ? `<button type="button" class="nos-pomo-btn small danger" data-pomo-op="stop">${tr('Kết thúc')}</button>` : ''}
        </div>`;
    }

    root.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      if (e.target.closest('[data-pomo-drag]')) sendCommand({op: 'drag_start'});
    });
    root.addEventListener('click', e => {
      const opBtn = e.target.closest('[data-pomo-op]');
      if (opBtn) { sendCommand({op: opBtn.dataset.pomoOp}); return; }
      const flBtn = e.target.closest('[data-pomo-float]');
      if (flBtn) { sendCommand({op: flBtn.dataset.pomoFloat}); return; }
      if (e.target.closest('[data-pomo-cycle-ui]')) {
        const order = ['pill', 'ring', 'flip', 'ambient'];
        const next = order[(order.indexOf(config.ui_mode) + 1) % order.length];
        sendCommand({op: 'config', values: {ui_mode: next}});
      }
    });

    window.NOSPomodoroFloat = {
      setMinimized(payload) {
        floatMinimized = !!payload?.minimized;
        renderFloat();
      },
      setSettings(s) {
        if (!s) return;
        Object.assign(initTheme, s);
        window.NOSTheme?.apply(root, initTheme);
        if (s.language) window.NOSI18n?.set(s.language);
        renderFloat();
      },
    };
    window.NOSPomodoro = {
      receive(payload) {
        if (!payload) return;
        if (payload.config) config = {...DEFAULT_CONFIG, ...payload.config};
        if (payload.state) {
          state = {...DEFAULT_STATE, ...payload.state};
          anchorMs = performance.now();
          if (state.last_event) handleCompletionEvent(state.last_event, payload.play_alert !== false);
        }
        renderFloat();
      },
    };
    setInterval(renderFloat, 1000);
    renderFloat();
    return;
  }

  /* ---------- Main Surfaces (Dashboard, Overview, Reviewer) ---------- */
  const hostContainer = isReviewer
    ? document.getElementById('nos-review-shell')
    : document.getElementById('nos-app') || document.body;

  // Create shared overlays (zero footprint while hidden)
  const ambientBar = document.createElement('div');
  ambientBar.id = 'nos-pomo-ambient-bar';
  ambientBar.className = 'nos-pomo-ambient-bar';
  ambientBar.hidden = true;
  ambientBar.innerHTML = `<div class="nos-pomo-ambient-fill"></div><div class="nos-pomo-ambient-peek"><span class="pomo-peek-phase"></span><strong class="pomo-peek-time" data-i18n-skip></strong></div>`;
  ambientBar.addEventListener('click', () => togglePopover());

  const banner = document.createElement('section');
  banner.id = 'nos-pomo-banner';
  banner.className = 'nos-pomo-banner';
  banner.setAttribute('role', 'status');
  banner.hidden = true;

  const dockWidget = document.createElement('aside');
  dockWidget.id = 'nos-pomo-dock-widget';
  dockWidget.className = 'nos-pomo-dock-widget';
  dockWidget.hidden = true;
  dockWidget.setAttribute('aria-label', tr('Đồng hồ Pomodoro nổi'));

  const popover = document.createElement('section');
  popover.id = 'nos-pomo-popover';
  popover.className = 'nos-pomo-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', tr('Điều khiển Pomodoro'));
  popover.hidden = true;

  const zenOverlay = document.createElement('div');
  zenOverlay.id = 'nos-pomo-zen-overlay';
  zenOverlay.className = 'nos-pomo-zen-overlay';
  zenOverlay.setAttribute('role', 'dialog');
  zenOverlay.setAttribute('aria-modal', 'true');
  zenOverlay.hidden = true;

  const trimDialog = document.createElement('dialog');
  trimDialog.className = 'nos-pomo-trim';
  trimDialog.setAttribute('aria-labelledby', 'nos-pomo-trim-title');
  trimDialog.innerHTML = `
    <h2 id="nos-pomo-trim-title">Cắt âm báo</h2>
    <p class="nos-pomo-trim-name" data-i18n-skip></p>
    <p class="nos-pomo-trim-status" role="status"></p>
    <fieldset disabled>
      <label for="nos-pomo-trim-start">
        <span>Điểm bắt đầu</span><output for="nos-pomo-trim-start" aria-hidden="true" data-i18n-skip></output>
        <input type="range" id="nos-pomo-trim-start" min="0" step="1">
      </label>
      <label for="nos-pomo-trim-duration">
        <span>Độ dài (tối đa 15 giây)</span><output for="nos-pomo-trim-duration" aria-hidden="true" data-i18n-skip></output>
        <input type="range" id="nos-pomo-trim-duration" step="1">
      </label>
    </fieldset>
    <div class="nos-pomo-trim-actions">
      <button type="button" class="nos-pomo-btn" data-trim-action="preview" disabled>Nghe thử</button>
      <button type="button" class="nos-pomo-btn" data-trim-action="cancel" autofocus>Hủy</button>
      <button type="button" class="nos-pomo-btn primary" data-trim-action="save" disabled>Lưu đoạn báo</button>
    </div>`;
  const trimFields = trimDialog.querySelector('fieldset');
  const trimStart = trimDialog.querySelector('#nos-pomo-trim-start');
  const trimDuration = trimDialog.querySelector('#nos-pomo-trim-duration');
  const trimStatus = trimDialog.querySelector('.nos-pomo-trim-status');
  const trimPreview = trimDialog.querySelector('[data-trim-action="preview"]');
  const trimSave = trimDialog.querySelector('[data-trim-action="save"]');
  const previewPicker = document.createElement('input');
  previewPicker.type = 'file';
  previewPicker.accept = '.mp3,.wav,.ogg';
  previewPicker.hidden = true;
  let previewSlot;
  let trimDraft = null;
  let stopTrimPreview = () => {};
  let previewUploadError = '';

  hostContainer.append(ambientBar, banner, dockWidget, popover, zenOverlay, trimDialog, previewPicker);

  function setTrimReady(ready, message = '') {
    trimStatus.textContent = tr(message);
    trimFields.disabled = trimPreview.disabled = trimSave.disabled = !ready;
  }

  function syncTrimFields(start, duration) {
    const minDuration = Math.min(100, trimDraft.totalMs);
    trimDraft.start_ms = Math.min(start, trimDraft.totalMs - minDuration);
    trimStart.max = trimDraft.totalMs - minDuration;
    trimStart.value = trimDraft.start_ms;
    trimDuration.min = minDuration;
    trimDuration.max = Math.min(MAX_ALERT_MS, trimDraft.totalMs - trimDraft.start_ms);
    trimDraft.duration_ms = Math.max(minDuration, Math.min(Number(trimDuration.max), duration));
    trimDuration.value = trimDraft.duration_ms;
    const format = window.NOSI18n?.numberFormat({style: 'unit', unit: 'second', maximumFractionDigits: 3});
    for (const input of [trimStart, trimDuration]) {
      const value = Number(input.value) / 1000;
      const label = format?.format(value) || `${value} s`;
      input.closest('label').querySelector('output').textContent = label;
      input.setAttribute('aria-valuetext', label);
    }
  }

  function openTrim(slot) {
    const entry = config[customSoundKey(slot)];
    if (!entry?.url) return;
    stopSoundTest();
    stopTrimPreview();
    const draft = trimDraft = {slot, id: entry.id, url: entry.url};
    trimDialog.querySelector('.nos-pomo-trim-name').textContent = entry.name;
    setTrimReady(false, 'Đang tải âm thanh…');
    if (!trimDialog.open) trimDialog.showModal();
    loadSound(entry.url).then(buffer => {
      if (trimDraft !== draft) return;
      draft.totalMs = Math.floor(buffer.duration * 1000);
      if (draft.totalMs < 1) throw new Error('Empty audio');
      syncTrimFields(entry.start_ms ?? 0, entry.duration_ms ?? MAX_ALERT_MS);
      setTrimReady(true);
    }).catch(() => {
      if (trimDraft === draft) setTrimReady(false, 'Tệp âm thanh không phát được.');
    });
  }

  function closeTrim(restoreFocus = true) {
    if (!trimDraft) return;
    const {slot} = trimDraft;
    trimDraft = null;
    stopTrimPreview();
    trimDialog.close();
    if (restoreFocus && popoverOpen) {
      popover.querySelector(`[data-pomo-edit-sound="${slot}"]`)?.focus({preventScroll: true});
    }
  }

  trimDialog.addEventListener('cancel', e => {
    e.preventDefault();
    closeTrim();
  });
  trimFields.addEventListener('input', () => {
    stopTrimPreview();
    syncTrimFields(Number(trimStart.value), Number(trimDuration.value));
  });
  trimDialog.addEventListener('click', e => {
    const action = e.target.closest('[data-trim-action]')?.dataset.trimAction;
    if (action === 'cancel') closeTrim();
    if (!trimDraft || trimFields.disabled) return;
    const {slot, id, start_ms, duration_ms} = trimDraft;
    if (action === 'preview') {
      stopTrimPreview();
      stopTrimPreview = playClip(trimDraft, soundVolume());
    } else if (action === 'save') {
      closeTrim();
      sendCommand({op: 'trim_sound', slot, id, start_ms, duration_ms});
    }
  });

  function discardPreviewSound(slot) {
    const url = config[customSoundKey(slot)]?.url;
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
    if (decoded?.url === url) decoded = null;
  }

  previewPicker.addEventListener('change', () => {
    const file = previewPicker.files[0];
    previewPicker.value = '';
    if (!file) return;
    const problem = !/\.(mp3|wav|ogg)$/i.test(file.name) ? 'Chỉ hỗ trợ tệp âm thanh MP3, WAV hoặc OGG.'
      : !file.size || file.size > 4 * 1024 * 1024 ? 'Tệp âm thanh phải nhỏ hơn 4 MB.' : '';
    previewUploadError = problem;
    if (problem) { renderPopover(); return; }
    discardPreviewSound(previewSlot);
    const url = URL.createObjectURL(file);
    config = {
      ...config,
      [soundKey(previewSlot)]: 'custom',
      [customSoundKey(previewSlot)]: {id: url, url, name: file.name, start_ms: 0, duration_ms: MAX_ALERT_MS},
    };
    renderPopover();
    if (popoverOpen) openTrim(previewSlot);
  });

  // Reviewer & Overview micro-chip mounting
  let chipBtn = document.getElementById('pomodoro-toggle') || document.getElementById('nos-pomo-chip');
  if (!chipBtn && isReviewer) {
    const tools = document.getElementById('nos-review-tools');
    if (tools) {
      chipBtn = document.createElement('button');
      chipBtn.type = 'button';
      chipBtn.id = 'nos-pomo-chip';
      chipBtn.className = 'nos-pomo-chip';
      chipBtn.setAttribute('aria-haspopup', 'dialog');
      chipBtn.setAttribute('aria-expanded', 'false');
      chipBtn.setAttribute('aria-controls', 'nos-pomo-popover');
      const moreBtn = tools.querySelector('[data-nos-review="more"]');
      tools.insertBefore(chipBtn, moreBtn || null);
    }
  } else if (!chipBtn && isOverview) {
    const top = document.querySelector('.overview-topbar .topbar-actions') || document.querySelector('.overview-topbar');
    if (top) {
      chipBtn = document.createElement('button');
      chipBtn.type = 'button';
      chipBtn.id = 'nos-pomo-chip';
      chipBtn.className = 'nos-pomo-chip';
      chipBtn.setAttribute('aria-haspopup', 'dialog');
      chipBtn.setAttribute('aria-expanded', 'false');
      top.append(chipBtn);
    }
  }

  function bindTrigger(btn) {
    if (!btn || btn.dataset.pomoBound) return;
    btn.dataset.pomoBound = 'true';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      togglePopover(btn);
    });
  }
  bindTrigger(chipBtn);

  function positionPopover(triggerEl) {
    const anchor = triggerEl || chipBtn;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 120, Math.max(12, rect.bottom + 8));
    const right = Math.max(10, window.innerWidth - rect.right);
    popover.style.top = `${Math.round(top)}px`;
    if (window.innerWidth > 640) {
      popover.style.right = `${Math.round(Math.min(right, window.innerWidth - 384))}px`;
      popover.style.left = '';
    }
  }

  function togglePopover(triggerEl, force) {
    const next = typeof force === 'boolean' ? force : !popoverOpen;
    popoverOpen = next;
    popover.hidden = !popoverOpen;
    if (chipBtn) chipBtn.setAttribute('aria-expanded', String(popoverOpen));
    if (popoverOpen) {
      renderPopover();
      positionPopover(triggerEl);
    } else {
      stopSoundTest();
      closeTrim(false);
    }
  }

  document.addEventListener('click', e => {
    if (!popoverOpen) return;
    const path = e.composedPath();
    if (path.includes(popover) || path.includes(trimDialog) || path.includes(previewPicker)) return;
    if (chipBtn && chipBtn.contains(e.target)) return;
    if (dockWidget.contains(e.target)) return;
    if (e.target.closest('[data-action="pomodoro"]')) return;
    togglePopover(null, false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !trimDialog.open) {
      if (zenOpen) { zenOpen = false; renderZen(); return; }
      if (popoverOpen) togglePopover(null, false);
    }
  });

  function handleCompletionEvent(evt, play = true) {
    if (!evt || !evt.event_id || evt.event_id <= lastPlayedEventId) return;
    lastPlayedEventId = evt.event_id;
    if (play) playAlert(evt.kind === 'break_done' ? 'break' : 'study');
  }

  /* ---------- Renderers ---------- */
  function renderChip(clk) {
    if (!chipBtn) return;
    const active = !!state.active;
    const awaiting = !!state.awaiting_phase;
    if (chipBtn.id === 'pomodoro-toggle') {
      chipBtn.classList.toggle('is-live', active || awaiting);
      chipBtn.dataset.phase = state.phase;
      chipBtn.dataset.active = String(active);
      const timeSpan = chipBtn.querySelector('.pomo-btn-time');
      if (timeSpan) {
        timeSpan.hidden = !active && !awaiting;
        timeSpan.textContent = awaiting ? (state.awaiting_phase === 'break' ? tr('Nghỉ') : tr('Học')) : clk.text;
      }
      const label = active
        ? `Pomodoro · ${phaseLabel()} · ${clk.text}`
        : tr('Đồng hồ Pomodoro');
      chipBtn.title = label;
      chipBtn.setAttribute('aria-label', label);
      return;
    }
    // Reviewer / Overview micro-chip
    chipBtn.dataset.active = String(active);
    chipBtn.dataset.phase = state.phase;
    chipBtn.dataset.paused = String(!!state.paused);
    chipBtn.dataset.awaiting = String(awaiting);
    const hideInAmbient = active && config.ui_mode === 'ambient' && !awaiting;
    chipBtn.hidden = hideInAmbient;
    const r = 6;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - clk.progress);
    const shortText = awaiting
      ? tr(state.awaiting_phase === 'break' ? 'Đến giờ nghỉ' : 'Hết giờ nghỉ')
      : active
        ? clk.text
        : 'Pomodoro';
    const subPhase = active ? (state.paused ? tr('Tạm dừng') : (state.phase === 'break' ? tr('Nghỉ') : tr('Học'))) : '';
    chipBtn.innerHTML = active
      ? `<svg class="nos-pomo-chip-ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="pomo-ring-track" cx="8" cy="8" r="${r}"/><circle class="pomo-ring-fill" cx="8" cy="8" r="${r}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/></svg><span class="nos-pomo-chip-time" data-i18n-skip>${shortText}</span><span class="nos-pomo-chip-phase">${subPhase}</span>`
      : `<span class="nos-pomo-chip-dot"></span><span class="nos-pomo-chip-time">${shortText}</span>`;
    chipBtn.title = tr('Mở điều khiển Pomodoro');
  }

  function renderAmbientBar(clk) {
    const show = !!state.active && config.ui_mode === 'ambient' && !floatOpen;
    ambientBar.hidden = !show;
    if (!show) return;
    ambientBar.dataset.phase = state.phase;
    ambientBar.dataset.paused = String(!!state.paused);
    const fill = ambientBar.querySelector('.nos-pomo-ambient-fill');
    if (fill) fill.style.width = `${clk.isStopwatch ? 100 : Math.round(clk.progress * 100)}%`;
    const ph = ambientBar.querySelector('.pomo-peek-phase');
    const tm = ambientBar.querySelector('.pomo-peek-time');
    if (ph) ph.textContent = state.paused ? tr('Tạm dừng') : phaseLabel();
    if (tm) tm.textContent = clk.text;
  }

  function renderBanner() {
    const awaiting = state.awaiting_phase;
    const evt = state.last_event;
    const show = !!awaiting && !state.active;
    banner.hidden = !show;
    if (!show) return;
    const isStudyDone = awaiting === 'break';
    banner.dataset.kind = isStudyDone ? 'study_done' : 'break_done';
    const minsDone = evt ? Math.max(1, Math.round((evt.seconds || 0) / 60)) : config.study_minutes;
    const cardsDone = evt?.cards || 0;
    const nextMins = Math.max(1, Math.round((state.awaiting_target_seconds || 300) / 60));
    const msg = isStudyDone
      ? tr(`Hoàn thành ${minsDone} phút học · ${cardsDone} lượt ôn. Sẵn sàng nghỉ ${nextMins} phút?`)
      : tr(`Hết giờ nghỉ (${minsDone} phút). Sẵn sàng bắt đầu phiên học tiếp theo?`);
    banner.innerHTML = `
      <p class="nos-pomo-banner-text" data-i18n-skip>${msg}</p>
      <div class="nos-pomo-banner-actions">
        <button type="button" class="nos-pomo-btn small primary" data-pomo-op="switch" data-pomo-phase="${awaiting}">${isStudyDone ? tr(`Nghỉ ${nextMins} phút`) : tr('Tiếp tục học')}</button>
        ${isStudyDone ? `<button type="button" class="nos-pomo-btn small" data-pomo-op="extend" data-pomo-minutes="5">${tr('+5 phút')}</button>` : ''}
        <button type="button" class="nos-pomo-btn small" data-pomo-op="dismiss">${tr('Đóng')}</button>
      </div>`;
  }

  function renderDockWidget(clk) {
    const ui = config.ui_mode;
    const show = !!state.active && (ui === 'ring' || ui === 'flip') && !floatOpen && !dockCollapsed;
    dockWidget.hidden = !show;
    if (!show) return;
    dockWidget.dataset.corner = config.widget_corner || 'bottom-right';
    dockWidget.dataset.phase = state.phase;
    dockWidget.innerHTML = `
      <div class="nos-pomo-dock-bar" data-dock-drag>
        <span>${phaseLabel()} · ${modeShortLabel(state.mode)}</span>
        <span style="display:inline-flex;gap:4px">
          <button type="button" class="nos-pomo-icon-btn" style="width:24px;height:24px" data-dock-corner title="${tr('Đổi góc đặt')}">⌖</button>
          <button type="button" class="nos-pomo-icon-btn" style="width:24px;height:24px" data-dock-collapse title="${tr('Thu gọn về thanh trên')}">–</button>
        </span>
      </div>
      ${buildClockHTML(ui, clk, state.phase, state.paused)}
      <div class="nos-pomo-controls">
        <button type="button" class="nos-pomo-btn small primary" data-pomo-op="${state.paused ? 'resume' : 'pause'}">${tr(state.paused ? 'Tiếp tục' : 'Tạm dừng')}</button>
        <button type="button" class="nos-pomo-btn small" data-pomo-op="switch">${tr(state.phase === 'study' ? 'Nghỉ' : 'Học')}</button>
        ${state.phase === 'break' ? `<button type="button" class="nos-pomo-btn small" data-pomo-zen="open">${tr('Zen')}</button>` : ''}
      </div>`;
  }

  function renderZen(clk = displayClock()) {
    const show = zenOpen && state.active && state.phase === 'break';
    if (!show) zenOpen = false;
    zenOverlay.hidden = !show;
    if (!show) return;
    zenOverlay.innerHTML = `
      <div class="nos-pomo-zen-card">
        <span class="nos-pomo-phase-badge" data-phase="break">${tr('Giờ nghỉ Zen · Thư giãn mắt')}</span>
        <h2>${tr('Nghỉ ngơi một chút nhé')}</h2>
        <div class="nos-pomo-zen-time" data-i18n-skip>${clk.text}</div>
        <p>${tr('Nhìn ra xa khoảng 6 mét trong 20 giây, thả lỏng vai và uống một ngụm nước trước khi quay lại ôn thẻ.')}</p>
        <div class="nos-pomo-controls">
          <button type="button" class="nos-pomo-btn primary" data-pomo-op="switch" data-pomo-phase="study">${tr('Quay lại học ngay')}</button>
          <button type="button" class="nos-pomo-btn" data-pomo-zen="close">${tr('Thu gọn màn hình nghỉ')}</button>
        </div>
      </div>`;
  }

  function renderPopover() {
    if (!popoverOpen) return;
    const clk = displayClock();
    const ui = config.ui_mode || 'pill';
    const mode = state.active ? state.mode : config.mode;
    const cyclesMax = Math.max(2, config.cycles_before_long || 4);
    const doneDots = state.cycle_count % cyclesMax;
    const dotsHtml = Array.from({length: cyclesMax}, (_, i) => `<i class="nos-pomo-cycle-dot${i < doneDots ? ' done' : ''}"></i>`).join('');

    const soundRow = slot => {
      const study = slot === 'study';
      const key = soundKey(slot);
      const entry = config[customSoundKey(slot)];
      const selected = config[key] === 'custom' && !entry ? DEFAULT_SOUNDS[slot] : config[key];
      const defaultOptions = Object.values(DEFAULT_SOUNDS).map(name =>
        `<option value="${name}"${selected === name ? ' selected' : ''} data-i18n-skip>${name}.mp3</option>`).join('');
      const label = study ? 'Hết giờ học' : 'Hết giờ nghỉ';
      const selectionLabel = study ? 'Âm báo hết giờ học' : 'Âm báo hết giờ nghỉ';
      const previewLabel = study ? 'Nghe thử âm báo hết giờ học' : 'Nghe thử âm báo hết giờ nghỉ';
      return `
        <div class="nos-pomo-label">${tr(label)}</div>
        <div class="nos-pomo-sound-row">
          <select data-pomo-sound-select="${key}" aria-label="${tr(selectionLabel)}">
            ${defaultOptions}
            ${entry ? `<option value="custom"${selected === 'custom' ? ' selected' : ''}>${tr('Âm thanh tùy chỉnh')}</option>` : ''}
            <option value="none"${selected === 'none' ? ' selected' : ''}>${tr('Im lặng (chỉ hiện chữ)')}</option>
          </select>
          <button type="button" class="nos-pomo-btn small" data-pomo-test-sound="${slot}" title="${tr(previewLabel)}" aria-label="${tr(previewLabel)}">▶</button>
          <button type="button" class="nos-pomo-btn small" data-pomo-op="pick_sound" data-pomo-slot="${slot}" title="${tr('Chọn tệp âm thanh MP3/WAV/OGG')}" aria-label="${tr('Chọn tệp âm thanh MP3/WAV/OGG')}">+</button>
        </div>
        ${entry ? `<div class="nos-pomo-custom-file">
          <span data-pomo-filename="${slot}" data-i18n-skip></span>
          <button type="button" class="nos-pomo-btn small" data-pomo-edit-sound="${slot}">${tr('Cắt âm báo')}</button>
          <button type="button" class="nos-pomo-btn small" data-pomo-op="clear_sound" data-pomo-slot="${slot}">${tr('Gỡ')}</button>
        </div>` : ''}`;
    };

    const scrollTop = popover.scrollTop;
    const focusedEdit = popover.contains(document.activeElement) ? document.activeElement.dataset.pomoEditSound : '';
    popover.innerHTML = `
      <div class="nos-pomo-head">
        <div class="nos-pomo-head-title">
          <strong>Pomodoro</strong>
          <span class="nos-pomo-phase-badge" data-phase="${state.phase}">${state.active ? phaseLabel() : modeShortLabel(mode)}</span>
        </div>
        <div class="nos-pomo-head-tools">
          <button type="button" class="nos-pomo-icon-btn" data-pomo-op="toggle_float" aria-pressed="${floatOpen}" title="${tr('Tách đồng hồ nổi xuyên mọi màn hình Anki')}">⧉</button>
          <button type="button" class="nos-pomo-icon-btn" data-pomo-close title="${tr('Đóng')}">×</button>
        </div>
      </div>

      <div class="nos-pomo-stage">
        ${buildClockHTML(ui, clk, state.phase, state.paused)}
        <div class="nos-pomo-cycles" aria-label="${tr('Chu kỳ Pomodoro')}">
          ${dotsHtml}
          <span data-i18n-skip>${tr(`Vòng ${state.cycle_count}`)}${state.active && state.phase === 'study' ? ` · ${tr(`${state.cards} lượt ôn`)}` : ''}</span>
        </div>
        <div class="nos-pomo-controls">
          ${!state.active
            ? `<button type="button" class="nos-pomo-btn primary" id="nos-pomo-start-btn" data-pomo-op="start">${tr('Bắt đầu học')}</button>
               <button type="button" class="nos-pomo-btn" data-pomo-op="start" data-pomo-phase="break">${tr('Bắt đầu nghỉ')}</button>`
            : `<button type="button" class="nos-pomo-btn primary" data-pomo-op="${state.paused ? 'resume' : 'pause'}">${tr(state.paused ? 'Tiếp tục' : 'Tạm dừng')}</button>
               <button type="button" class="nos-pomo-btn" data-pomo-op="switch">${tr(state.phase === 'study' ? 'Chuyển nghỉ' : 'Quay lại học')}</button>
               ${state.target_seconds > 0 ? `<button type="button" class="nos-pomo-btn" data-pomo-op="extend" data-pomo-minutes="5">${tr('+5p')}</button>` : ''}
               <button type="button" class="nos-pomo-btn danger" data-pomo-op="stop">${tr('Kết thúc')}</button>`}
          ${state.active && state.phase === 'break' ? `<button type="button" class="nos-pomo-btn" data-pomo-zen="open">${tr('Màn hình nghỉ Zen')}</button>` : ''}
        </div>
      </div>

      <div class="nos-pomo-section">
        <span class="nos-pomo-label">${tr('Chế độ Pomodoro')}</span>
        <div class="nos-pomo-seg" role="group" aria-label="${tr('Chọn chế độ Pomodoro')}">
          <button type="button" data-pomo-mode="classic" aria-pressed="${config.mode === 'classic'}">${tr('Tiêu chuẩn')}<small>25p / 5p</small></button>
          <button type="button" data-pomo-mode="long" aria-pressed="${config.mode === 'long'}">${tr('Dài')}<small>50p / 10p</small></button>
          <button type="button" data-pomo-mode="custom" aria-pressed="${config.mode === 'custom'}">${tr('Tùy chỉnh')}<small>${config.study_minutes}p / ${config.break_minutes}p</small></button>
          <button type="button" data-pomo-mode="stopwatch" aria-pressed="${config.mode === 'stopwatch'}">${tr('Timer đếm')}<small>00:00 ↑</small></button>
        </div>
        <div class="nos-pomo-custom-grid" ${config.mode === 'custom' ? '' : 'hidden'}>
          <label class="nos-pomo-field">${tr('Thời gian học (phút)')}
            <input type="number" id="nos-pomo-study-min" min="1" max="180" value="${config.study_minutes}">
          </label>
          <label class="nos-pomo-field">${tr('Thời gian nghỉ (phút)')}
            <input type="number" id="nos-pomo-break-min" min="1" max="60" value="${config.break_minutes}">
          </label>
        </div>
      </div>

      <div class="nos-pomo-section">
        <span class="nos-pomo-label">${tr('Giao diện đồng hồ (UI Mode)')}</span>
        <div class="nos-pomo-seg" role="group" aria-label="${tr('Chọn giao diện đồng hồ')}">
          <button type="button" data-pomo-ui="pill" aria-pressed="${ui === 'pill'}">${tr('Gọn')}<small>Pill</small></button>
          <button type="button" data-pomo-ui="ring" aria-pressed="${ui === 'ring'}">${tr('Vòng tròn')}<small>Ring</small></button>
          <button type="button" data-pomo-ui="flip" aria-pressed="${ui === 'flip'}">${tr('Lật số')}<small>Flip</small></button>
          <button type="button" data-pomo-ui="ambient" aria-pressed="${ui === 'ambient'}">${tr('Thanh Zen')}<small>Bar</small></button>
        </div>
      </div>

      <div class="nos-pomo-section">
        <span class="nos-pomo-label">${tr('Âm thanh báo hết giờ')}</span>
        <div class="nos-pomo-sound-box">
          ${soundRow('study')}
          ${soundRow('break')}
          ${previewUploadError ? `<p class="nos-pomo-trim-status" role="status">${tr(previewUploadError)}</p>` : ''}
          <div class="nos-pomo-vol-row">
            <span>${tr('Âm lượng')}</span>
            <input type="range" id="nos-pomo-volume" min="0" max="100" value="${config.sound_volume}" aria-label="${tr('Âm lượng âm báo Pomodoro')}">
            <strong id="nos-pomo-vol-val" data-i18n-skip>${config.sound_volume}%</strong>
          </div>
        </div>
      </div>

      <div class="nos-pomo-toggles">
        <label class="nos-pomo-toggle"><span>${tr('Nghỉ dài sau mỗi 4 vòng')}</span><input type="checkbox" data-pomo-bool="long_break_enabled"${config.long_break_enabled ? ' checked' : ''}></label>
        <label class="nos-pomo-toggle"><span>${tr('Tự động chuyển sang giờ nghỉ')}</span><input type="checkbox" data-pomo-bool="auto_start_break"${config.auto_start_break ? ' checked' : ''}></label>
        <label class="nos-pomo-toggle"><span>${tr('Tạm dừng khi rời cửa sổ Anki (pha học)')}</span><input type="checkbox" data-pomo-bool="pause_on_blur"${config.pause_on_blur ? ' checked' : ''}></label>
      </div>`;
    for (const label of popover.querySelectorAll('[data-pomo-filename]')) {
      label.textContent = config[customSoundKey(label.dataset.pomoFilename)].name;
    }
    popover.scrollTop = scrollTop;
    if (focusedEdit) popover.querySelector(`[data-pomo-edit-sound="${focusedEdit}"]`)?.focus({preventScroll: true});
  }

  function renderAll() {
    const clk = displayClock();
    renderChip(clk);
    renderAmbientBar(clk);
    renderBanner();
    renderDockWidget(clk);
    renderZen(clk);
    if (popoverOpen) {
      // Lightweight live clock text patch when popover is open (preserves focus on inputs!)
      const digits = popover.querySelector('.nos-pomo-stage .pomo-digits, .nos-pomo-stage .nos-pomo-ambient-meta strong');
      if (digits && !popover.querySelector('.nos-pomo-clock-flip')) {
        if (digits.textContent !== clk.text) digits.textContent = clk.text;
        const ring = popover.querySelector('.nos-pomo-clock-ring .ring-fg');
        if (ring) {
          const c = 2 * Math.PI * 62;
          ring.setAttribute('stroke-dashoffset', (c * (1 - clk.progress)).toFixed(1));
        }
        const amb = popover.querySelector('.nos-pomo-ambient-track > i');
        if (amb) amb.style.width = `${clk.isStopwatch ? 100 : Math.round(clk.progress * 100)}%`;
      } else if (popover.querySelector('.nos-pomo-clock-flip')) {
        const cards = popover.querySelectorAll('.nos-pomo-stage .nos-pomo-flip-card span');
        if (cards.length === 2) {
          if (cards[0].textContent !== clk.mm) cards[0].textContent = clk.mm;
          if (cards[1].textContent !== clk.ss) cards[1].textContent = clk.ss;
        }
      }
    }
    if (state.active && !state.paused && state.target_seconds > 0 && clk.remaining <= 0 && !completionSent) {
      completionSent = true;
      sendCommand({op: 'complete'});
    }
  }

  /* ---------- Event Delegation ---------- */
  function handleActionClick(e) {
    if (e.target.closest('[data-pomo-close]')) { togglePopover(null, false); return; }
    const zenBtn = e.target.closest('[data-pomo-zen]');
    if (zenBtn) {
      zenOpen = zenBtn.dataset.pomoZen === 'open';
      if (zenOpen) togglePopover(null, false);
      renderZen();
      return;
    }
    const modeBtn = e.target.closest('[data-pomo-mode]');
    if (modeBtn) {
      const m = modeBtn.dataset.pomoMode;
      config = {...config, mode: m};
      sendCommand({op: 'config', values: {mode: m}});
      renderPopover();
      return;
    }
    const uiBtn = e.target.closest('[data-pomo-ui]');
    if (uiBtn) {
      const u = uiBtn.dataset.pomoUi;
      dockCollapsed = false;
      config = {...config, ui_mode: u};
      sendCommand({op: 'config', values: {ui_mode: u}});
      renderPopover();
      renderAll();
      return;
    }
    const testBtn = e.target.closest('[data-pomo-test-sound]');
    if (testBtn) {
      stopSoundTest();
      stopSoundTest = playSound(testBtn.dataset.pomoTestSound);
      return;
    }
    const editBtn = e.target.closest('[data-pomo-edit-sound]');
    if (editBtn) {
      openTrim(editBtn.dataset.pomoEditSound);
      return;
    }
    if (e.target.closest('[data-dock-collapse]')) {
      dockCollapsed = true;
      renderAll();
      return;
    }
    if (e.target.closest('[data-dock-corner]')) {
      const order = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
      const next = order[(order.indexOf(config.widget_corner || 'bottom-right') + 1) % order.length];
      config = {...config, widget_corner: next};
      sendCommand({op: 'config', values: {widget_corner: next}});
      renderAll();
      return;
    }
    const opBtn = e.target.closest('[data-pomo-op]');
    if (opBtn) {
      const op = opBtn.dataset.pomoOp;
      const payload = {op};
      if (opBtn.dataset.pomoPhase) payload.phase = opBtn.dataset.pomoPhase;
      if (opBtn.dataset.pomoMinutes) payload.minutes = Number(opBtn.dataset.pomoMinutes);
      if (opBtn.dataset.pomoSlot) payload.slot = opBtn.dataset.pomoSlot;
      if (op === 'pick_sound' && !isNative()) {
        previewSlot = payload.slot;
        previewPicker.click();
        return;
      }
      if (op === 'start') {
        dockCollapsed = false;
        payload.mode = config.mode;
        payload.study_minutes = config.study_minutes;
        payload.break_minutes = config.break_minutes;
      }
      sendCommand(payload);
      if (op === 'switch' && payload.phase === 'study') zenOpen = false;
      if (popoverOpen) renderPopover();
    }
  }

  [popover, banner, dockWidget, zenOverlay].forEach(el => el.addEventListener('click', handleActionClick));

  popover.addEventListener('change', e => {
    const target = e.target;
    if (target.id === 'nos-pomo-study-min') {
      const val = clamp(target.value, 1, 180, 25);
      target.value = String(val);
      config = {...config, study_minutes: val};
      sendCommand({op: 'config', values: {study_minutes: val}});
      renderPopover();
    } else if (target.id === 'nos-pomo-break-min') {
      const val = clamp(target.value, 1, 60, 5);
      target.value = String(val);
      config = {...config, break_minutes: val};
      sendCommand({op: 'config', values: {break_minutes: val}});
      renderPopover();
    } else if (target.dataset.pomoSoundSelect) {
      const key = target.dataset.pomoSoundSelect;
      config = {...config, [key]: target.value};
      sendCommand({op: 'config', values: {[key]: target.value}});
    } else if (target.dataset.pomoBool) {
      const key = target.dataset.pomoBool;
      config = {...config, [key]: !!target.checked};
      sendCommand({op: 'config', values: {[key]: !!target.checked}});
    } else if (target.id === 'nos-pomo-volume') {
      const val = clamp(target.value, 0, 100, 75);
      config = {...config, sound_volume: val};
      sendCommand({op: 'config', values: {sound_volume: val}});
    }
  });
  popover.addEventListener('input', e => {
    if (e.target.id === 'nos-pomo-volume') {
      const out = popover.querySelector('#nos-pomo-vol-val');
      if (out) out.textContent = `${e.target.value}%`;
    }
  });

  function receive(payload, playCompletion = true) {
    if (!payload) return;
    const previousConfig = config;
    const prevActive = state.active;
    const prevPhase = state.phase;
    if (payload.config) config = {...DEFAULT_CONFIG, ...payload.config};
    if (typeof payload.float_open === 'boolean') floatOpen = payload.float_open;
    if (payload.state) {
      state = {...DEFAULT_STATE, ...payload.state};
      anchorMs = performance.now();
      completionSent = false;
      if (state.last_event) handleCompletionEvent(state.last_event, playCompletion);
    }
    if (trimDraft && config[customSoundKey(trimDraft.slot)]?.id !== trimDraft.id) closeTrim();
    if (popoverOpen) {
      if (prevActive !== state.active || prevPhase !== state.phase || JSON.stringify(previousConfig) !== JSON.stringify(config)) {
        renderPopover();
      }
      if (payload.edit_sound && !trimDialog.open) openTrim(payload.edit_sound);
    }
    renderAll();
    document.dispatchEvent(new CustomEvent('nos:pomodoro', {detail: {state, config}}));
  }

  // Bootstrap initial state if embedded
  const bootSource = document.getElementById('nos-review-bootstrap')
    || document.getElementById('nos-overview-bootstrap')
    || document.getElementById('nos-dashboard-bootstrap');
  if (bootSource) {
    try {
      const parsed = JSON.parse(bootSource.textContent || '{}');
      if (parsed.pomodoro) receive(parsed.pomodoro, false);
      else if (parsed.settings?.pomodoro) receive({config: parsed.settings.pomodoro});
    } catch {}
  }

  document.addEventListener('nos:language', () => {
    renderAll();
    if (popoverOpen) renderPopover();
  });

  setInterval(renderAll, 1000);
  renderAll();

  window.NOSPomodoro = {
    receive,
    open: trigger => togglePopover(trigger, true),
    close: () => togglePopover(null, false),
    toggle: trigger => togglePopover(trigger),
    getState: () => ({...state}),
    getConfig: () => ({...config}),
    command: sendCommand,
    playAlert,
  };
})();
