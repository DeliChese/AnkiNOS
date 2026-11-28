/* AnkiNOS Freeform Modular Custom UI Studio:
 * Drag anywhere, resize freely (w/h), close any piece with ×, reorder/detach Sidebar & Dock,
 * create custom Tool Containers (dock/rail/grid/pill), and save multiple personal presets. */
(function initializeNOSCustomUI() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNOSCustomUI, {once: true});
    return;
  }
  const app = document.getElementById('nos-app');
  if (!app || window.NOSCustomUI) return;
  const $ = id => document.getElementById(id);
  const stage = $('cui-stage');
  const workspace = stage?.closest('.workspace');
  const homeGrid = app.querySelector('.home-grid');
  const rail = app.querySelector('.rail');
  const topbar = app.querySelector('.topbar');
  const greetingCard = $('greeting-card');
  const goalCard = $('goal-card');
  const activityPanel = $('activity-panel');
  const launchpadPanel = $('study-launchpad');
  const dialog = $('custom-ui-dialog');
  const liveBar = $('custom-ui-livebar');
  if (!homeGrid || !dialog) return;

  const BASE_NAMES = {
    aurora: 'Cực quang',
    bento: 'Bento',
    dock: 'Dock nổi',
    sidebar: 'Không gian làm việc',
    zen: 'Zen',
    edges: '4 Cạnh',
  };
  const BLOCK_META = {
    greeting: {name: 'Lời chào trang chủ', desc: 'Ngày hôm nay, lời chào & dòng phụ đề'},
    goal: {name: 'Vòng mục tiêu ngày', desc: 'Tiến độ lượt ôn hôm nay'},
    activity: {name: 'Heatmap nhịp điệu học tập', desc: 'Lịch sử ôn tập & chuỗi ngày'},
    launchpad: {name: 'Chuẩn bị phiên học', desc: 'Chọn bộ thẻ, ước lượng giờ & Focus'},
    toolbox: {name: 'Hộp công cụ tùy chỉnh', desc: 'Tự chọn kiểu khay chứa & nút chức năng'},
    quick_stats: {name: 'Chỉ số hôm nay', desc: 'Ghi nhớ, lượt ôn, chuỗi ngày & thời gian'},
    clock: {name: 'Đồng hồ & Nhắc nhở', desc: 'Giờ hiện tại kèm dòng động lực'},
    memo: {name: 'Ghi chú dán nhanh', desc: 'Ghim mục tiêu hoặc nhắc nhở ngay trang chủ'},
    shortcuts: {name: 'Lối tắt nhanh', desc: 'Mở nhanh Duyệt thẻ, Thêm thẻ, Lịch ôn, Sổ tay'},
  };
  const NAV_ITEMS = [
    {key: 'home', label: 'Tổng quan'},
    {key: 'daily', label: 'Lịch ôn'},
    {key: 'stats', label: 'Thống kê'},
    {key: 'library', label: 'Bộ thẻ'},
    {key: 'notebook', label: 'Sổ tay'},
    {key: 'appearance', label: 'Giao diện'},
    {key: 'preferences', label: 'Cài đặt'},
    {key: 'launcher', label: 'Chức năng'},
  ];
  const TOOL_CATALOG = {
    home: {label: 'Tổng quan', icon: 'i-home', action: 'page', value: 'home'},
    daily: {label: 'Lịch ôn', icon: 'i-calendar', action: 'page', value: 'daily'},
    stats: {label: 'Thống kê', icon: 'i-chart', action: 'page', value: 'stats'},
    library: {label: 'Bộ thẻ', icon: 'i-layers', action: 'library'},
    notebook: {label: 'Sổ tay', icon: 'i-file', cmd: 'notebook'},
    appearance: {label: 'Giao diện', icon: 'i-moon', action: 'appearance'},
    preferences: {label: 'Cài đặt', icon: 'i-settings', action: 'preferences'},
    launcher: {label: 'Chức năng', icon: 'i-grid', action: 'launcher'},
    add_cards: {label: 'Thêm thẻ', icon: 'i-plus', action: 'add_cards'},
    browse: {label: 'Duyệt thẻ', icon: 'i-search', action: 'browse'},
    sync: {label: 'Đồng bộ', icon: 'i-sync', action: 'sync'},
    import: {label: 'Nhập thẻ', icon: 'i-download', action: 'import'},
    export: {label: 'Xuất thẻ', icon: 'i-upload', action: 'export'},
    studio: {label: 'Thư viện ảnh', icon: 'i-folder', action: 'studio'},
    commands: {label: 'Lệnh nhanh', icon: 'i-bolt', cmd: 'commands'},
    fullscreen: {label: 'Toàn màn hình', icon: 'i-fullscreen', action: 'fullscreen'},
    guide: {label: 'Hướng dẫn', icon: 'i-info', action: 'guide'},
    changelog: {label: 'Nhật ký cập nhật', icon: 'i-spark', action: 'changelog'},
  };
  const TOOLBOX_STYLE_LABELS = {
    dock: 'Thanh ngang (Dock)',
    rail: 'Thanh dọc (Sidebar)',
    grid: 'Lưới ô (Grid)',
    pill: 'Viên thuốc gọn (Pill)',
  };
  const CORE_TYPES = ['greeting', 'goal', 'activity', 'launchpad'];
  const STUDIO_TABS = ['layout', 'blocks', 'nav', 'toolboxes'];
  const GEOMETRY = {
    x: {label: 'Vị trí ngang (px)', min: 0, max: 2400},
    y: {label: 'Vị trí dọc (px)', min: 0, max: 2400},
    w: {label: 'Chiều rộng (px)', min: 140, max: 1600, auto: true},
    h: {label: 'Chiều cao (px)', min: 56, max: 1200, auto: true},
    z: {label: 'Lớp hiển thị', min: 1, max: 50},
  };
  const MAX_PRESETS = 12;
  const MAX_BLOCKS = 16;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const tr = s => (window.NOSI18n ? window.NOSI18n.t(s) : s);
  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const clone = obj => JSON.parse(JSON.stringify(obj));

  let lastSettings = {};
  let lastSnapshot = null;
  let editorPresets = [];
  let selectedId = '';
  let activeStudioTab = 'layout';
  let expandedEditBlockId = '';
  let liveEditDraft = null;
  let liveEditPresets = [];
  let previousLayout = '';
  let dragListId = '';
  let dragNavKey = '';
  let clockTimer = 0;
  let returnFocus = null;
  let sizeBadge = null;
  let switcherSignature = '';
  const widgetContent = new WeakMap();
  const desktop = matchMedia('(min-width: 721px)');
  const canArrangeCanvas = () => desktop.matches && app.dataset.cuiCanvas === 'roomy';

  function defaultNav() {
    return {
      placement: 'default',
      orientation: 'auto',
      x: 20,
      y: 90,
      order: NAV_ITEMS.map(i => i.key),
      hidden: [],
    };
  }

  function defaultFreeformRect(type, index = 0) {
    if (type === 'greeting') return {x: 0, y: 0, w: 624, h: 120, z: 2};
    if (type === 'goal') return {x: 648, y: 12, w: 288, h: 96, z: 3};
    if (type === 'activity') return {x: 0, y: 144, w: 648, h: 336, z: 2};
    if (type === 'launchpad') return {x: 672, y: 144, w: 348, h: 336, z: 2};
    const col = (index % 2) * 384;
    const row = 504 + Math.floor(index / 2) * 168;
    if (type === 'toolbox') return {x: col, y: row, w: 468, h: 96, z: 5};
    if (type === 'quick_stats') return {x: 0, y: row, w: 648, h: 156, z: 4};
    return {x: col, y: row, w: 360, h: 156, z: 4};
  }

  function defaultPreset(base = 'aurora', name = 'Bố cục của tôi') {
    return {
      id: uid('cui'),
      name,
      base: BASE_NAMES[base] ? base : 'aurora',
      mode: 'freeform',
      snap: true,
      columns: 'auto',
      gap: 18,
      radius: 22,
      width: 'normal',
      show_topbar: true,
      show_greeting: true,
      show_goal: true,
      greeting_align: 'default',
      nav: defaultNav(),
      blocks: [
        {id: 'greeting', type: 'greeting', span: 'auto', hidden: false, ...defaultFreeformRect('greeting')},
        {id: 'goal', type: 'goal', span: 'auto', hidden: false, ...defaultFreeformRect('goal')},
        {id: 'activity', type: 'activity', span: 'auto', hidden: false, ...defaultFreeformRect('activity')},
        {id: 'launchpad', type: 'launchpad', span: 'auto', hidden: false, ...defaultFreeformRect('launchpad')},
      ],
    };
  }

  function defaultWidget(type, style = 'dock') {
    const base = {id: uid('w'), type, span: 'auto', hidden: false, ...defaultFreeformRect(type)};
    if (type === 'toolbox') {
      const dims = style === 'rail' ? {w: 180, h: 324} : style === 'grid' ? {w: 360, h: 216} : style === 'pill' ? {w: 288, h: 64} : {w: 504, h: 96};
      return {
        ...base,
        ...dims,
        title: tr('Hộp công cụ'),
        style,
        tools: ['add_cards', 'browse', 'daily', 'stats', 'notebook', 'sync'],
      };
    }
    if (type === 'quick_stats') return {...base, span: 'full'};
    if (type === 'clock' || type === 'memo') return {...base, span: 'half'};
    return {...base, type: 'shortcuts', span: 'full'};
  }

  function appendWidget(preset, type, style) {
    if (preset.blocks.length >= MAX_BLOCKS) return null;
    const widget = defaultWidget(type, style);
    widget.y = Math.min(GEOMETRY.y.max, Math.max(0, ...preset.blocks
      .filter(block => !block.hidden).map(block => block.y + (block.h || 220))) + preset.gap);
    preset.blocks.push(widget);
    return widget;
  }

  function normalizePreset(preset) {
    if (!preset) return null;
    preset.mode = preset.mode === 'freeform' ? 'freeform' : 'grid';
    preset.snap = preset.snap !== false;
    preset.show_topbar = preset.show_topbar !== false;
    preset.nav = {...defaultNav(), ...(preset.nav || {})};
    if (!Array.isArray(preset.nav.order) || !preset.nav.order.length) preset.nav.order = NAV_ITEMS.map(i => i.key);
    for (const item of NAV_ITEMS) {
      if (!preset.nav.order.includes(item.key)) preset.nav.order.push(item.key);
    }
    if (!Array.isArray(preset.nav.hidden)) preset.nav.hidden = [];
    if (!Array.isArray(preset.blocks)) preset.blocks = [];
    const seen = new Set(preset.blocks.map(b => b.type));
    if (!seen.has('greeting')) {
      preset.blocks.unshift({id: 'greeting', type: 'greeting', span: 'auto', hidden: preset.show_greeting === false, ...defaultFreeformRect('greeting')});
    }
    if (!seen.has('goal')) {
      preset.blocks.splice(1, 0, {id: 'goal', type: 'goal', span: 'auto', hidden: preset.show_goal === false, ...defaultFreeformRect('goal')});
    }
    for (const core of ['activity', 'launchpad']) {
      if (!seen.has(core)) preset.blocks.push({id: core, type: core, span: 'auto', hidden: false, ...defaultFreeformRect(core)});
    }
    preset.blocks.forEach((b, idx) => {
      const rect = defaultFreeformRect(b.type, idx);
      for (const key of Object.keys(GEOMETRY)) {
        if (!Number.isInteger(b[key])) b[key] = rect[key];
      }
      if (b.type === 'toolbox') {
        if (!TOOLBOX_STYLE_LABELS[b.style]) b.style = 'dock';
        if (!Array.isArray(b.tools) || !b.tools.length) b.tools = ['add_cards', 'browse', 'daily', 'stats', 'notebook', 'sync'];
      }
    });
    return preset;
  }

  function getPresetsFrom(settings = lastSettings) {
    return Array.isArray(settings?.custom_ui_presets) ? settings.custom_ui_presets : [];
  }

  function getActivePreset(settings = lastSettings) {
    if (liveEditDraft) return liveEditDraft;
    const id = settings?.custom_ui_active || '';
    if (!id) return null;
    const found = getPresetsFrom(settings).find(p => p.id === id);
    return found ? normalizePreset(clone(found)) : null;
  }

  function formatTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function stopClock() {
    if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
  }

  function updateClocks() {
    const nodes = homeGrid.querySelectorAll('[data-cui-clock]');
    if (!nodes.length) { stopClock(); return; }
    const now = formatTime(new Date());
    nodes.forEach(node => { node.textContent = now; });
  }

  function ensureClock() {
    if (!homeGrid.querySelector('[data-cui-clock]')) { stopClock(); return; }
    updateClocks();
    if (!clockTimer) clockTimer = setInterval(updateClocks, 15000);
  }

  function renderWidgetContent(block) {
    const stats = lastSnapshot?.partial ? {} : lastSnapshot?.stats || {};
    const fmtNum = v => window.NOSI18n ? window.NOSI18n.numberFormat().format(v) : String(v);
    const title = block.title || tr(BLOCK_META[block.type]?.name || 'Widget');
    const titleAttr = block.title ? ' data-i18n-skip' : '';
    if (block.type === 'toolbox') {
      const tools = Array.isArray(block.tools) && block.tools.length ? block.tools : ['add_cards', 'browse', 'daily', 'stats', 'notebook', 'sync'];
      const buttons = tools.map(key => {
        const meta = TOOL_CATALOG[key];
        if (!meta) return '';
        const actionAttrs = meta.cmd
          ? `data-tool-cmd="${esc(meta.cmd)}"`
          : `data-action="${esc(meta.action)}"${meta.value ? ` data-value="${esc(meta.value)}"` : ''}`;
        return `<button type="button" class="nos-cui-tool-btn" ${actionAttrs} title="${esc(tr(meta.label))}"><svg class="icon"><use href="#${esc(meta.icon)}"/></svg><span>${esc(tr(meta.label))}</span></button>`;
      }).join('');
      return `${block.title ? `<div class="nos-cui-widget-head"><h3${titleAttr}>${esc(block.title)}</h3></div>` : ''}
        <div class="nos-cui-toolbox-items">${buttons}</div>`;
    }
    if (block.type === 'quick_stats') {
      const ret = stats.retention == null ? '—' : `${fmtNum(stats.retention)}%`;
      const rev = stats.reviews == null ? '—' : fmtNum(stats.reviews);
      const streak = stats.streak == null ? '—' : `${fmtNum(stats.streak)} ${tr('ngày')}`;
      const mins = stats.milliseconds == null ? '—' : `${fmtNum(Math.round(stats.milliseconds / 60000))} ${tr('phút')}`;
      return `<div class="nos-cui-widget-head"><h3${titleAttr}>${esc(title)}</h3></div>
        <div class="nos-cui-kpis">
          <div class="nos-cui-kpi"><span>${esc(tr('Ghi nhớ'))}</span><strong>${esc(ret)}</strong></div>
          <div class="nos-cui-kpi"><span>${esc(tr('Đã ôn'))}</span><strong>${esc(rev)}</strong></div>
          <div class="nos-cui-kpi"><span>${esc(tr('Chuỗi ngày'))}</span><strong>${esc(streak)}</strong></div>
          <div class="nos-cui-kpi"><span>${esc(tr('Thời gian'))}</span><strong>${esc(mins)}</strong></div>
        </div>`;
    }
    if (block.type === 'clock') {
      const sub = block.body || '';
      return `<div class="nos-cui-widget-head"><h3${titleAttr}>${esc(title)}</h3></div>
        <div class="nos-cui-clock-time" data-cui-clock data-i18n-skip>${formatTime(new Date())}</div>
        ${sub ? `<p class="nos-cui-clock-sub" data-i18n-skip>${esc(sub)}</p>` : ''}`;
    }
    if (block.type === 'memo') {
      const body = block.body || tr('Nhấn Sửa trong Custom UI Studio để viết ghi chú của riêng bạn.');
      const bodyAttr = block.body ? ' data-i18n-skip' : '';
      return `<div class="nos-cui-widget-head"><h3${titleAttr}>${esc(title)}</h3></div>
        <div class="nos-cui-memo-body"${bodyAttr}>${esc(body)}</div>`;
    }
    return `<div class="nos-cui-widget-head"><h3${titleAttr}>${esc(title)}</h3></div>
      <div class="nos-cui-shortcuts">
        <button type="button" data-action="add_cards">${esc(tr('Thêm thẻ'))}</button>
        <button type="button" data-action="browse">${esc(tr('Duyệt thẻ'))}</button>
        <button type="button" data-action="page" data-value="daily">${esc(tr('Lịch ôn'))}</button>
        <button type="button" data-action="page" data-value="stats">${esc(tr('Thống kê'))}</button>
        <button type="button" data-action="library">${esc(tr('Bộ thẻ'))}</button>
        <button type="button" data-action="sync">${esc(tr('Đồng bộ'))}</button>
      </div>`;
  }

  function attachBlockChrome(node, block, freeform) {
    let chip = node.querySelector(':scope > .cui-live-chip');
    if (!chip) {
      chip = document.createElement('div');
      chip.className = 'cui-live-chip';
      node.append(chip);
    }
    const isCustom = !CORE_TYPES.includes(block.type);
    const spanBtn = !freeform && block.type !== 'greeting' && block.type !== 'goal'
      ? `<button type="button" data-live-span="${esc(block.id)}" title="${esc(tr('Đổi độ rộng khối'))}">${esc(block.span === 'full' ? tr('Thu gọn') : tr('Toàn dòng'))}</button>`
      : '';
    const editBtn = isCustom || freeform
      ? `<button type="button" data-live-edit-block="${esc(block.id)}" title="${esc(tr('Chỉnh sửa khối này'))}">✎</button>`
      : '';
    chip.innerHTML = `<span class="cui-live-grip" aria-hidden="true">⋮⋮</span>${spanBtn}${editBtn}<button type="button" class="cui-close-x" data-live-close="${esc(block.id)}" aria-label="${esc(tr('Tắt phần này'))}" title="${esc(tr('Tắt phần này'))}">×</button>`;

    for (const dir of ['e', 's', 'se']) {
      let handle = node.querySelector(`:scope > .cui-resize-${dir}`);
      if (!handle) {
        handle = document.createElement('div');
        handle.className = `cui-resize-handle cui-resize-${dir}`;
        handle.dataset.cuiResize = dir;
        handle.dataset.cuiTarget = block.id;
        node.append(handle);
      } else {
        handle.dataset.cuiTarget = block.id;
      }
    }
  }

  function removeBlockChrome(node) {
    if (!node) return;
    node.querySelector(':scope > .cui-live-chip')?.remove();
    node.querySelectorAll(':scope > .cui-resize-handle').forEach(el => el.remove());
  }

  function applyNavPreset(preset) {
    if (!rail) return;
    const nav = preset?.nav;
    const isDefaultOrder = !nav || nav.order.every((k, i) => k === NAV_ITEMS[i]?.key);
    const hasHidden = !!(nav?.hidden?.length);
    const customPlacement = nav && nav.placement !== 'default';
    const customOrient = nav && nav.orientation !== 'auto';
    const isCustomNav = !!(preset && (!isDefaultOrder || hasHidden || customPlacement || customOrient));

    const previousPlacement = app.dataset.cuiNavPlacement || '';
    const nextPlacement = customPlacement ? nav.placement : '';
    if (nextPlacement) app.dataset.cuiNavPlacement = nextPlacement;
    else delete app.dataset.cuiNavPlacement;
    if (previousPlacement !== nextPlacement && app.dataset.layout === 'edges') window.NOSLayout?.changed();
    const recovery = $('cui-recovery');
    if (recovery) recovery.hidden = !nav || (nav.placement !== 'hidden' &&
      !nav.hidden.includes('home') && preset.show_topbar !== false);
    if (!preset || !isCustomNav) {
      delete app.dataset.cuiNavPlacement;
      delete app.dataset.cuiNavOrient;
      delete app.dataset.cuiNavCustom;
      app.style.removeProperty('--cui-nav-x');
      app.style.removeProperty('--cui-nav-y');
      app.querySelectorAll('[data-nav-key]').forEach(btn => {
        btn.style.removeProperty('order');
        delete btn.dataset.cuiNavHidden;
      });
    } else {
      app.dataset.cuiNavCustom = 'true';
      if (customOrient) app.dataset.cuiNavOrient = nav.orientation;
      else delete app.dataset.cuiNavOrient;
      app.style.setProperty('--cui-nav-x', `${nav.x ?? 20}px`);
      app.style.setProperty('--cui-nav-y', `${nav.y ?? 90}px`);
      const hiddenSet = new Set(nav.hidden || []);
      app.querySelectorAll('[data-nav-key]').forEach(btn => {
        const key = btn.dataset.navKey;
        const idx = nav.order.indexOf(key);
        btn.style.order = String(idx >= 0 ? idx + 2 : 20);
        if (hiddenSet.has(key)) btn.dataset.cuiNavHidden = 'true';
        else delete btn.dataset.cuiNavHidden;
      });
    }

    // Rail live edit chip
    let railChip = rail.querySelector(':scope > .cui-rail-chip');
    if (liveEditDraft && preset?.nav?.placement !== 'hidden' && desktop.matches) {
      if (!railChip) {
        railChip = document.createElement('div');
        railChip.className = 'cui-rail-chip';
        rail.append(railChip);
      }
      const isFloating = preset.nav.placement === 'floating';
      const orientNext = preset.nav.orientation === 'horizontal' ? tr('Dọc') : tr('Ngang');
      railChip.innerHTML = `<span data-cui-rail-drag="1" title="${esc(tr('Kéo để di chuyển thanh điều hướng'))}">⋮⋮</span>
        <button type="button" data-cui-rail-float="1" title="${esc(isFloating ? tr('Gắn lại cạnh') : tr('Thả nổi tự do'))}">${esc(isFloating ? tr('Gắn cạnh') : tr('Tự do'))}</button>
        ${isFloating ? `<button type="button" data-cui-rail-orient="1">${esc(orientNext)}</button>` : ''}
        <button type="button" class="cui-close-x" data-cui-rail-hide="1" title="${esc(tr('Ẩn thanh điều hướng'))}">×</button>`;
    } else if (railChip) {
      railChip.remove();
    }
  }

  function syncTopbarCloseBtn() {
    if (!topbar) return;
    const actions = topbar.querySelector('.topbar-actions');
    if (!actions) return;
    let btn = actions.querySelector('.cui-topbar-x');
    if (liveEditDraft) {
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cui-topbar-x';
        btn.textContent = '×';
        btn.title = tr('Ẩn thanh trên cùng');
        btn.setAttribute('aria-label', tr('Ẩn thanh trên cùng'));
        btn.addEventListener('click', () => {
          if (!liveEditDraft) return;
          liveEditDraft.show_topbar = false;
          applyHomePreset(liveEditDraft);
          renderRestoreChips();
        });
        actions.append(btn);
      }
    } else if (btn) {
      btn.remove();
    }
  }

  function updateStageHeight(preset) {
    if (!stage || !preset || preset.mode !== 'freeform') {
      app.style.removeProperty('--cui-stage-h');
      return;
    }
    let maxBottom = 640;
    for (const b of preset.blocks) {
      if (b.hidden) continue;
      const bottom = (b.y || 0) + (b.h || 220) + 48;
      if (bottom > maxBottom) maxBottom = bottom;
    }
    app.style.setProperty('--cui-stage-h', `${maxBottom}px`);
  }

  function applyHomePreset(preset) {
    const existingWidgets = new Map();
    homeGrid.querySelectorAll(':scope > :is(.nos-cui-widget, .nos-cui-toolbox)').forEach(el => existingWidgets.set(el.dataset.cuiBlock, el));
    const coreMap = {greeting: greetingCard, goal: goalCard, activity: activityPanel, launchpad: launchpadPanel};

    if (!preset) {
      delete app.dataset.customUi;
      delete app.dataset.cuiMode;
      delete app.dataset.cuiCanvas;
      delete app.dataset.cuiCols;
      delete app.dataset.cuiWidth;
      delete app.dataset.cuiTopbar;
      delete app.dataset.cuiGreeting;
      delete app.dataset.cuiGoal;
      delete app.dataset.cuiGreetingAlign;
      app.style.removeProperty('--cui-gap');
      app.style.removeProperty('--cui-radius');
      app.style.removeProperty('--cui-stage-h');
      for (const el of Object.values(coreMap)) {
        if (!el) continue;
        for (const prop of ['order', '--cui-x', '--cui-y', '--cui-w', '--cui-h', '--cui-z']) el.style.removeProperty(prop);
        delete el.dataset.cuiBlock;
        delete el.dataset.cuiSpan;
        delete el.dataset.cuiHidden;
        el.draggable = false;
        removeBlockChrome(el);
      }
      existingWidgets.forEach(el => el.remove());
      applyNavPreset(null);
      syncTopbarCloseBtn();
      stopClock();
      return;
    }

    normalizePreset(preset);
    if (liveEditDraft && app.dataset.layout !== preset.base) {
      app.dataset.layout = preset.base;
      window.NOSLayout?.changed();
    }
    const freeform = preset.mode === 'freeform';
    app.dataset.customUi = 'true';
    app.dataset.cuiMode = preset.mode;
    app.dataset.cuiCols = preset.columns || 'auto';
    app.dataset.cuiWidth = preset.width || 'normal';
    app.dataset.cuiTopbar = preset.show_topbar === false ? 'hidden' : 'show';
    const greetingBlock = preset.blocks.find(b => b.type === 'greeting');
    const goalBlock = preset.blocks.find(b => b.type === 'goal');
    const hideGreeting = preset.show_greeting === false || greetingBlock?.hidden === true;
    const hideGoal = preset.show_goal === false || goalBlock?.hidden === true;
    app.dataset.cuiGreeting = hideGreeting ? 'hidden' : 'show';
    app.dataset.cuiGoal = hideGoal ? 'hidden' : 'show';
    app.dataset.cuiGreetingAlign = preset.greeting_align === 'center' ? 'center' : 'default';
    app.style.setProperty('--cui-gap', `${preset.gap ?? 18}px`);
    app.style.setProperty('--cui-radius', `${preset.radius ?? 22}px`);
    if (workspace?.clientWidth) {
      app.dataset.cuiCanvas = workspace.clientWidth >= 860 ? 'roomy' : 'compact';
    }

    const keepWidgetIds = new Set();
    const editing = !!liveEditDraft;

    preset.blocks.forEach((block, index) => {
      let node = coreMap[block.type] || null;
      if (!node) {
        keepWidgetIds.add(block.id);
        node = existingWidgets.get(block.id);
        const cls = block.type === 'toolbox' ? 'nos-cui-toolbox glass panel' : 'nos-cui-widget glass panel';
        if (!node) {
          node = document.createElement('section');
          node.className = cls;
          homeGrid.append(node);
        } else if (node.className !== cls) {
          node.className = cls;
        }
        if (block.type === 'toolbox') node.dataset.toolboxStyle = block.style || 'dock';
        else delete node.dataset.toolboxStyle;
        const stats = block.type === 'quick_stats' ? lastSnapshot?.stats : null;
        const signature = JSON.stringify([block.type, block.title, block.body, block.tools,
          window.NOSI18n?.language(), stats, stats && lastSnapshot?.partial]);
        if (widgetContent.get(node) !== signature) {
          node.innerHTML = renderWidgetContent(block);
          widgetContent.set(node, signature);
        }
      }
      if (!node) return;
      node.dataset.cuiBlock = block.id;
      node.dataset.cuiSpan = block.span || 'auto';
      const isHidden = block.hidden || (block.type === 'greeting' && hideGreeting) || (block.type === 'goal' && hideGoal);
      node.dataset.cuiHidden = isHidden ? 'true' : 'false';
      node.style.order = String(index + 1);
      if (freeform) {
        node.style.setProperty('--cui-x', `${block.x ?? 0}px`);
        node.style.setProperty('--cui-y', `${block.y ?? 0}px`);
        node.style.setProperty('--cui-w', block.w ? `${block.w}px` : 'auto');
        node.style.setProperty('--cui-h', block.h ? `${block.h}px` : 'auto');
        node.style.setProperty('--cui-z', String(block.z || 2));
        node.draggable = false;
      } else {
        for (const prop of ['--cui-x', '--cui-y', '--cui-w', '--cui-h', '--cui-z']) node.style.removeProperty(prop);
        node.draggable = editing && block.type !== 'greeting' && block.type !== 'goal';
      }
      if (editing) attachBlockChrome(node, block, freeform && canArrangeCanvas());
      else removeBlockChrome(node);
    });
    existingWidgets.forEach((el, id) => { if (!keepWidgetIds.has(id)) el.remove(); });
    updateStageHeight(preset);
    applyNavPreset(preset);
    syncTopbarCloseBtn();
    ensureClock();
  }

  function renderRestoreChips() {
    const group = $('cui-restore-group');
    const chips = $('cui-restore-chips');
    if (!group || !chips || !liveEditDraft) return;
    const hiddenItems = [];
    for (const block of liveEditDraft.blocks) {
      const isHidden = block.hidden || (block.type === 'greeting' && liveEditDraft.show_greeting === false) ||
        (block.type === 'goal' && liveEditDraft.show_goal === false);
      if (isHidden) hiddenItems.push({key: `block:${block.id}`, label: block.title || tr(BLOCK_META[block.type].name), userText: !!block.title});
    }
    if (liveEditDraft.nav?.placement === 'hidden') hiddenItems.push({key: 'nav', label: tr('Thanh điều hướng (Sidebar)')});
    if (liveEditDraft.show_topbar === false) hiddenItems.push({key: 'topbar', label: tr('Thanh trên cùng')});
    group.hidden = !hiddenItems.length;
    chips.innerHTML = hiddenItems.map(item => `<button type="button" class="subtle-button" data-cui-restore="${esc(item.key)}"${item.userText ? ' data-i18n-skip' : ''}>+ ${esc(item.label)}</button>`).join('');
  }

  function syncLiveBarUI() {
    if (!liveEditDraft) return;
    if ($('cui-live-mode-btn')) {
      $('cui-live-mode-btn').textContent = liveEditDraft.mode === 'freeform' ? tr('Chế độ: Tự do') : tr('Chế độ: Lưới');
    }
    if ($('cui-live-snap-btn')) {
      const canSnap = liveEditDraft.mode === 'freeform' && canArrangeCanvas();
      $('cui-live-snap-btn').hidden = !canSnap;
      $('cui-live-snap-btn').setAttribute('aria-pressed', String(liveEditDraft.snap !== false));
    }
    $('cui-live-hint').textContent = liveEditDraft.mode !== 'freeform' ? 'Kéo khối để đổi thứ tự.' :
      canArrangeCanvas() ? 'Kéo tay nắm để di chuyển, kéo mép để đổi kích thước.' :
        'Trên màn hình hẹp, các khối xếp dọc. Mở Bảng chi tiết để chỉnh vị trí tự do.';
    liveBar.querySelectorAll('[data-cui-live-add]').forEach(button => {
      button.disabled = liveEditDraft.blocks.length >= MAX_BLOCKS;
    });
    renderRestoreChips();
  }

  function renderExternalSwitchers(settings = lastSettings) {
    const presets = getPresetsFrom(settings);
    const activeId = settings?.custom_ui_active || '';
    const signature = JSON.stringify([activeId, window.NOSI18n?.language(), presets.map(p => [p.id, p.name, p.base])]);
    if (switcherSignature === signature) return;
    switcherSignature = signature;
    const appearanceBox = $('cui-appearance-presets');
    if (appearanceBox) {
      if (!presets.length) {
        appearanceBox.innerHTML = `<p class="cui-empty-hint">${esc(tr('Chưa có bản giao diện tùy chỉnh nào. Nhấn nút bên dưới để tạo từ 6 bố cục có sẵn.'))}</p>`;
      } else {
        appearanceBox.innerHTML = presets.map(p => `<button type="button" class="cui-preset-chip${p.id === activeId ? ' active' : ''}" data-cui-activate="${esc(p.id)}"><span data-i18n-skip>${esc(p.name)}</span><small>${esc(tr(BASE_NAMES[p.base] || p.base))}</small></button>`).join('');
      }
    }
    const layoutMenu = $('layout-menu');
    if (layoutMenu) {
      let section = layoutMenu.querySelector('.nos-layout-custom-section');
      if (!section) {
        section = document.createElement('div');
        section.className = 'nos-layout-custom-section';
        layoutMenu.append(section);
      }
      const listHtml = presets.length
        ? `<div class="nos-layout-custom-list">${presets.map(p => `<button type="button" class="nos-layout-option" role="menuitemradio" aria-checked="${String(p.id === activeId)}" data-cui-activate="${esc(p.id)}"><span class="nos-lthumb" data-l="${esc(p.base)}" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></span><span><strong data-i18n-skip>${esc(p.name)}</strong><small>${esc(tr('Bản tùy chỉnh'))} · ${esc(tr(BASE_NAMES[p.base] || p.base))}</small></span><span class="nos-layout-check" aria-hidden="true"></span></button>`).join('')}</div>`
        : '';
      section.innerHTML = `<div class="nos-layout-custom-head"><span>${esc(tr('Bản giao diện của bạn'))}</span><button type="button" class="nos-layout-custom-btn" data-action="open_custom_ui">${esc(tr('Tùy biến…'))}</button></div>${listHtml}`;
    }
  }

  function currentDraft() {
    return editorPresets.find(p => p.id === selectedId) || editorPresets[0] || null;
  }

  function switchStudioTab(tab = 'layout') {
    activeStudioTab = STUDIO_TABS.includes(tab) ? tab : 'layout';
    dialog.querySelectorAll('[data-cui-tab]').forEach(btn => {
      const active = btn.dataset.cuiTab === activeStudioTab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
    });
    dialog.querySelectorAll('.cui-tab-pane').forEach(pane => {
      pane.hidden = pane.id !== `cuipane-${activeStudioTab}`;
    });
  }

  function renderGeometryEditor(block) {
    return `<div class="cui-geometry">${Object.entries(GEOMETRY).map(([key, options]) =>
      `<label class="cui-field"><span>${esc(tr(options.label))}</span>
        <input type="number" class="nos-text-input" inputmode="numeric" min="${options.min}" max="${options.max}"
          data-cui-geometry="${key}" data-cui-geometry-block="${esc(block.id)}"
          value="${options.auto && !block[key] ? '' : block[key] ?? ''}"
          ${options.auto ? `placeholder="${esc(tr('Tự động'))}"` : ''}>
      </label>`).join('')}</div>`;
  }

  function renderToolboxEditorInner(block) {
    const picked = Array.isArray(block.tools) ? block.tools : [];
    const pickedSet = new Set(picked);
    const styleOptions = Object.entries(TOOLBOX_STYLE_LABELS)
      .map(([k, label]) => `<option value="${k}"${block.style === k ? ' selected' : ''}>${esc(tr(label))}</option>`).join('');
    const pickerChips = Object.entries(TOOL_CATALOG)
      .map(([k, meta]) => `<button type="button" class="cui-tool-chip${pickedSet.has(k) ? ' is-picked' : ''}" data-cui-tb-toggle="${esc(block.id)}" data-tool="${esc(k)}">${esc(tr(meta.label))}</button>`).join('');
    const orderItems = picked.map((k, i) => {
      const meta = TOOL_CATALOG[k];
      if (!meta) return '';
      return `<span class="cui-tool-order-item"><span>${esc(tr(meta.label))}</span>
        <button type="button" data-cui-tb-move="${esc(block.id)}" data-tool="${esc(k)}" data-dir="-1" ${i === 0 ? 'disabled' : ''}>←</button>
        <button type="button" data-cui-tb-move="${esc(block.id)}" data-tool="${esc(k)}" data-dir="1" ${i === picked.length - 1 ? 'disabled' : ''}>→</button>
      </span>`;
    }).join('');
    return `<div class="cui-row-grid">
        <label class="cui-field"><span>${esc(tr('Tên hộp công cụ (để trống nếu chỉ hiện nút)'))}</span>
          <input type="text" class="nos-text-input" maxlength="60" data-cui-field-title="${esc(block.id)}" value="${esc(block.title || '')}" placeholder="${esc(tr('Hộp công cụ'))}">
        </label>
        <label class="cui-field"><span>${esc(tr('Kiểu khay chứa'))}</span>
          <select class="nos-select" data-cui-tb-style="${esc(block.id)}">${styleOptions}</select>
        </label>
      </div>
      <div class="cui-field"><span>${esc(tr('Chọn các công cụ bên trong'))}</span>
        <div class="cui-tool-picker">${pickerChips}</div>
      </div>
      <div class="cui-field"><span>${esc(tr('Thứ tự nút trong hộp'))}</span>
        <div class="cui-tool-order">${orderItems}</div>
      </div>`;
  }

  function renderStudio() {
    const presetList = $('cui-preset-list');
    const activeId = lastSettings?.custom_ui_active || '';
    if (presetList) {
      presetList.innerHTML = editorPresets.map(p => {
        const sel = p.id === selectedId ? ' is-selected' : '';
        const act = p.id === activeId ? ' is-active' : '';
        return `<button type="button" class="cui-preset-item${sel}${act}" data-cui-select="${esc(p.id)}"><strong data-i18n-skip>${esc(p.name)}</strong><small>${esc(tr(BASE_NAMES[p.base] || p.base))} · ${p.blocks.length} ${esc(tr('khối'))}</small></button>`;
      }).join('');
    }
    const p = currentDraft();
    if (!p) return;
    normalizePreset(p);
    selectedId = p.id;
    if ($('cui-name') && document.activeElement !== $('cui-name')) $('cui-name').value = p.name;
    if ($('cui-base')) $('cui-base').value = p.base;
    if ($('cui-mode')) $('cui-mode').value = p.mode;
    const freeform = p.mode === 'freeform';
    $('cui-columns').value = p.columns;
    $('cui-columns').disabled = freeform;
    $('cui-snap').disabled = !freeform;
    $('cui-reset-positions').hidden = !freeform;
    $('cui-geometry-help').hidden = !freeform;
    if ($('cui-width')) $('cui-width').value = p.width;
    if ($('cui-greeting-align')) $('cui-greeting-align').value = p.greeting_align;
    if ($('cui-gap')) $('cui-gap').value = p.gap;
    if ($('cui-gap-val')) $('cui-gap-val').textContent = `${p.gap} px`;
    if ($('cui-radius')) $('cui-radius').value = p.radius;
    if ($('cui-radius-val')) $('cui-radius-val').textContent = `${p.radius} px`;
    if ($('cui-snap')) $('cui-snap').checked = p.snap !== false;
    if ($('cui-show-topbar')) $('cui-show-topbar').checked = p.show_topbar !== false;
    const greetingBlock = p.blocks.find(b => b.type === 'greeting');
    const goalBlock = p.blocks.find(b => b.type === 'goal');
    if ($('cui-show-greeting')) $('cui-show-greeting').checked = p.show_greeting !== false && !greetingBlock?.hidden;
    if ($('cui-show-goal')) $('cui-show-goal').checked = p.show_goal !== false && !goalBlock?.hidden;
    if ($('cui-nav-placement')) $('cui-nav-placement').value = p.nav.placement;
    if ($('cui-nav-orientation')) $('cui-nav-orientation').value = p.nav.orientation;
    if ($('cui-delete')) $('cui-delete').disabled = editorPresets.length <= 1 && !getPresetsFrom().length;
    if ($('cui-new-preset')) $('cui-new-preset').disabled = editorPresets.length >= MAX_PRESETS;
    $('cui-duplicate').disabled = editorPresets.length >= MAX_PRESETS;
    dialog.querySelectorAll('[data-cui-add], [data-cui-add-toolbox]').forEach(button => {
      button.disabled = p.blocks.length >= MAX_BLOCKS;
    });

    // 1. Blocks list
    const blocksList = $('cui-blocks-list');
    if (activeStudioTab === 'blocks' && blocksList) {
      blocksList.innerHTML = p.blocks.map((block, index) => {
        const meta = BLOCK_META[block.type] || {name: block.type, desc: ''};
        const isCore = CORE_TYPES.includes(block.type);
        const title = block.title || tr(meta.name);
        const titleAttr = block.title ? ' data-i18n-skip' : '';
        const spanLabel = block.span === 'full' ? tr('Toàn dòng') : block.span === 'half' ? tr('Nửa dòng') : tr('Tự động');
        const editable = freeform || !isCore;
        const editingThis = editable && expandedEditBlockId === block.id;
        return `<div class="cui-block-row${block.hidden ? ' is-hidden-block' : ''}" draggable="true" data-cui-row="${esc(block.id)}">
          <div class="cui-block-main">
            <span class="cui-drag-handle" title="${esc(tr('Kéo để sắp xếp'))}" aria-hidden="true">⋮⋮</span>
            <div class="cui-block-label">
              <strong${titleAttr}>${esc(title)}</strong>
              <small>${esc(tr(meta.desc))}</small>
            </div>
            <div class="cui-block-actions">
              <button type="button" class="cui-mini-btn" data-cui-move="${esc(block.id)}" data-dir="-1" ${index === 0 ? 'disabled' : ''} aria-label="${esc(tr('Đưa lên'))}">↑</button>
              <button type="button" class="cui-mini-btn" data-cui-move="${esc(block.id)}" data-dir="1" ${index === p.blocks.length - 1 ? 'disabled' : ''} aria-label="${esc(tr('Đưa xuống'))}">↓</button>
              ${p.mode === 'grid' && block.type !== 'greeting' && block.type !== 'goal' ? `<button type="button" class="cui-mini-btn${block.span === 'full' ? ' is-on' : ''}" data-cui-span-cycle="${esc(block.id)}">${esc(spanLabel)}</button>` : ''}
              <button type="button" class="cui-mini-btn${!block.hidden ? ' is-on' : ''}" data-cui-toggle-hide="${esc(block.id)}">${esc(block.hidden ? tr('Đang ẩn') : tr('Đang hiện'))}</button>
              ${editable ? `<button type="button" class="cui-mini-btn${editingThis ? ' is-on' : ''}" data-cui-edit-block="${esc(block.id)}" aria-expanded="${editingThis}">${esc(tr('Sửa'))}</button>` : ''}
              ${!isCore ? `<button type="button" class="cui-mini-btn is-danger" data-cui-remove-block="${esc(block.id)}" title="${esc(tr('Xóa khối này'))}">×</button>` : ''}
            </div>
          </div>
          ${editingThis ? `<div class="cui-block-edit">
            ${freeform ? renderGeometryEditor(block) : ''}
            ${isCore ? '' : block.type === 'toolbox' ? renderToolboxEditorInner(block) : `
              <label class="cui-field"><span>${esc(tr('Tiêu đề khối'))}</span>
                <input type="text" class="nos-text-input" maxlength="60" data-cui-field-title="${esc(block.id)}" value="${esc(block.title || '')}" placeholder="${esc(tr(meta.name))}">
              </label>
              ${(block.type === 'memo' || block.type === 'clock') ? `<label class="cui-field"><span>${esc(tr('Nội dung hiển thị'))}</span>
                <textarea class="cui-textarea" maxlength="320" data-cui-field-body="${esc(block.id)}" placeholder="${esc(tr('Nhập nội dung hoặc câu nhắc học tập…'))}">${esc(block.body || '')}</textarea>
              </label>` : ''}`}
          </div>` : ''}
        </div>`;
      }).join('');
    }

    // 2. Nav items order & visibility list
    const navList = $('cui-nav-list');
    if (activeStudioTab === 'nav' && navList) {
      const hiddenSet = new Set(p.nav.hidden || []);
      navList.innerHTML = p.nav.order.map((key, idx) => {
        const meta = NAV_ITEMS.find(i => i.key === key);
        if (!meta) return '';
        const isHidden = hiddenSet.has(key);
        return `<div class="cui-block-row${isHidden ? ' is-hidden-block' : ''}" draggable="true" data-cui-nav-row="${esc(key)}">
          <div class="cui-block-main">
            <span class="cui-drag-handle" aria-hidden="true">⋮⋮</span>
            <div class="cui-block-label"><strong>${esc(tr(meta.label))}</strong></div>
            <div class="cui-block-actions">
              <button type="button" class="cui-mini-btn" data-cui-nav-move="${esc(key)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''}>↑</button>
              <button type="button" class="cui-mini-btn" data-cui-nav-move="${esc(key)}" data-dir="1" ${idx === p.nav.order.length - 1 ? 'disabled' : ''}>↓</button>
              <button type="button" class="cui-mini-btn${!isHidden ? ' is-on' : ''}" data-cui-nav-toggle="${esc(key)}">${esc(isHidden ? tr('Đang ẩn') : tr('Đang hiện'))}</button>
            </div>
          </div>
        </div>`;
      }).join('');
    }

    // 3. Dedicated Toolboxes tab
    const tbList = $('cui-toolboxes-list');
    if (activeStudioTab === 'toolboxes' && tbList) {
      const toolboxes = p.blocks.filter(b => b.type === 'toolbox');
      if (!toolboxes.length) {
        tbList.innerHTML = `<p class="cui-empty-hint">${esc(tr('Chưa có hộp công cụ riêng nào. Nhấn một trong 4 kiểu ở trên để tạo khay chứa công cụ và kéo đặt bất cứ đâu.'))}</p>`;
      } else {
        tbList.innerHTML = toolboxes.map(block => `<div class="cui-block-row">
          <div class="cui-block-main">
            <div class="cui-block-label">
              <strong data-i18n-skip>${esc(block.title || tr('Hộp công cụ'))}</strong>
              <small>${esc(tr(TOOLBOX_STYLE_LABELS[block.style] || block.style))} · ${(block.tools || []).length} ${esc(tr('công cụ'))}</small>
            </div>
            <button type="button" class="cui-mini-btn" data-cui-edit-toolbox="${esc(block.id)}"
              aria-expanded="${expandedEditBlockId === block.id}">${esc(tr('Sửa'))}</button>
          </div>
          ${expandedEditBlockId === block.id ? `<div class="cui-block-edit">${renderToolboxEditorInner(block)}</div>` : ''}
        </div>`).join('');
      }
    }
  }

  function reorderList(arr, fromKey, toKey, getKey) {
    const fromIdx = arr.findIndex(item => getKey(item) === fromKey);
    const toIdx = arr.findIndex(item => getKey(item) === toKey);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return false;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    return true;
  }

  function commitPresets(presets, activeId, baseLayout) {
    const patch = {custom_ui_presets: clone(presets), custom_ui_active: activeId || ''};
    if (baseLayout && BASE_NAMES[baseLayout]) patch.layout = baseLayout;
    window.AnkiNOS?.saveUI?.(patch);
  }

  function open(presetId = '', initialTab = 'layout', editBlockId = '', drafts = null) {
    if (liveEditDraft) return openFromLive(initialTab, editBlockId);
    if (dialog.open && !drafts) return;
    const existing = clone(getPresetsFrom());
    if (!existing.length) {
      const base = BASE_NAMES[lastSettings?.layout] ? lastSettings.layout : 'aurora';
      existing.push(defaultPreset(base, `${tr('Bản tùy chỉnh')} 1`));
    }
    editorPresets = drafts || existing.map(normalizePreset);
    selectedId = (presetId && editorPresets.some(p => p.id === presetId))
      ? presetId
      : (lastSettings?.custom_ui_active && editorPresets.some(p => p.id === lastSettings.custom_ui_active)
        ? lastSettings.custom_ui_active
        : editorPresets[0].id);
    expandedEditBlockId = editBlockId || '';
    switchStudioTab(initialTab);
    renderStudio();
    if (!dialog.open) {
      if (!drafts) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('layout-toggle');
      dialog.showModal();
    }
    $('cui-close')?.focus({preventScroll: true});
    if (editBlockId) {
      const row = $('cui-blocks-list')?.querySelector(`[data-cui-row="${CSS.escape(editBlockId)}"]`);
      row?.querySelector('[data-cui-edit-block]')?.focus();
    }
  }

  function close(restoreFocus = true) {
    if (!dialog.open) return;
    dialog.close();
    if (restoreFocus) focusReturnTarget();
  }

  function focusReturnTarget() {
    [returnFocus, $('cui-recovery')?.querySelector('[data-action="open_custom_ui"]'), $('layout-toggle'), $('appearance-toggle')]
      .find(node => node?.getClientRects().length)?.focus({preventScroll: true});
  }

  function openFromLive(tab = 'blocks', blockId = '') {
    if (!liveEditDraft) return;
    const {id} = liveEditDraft;
    const drafts = liveEditPresets;
    finishLiveEdit(false, false);
    open(id, tab, blockId, drafts);
  }

  function startLiveEdit(fromStudio = false) {
    if (liveEditDraft) return;
    const existing = fromStudio ? editorPresets : clone(getPresetsFrom());
    let draft = fromStudio ? currentDraft() : existing.find(p => p.id === lastSettings?.custom_ui_active);
    if (!draft) {
      if (existing.length >= MAX_PRESETS) return open();
      const base = BASE_NAMES[lastSettings?.layout] ? lastSettings.layout : 'aurora';
      draft = defaultPreset(base, `${tr('Bản tùy chỉnh')} ${existing.length + 1}`);
      existing.push(draft);
    }
    normalizePreset(draft);
    if (!fromStudio) returnFocus = document.activeElement;
    previousLayout = lastSettings?.layout || 'aurora';
    liveEditPresets = existing;
    liveEditDraft = draft;
    close(false);
    app.classList.add('nos-ui-editing');
    if (liveBar) liveBar.hidden = false;
    if ($('cui-add-popover')) $('cui-add-popover').hidden = true;
    $('cui-live-add-toggle')?.setAttribute('aria-expanded', 'false');
    applyHomePreset(liveEditDraft);
    syncLiveBarUI();
    $('cui-live-mode-btn')?.focus({preventScroll: true});
  }

  function finishLiveEdit(save, restoreFocus = true) {
    if (!liveEditDraft) return;
    const draft = liveEditDraft;
    const drafts = liveEditPresets;
    endPointerOp();
    liveEditDraft = null;
    liveEditPresets = [];
    app.classList.remove('nos-ui-editing');
    if (liveBar) liveBar.hidden = true;
    if ($('cui-add-popover')) $('cui-add-popover').hidden = true;
    if (save) {
      commitPresets(drafts, draft.id, draft.base);
      window.AnkiNOS?.toast?.(`Đã lưu bản giao diện: ${draft.name}`);
    } else {
      if (app.dataset.layout !== previousLayout) {
        app.dataset.layout = previousLayout;
        window.NOSLayout?.changed();
      }
      applyHomePreset(getActivePreset(lastSettings));
    }
    if (restoreFocus) focusReturnTarget();
  }

  function activatePreset(id) {
    const preset = getPresetsFrom().find(p => p.id === id);
    if (!preset) return;
    commitPresets(getPresetsFrom(), preset.id, preset.base);
    window.AnkiNOS?.toast?.(`Đang dùng giao diện: ${preset.name}`);
  }

  function deactivate() {
    commitPresets(getPresetsFrom(), '', lastSettings?.layout);
    close();
    window.AnkiNOS?.toast?.('Đã quay về bố cục mặc định');
  }

  function showSizeBadge(x, y, text) {
    if (!sizeBadge) {
      sizeBadge = document.createElement('div');
      sizeBadge.className = 'cui-size-badge';
      app.append(sizeBadge);
    }
    sizeBadge.textContent = text;
    sizeBadge.style.left = `${Math.min(innerWidth - 110, x + 14)}px`;
    sizeBadge.style.top = `${Math.max(8, y - 28)}px`;
    sizeBadge.hidden = false;
  }

  function hideSizeBadge() {
    if (sizeBadge) sizeBadge.hidden = true;
  }

  // ── Live Freeform Pointer Drag & Resize Engine ────────────────────────────
  let activePointerOp = null;

  function floatRail() {
    const rect = rail.getBoundingClientRect();
    const zoom = Number(app.style.zoom) || 1;
    liveEditDraft.nav.placement = 'floating';
    liveEditDraft.nav.x = Math.max(0, Math.round(rect.left / zoom));
    liveEditDraft.nav.y = Math.max(0, Math.round(rect.top / zoom));
    applyNavPreset(liveEditDraft);
  }

  app.addEventListener('pointerdown', e => {
    if (!liveEditDraft || !desktop.matches || activePointerOp || e.button !== 0) return;

    // 1. Floating Rail drag
    const railHandle = e.target.closest('[data-cui-rail-drag]');
    if (railHandle && rail) {
      e.preventDefault();
      if (liveEditDraft.nav.placement !== 'floating') floatRail();
      activePointerOp = {
        kind: 'rail',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: rail.offsetLeft,
        origY: rail.offsetTop,
        width: rail.offsetWidth,
        height: rail.offsetHeight,
      };
      rail.setPointerCapture?.(e.pointerId);
      return;
    }

    if (liveEditDraft.mode !== 'freeform' || !canArrangeCanvas()) return;

    // 2. Block resize handle (e | s | se)
    const resizeHandle = e.target.closest('[data-cui-resize]');
    if (resizeHandle) {
      const id = resizeHandle.dataset.cuiTarget;
      const block = liveEditDraft.blocks.find(b => b.id === id);
      const node = app.querySelector(`[data-cui-block="${CSS.escape(id)}"]`);
      if (!block || !node) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = node.getBoundingClientRect();
      const zoom = Number(app.style.zoom) || 1;
      activePointerOp = {
        kind: 'resize',
        dir: resizeHandle.dataset.cuiResize,
        block,
        node,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origW: Math.round(rect.width / zoom),
        origH: Math.round(rect.height / zoom),
      };
      node.classList.add('is-dragging');
      resizeHandle.setPointerCapture?.(e.pointerId);
      return;
    }

    // 3. Freeform block drag (grab anywhere on block or chip except buttons/inputs)
    const blockEl = e.target.closest('[data-cui-block]');
    if (blockEl && (!e.target.closest('button,input,select,textarea,summary') || e.target.closest('.cui-live-grip')) &&
      (e.pointerType === 'mouse' || e.target.closest('.cui-live-grip'))) {
      const id = blockEl.dataset.cuiBlock;
      const block = liveEditDraft.blocks.find(b => b.id === id);
      if (!block) return;
      e.preventDefault();
      activePointerOp = {
        kind: 'move',
        block,
        node: blockEl,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: blockEl.offsetLeft,
        origY: blockEl.offsetTop,
        maxX: Math.max(0, stage.clientWidth - 140),
      };
      blockEl.classList.add('is-dragging');
      blockEl.setPointerCapture?.(e.pointerId);
    }
  });

  app.addEventListener('pointermove', e => {
    if (!activePointerOp || e.pointerId !== activePointerOp.pointerId || !liveEditDraft) return;
    const zoom = Number(app.style.zoom) || 1;
    const dx = (e.clientX - activePointerOp.startX) / zoom;
    const dy = (e.clientY - activePointerOp.startY) / zoom;
    const snap = liveEditDraft.snap !== false && !e.altKey ? 12 : 1;
    const snapVal = v => Math.round(v / snap) * snap;

    if (activePointerOp.kind === 'rail') {
      const maxX = Math.max(0, Math.floor(innerWidth / zoom - activePointerOp.width));
      const maxY = Math.max(0, Math.floor(innerHeight / zoom - activePointerOp.height));
      liveEditDraft.nav.x = Math.min(maxX, Math.max(0, snapVal(activePointerOp.origX + dx)));
      liveEditDraft.nav.y = Math.min(maxY, Math.max(0, snapVal(activePointerOp.origY + dy)));
      app.style.setProperty('--cui-nav-x', `${liveEditDraft.nav.x}px`);
      app.style.setProperty('--cui-nav-y', `${liveEditDraft.nav.y}px`);
      showSizeBadge(e.clientX, e.clientY, `${liveEditDraft.nav.x}, ${liveEditDraft.nav.y}`);
      return;
    }

    const {block, node} = activePointerOp;
    if (activePointerOp.kind === 'move') {
      block.x = Math.max(0, Math.min(activePointerOp.maxX, snapVal(activePointerOp.origX + dx)));
      block.y = Math.max(0, Math.min(2400, snapVal(activePointerOp.origY + dy)));
      node.style.setProperty('--cui-x', `${block.x}px`);
      node.style.setProperty('--cui-y', `${block.y}px`);
      updateStageHeight(liveEditDraft);
      showSizeBadge(e.clientX, e.clientY, `x:${block.x} y:${block.y}`);
      return;
    }

    if (activePointerOp.kind === 'resize') {
      if (activePointerOp.dir === 'e' || activePointerOp.dir === 'se') {
        block.w = Math.max(140, Math.min(1600, snapVal(activePointerOp.origW + dx)));
        node.style.setProperty('--cui-w', `${block.w}px`);
      }
      if (activePointerOp.dir === 's' || activePointerOp.dir === 'se') {
        block.h = Math.max(56, Math.min(1200, snapVal(activePointerOp.origH + dy)));
        node.style.setProperty('--cui-h', `${block.h}px`);
      }
      updateStageHeight(liveEditDraft);
      showSizeBadge(e.clientX, e.clientY, `${block.w || 'auto'} × ${block.h || 'auto'} px`);
    }
  });

  function endPointerOp(event) {
    if (!activePointerOp || (event && event.pointerId !== activePointerOp.pointerId)) return;
    activePointerOp.node?.classList.remove('is-dragging');
    activePointerOp = null;
    hideSizeBadge();
  }
  addEventListener('pointerup', endPointerOp);
  addEventListener('pointercancel', endPointerOp);
  app.addEventListener('lostpointercapture', endPointerOp);
  desktop.addEventListener('change', () => {
    endPointerOp();
    if (liveEditDraft) {
      applyHomePreset(liveEditDraft);
      syncLiveBarUI();
    }
  });

  // ── Live Toolbar & Canvas Control Actions ─────────────────────────────────
  $('cui-live-mode-btn')?.addEventListener('click', () => {
    if (!liveEditDraft) return;
    liveEditDraft.mode = liveEditDraft.mode === 'freeform' ? 'grid' : 'freeform';
    applyHomePreset(liveEditDraft);
    syncLiveBarUI();
  });

  $('cui-live-snap-btn')?.addEventListener('click', () => {
    if (!liveEditDraft) return;
    liveEditDraft.snap = !(liveEditDraft.snap !== false);
    syncLiveBarUI();
  });

  $('cui-live-add-toggle')?.addEventListener('click', () => {
    const pop = $('cui-add-popover');
    if (!pop) return;
    const show = pop.hidden;
    pop.hidden = !show;
    $('cui-live-add-toggle')?.setAttribute('aria-expanded', String(show));
    if (show) renderRestoreChips();
  });

  $('cui-live-nav-btn')?.addEventListener('click', () => openFromLive('nav'));

  liveBar?.addEventListener('click', e => {
    if (!liveEditDraft) return;
    const addBtn = e.target.closest('[data-cui-live-add]');
    if (addBtn) {
      const [type, style] = addBtn.dataset.cuiLiveAdd.split(':');
      const widget = appendWidget(liveEditDraft, type, style);
      if (!widget) return;
      applyHomePreset(liveEditDraft);
      syncLiveBarUI();
      if ($('cui-add-popover')) $('cui-add-popover').hidden = true;
      $('cui-live-add-toggle')?.setAttribute('aria-expanded', 'false');
      return;
    }
    const restoreBtn = e.target.closest('[data-cui-restore]');
    if (restoreBtn) {
      const key = restoreBtn.dataset.cuiRestore;
      if (key === 'nav') {
        liveEditDraft.nav.placement = 'default';
      } else if (key === 'topbar') {
        liveEditDraft.show_topbar = true;
      } else if (key.startsWith('block:')) {
        const b = liveEditDraft.blocks.find(x => x.id === key.slice(6));
        if (b) b.hidden = false;
        if (b?.type === 'greeting') liveEditDraft.show_greeting = true;
        if (b?.type === 'goal') liveEditDraft.show_goal = true;
      }
      applyHomePreset(liveEditDraft);
      renderRestoreChips();
    }
  });

  // Canvas controls stay available while the dashboard actions are paused.
  app.addEventListener('click', event => {
    if (!liveEditDraft || event.target.closest('.cui-live-chip')) return;
    const control = event.target.closest('[data-action], [data-tool-cmd]');
    if (!control?.closest('[data-cui-block]')) return;
    event.preventDefault();
    event.stopPropagation();
  }, {capture: true});

  // Live clicks on canvas blocks, rail chips, and tool container buttons
  app.addEventListener('click', e => {
    // 1. Real tool commands inside custom Tool Containers (when NOT editing)
    if (!liveEditDraft) {
      const toolCmdBtn = e.target.closest('[data-tool-cmd]');
      if (toolCmdBtn) {
        const cmd = toolCmdBtn.dataset.toolCmd;
        if (cmd === 'notebook') $('study-notebook')?.click();
        else if (cmd === 'commands') document.dispatchEvent(new KeyboardEvent('keydown', {key: 'k', ctrlKey: true, bubbles: true}));
        return;
      }
    }

    // 2. Rail live controls
    if (liveEditDraft) {
      if (e.target.closest('[data-cui-rail-float]')) {
        if (liveEditDraft.nav.placement === 'floating') {
          liveEditDraft.nav.placement = 'default';
          liveEditDraft.nav.orientation = 'auto';
          applyNavPreset(liveEditDraft);
        } else floatRail();
        return;
      }
      if (e.target.closest('[data-cui-rail-orient]')) {
        liveEditDraft.nav.orientation = liveEditDraft.nav.orientation === 'horizontal' ? 'vertical' : 'horizontal';
        applyNavPreset(liveEditDraft);
        return;
      }
      if (e.target.closest('[data-cui-rail-hide]')) {
        liveEditDraft.nav.placement = 'hidden';
        applyNavPreset(liveEditDraft);
        renderRestoreChips();
        return;
      }

      // 3. Block corner controls (span / edit / × close)
      const spanBtn = e.target.closest('[data-live-span]');
      if (spanBtn) {
        const b = liveEditDraft.blocks.find(x => x.id === spanBtn.dataset.liveSpan);
        if (b) { b.span = b.span === 'full' ? 'auto' : 'full'; applyHomePreset(liveEditDraft); }
        return;
      }
      const editBtn = e.target.closest('[data-live-edit-block]');
      if (editBtn) return openFromLive('blocks', editBtn.dataset.liveEditBlock);
      const closeBtn = e.target.closest('[data-live-close]');
      if (closeBtn) {
        const id = closeBtn.dataset.liveClose;
        const b = liveEditDraft.blocks.find(x => x.id === id);
        if (!b) return;
        b.hidden = true;
        if (b.type === 'greeting') liveEditDraft.show_greeting = false;
        if (b.type === 'goal') liveEditDraft.show_goal = false;
        applyHomePreset(liveEditDraft);
        renderRestoreChips();
        return;
      }
    }

    // 4. Custom preset activation chips (in Appearance & Layout Menu)
    const chip = e.target.closest('[data-cui-activate]');
    if (chip) {
      activatePreset(chip.dataset.cuiActivate);
      if (!$('layout-menu').hidden) {
        $('layout-menu').hidden = true;
        $('layout-toggle')?.setAttribute('aria-expanded', 'false');
      }
    }
  });

  // Grid-mode HTML5 drag-drop reorder on Home
  homeGrid.addEventListener('dragstart', e => {
    if (!liveEditDraft || liveEditDraft.mode === 'freeform') return;
    const block = e.target.closest('[data-cui-block]');
    if (!block || e.target.closest('button,input,select,textarea')) { e.preventDefault(); return; }
    dragListId = block.dataset.cuiBlock;
    block.classList.add('is-dragging');
    e.dataTransfer?.setData('text/plain', dragListId);
  });
  homeGrid.addEventListener('dragover', e => {
    if (!liveEditDraft || liveEditDraft.mode === 'freeform' || !dragListId) return;
    const block = e.target.closest('[data-cui-block]');
    if (!block || block.dataset.cuiBlock === dragListId) return;
    e.preventDefault();
    homeGrid.querySelectorAll('.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
    block.classList.add('is-drag-over');
  });
  homeGrid.addEventListener('drop', e => {
    if (!liveEditDraft || liveEditDraft.mode === 'freeform' || !dragListId) return;
    const block = e.target.closest('[data-cui-block]');
    if (!block) return;
    e.preventDefault();
    if (reorderList(liveEditDraft.blocks, dragListId, block.dataset.cuiBlock, b => b.id)) applyHomePreset(liveEditDraft);
    dragListId = '';
  });
  homeGrid.addEventListener('dragend', () => {
    dragListId = '';
    homeGrid.querySelectorAll('.is-dragging,.is-drag-over').forEach(el => el.classList.remove('is-dragging', 'is-drag-over'));
  });

  // ── Studio Dialog Events ──────────────────────────────────────────────────
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.addEventListener('keydown', event => {
    if (!event.target.matches('[data-cui-tab]')) return;
    const index = STUDIO_TABS.indexOf(activeStudioTab);
    const positions = {ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: STUDIO_TABS.length - 1};
    if (!Object.hasOwn(positions, event.key)) return;
    event.preventDefault();
    const tab = STUDIO_TABS[(positions[event.key] + STUDIO_TABS.length) % STUDIO_TABS.length];
    switchStudioTab(tab);
    renderStudio();
    dialog.querySelector(`[data-cui-tab="${tab}"]`).focus();
  });

  $('cui-new-preset')?.addEventListener('click', () => {
    if (editorPresets.length >= MAX_PRESETS) return;
    const base = currentDraft()?.base || lastSettings?.layout || 'aurora';
    const next = defaultPreset(base, `${tr('Bản tùy chỉnh')} ${editorPresets.length + 1}`);
    editorPresets.push(next);
    selectedId = next.id;
    expandedEditBlockId = '';
    switchStudioTab('layout');
    renderStudio();
    $('cui-name')?.focus();
  });

  $('cui-use-builtin')?.addEventListener('click', deactivate);

  $('cui-duplicate')?.addEventListener('click', () => {
    const p = currentDraft();
    if (!p || editorPresets.length >= MAX_PRESETS) return;
    const copy = clone(p);
    copy.id = uid('cui');
    copy.name = `${p.name} (2)`.slice(0, 48);
    editorPresets.push(copy);
    selectedId = copy.id;
    renderStudio();
  });

  $('cui-delete')?.addEventListener('click', () => {
    const p = currentDraft();
    if (!p) return;
    if (!confirm(tr('Xóa bản giao diện tùy chỉnh này?'))) return;
    editorPresets = editorPresets.filter(item => item.id !== p.id);
    const saved = getPresetsFrom();
    if (saved.some(item => item.id === p.id)) {
      const nextActive = lastSettings?.custom_ui_active === p.id ? '' : (lastSettings?.custom_ui_active || '');
      commitPresets(saved.filter(item => item.id !== p.id), nextActive, lastSettings?.layout);
    }
    if (!editorPresets.length) close();
    else { selectedId = editorPresets[0].id; renderStudio(); }
    window.AnkiNOS?.toast?.('Đã xóa bản giao diện');
  });

  $('cui-reset-positions')?.addEventListener('click', () => {
    const p = currentDraft();
    if (!p) return;
    const rows = [504, 504];
    for (const block of p.blocks) {
      const core = CORE_TYPES.includes(block.type);
      const rect = core ? defaultFreeformRect(block.type) : defaultWidget(block.type, block.style);
      const wide = rect.w > 500;
      const lane = rows[0] <= rows[1] ? 0 : 1;
      const nextY = wide ? Math.max(...rows) : rows[lane];
      block.x = core ? rect.x : wide ? 0 : lane * (500 + p.gap);
      block.y = core ? rect.y : Math.min(GEOMETRY.y.max, nextY);
      block.w = rect.w;
      block.h = rect.h;
      block.z = rect.z;
      if (!core) {
        rows[lane] = nextY + block.h + p.gap;
        if (wide) rows[1 - lane] = rows[lane];
      }
    }
    renderStudio();
    window.AnkiNOS?.toast?.('Đã sắp gọn vị trí các khối');
  });

  $('cui-live-edit')?.addEventListener('click', () => startLiveEdit(true));

  $('cui-save-apply')?.addEventListener('click', () => {
    const p = currentDraft();
    if (!p) return;
    p.name = (p.name || '').trim().slice(0, 48) || tr('Bố cục tùy chỉnh');
    commitPresets(editorPresets, p.id, p.base);
    close();
    window.AnkiNOS?.toast?.(`Đã lưu và áp dụng: ${p.name}`);
  });

  $('cui-name')?.addEventListener('input', e => {
    const p = currentDraft();
    if (!p) return;
    p.name = e.target.value;
    const item = $('cui-preset-list')?.querySelector(`[data-cui-select="${p.id}"] strong`);
    if (item) item.textContent = p.name || tr('Bố cục tùy chỉnh');
  });
  $('cui-base')?.addEventListener('change', e => { const p = currentDraft(); if (p) { p.base = e.target.value; renderStudio(); } });
  $('cui-mode')?.addEventListener('change', e => { const p = currentDraft(); if (p) { p.mode = e.target.value; renderStudio(); } });
  $('cui-columns')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.columns = e.target.value; });
  $('cui-width')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.width = e.target.value; });
  $('cui-greeting-align')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.greeting_align = e.target.value; });
  $('cui-gap')?.addEventListener('input', e => {
    const p = currentDraft();
    if (!p) return;
    p.gap = Number(e.target.value);
    if ($('cui-gap-val')) $('cui-gap-val').textContent = `${p.gap} px`;
  });
  $('cui-radius')?.addEventListener('input', e => {
    const p = currentDraft();
    if (!p) return;
    p.radius = Number(e.target.value);
    if ($('cui-radius-val')) $('cui-radius-val').textContent = `${p.radius} px`;
  });
  $('cui-snap')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.snap = e.target.checked; });
  $('cui-show-topbar')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.show_topbar = e.target.checked; });
  $('cui-show-greeting')?.addEventListener('change', e => {
    const p = currentDraft();
    if (!p) return;
    p.show_greeting = e.target.checked;
    const b = p.blocks.find(x => x.type === 'greeting');
    if (b) b.hidden = !e.target.checked;
    renderStudio();
  });
  $('cui-show-goal')?.addEventListener('change', e => {
    const p = currentDraft();
    if (!p) return;
    p.show_goal = e.target.checked;
    const b = p.blocks.find(x => x.type === 'goal');
    if (b) b.hidden = !e.target.checked;
    renderStudio();
  });
  $('cui-nav-placement')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.nav.placement = e.target.value; });
  $('cui-nav-orientation')?.addEventListener('change', e => { const p = currentDraft(); if (p) p.nav.orientation = e.target.value; });

  dialog.addEventListener('click', e => {
    const tabBtn = e.target.closest('[data-cui-tab]');
    if (tabBtn) { switchStudioTab(tabBtn.dataset.cuiTab); renderStudio(); return; }
    const selectBtn = e.target.closest('[data-cui-select]');
    if (selectBtn) {
      selectedId = selectBtn.dataset.cuiSelect;
      expandedEditBlockId = '';
      renderStudio();
      $('cui-preset-list').querySelector('.is-selected')?.focus({preventScroll: true});
      return;
    }
    const addBtn = e.target.closest('[data-cui-add]');
    if (addBtn) {
      const p = currentDraft();
      const widget = p && appendWidget(p, addBtn.dataset.cuiAdd);
      if (!widget) return;
      expandedEditBlockId = widget.id;
      renderStudio();
      $('cui-blocks-list').lastElementChild?.querySelector('[data-cui-edit-block]')?.focus();
      return;
    }
    const addTbBtn = e.target.closest('[data-cui-add-toolbox]');
    if (addTbBtn) {
      const p = currentDraft();
      const widget = p && appendWidget(p, 'toolbox', addTbBtn.dataset.cuiAddToolbox);
      if (!widget) return;
      expandedEditBlockId = widget.id;
      renderStudio();
      $('cui-toolboxes-list').lastElementChild?.querySelector('[data-cui-edit-toolbox]')?.focus();
      return;
    }
    const moveBtn = e.target.closest('[data-cui-move]');
    if (moveBtn) {
      const p = currentDraft();
      if (!p) return;
      const idx = p.blocks.findIndex(b => b.id === moveBtn.dataset.cuiMove);
      const next = idx + Number(moveBtn.dataset.dir);
      if (idx >= 0 && next >= 0 && next < p.blocks.length) {
        const [item] = p.blocks.splice(idx, 1);
        p.blocks.splice(next, 0, item);
        renderStudio();
      }
      return;
    }
    const spanBtn = e.target.closest('[data-cui-span-cycle]');
    if (spanBtn) {
      const p = currentDraft();
      const b = p?.blocks.find(x => x.id === spanBtn.dataset.cuiSpanCycle);
      if (b) { b.span = b.span === 'auto' ? 'full' : b.span === 'full' ? 'half' : 'auto'; renderStudio(); }
      return;
    }
    const hideBtn = e.target.closest('[data-cui-toggle-hide]');
    if (hideBtn) {
      const p = currentDraft();
      const b = p?.blocks.find(x => x.id === hideBtn.dataset.cuiToggleHide);
      if (b) {
        b.hidden = !b.hidden;
        if (b.type === 'greeting') p.show_greeting = !b.hidden;
        if (b.type === 'goal') p.show_goal = !b.hidden;
        renderStudio();
      }
      return;
    }
    const editBtn = e.target.closest('[data-cui-edit-block],[data-cui-edit-toolbox]');
    if (editBtn) {
      const attr = editBtn.hasAttribute('data-cui-edit-block') ? 'data-cui-edit-block' : 'data-cui-edit-toolbox';
      const id = editBtn.getAttribute(attr);
      expandedEditBlockId = expandedEditBlockId === id ? '' : id;
      renderStudio();
      dialog.querySelector(`[role="tabpanel"]:not([hidden]) [${attr}="${CSS.escape(id)}"]`)?.focus({preventScroll: true});
      return;
    }
    const removeBtn = e.target.closest('[data-cui-remove-block]');
    if (removeBtn) {
      const p = currentDraft();
      if (p) { p.blocks = p.blocks.filter(b => b.id !== removeBtn.dataset.cuiRemoveBlock); renderStudio(); }
      return;
    }
    const navMove = e.target.closest('[data-cui-nav-move]');
    if (navMove) {
      const p = currentDraft();
      if (!p) return;
      const idx = p.nav.order.indexOf(navMove.dataset.cuiNavMove);
      const next = idx + Number(navMove.dataset.dir);
      if (idx >= 0 && next >= 0 && next < p.nav.order.length) {
        const [item] = p.nav.order.splice(idx, 1);
        p.nav.order.splice(next, 0, item);
        renderStudio();
      }
      return;
    }
    const navToggle = e.target.closest('[data-cui-nav-toggle]');
    if (navToggle) {
      const p = currentDraft();
      if (!p) return;
      const key = navToggle.dataset.cuiNavToggle;
      if (p.nav.hidden.includes(key)) p.nav.hidden = p.nav.hidden.filter(k => k !== key);
      else p.nav.hidden.push(key);
      renderStudio();
      return;
    }
    const tbToggle = e.target.closest('[data-cui-tb-toggle]');
    if (tbToggle) {
      const p = currentDraft();
      const b = p?.blocks.find(x => x.id === tbToggle.dataset.cuiTbToggle);
      if (!b) return;
      const tool = tbToggle.dataset.tool;
      if (!Array.isArray(b.tools)) b.tools = [];
      if (b.tools.includes(tool)) {
        if (b.tools.length > 1) b.tools = b.tools.filter(t => t !== tool);
      } else if (b.tools.length < 16) {
        b.tools.push(tool);
      }
      renderStudio();
      return;
    }
    const tbMove = e.target.closest('[data-cui-tb-move]');
    if (tbMove) {
      const p = currentDraft();
      const b = p?.blocks.find(x => x.id === tbMove.dataset.cuiTbMove);
      if (!b || !Array.isArray(b.tools)) return;
      const idx = b.tools.indexOf(tbMove.dataset.tool);
      const next = idx + Number(tbMove.dataset.dir);
      if (idx >= 0 && next >= 0 && next < b.tools.length) {
        const [item] = b.tools.splice(idx, 1);
        b.tools.splice(next, 0, item);
        renderStudio();
      }
    }
  });

  dialog.addEventListener('change', e => {
    const p = currentDraft();
    if (!p) return;
    if (e.target.dataset.cuiTbStyle) {
      const b = p.blocks.find(x => x.id === e.target.dataset.cuiTbStyle);
      if (b) { b.style = e.target.value; renderStudio(); }
    }
    const key = e.target.dataset.cuiGeometry;
    if (key && Object.hasOwn(GEOMETRY, key)) {
      const block = p.blocks.find(item => item.id === e.target.dataset.cuiGeometryBlock);
      if (!block) return;
      const {min, max, auto} = GEOMETRY[key];
      const value = e.target.valueAsNumber;
      if (Number.isFinite(value)) block[key] = Math.min(max, Math.max(min, Math.round(value)));
      else if (auto) block[key] = 0;
      e.target.value = auto && !block[key] ? '' : String(block[key]);
    }
  });

  dialog.addEventListener('input', e => {
    const p = currentDraft();
    if (!p) return;
    if (e.target.dataset.cuiFieldTitle) {
      const b = p.blocks.find(x => x.id === e.target.dataset.cuiFieldTitle);
      if (b) b.title = e.target.value;
    } else if (e.target.dataset.cuiFieldBody) {
      const b = p.blocks.find(x => x.id === e.target.dataset.cuiFieldBody);
      if (b) b.body = e.target.value;
    }
  });

  // Drag & Drop inside Studio Block List and Nav List
  const blocksListEl = $('cui-blocks-list');
  if (blocksListEl) {
    blocksListEl.addEventListener('dragstart', e => {
      const row = e.target.closest('[data-cui-row]');
      if (!row || e.target.closest('input,textarea,button,select')) { e.preventDefault(); return; }
      dragListId = row.dataset.cuiRow;
      row.classList.add('is-dragging');
      e.dataTransfer?.setData('text/plain', dragListId);
    });
    blocksListEl.addEventListener('dragover', e => {
      const row = e.target.closest('[data-cui-row]');
      if (!row || !dragListId || row.dataset.cuiRow === dragListId) return;
      e.preventDefault();
      blocksListEl.querySelectorAll('.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
      row.classList.add('is-drag-over');
    });
    blocksListEl.addEventListener('drop', e => {
      const row = e.target.closest('[data-cui-row]');
      if (!row || !dragListId) return;
      e.preventDefault();
      const p = currentDraft();
      if (p && reorderList(p.blocks, dragListId, row.dataset.cuiRow, b => b.id)) renderStudio();
      dragListId = '';
    });
    blocksListEl.addEventListener('dragend', () => {
      dragListId = '';
      blocksListEl.querySelectorAll('.is-dragging,.is-drag-over').forEach(el => el.classList.remove('is-dragging', 'is-drag-over'));
    });
  }

  const navListEl = $('cui-nav-list');
  if (navListEl) {
    navListEl.addEventListener('dragstart', e => {
      const row = e.target.closest('[data-cui-nav-row]');
      if (!row || e.target.closest('button')) { e.preventDefault(); return; }
      dragNavKey = row.dataset.cuiNavRow;
      row.classList.add('is-dragging');
      e.dataTransfer?.setData('text/plain', dragNavKey);
    });
    navListEl.addEventListener('dragover', e => {
      const row = e.target.closest('[data-cui-nav-row]');
      if (!row || !dragNavKey || row.dataset.cuiNavRow === dragNavKey) return;
      e.preventDefault();
      navListEl.querySelectorAll('.is-drag-over').forEach(el => el.classList.remove('is-drag-over'));
      row.classList.add('is-drag-over');
    });
    navListEl.addEventListener('drop', e => {
      const row = e.target.closest('[data-cui-nav-row]');
      if (!row || !dragNavKey) return;
      e.preventDefault();
      const p = currentDraft();
      if (p && reorderList(p.nav.order, dragNavKey, row.dataset.cuiNavRow, k => k)) renderStudio();
      dragNavKey = '';
    });
    navListEl.addEventListener('dragend', () => {
      dragNavKey = '';
      navListEl.querySelectorAll('.is-dragging,.is-drag-over').forEach(el => el.classList.remove('is-dragging', 'is-drag-over'));
    });
  }

  document.addEventListener('nos:language', () => {
    renderExternalSwitchers(lastSettings);
    if (dialog.open) renderStudio();
    applyHomePreset(getActivePreset(lastSettings));
    syncLiveBarUI();
  });

  window.NOSCustomUI = {
    sync(settings, snapshot) {
      lastSettings = settings || lastSettings;
      if (snapshot) lastSnapshot = snapshot;
      renderExternalSwitchers(lastSettings);
      applyHomePreset(getActivePreset(lastSettings));
    },
    open,
    openFromLive,
    close,
    startLiveEdit,
    finishLiveEdit,
    isLiveEditing: () => !!liveEditDraft,
    activatePreset,
    deactivate,
  };
  if (rail && typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      if (app.dataset.cuiNavPlacement !== 'floating') return;
      app.style.setProperty('--cui-nav-w', rail.offsetWidth + 'px');
      app.style.setProperty('--cui-nav-h', rail.offsetHeight + 'px');
    }).observe(rail, {box: 'border-box'});
    if (workspace) new ResizeObserver(() => {
      if (!app.dataset.customUi || !workspace.clientWidth) return;
      const canvas = workspace.clientWidth >= 860 ? 'roomy' : 'compact';
      if (app.dataset.cuiCanvas === canvas) return;
      app.dataset.cuiCanvas = canvas;
      if (liveEditDraft) {
        endPointerOp();
        applyHomePreset(liveEditDraft);
        syncLiveBarUI();
      }
    }).observe(workspace);
  }
  if (window.AnkiNOS?.getSettings) {
    window.NOSCustomUI.sync(window.AnkiNOS.getSettings(), window.AnkiNOS.getSnapshot?.());
  }
})();
