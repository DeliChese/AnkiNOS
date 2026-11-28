/* AnkiNOS: one UI, using Anki's pycmd bridge when hosted in the deck browser. */
(function initializeAnkiNOS() {
  'use strict';
  // Anki stdHtml loads registered scripts before the document body.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAnkiNOS, {once:true});
    return;
  }
  const app = document.getElementById('nos-app');
  if (!app || window.AnkiNOS) return;
  const $ = id => document.getElementById(id);
  const native = app.dataset.native === 'true' || typeof window.pycmd === 'function';
  const bridgeStarted = performance.now();
  const format = window.NOSI18n.numberFormat();
  const historyDate = window.NOSI18n.dateFormat({weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const n = value => format.format(value ?? 0);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
  const defaultLayout = 'aurora';
  const state = {snapshot: null, settings: {layout: app.dataset.layout || defaultLayout, sidebar_side: app.dataset.sidebarSide === 'right' ? 'right' : 'left'}, filter: 'all', color: '', query: '', sort: 'name', period: 'year', calendar: null, expanded: new Set(), collapsed: new Set(), page: 'home'};
  const popups = [['profile-panel','profile-toggle'],['launcher','launcher-toggle'],['add-menu','add-toggle'],['layout-menu','layout-toggle']];
  let toastTimer;
  let settingsDraft = null;
  let settingsEditor = null;
  let settingsTrigger = null;
  let pendingSettings = {};
  let settingsSyncFrame = 0;
  let lastAppliedSettings = '';
  let lastSnapshotAt = 0;
  let heatmapRevision = 0;
  let libraryRenderedOnce = false;
  let refreshTimer;
  let snapshotPending=false;
  const historyPending=new Set();
  const loadingToday=iso(new Date());
  const firstAnkiYear=2006;
  const rafState = {};
  const chartSeries = new Map();
  // Throttle expensive visual handlers to one rAF per frame to avoid layout thrashing.
  function throttleRAF(key, fn) {
    return event => {
      if (rafState[key]) return;
      rafState[key] = requestAnimationFrame(() => {
        rafState[key] = 0;
        fn(event);
      });
    };
  }
  let libraryDataKey='', libraryRevision=0, libraryTreeKey='', libraryRenderKey='', heatmapKey='';
  let deckDataKey='', deckRevision=0;
  let libraryTree=[], allDecks=[], deckIndex=new Map(), filteredIndex=new Map();

  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
  }

  function command(action, args = {}) {
    if (!native) {
      if (action === 'snapshot') return receive({event: 'snapshot', payload: previewData()});
      if (action === 'fullscreen') {
        const request = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        request.catch(() => toast('Không thể bật toàn màn hình trong cửa sổ xem trước này.'));
        return;
      }
      if (action === 'save_ui') return;
      if (action === 'favorite') {
        const list = state.settings.favorites || [];
        state.settings.favorites = list.includes(args.id) ? list.filter(x => x !== args.id) : [...list, args.id];
        updateLibraryData();
        renderLibrary();
        return;
      }
      toast('Bản xem trước. Mở Anki để dùng chức năng này với bộ sưu tập của bạn.');
      return;
    }
    // Qt installs pycmd asynchronously, after the document can already be ready.
    if (typeof window.pycmd !== 'function') {
      if (performance.now() - bridgeStarted < 15000) setTimeout(() => command(action,args),10);
      else receive({event:'error',payload:'Cầu nối Anki chưa sẵn sàng. Nhấn Làm mới để thử lại.'});
      return;
    }
    if (action === 'snapshot') {
      if(snapshotPending)return;
      snapshotPending=true;
      $('refresh-button').disabled = true;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { snapshotPending=false; $('refresh-button').disabled = false; }, 15000);
    }
    window.pycmd(`nos:${JSON.stringify({action, ...args})}`);
  }

  function saveUI(patch) {
    if (settingsDraft) {
      Object.assign(settingsDraft, patch);
      Object.assign(pendingSettings, patch);
      if (!settingsSyncFrame) settingsSyncFrame = requestAnimationFrame(() => {
        settingsSyncFrame = 0;
        if (settingsDraft) syncSettingsForm(settingsDraft);
      });
      settingsEditor.querySelector('.settings-footer button').disabled = false;
      settingsEditor.querySelector('.settings-footer span').textContent = 'Có thay đổi chưa áp dụng';
      return;
    }
    Object.assign(state.settings, patch);
    applySettings();
    command('save_ui', {values: patch});
  }

  function applySettingsDraft() {
    if (!settingsDraft || !Object.keys(pendingSettings).length) return;
    const previous = state.settings;
    const patch = pendingSettings;
    pendingSettings = {};
    state.settings = {...previous, ...patch};
    applySettings();
    if (state.snapshot) {
      if (previous.goal !== state.settings.goal || previous.custom_greeting !== state.settings.custom_greeting) renderStats();
      if (previous.view !== state.settings.view) {
        libraryRenderKey = '';
        if ($('library-dialog').open) renderLibrary();
      }
      if (previous.heatmap_day !== state.settings.heatmap_day) renderHeatmap();
    }
    // Never send the image gallery (or large resource lists) back over pycmd.
    const keys = ['goal','custom_greeting','layout','sidebar_side','theme','color_theme','accent','custom_accent',
      'text_color','custom_text_color','theme_overrides','rating_colors','rating_color_again','rating_color_hard','rating_color_good','rating_color_easy','reviewer_card_opacity',
      'font_family','blur','glass_blur','glass_opacity','surface_style','motion_preset','motion_duration','animations','lite_mode','ui_scale','language',
      'stat_retention','stat_pace','stat_time','stat_studied','heatmap_day','heatmap_palette',
      'activity_collapsed','launchpad_collapsed','library_collapsed','sidebar_collapsed','welcome_dismissed','whats_new_seen_version','update_notice_muted','custom_ui_presets','custom_ui_active','view','pomodoro',
      // Image assignments belong exclusively to Studio and save immediately.
    ];
    const values = Object.fromEntries(keys.filter(key => Object.hasOwn(patch,key))
      .map(key => [key,state.settings[key]]));
    if (patch.language_pref) values.language = patch.language_pref;
    command('apply_settings', {values});
    settingsEditor.querySelector('.settings-footer button').disabled = true;
    settingsEditor.querySelector('.settings-footer span').textContent = 'Đã áp dụng · cấu hình lưu theo hồ sơ';
  }

  function setPopup(id, toggle, show) {
    const popup = $(id);
    // Repeated hidden assignments can trigger invalidation of popup descendants.
    if (popup.hidden === !show) return;
    popup.hidden = !show;
    $(toggle).setAttribute('aria-expanded', String(show));
  }

  function closePopups(restoreFocus = false) {
    for (const [id, toggle] of popups) {
      if (!$(id).hidden && restoreFocus) $(toggle).focus();
      setPopup(id, toggle, false);
    }
  }

  function togglePopup(id, toggle) {
    const show = $(id).hidden;
    closePopups();
    setPopup(id, toggle, show);
    if (show) {
      if (id === 'layout-menu') window.NOSLayout?.focusMenu();
      else $(id).querySelector('button')?.focus();
    }
  }

  function saveLayout(layout) {
    saveUI({layout: layout.id, custom_ui_active: ''});
    toast(`Bố cục: ${layout.name}`);
  }

  function positionLibrary(prepare=false) {
    const dialog=$('library-dialog');
    if(!dialog.open&&prepare!==true)return;
    const anchor = $('library-toggle').getBoundingClientRect();
    const zoom = Number(app.style.zoom) || 1;
    const viewportWidth = innerWidth / zoom;
    const viewportHeight = innerHeight / zoom;
    const narrow = innerWidth <= 720;
    const layout = app.dataset.layout;
    const sidebarSide = app.dataset.sidebarSide === 'right' ? 'right' : 'left';
    const floating = !narrow && ['bento', 'dock', 'zen', 'edges'].includes(layout);
    const topMargin = narrow ? 16 : ({bento: 84, zen: 72}[layout] || 24);
    const bottomMargin = narrow ? 109 : floating && layout === 'dock' ? 104 : 28;
    const height = Math.max(1, Math.min(760, viewportHeight - topMargin - bottomMargin));
    // Anchor to the resting (collapsed) rail width so hovering the aurora rail never shifts the popover.
    const railOuter = layout === 'sidebar'
      ? (innerWidth <= 1100 ? 200 : 236)
      : (innerHeight <= 600 ? (innerWidth <= 1200 ? 67 : 66) : (innerWidth <= 1200 ? 83 : 84));
    const sideOffset = railOuter + 24;
    const width = Math.max(1, Math.min(1280, viewportWidth - (narrow ? 32 : floating ? 48 : sideOffset + 24)));
    const left = narrow ? 16 : floating ? (viewportWidth - width) / 2
      : sidebarSide === 'right' ? Math.max(16, viewportWidth - sideOffset - width) : sideOffset;
    const top = floating || narrow ? topMargin : Math.max(24, Math.min(anchor.top / zoom - 50, viewportHeight - height - bottomMargin));
    const anchorX = (anchor.left + anchor.width / 2) / zoom - left;
    const anchorY = (anchor.top + anchor.height / 2) / zoom - top;
    dialog.dataset.side = floating ? 'none' : narrow ? 'bottom' : sidebarSide;
    for (const [key, value] of Object.entries({
      '--popover-left': left, '--popover-top': top, '--popover-width': width, '--popover-height': height,
      '--anchor-y': Math.max(30, Math.min(height - 30, anchorY)),
      '--anchor-x': Math.max(30, Math.min(width - 30, anchorX))
    })) dialog.style.setProperty(key, `${value}px`);
  }

  function closeLibrary(restoreFocus=true) {
    const dialog=$('library-dialog');
    if(!dialog.open)return;
    closePopups();
    dialog.close();
    app.classList.remove('library-open');
    $('library-toggle').setAttribute('aria-expanded','false');
    $('library-toggle').classList.remove('popover-active');
    if(restoreFocus)$('library-toggle').focus({preventScroll:true});
  }

  function openLibrary({focusDeck=null,search=false}={}) {
    if (window.NOSCustomUI?.isLiveEditing()) return;
    closePopups();
    if(focusDeck&&state.snapshot) {
      const target=deckIndex.get(focusDeck);
      state.filter='all';state.color='';state.query='';$('library-search').value='';
      if(target)for(const deck of allDecks) {
        if(deck.id===focusDeck||target.full_name.startsWith(deck.full_name+'::')) {
          state.expanded.add(deck.id);state.collapsed.delete(deck.id);
        }
      }
    }
    const dialog=$('library-dialog');
    // Set the final geometry before showModal's first layout/focus pass.
    positionLibrary(true);
    if(!dialog.open)dialog.showModal();
    // Reuse the existing DOM on reopen; only rebuild when underlying data changed.
    renderLibrary(focusDeck);
    app.classList.add('library-open');
    $('library-toggle').setAttribute('aria-expanded','true');
    $('library-toggle').classList.add('popover-active');
    if(search)$('library-search').focus({preventScroll:true});
    else $('library-close').focus({preventScroll:true});
    if(focusDeck)requestAnimationFrame(()=>{
      const row=Array.from($('deck-list').querySelectorAll('[data-deck-id]')).find(node=>node.dataset.deckId===focusDeck);
      if(row){row.scrollIntoView({block:'nearest'});row.classList.add('focused-deck');}
    });
  }

  window.NOSTheme.watch(app,()=>state.settings,true);
  window.NOSTheme.cards($('theme-palette-grid'),id=>saveUI({color_theme:id,accent:'auto'}));
  window.NOSTheme.fontCards?.($('theme-font-grid'),id=>saveUI({font_family:id}));
  window.NOSTheme.watch($('theme-preview'),()=>settingsDraft||state.settings,false,()=>window.NOSTheme.sync(settingsDraft||state.settings));

  let infoReturnFocus = null;
  function openAbout() {
    closePopups();
    closeLibrary(false);
    closeGuide(false);
    closeChangelog(false);
    const dialog = $('about-dialog');
    if (!dialog || dialog.open) return;
    infoReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('brand-about');
    dialog.showModal();
    $('about-close')?.focus({preventScroll: true});
  }
  function closeAbout(restoreFocus = true) {
    const dialog = $('about-dialog');
    if (!dialog?.open) return;
    dialog.close();
    if (restoreFocus) (infoReturnFocus || $('brand-about'))?.focus({preventScroll: true});
  }
  function switchChangelogTab(tabName = 'highlights') {
    const valid = ['highlights', 'history'].includes(tabName) ? tabName : 'highlights';
    app.querySelectorAll('[data-changelog-tab]').forEach(btn => {
      const active = btn.dataset.changelogTab === valid;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    app.querySelectorAll('.changelog-pane').forEach(pane => {
      pane.hidden = pane.id !== `cpane-${valid}`;
    });
  }
  function openChangelog(initialTab = 'highlights') {
    closePopups();
    closeLibrary(false);
    closeAbout(false);
    closeGuide(false);
    const dialog = $('changelog-dialog');
    if (!dialog) return;
    switchChangelogTab(initialTab);
    const ver = state.settings.addon_version || '';
    if (ver && state.settings.whats_new_seen_version !== ver) {
      saveUI({whats_new_seen_version: ver});
    }
    if (dialog.open) return;
    infoReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('brand-about');
    dialog.showModal();
    $('changelog-close')?.focus({preventScroll: true});
  }
  function closeChangelog(restoreFocus = true) {
    const dialog = $('changelog-dialog');
    if (!dialog?.open) return;
    dialog.close();
    if (restoreFocus && infoReturnFocus?.isConnected) {
      infoReturnFocus.focus({preventScroll: true});
    }
  }
  function switchGuideTab(tabName = 'start') {
    const valid = ['start','scheduler','focus','notebook','stats'].includes(tabName) ? tabName : 'start';
    app.querySelectorAll('.guide-tab[data-guide-select]').forEach(btn => {
      const active = btn.dataset.guideSelect === valid;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    app.querySelectorAll('.guide-pane').forEach(pane => {
      pane.hidden = pane.id !== `gpane-${valid}`;
    });
  }
  function openGuide(initialTab = 'start') {
    closePopups();
    closeLibrary(false);
    closeAbout(false);
    closeChangelog(false);
    const dialog = $('guide-dialog');
    if (!dialog) return;
    switchGuideTab(initialTab);
    if (dialog.open) return;
    infoReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : $('guide-toggle');
    dialog.showModal();
    $('guide-close')?.focus({preventScroll: true});
  }
  function closeGuide(restoreFocus = true) {
    const dialog = $('guide-dialog');
    if (!dialog?.open) return;
    dialog.close();
    if (restoreFocus) (infoReturnFocus || $('guide-toggle'))?.focus({preventScroll: true});
  }
  let lightboxState = null;
  function openLightbox(kind) {
    const slot = kind === 'cover' ? 'image_cover' : 'image_avatar';
    const entry = (state.settings.images || []).find(img => img.id === state.settings[slot]);
    if (!entry) return;
    const url = mediaUrl(slot, state.settings, 'original') || mediaUrl(slot, state.settings, 'wall');
    if (!url) return;
    const dialog = $('image-lightbox-dialog');
    if (!dialog) return;
    lightboxState = {kind, slot, photoId: entry.id};
    $('lightbox-image').src = url;
    $('lightbox-title').textContent = kind === 'cover' ? 'Ảnh bìa hồ sơ' : 'Ảnh đại diện hồ sơ';
    const parts = [entry.name];
    if (entry.width && entry.height) parts.push(`${entry.width} × ${entry.height} px`);
    $('lightbox-meta').setAttribute('data-i18n-skip', '');
    $('lightbox-meta').textContent = parts.filter(Boolean).join(' · ');
    closePopups(false);
    if (!dialog.open) dialog.showModal();
    $('lightbox-close')?.focus({preventScroll: true});
  }
  function closeLightbox(restoreFocus = true) {
    const dialog = $('image-lightbox-dialog');
    if (!dialog?.open) return;
    dialog.close();
    if (restoreFocus) $('profile-toggle')?.focus({preventScroll: true});
  }

  let settingsDragX = 0, settingsDragY = 0;
  function resetSettingsPosition() {
    settingsDragX = 0;
    settingsDragY = 0;
    const panel = settingsEditor?.querySelector('.settings-panel');
    if (panel) {
      panel.style.removeProperty('--drag-x');
      panel.style.removeProperty('--drag-y');
    }
    settingsEditor?.classList.remove('is-dragged');
  }

  function setSettingsDocked(docked) {
    const dialog = settingsEditor;
    const btn = dialog?.querySelector('.settings-dock-btn');
    if (!dialog) return;
    dialog.classList.toggle('is-docked', !!docked);
    if (docked) resetSettingsPosition();
    if (btn) {
      btn.setAttribute('aria-pressed', String(!!docked));
      const label = docked ? 'Trả về cửa sổ giữa' : 'Ghim sang cạnh để xem trực tiếp';
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
  }

  function openSettings(dialog = $('settings-dialog'), trigger = document.activeElement) {
    if (settingsEditor) return;
    settingsEditor = dialog;
    settingsTrigger = trigger;
    closePopups();
    closeLibrary(false);
    resetSettingsPosition();
    settingsDraft = {...state.settings};
    pendingSettings = {};
    switchSettingsTab(dialog.querySelector('[data-settings-tab]').dataset.settingsTab);
    syncSettingsForm(settingsDraft);
    settingsEditor.querySelector('.settings-footer button').disabled = true;
    settingsEditor.querySelector('.settings-footer span').textContent = 'Nhấn Áp dụng để lưu thay đổi';
    dialog.showModal();
    app.classList.add('settings-open');
    dialog.querySelector('[data-action="close_settings"]')?.focus({preventScroll: true});
  }

  function closeSettings(restoreFocus = true) {
    const dialog = settingsEditor;
    if (!dialog) return;
    dialog.close();
    resetSettingsPosition();
    settingsDraft = null;
    pendingSettings = {};
    app.classList.remove('settings-open');
    settingsEditor = null;
    if (restoreFocus) {
      const fallback = dialog.id === 'appearance-dialog' ? $('appearance-toggle') : app.querySelector('[data-action="preferences"]');
      (settingsTrigger?.getClientRects().length && settingsTrigger !== document.body ? settingsTrigger : fallback)?.focus({preventScroll: true});
    }
    settingsTrigger = null;
  }

  function switchSettingsTab(tabName) {
    const content = settingsEditor.querySelector('.settings-content');
    content.scrollTop = 0;
    if (settingsEditor.id === 'appearance-dialog') $('theme-preview').hidden = tabName === 'reviewer';
    settingsEditor.querySelectorAll('[data-settings-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.settingsTab === tabName);
      btn.setAttribute('aria-current', btn.dataset.settingsTab === tabName ? 'true' : 'false');
    });
    settingsEditor.querySelectorAll('.settings-tab-pane').forEach(pane => {
      pane.hidden = pane.id !== `stab-${tabName}`;
    });
  }

  function syncSettingsForm(s = settingsDraft || state.settings) {
    window.NOSTheme.sync(s);
    $('set-surface-style').value = s.surface_style === 'liquid' ? 'liquid' : 'frosted';
    window.NOSTheme.apply($('material-sample'), s);
    $('set-motion-preset').value = Object.hasOwn(pageMotions, s.motion_preset) ? s.motion_preset : s.motion_preset === 'none' ? 'none' : 'fade';
    $('set-motion-duration').value = String(motionDuration(s));
    $('motion-duration-val').textContent = `${motionDuration(s)} ms`;
    const motionDisabled = s.animations === false || !!s.lite_mode;
    $('set-motion-preset').disabled = motionDisabled;
    $('motion-preview').disabled = $('set-motion-duration').disabled =
      motionDisabled || s.motion_preset === 'none';
    window.NOSLayout?.sync(s);
    app.querySelectorAll('.theme-pill-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.setTheme || 'dusk') === (s.theme || 'dusk'));
    });
    app.querySelectorAll('.accent-dot-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.setAccent || 'blue') === (s.accent || 'blue'));
    });
    if ($('set-blur')) $('set-blur').checked = s.blur !== false;
    const gBlur = Number.isInteger(s.glass_blur) ? s.glass_blur : 16;
    const gAlpha = Number.isInteger(s.glass_opacity) ? s.glass_opacity : 74;
    if ($('set-glass-blur')) $('set-glass-blur').value = gBlur;
    if ($('glass-blur-val')) $('glass-blur-val').textContent = `${gBlur} px`;
    if ($('set-glass-opacity')) $('set-glass-opacity').value = gAlpha;
    if ($('glass-opacity-val')) $('glass-opacity-val').textContent = `${gAlpha}%`;
    const glassDisabled = !!s.lite_mode || s.blur === false;
    if ($('row-glass-blur')) $('row-glass-blur').classList.toggle('is-overridden', glassDisabled);
    if ($('row-glass-opacity')) $('row-glass-opacity').classList.toggle('is-overridden', glassDisabled);
    if ($('set-glass-blur')) $('set-glass-blur').disabled = glassDisabled;
    if ($('set-glass-opacity')) $('set-glass-opacity').disabled = glassDisabled;
    if ($('set-animations')) $('set-animations').checked = s.animations !== false;
    if ($('row-set-blur')) $('row-set-blur').classList.toggle('is-overridden', !!s.lite_mode);
    if ($('row-set-animations')) $('row-set-animations').classList.toggle('is-overridden', !!s.lite_mode);
    if ($('settings-lite-hint')) $('settings-lite-hint').hidden = !s.lite_mode;
    const draftLayout = window.NOSLayout?.normalize(s.layout) || defaultLayout;
    if ($('sidebar-side-row')) $('sidebar-side-row').classList.toggle('is-overridden', draftLayout !== 'aurora' && draftLayout !== 'sidebar');
    if ($('set-stat-retention')) $('set-stat-retention').checked = s.stat_retention !== false;
    const greetingInput = $('set-custom-greeting');
    if (greetingInput && document.activeElement !== greetingInput) greetingInput.value = s.custom_greeting || '';
    if ($('set-stat-pace')) $('set-stat-pace').checked = s.stat_pace !== false;
    if ($('set-stat-time')) $('set-stat-time').checked = s.stat_time !== false;
    if ($('set-stat-studied')) $('set-stat-studied').checked = s.stat_studied !== false;
    if ($('set-lite-mode')) $('set-lite-mode').checked = !!s.lite_mode;
    if ($('set-heatmap-day')) $('set-heatmap-day').value = s.heatmap_day || 'monday';
    if ($('set-heatmap-palette')) $('set-heatmap-palette').value = s.heatmap_palette || 'default';
    const goal = Math.max(1, Number(s.goal) || 200);
    if ($('set-goal-num')) $('set-goal-num').value = goal;
    if ($('set-goal-range')) $('set-goal-range').value = Math.min(500, goal);
    app.querySelectorAll('.scale-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.scale) === (s.ui_scale || 100));
    });
    const side = s.sidebar_side === 'right' ? 'right' : 'left';
    const langGrid = $('language-grid');
    if (langGrid && window.NOSI18n?.languages) {
      for (const pack of window.NOSI18n.languages()) {
        if (!langGrid.querySelector(`[data-set-language="${pack.id}"]`)) {
          const btn = document.createElement('button');
          btn.type = 'button'; btn.className = 'language-card'; btn.dataset.setLanguage = pack.id;
          btn.setAttribute('role', 'radio'); btn.setAttribute('aria-checked', 'false'); btn.setAttribute('data-i18n-skip', '');
          btn.innerHTML = `<span class="language-code">${escape(pack.id.toUpperCase())}</span><div><strong>${escape(pack.name)}</strong><small>${escape(pack.english)}</small></div>`;
          langGrid.append(btn);
        }
      }
    }
    const autoResolved = window.NOSI18n?.resolve ? window.NOSI18n.resolve(s.anki_locale || navigator.language || '') : 'vi';
    const langPref = s.language_pref === 'auto' ? 'auto' : (window.NOSI18n?.has(s.language_pref) ? s.language_pref : (window.NOSI18n?.has(s.language) ? s.language : 'auto'));
    const effectiveLang = langPref === 'auto' ? autoResolved : langPref;
    const autoNote = $('language-auto-note');
    if (autoNote) {
      const detectedMeta = window.NOSI18n?.languages?.().find(p => p.id === autoResolved);
      const label = detectedMeta ? detectedMeta.name : autoResolved.toUpperCase();
      autoNote.textContent = s.anki_locale ? `Đang nhận: ${label} (${s.anki_locale})` : `Đang nhận: ${label}`;
    }
    app.querySelectorAll('.language-card').forEach(btn => {
      const selected = btn.dataset.setLanguage === langPref;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-checked', String(selected));
    });
    renderLanguagePreview(effectiveLang);
    app.querySelectorAll('#appearance-dialog .side-btn[data-sidebar-side]').forEach(btn => {
      const selected = btn.dataset.sidebarSide === side;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }

  // Shows a handful of real interface strings in the language being chosen,
  // without changing the page itself until the user presses Apply.
  function renderLanguagePreview(lang) {
    const box = $('language-preview');
    const i18n = window.NOSI18n;
    if (!box || !i18n) return;
    const active = state.settings.language || 'vi';
    const key = `${lang}|${active}`;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    const tr = text => escape(i18n.preview(text, lang));
    const inUse = lang === active;
    const nav = ['Tổng quan', 'Lịch ôn', 'Thống kê', 'Bộ thẻ', 'Sổ tay', 'Cài đặt'];
    box.innerHTML = `
      <div class="language-preview-head">
        <strong>${tr('Một vài mục sau khi đổi ngôn ngữ')}</strong>
        <span class="language-preview-badge" data-state="${inUse ? 'active' : 'draft'}">${tr(inUse ? 'Đang dùng' : 'Xem trước · chưa lưu')}</span>
      </div>
      <div class="language-preview-row"><span class="language-preview-label">${tr('Điều hướng')}</span>
        <div class="language-preview-nav">${nav.map(item => `<span>${tr(item)}</span>`).join('')}</div></div>
      <div class="language-preview-row"><span class="language-preview-label">${tr('Lời chào')}</span>
        <div><strong>${tr('Chào buổi sáng')}, Minh ✦</strong><p>${tr('Mỗi lần ôn tập, một chút tiến bộ.')}</p></div></div>
      <div class="language-preview-row"><span class="language-preview-label">${tr('Thẻ chỉ số')}</span>
        <div class="language-preview-stats">
          <div><small>${tr('Ghi nhớ')}</small><b>92%</b><em>${tr('Hôm nay')}</em></div>
          <div><small>${tr('Nhịp học')}</small><b>6,5 <span>${tr('lượt/phút')}</span></b><em>${tr('Tốc độ ôn hôm nay')}</em></div>
        </div></div>
      <div class="language-preview-row"><span class="language-preview-label">${tr('Hành động')}</span>
        <div class="language-preview-action"><span class="language-preview-cta">${tr('Học ngay →')}</span><small>${tr('24 thẻ đang chờ · khoảng 8 phút')}</small></div></div>
      <div class="language-preview-row"><span class="language-preview-label">${tr('Thanh trạng thái')}</span>
        <div class="language-preview-action"><small>${tr('Nhấn Áp dụng để lưu thay đổi')}</small><span class="language-preview-apply">${tr('Áp dụng')}</span></div></div>`;
  }

  // Dynamic text is generated in Vietnamese; rebuild it so dates and numbers
  // follow the newly selected language.
  document.addEventListener('nos:language', () => {
    if (!state.snapshot) return;
    renderStats();
    heatmapKey = '';
    renderHeatmap();
    libraryRenderKey = '';
    syncLibraryFooter();
    if ($('library-dialog')?.open) renderLibrary();
    if (settingsEditor) window.NOSTheme.sync(settingsDraft || state.settings);
  });

  function exportSettings() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(settingsDraft || state.settings, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', 'ankinos-settings.json');
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  function importSettings() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const imported = JSON.parse(ev.target.result);
          if (typeof imported === 'object' && imported !== null) {
            if (window.NOSLayout?.normalize(imported.layout) !== imported.layout) delete imported.layout;
            saveUI(imported);
            toast('Đã nhập. Nhấn Áp dụng để lưu.');
          }
        } catch {
          toast('Tệp JSON không hợp lệ.');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function resetSettings() {
    if (confirm(window.NOSI18n.t('Khôi phục toàn bộ cài đặt AnkiNOS về mặc định ban đầu?'))) {
      const defaults = {
        goal: 200, custom_greeting: '', update_notice_muted: false, custom_ui_active: '', layout: defaultLayout, sidebar_side: 'left', theme: 'dusk', color_theme: 'nos', accent: 'blue', custom_accent:'#83b8ff',
        text_color: 'auto', custom_text_color: '#f3f6ff',
        rating_colors: 'auto', rating_color_again: '#f26d85', rating_color_hard: '#f0b85b', rating_color_good: '#6ea8fe', rating_color_easy: '#4fd19b',
        reviewer_card_opacity: 100, theme_overrides: {},
        font_family: 'system',
        blur: true, glass_blur: 16, glass_opacity: 74, animations: true, ui_scale: 100,
        surface_style: 'frosted', motion_preset: 'fade', motion_duration: 220,
        stat_retention: true, stat_pace: true, stat_time: true, stat_studied: true,
        heatmap_day: 'monday', heatmap_palette: 'default', lite_mode: false
      };
      saveUI(defaults);
      toast('Đã chọn mặc định. Nhấn Áp dụng để lưu.');
    }
  }

  const MEDIA_URL = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}(?:-wall)?\.(?:png|jpg|webp)$/;
  const THUMB_URL = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}-thumb\.png$/;
  // kind 'wall': screen-sized copy for wallpapers (falls back to the original
  // until it exists); kind 'thumb': 480px copy, enough for a 36px avatar.
  function mediaUrl(slot, settings = state.settings, kind = 'wall') {
    const entry = (settings.images || []).find(image => image.id === settings[slot]);
    if (!entry) return '';
    if (kind === 'original') return MEDIA_URL.test(entry.url || '') ? entry.url : '';
    if (kind === 'thumb' && THUMB_URL.test(entry.thumb_url || '')) return entry.thumb_url;
    const wall = kind === 'wall' ? entry.wall_url : '';
    if (wall && MEDIA_URL.test(wall)) return wall;
    return MEDIA_URL.test(entry.url || '') ? entry.url : '';
  }
  const clampInt = (value, low, high, fallback) =>
    Number.isInteger(value) ? Math.min(high, Math.max(low, value)) : fallback;
  function imageFrame(settings, surface) {
    const raw = settings?.image_frames?.[surface] || {};
    return {
      x: clampInt(raw.x, 0, 100, 50),
      y: clampInt(raw.y, 0, 100, 50),
      zoom: clampInt(raw.zoom, 100, 250, 100),
    };
  }
  // Shared by every page: the fit/dim/blur/framing options are plain CSS variables.
  function wallpaperVars(settings, surface) {
    const fit = settings['image_fit_' + surface] === 'contain' ? 'contain' : 'cover';
    const dim = clampInt(settings.wallpaper_dim, 0, 80, 28);
    const blur = clampInt(settings.wallpaper_blur, 0, 24, 0);
    const frame = imageFrame(settings, surface);
    const scale = (frame.zoom / 100) * (blur ? 1.06 : 1);
    return {'--wall-fit': fit, '--wall-dim': String(dim / 100), '--wall-blur': blur + 'px',
            '--wall-pos-x': frame.x + '%', '--wall-pos-y': frame.y + '%',
            '--wall-scale': scale.toFixed(3)};
  }

  function applySettings() {
    const s = state.settings;
    const layout = window.NOSLayout?.normalize(s.layout) || defaultLayout;
    const sidebarSide = s.sidebar_side === 'right' ? 'right' : 'left';
    const signature = JSON.stringify([
      layout,sidebarSide,s.theme,s.color_theme,s.accent,s.custom_accent,
      s.text_color,s.custom_text_color,s.theme_overrides,s.rating_colors,s.rating_color_again,s.rating_color_hard,s.rating_color_good,s.rating_color_easy,s.reviewer_card_opacity,
      s.font_family,s.blur,s.glass_blur,s.glass_opacity,s.surface_style,s.motion_preset,s.motion_duration,s.animations,s.lite_mode,s.ui_scale,s.language,s.language_pref,
      s.stat_retention,s.stat_pace,s.stat_time,s.stat_studied,s.custom_greeting,
      s.heatmap_palette,s.activity_collapsed,s.launchpad_collapsed,s.sidebar_collapsed,s.welcome_dismissed,s.whats_new_seen_version,s.update_notice_muted,s.addon_version,s.custom_ui_active,s.custom_ui_presets,s.view,
      s.image_dashboard,s.image_avatar,s.image_cover,s.image_frames,
      s.image_fit_dashboard,s.wallpaper_dim,s.wallpaper_blur,
      mediaUrl('image_dashboard', s), mediaUrl('image_avatar', s, 'thumb'), mediaUrl('image_cover', s, 'wall')
    ]);
    if (signature === lastAppliedSettings) return;
    if (s.animations === false || s.lite_mode || s.motion_preset === 'none') pageAnimation?.cancel();
    lastAppliedSettings = signature;
    if (app.dataset.layout !== layout) app.dataset.layout = layout;
    if (app.dataset.sidebarSide !== sidebarSide) app.dataset.sidebarSide = sidebarSide;
    window.NOSTheme.apply(app,s,true);
    window.NOSI18n?.set(s.language || 'vi');
    const background = mediaUrl('image_dashboard', s);
    app.dataset.customBackground = background ? 'true' : 'false';
    // One actual <img> layer; the browser fits the full image once, with
    // no CSS tiling/compositing seam or destructive background-size crop.
    for (const [name, value] of Object.entries(wallpaperVars(s, 'dashboard'))) app.style.setProperty(name, value);
    const wallpaperImage = app.querySelector('.nos-wallpaper-image');
    if (wallpaperImage) {
      if (background && wallpaperImage.getAttribute('src') !== background) wallpaperImage.src = background;
      if (!background) wallpaperImage.removeAttribute('src');
      wallpaperImage.hidden = !background;
    }
    const avatar = mediaUrl('image_avatar', s, 'thumb');
    const avFrame = imageFrame(s, 'avatar');
    for (const [boxId, imgId] of [['avatar-box', 'topbar-avatar-img'], ['profile-avatar-box', 'profile-avatar-img']]) {
      const box = $(boxId), img = $(imgId);
      if (box) box.classList.toggle('has-image', !!avatar);
      if (img) {
        if (avatar && img.getAttribute('src') !== avatar) img.src = avatar;
        if (!avatar) img.removeAttribute('src');
        img.hidden = !avatar;
        img.style.objectPosition = `${avFrame.x}% ${avFrame.y}%`;
        img.style.transformOrigin = `${avFrame.x}% ${avFrame.y}%`;
        img.style.transform = `scale(${(avFrame.zoom / 100).toFixed(3)})`;
      }
    }
    const avatarBtn = $('profile-avatar-btn');
    if (avatarBtn) {
      avatarBtn.classList.toggle('is-viewable', !!avatar);
      avatarBtn.disabled = !avatar;
      avatarBtn.title = avatar ? 'Nhấn để xem ảnh đại diện' : 'Chưa có ảnh đại diện';
    }
    const cover = mediaUrl('image_cover', s, 'wall');
    const coverFrame = imageFrame(s, 'cover');
    const coverImg = $('profile-cover-img'), coverView = $('profile-cover-view'), banner = $('profile-banner');
    if (banner) banner.classList.toggle('has-cover', !!cover);
    if (coverImg) {
      if (cover && coverImg.getAttribute('src') !== cover) coverImg.src = cover;
      if (!cover) coverImg.removeAttribute('src');
      coverImg.hidden = !cover;
      coverImg.style.objectPosition = `${coverFrame.x}% ${coverFrame.y}%`;
      coverImg.style.transformOrigin = `${coverFrame.x}% ${coverFrame.y}%`;
      coverImg.style.transform = `scale(${(coverFrame.zoom / 100).toFixed(3)})`;
    }
    if (coverView) coverView.hidden = !cover;


    app.classList.toggle('lite-mode', !!s.lite_mode);
    app.classList.toggle('no-blur', s.blur === false);
    app.classList.toggle('reduce-motion', s.animations === false);
    app.dataset.animations = s.animations === false ? 'off' : 'on';
    const zoom = (s.ui_scale && s.ui_scale !== 100) ? (s.ui_scale / 100) : 1;
    app.style.zoom = zoom !== 1 ? String(zoom) : '';
    app.style.setProperty('--nos-zoom', String(zoom));
    positionLibrary();
    window.NOSLayout?.changed();

    if ($('welcome-overlay')) $('welcome-overlay').hidden = s.welcome_dismissed !== false;
    const ver = s.addon_version || '';
    const showUpdatePill = s.welcome_dismissed === true && !!ver && s.whats_new_seen_version !== ver && !s.update_notice_muted;
    if ($('update-pill')) $('update-pill').hidden = !showUpdatePill;
    if ($('set-update-notice-muted')) $('set-update-notice-muted').checked = !!s.update_notice_muted;
    window.NOSCustomUI?.sync(s, state.snapshot);
    if ($('card-retention')) $('card-retention').hidden = s.stat_retention === false;
    if ($('card-pace')) $('card-pace').hidden = s.stat_pace === false;
    if ($('card-time')) $('card-time').hidden = s.stat_time === false;
    if ($('card-studied')) $('card-studied').hidden = s.stat_studied === false;

    app.dataset.heatPalette = s.heatmap_palette || 'default';

    for (const [panel, key, action, label] of [
      ['activity-panel','activity_collapsed','collapse_activity','hoạt động'],
      ['study-launchpad','launchpad_collapsed','collapse_launchpad','bước tiếp theo'],
    ]) {
      const collapsed = !!s[key];
      const panelNode = $(panel);
      if (panelNode) panelNode.classList.toggle('collapsed', collapsed);
      const button = app.querySelector(`[data-action="${action}"]`);
      if (button) {
        button.setAttribute('aria-expanded', String(!collapsed));
        button.setAttribute('aria-label', `${collapsed ? 'Mở rộng' : 'Thu gọn'} ${label}`);
        button.title = button.getAttribute('aria-label');
      }
    }
    $('library-panel').classList.toggle('sidebar-hidden', !!s.sidebar_collapsed);
    $('sidebar-toggle').setAttribute('aria-expanded', String(!s.sidebar_collapsed));
    $('sidebar-toggle').setAttribute('aria-label', s.sidebar_collapsed ? 'Hiện bộ lọc' : 'Ẩn bộ lọc');
    $('theme-label').textContent = s.theme === 'night' ? 'Chuyển sang kính hoàng hôn' : 'Chuyển sang kính tối';
    if ($('animations-label')) {
      $('animations-label').textContent = s.animations === false ? 'Hiệu ứng mượt: Đang tắt' : 'Hiệu ứng mượt: Đang bật';
    }
    app.querySelectorAll('[data-action="view"]').forEach(button => {
      const selected = button.dataset.value === (s.view || 'list');
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (settingsEditor) syncSettingsForm();
  }

  function duration(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}<small>h</small> ${minutes % 60}<small>m</small>`;
    if (minutes) return `${minutes} <small>phút</small>`;
    return `${Math.floor(ms / 1000)} <small>giây</small>`;
  }

  // The Stats page re-renders these cards from the selected scope's data.
  window.NOSMetricCharts = {
    sparkline: (...args) => sparkline(...args),
    renderTrend: (...args) => renderTrend(...args),
  };

  function renderStats() {
    const data = state.snapshot, stats = data.stats;
    const waiting = !!data.partial;
    const goal = Math.max(1, Number(state.settings.goal) || 200);
    const percent = Math.round(stats.reviews / goal * 100);
    const initials = data.profile.trim().split(/\s+/).slice(-2).map(word => [...word][0]).join('').toUpperCase();
    $('avatar-initials').textContent = $('profile-initials').textContent = initials || 'A';
    $('profile-name').textContent = data.profile;
    const now = new Date(), hour = now.getHours();
    const customGreeting = typeof state.settings.custom_greeting === 'string' ? state.settings.custom_greeting.trim() : '';
    const greetingTitle = $('greeting-title');
    if (customGreeting) {
      greetingTitle.setAttribute('data-i18n-skip', '');
      greetingTitle.innerHTML = `${escape(customGreeting.replace(/\{name\}/gi, data.profile))} <span class="greeting-spark">✦</span>`;
    } else {
      const salutation = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
      greetingTitle.removeAttribute('data-i18n-skip');
      greetingTitle.innerHTML = `${salutation}, ${escape(data.profile)} <span class="greeting-spark">✦</span>`;
    }
    $('today-label').textContent = window.NOSI18n.dateFormat({weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now).toUpperCase();
    const loading = 'Đang tải dữ liệu Anki…';
    $('greeting-caption').textContent = data.due == null ? loading : data.due ? `${n(data.due)} thẻ đang chờ bạn. Bắt đầu một chút, nhớ thêm thật nhiều.` : 'Một khoảng lặng để học, một bước nhỏ để tiến xa.';
    $('goal-ring').style.setProperty('--progress', `${Math.min(100, percent)}%`);
    $('goal-percent').textContent = waiting ? '—' : `${percent}%`;
    $('goal-copy').textContent = waiting ? loading : `${n(stats.reviews)} / ${n(goal)} lượt ôn`;
    $('profile-goal-text').textContent = waiting ? '—' : `${n(stats.reviews)} / ${n(goal)}`;
    $('profile-goal-fill').style.width = `${Math.min(100, percent)}%`;
    const retention = stats.retention == null ? '—' : `${n(stats.retention)}%`;
    $('stat-retention').textContent = $('profile-retention').textContent = retention;
    const todayReviews = Number(stats.reviews) || 0;
    const todayCorrect = typeof stats.correct === 'number'
      ? stats.correct
      : (stats.retention != null && todayReviews ? Math.round(todayReviews * stats.retention / 100) : 0);
    const trueRet = stats.true_retention;
    $('retention-detail').textContent = waiting ? loading : todayReviews
      ? (trueRet != null
        ? `Hôm nay · ${n(todayCorrect)}/${n(todayReviews)} lượt đúng · True Retention ${n(trueRet)}%`
        : `Hôm nay · ${n(todayCorrect)}/${n(todayReviews)} lượt đúng`)
      : 'Hôm nay chưa có lượt ôn';
    $('stat-pace').innerHTML = `${stats.pace == null ? '—' : n(stats.pace)} <small>lượt/phút</small>`;
    if ($('pace-detail')) {
      const avgSec = todayReviews > 0 ? Math.round((stats.milliseconds / 1000 / todayReviews) * 10) / 10 : 0;
      $('pace-detail').textContent = waiting ? loading : todayReviews
        ? `Hôm nay · ${n(avgSec)} giây/thẻ · ${n(todayReviews)} lượt`
        : 'Hôm nay chưa ôn thẻ nào';
    }
    $('stat-time').innerHTML = waiting ? '—' : duration(stats.milliseconds);
    $('stat-studied').innerHTML = waiting ? '—' : `${n(stats.reviews)} <small>lượt</small>`;
    $('studied-detail').textContent = data.total_cards == null ? loading : `${n(data.total_cards)} thẻ trong bộ sưu tập`;
    $('streak-copy').textContent = waiting ? '—' : `${n(stats.streak)} ngày liên tiếp`;
    $('profile-streak').textContent = waiting ? '—' : `${n(stats.streak)} ngày`;
    $('profile-total').textContent = data.total_cards == null ? '—' : `${n(data.total_cards)} thẻ`;
    window.NOSCustomUI?.sync(state.settings, state.snapshot);
    if (waiting) return;
    const recent = Array.from({length:14}, (_, i) => {
      const date = iso(addDays(parseDate(data.today), i - 13));
      return {date, ...(data.days[date] || {reviews:0, milliseconds:0, correct:null, tested:0, passed:0})};
    });
    const dayRetention = d => {
      if (typeof d.correct === 'number' && d.reviews > 0) return Math.max(0, Math.min(100, d.correct / d.reviews * 100));
      return d.tested ? Math.max(0, Math.min(100, d.passed / d.tested * 100)) : null;
    };
    const dayPace = d => d.reviews > 0 ? Math.round((d.reviews / Math.max(1, (d.milliseconds || 0) / 60000)) * 10) / 10 : null;
    for (const [id,key,unit,value] of [
      ['retention','retention','%', dayRetention],
      ['pace','pace','lượt/phút', dayPace],
      ['time','milliseconds','phút', d => d.milliseconds / 60000],
      ['studied','reviews','lượt ôn', d => d.reviews],
    ]) {
      const trend = data.trends?.[key];
      renderTrend(id,trend);
      sparkline(`spark-${id}`, recent.map(d => ({date:d.date,value:value(d)})),unit,trend?.percent);
    }
  }

  function renderTrend(id, trend) {
    const label = $(`trend-${id}`), card = label.closest('.stat-card');
    const percent = trend?.percent;
    const direction = percent == null || percent === 0 ? 'neutral' : percent > 0 ? 'up' : 'down';
    card.dataset.direction = direction;
    if (percent == null) {
      label.textContent = trend?.previous === 0 && trend?.current > 0 ? 'Mới phát sinh · chưa có mốc so sánh' : 'Chưa đủ dữ liệu so sánh';
      label.title = trend?.comparison ? `So với ${trend.comparison}; không tính phần trăm khi mốc trước bằng 0 hoặc chưa có dữ liệu.` : 'Cần lịch sử ôn tập để tính tăng giảm.';
    } else {
      label.innerHTML = `<strong>${direction === 'up' ? '↗ +' : direction === 'down' ? '↘ −' : '→ '}${n(Math.abs(percent))}%</strong><span>so với ${escape(trend.comparison)}</span>`;
      label.title = `Thay đổi tương đối ${percent > 0 ? '+' : ''}${n(percent)}% so với ${trend.comparison}. Màu biểu thị chiều tăng/giảm của số liệu.`;
    }
  }

  function sparkline(id, series, unit, change) {
    const svg = $(id), available = series.filter(point => point.value != null);
    const key=JSON.stringify([series,unit,change]);
    if(chartSeries.get(id)?.key===key)return;
    chartSeries.set(id,{series,unit,key});
    svg.dataset.direction = change == null || change === 0 ? 'neutral' : change > 0 ? 'up' : 'down';
    svg.setAttribute('aria-label',`Biểu đồ ${unit} trong 14 ngày gần nhất. Di chuột để xem số liệu từng ngày.`);
    if (!available.length) {
      svg.innerHTML = '<path d="M6,31 H154" stroke="currentColor" stroke-width="1" stroke-dasharray="3 5" opacity=".4"/><text x="80" y="48" text-anchor="middle" fill="currentColor" font-size="8">Chưa có dữ liệu</text>';
      return;
    }
    const values = available.map(point => Math.max(0,point.value)), max = Math.max(0,...values);
    const sorted = [...values].sort((a,b) => a-b);
    const quartile = sorted[Math.floor(sorted.length*.75)] || 0;
    const ceiling = id === 'spark-retention' ? 100 : quartile > 0 && max > quartile * 5 ? quartile * 2 : max;
    const range = ceiling || 1;
    const points = series.map((point,i) => point.value == null ? null : {x:6+i*148/(series.length-1),y:Math.max(8,52-Math.min(Math.max(0,point.value)/range,1)*44)});
    const segments = [];
    let current = [];
    for (const point of points) {
      if (point) current.push(point);
      else if (current.length) { segments.push(current); current=[]; }
    }
    if (current.length) segments.push(current);
    const gradient = `<defs><linearGradient id="g-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".24"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>`;
    svg.innerHTML = gradient + segments.map(segment => {
      const d = segment.map(({x,y},i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      const first=segment[0],last=segment[segment.length-1];
      return `<path d="${d} L${last.x},60 L${first.x},60Z" fill="url(#g-${id})"/><path class="spark-line" d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`;
    }).join('') + points.filter(Boolean).map(({x,y}) => `<line class="spark-zero-bar" x1="${x}" x2="${x}" y1="${y}" y2="56" stroke="currentColor" stroke-width="2" opacity=".24"/><circle class="spark-point" cx="${x}" cy="${y}" r="1.5" fill="currentColor"/>`).join('') + '<line class="spark-cursor" y1="4" y2="59" stroke="currentColor" stroke-dasharray="2 3" visibility="hidden"/>';
  }

  function chartTooltip(svg,index) {
    const data=chartSeries.get(svg.id);
    if (!data) return;
    const point=data.series[index], tip=$('chart-tooltip'), rect=svg.getBoundingClientRect();
    tip.textContent = `${window.NOSI18n.dateFormat({day:'numeric',month:'numeric'}).format(parseDate(point.date))} · ${point.value == null ? 'Chưa có lượt đo' : `${n(Math.round(point.value*10)/10)} ${data.unit}`}`;
    tip.hidden=false;
    tip.style.left=`${Math.max(8,Math.min(rect.left+rect.width*index/(data.series.length-1),innerWidth-tip.offsetWidth-8))}px`;
    tip.style.top=`${Math.max(8,rect.top-tip.offsetHeight-9)}px`;
    const cursor=svg.querySelector('.spark-cursor');
    if (cursor) { cursor.setAttribute('x1',6+index*148/(data.series.length-1));cursor.setAttribute('x2',cursor.getAttribute('x1'));cursor.setAttribute('visibility','visible'); }
  }

  function fullscreenState(active) {
    const button=$('fullscreen-toggle');
    button.setAttribute('aria-pressed',String(active));
    button.title=active ? 'Thoát toàn màn hình' : 'Toàn màn hình';
    button.setAttribute('aria-label',button.title);
  }

  const calendarDay = date => Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000;
  const calendarAnchor = () => parseDate(state.calendar || state.snapshot?.today || loadingToday);
  function needsHistory(year) {
    const data=state.snapshot;
    return !!data?.history_loaded_years && !data.history_loaded_years.includes(year)
      && year >= Math.max(firstAnkiYear,data.history_start_year ?? firstAnkiYear) && year <= Number(data.today.slice(0,4));
  }
  function setCalendar(year, month, day=calendarAnchor().getDate()) {
    const latest=Number((state.snapshot?.today||loadingToday).slice(0,4));
    if (!Number.isInteger(year) || year<firstAnkiYear || year>latest || !Number.isInteger(month) || month<0 || month>11) return;
    state.calendar=iso(new Date(year,month,Math.min(day,new Date(year,month+1,0).getDate()),12));
    renderHeatmap();
  }
  function calendarStep(step) {
    const anchor=calendarAnchor();
    if(state.period==='week')return addDays(anchor,7*step);
    if(state.period==='month')return new Date(anchor.getFullYear(),anchor.getMonth()+step,1,12);
    return new Date(anchor.getFullYear()+step,anchor.getMonth(),Math.min(anchor.getDate(),new Date(anchor.getFullYear()+step,anchor.getMonth()+1,0).getDate()),12);
  }

  function heatCell(date, year, month = null) {
    const waiting=!state.snapshot||state.snapshot.partial||needsHistory(date.getFullYear());
    const key = iso(date), data = waiting?null:state.snapshot.days[key];
    const reviews = data?.reviews || 0;
    const level = reviews >= 200 ? 4 : reviews >= 100 ? 3 : reviews >= 40 ? 2 : reviews ? 1 : 0;
    const blank = date.getFullYear() !== year || (month != null && date.getMonth() !== month);
    const future = key > (state.snapshot?.today||loadingToday);
    const label = !waiting ? `${historyDate.format(date)} · ${n(reviews)} lượt ôn${future ? ' · Chưa đến ngày' : ''}` : 'Đang tải lịch sử ôn tập…';
    return `<div class="heat-cell heat-${level}${blank ? ' blank' : ''}${future ? ' future' : ''}${key===state.snapshot?.today?' today':''}" ${blank ? 'aria-hidden="true"' : `data-date="${key}" data-tooltip="${escape(label)}" aria-label="${escape(label)}" role="img"${key===state.snapshot?.today?' aria-current="date"':''}`}>${month != null && !blank ? date.getDate() : ''}</div>`;
  }

  function renderHeatmap() {
    if (state.snapshot?.partial) {
      $('heatmap').setAttribute('aria-busy', 'true');
      $('activity-summary').textContent = 'Đang tải lịch sử ôn tập…';
      return;
    }
    const data=state.snapshot||{days:{},today:loadingToday};
    // O(1) invalidation instead of serializing 365+ historical day objects.
    const key=JSON.stringify([heatmapRevision,!!state.snapshot,data.today,
      state.period,state.calendar,state.settings.heatmap_day]);
    if(key===heatmapKey)return;
    heatmapKey=key;
    const target = $('heatmap'), today = parseDate(data.today), anchor=calendarAnchor(), year=anchor.getFullYear(), month=anchor.getMonth();
    const isSunday = (state.settings.heatmap_day || 'monday') === 'sunday';
    const dayNames = isSunday ? ['CN','T2','T3','T4','T5','T6','T7'] : ['T2','T3','T4','T5','T6','T7','CN'];
    let start, end, from, html = '';
    const yearSelect=$('heatmap-year-select'),monthSelect=$('heatmap-month-select');
    if(yearSelect.dataset.latest!==String(today.getFullYear())){
      yearSelect.innerHTML=Array.from({length:today.getFullYear()-firstAnkiYear+1},(_,i)=>today.getFullYear()-i).map(y=>`<option value="${y}">${y}</option>`).join('');
      yearSelect.dataset.latest=String(today.getFullYear());
    }
    if(!monthSelect.options.length)monthSelect.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i}">Tháng ${i+1}</option>`).join('');
    yearSelect.value=String(year);monthSelect.value=String(month);
    monthSelect.hidden=state.period==='year';
    const unit=state.period==='year'?'Năm':state.period==='month'?'Tháng':'Tuần';
    for(const step of [-1,1]){
      const button=app.querySelector(`[data-action="year"][data-value="${step}"]`),next=calendarStep(step);
      button.disabled=next.getFullYear()<firstAnkiYear||next.getFullYear()>today.getFullYear();
      button.title=`${unit} ${step<0?'trước':'sau'}`;
      button.setAttribute('aria-label',button.title);
    }
    target.className = 'heatmap';
    if (state.period === 'year') {
      $('heatmap-year').textContent = year;
      const first = new Date(year,0,1,12);
      const offset = isSunday ? first.getDay() : ((first.getDay()+6)%7);
      start = addDays(first, -offset);
      end = new Date(year,11,31,12);
      from=iso(first);
      const weeks = Math.ceil((calendarDay(end)-calendarDay(start)+1)/7);
      target.style.setProperty('--weeks', weeks);
      html = '<span></span>';
      for (let m=0;m<12;m++) {
        const column=Math.floor((calendarDay(new Date(year,m,1))-calendarDay(start))/7);
        const next=m===11?weeks:Math.floor((calendarDay(new Date(year,m+1,1))-calendarDay(start))/7);
        html += `<button class="heat-month" data-action="heatmap_month" data-month="${m}" style="grid-column:${column+2}/span ${next-column};grid-row:1" aria-label="Xem tháng ${m+1} năm ${year}">Tháng ${m+1}</button>`;
      }
      for (let day = 0; day < 7; day++) {
        html += `<span class="heat-day">${dayNames[day]}</span>`;
        for (let week = 0; week < weeks; week++) html += heatCell(addDays(start, week*7+day), year);
      }
      $('heatmap-caption').textContent=`Năm ${year} · ${calendarDay(end)-calendarDay(first)+1} ngày`;
    } else if (state.period === 'month') {
      $('heatmap-year').textContent = `T${month+1} · ${year}`;
      target.classList.add('month-map');
      const first = new Date(year,month,1,12);
      const mOffset = isSunday ? first.getDay() : ((first.getDay()+6)%7);
      start = addDays(first,-mOffset);
      end = new Date(year,month+1,0,12);
      from=iso(first);
      const cells = Math.ceil((calendarDay(end)-calendarDay(start)+1)/7)*7;
      html = dayNames.map(day => `<span class="heat-day">${day}</span>`).join('');
      for (let i=0; i<cells; i++) html += heatCell(addDays(start,i),year,month);
      $('heatmap-caption').textContent=`Tháng ${month+1} năm ${year} · ${end.getDate()} ngày`;
    } else {
      target.classList.add('week-map');
      const wOffset = isSunday ? anchor.getDay() : ((anchor.getDay()+6)%7);
      start = addDays(anchor,-wOffset);
      end = addDays(start,6);
      from=iso(start);
      $('heatmap-year').textContent = year;
      $('heatmap-caption').textContent=`${start.toLocaleDateString(window.NOSI18n.locale())} – ${end.toLocaleDateString(window.NOSI18n.locale())}`;
      const values = Array.from({length:7}, (_,i) => data.days[iso(addDays(start,i))]?.reviews || 0);
      const max = Math.max(...values,1);
      html = '<div class="week-chart">' + values.map((count,i) => {
        const date=addDays(start,i),waiting=needsHistory(date.getFullYear());
        return `<div class="week-day" data-date="${iso(date)}" title="${escape(historyDate.format(date))}"><span class="week-count">${waiting?'…':n(count)}</span><div class="week-bar" style="height:${waiting?2:Math.max(2,count/max*100)}px"></div><span>${dayNames[i]} · ${date.getDate()}/${date.getMonth()+1}</span></div>`;
      }).join('') + '</div>';
    }
    target.innerHTML = html;
    const pendingYears=[...new Set([year,...(state.period==='week'?[start.getFullYear(),end.getFullYear()]:[])])].filter(needsHistory);
    target.setAttribute('aria-busy',String(!state.snapshot||pendingYears.length>0));
    const to = iso(end);
    const entries = Object.entries(data.days).filter(([key]) => key >= from && key <= to);
    const total = entries.reduce((sum, [,day]) => sum + day.reviews,0);
    if(state.snapshot)$('activity-summary').textContent = `${n(total)} lượt ôn · ${n(entries.filter(([,day]) => day.reviews > 0).length)} ngày học ${state.period === 'year' ? `trong năm ${year}` : state.period === 'month' ? 'trong tháng' : 'trong tuần'}`;
    if(pendingYears.length){
      $('activity-summary').textContent=`Đang tải lịch sử năm ${pendingYears.join(', ')}…`;
      for(const pendingYear of pendingYears)if(!historyPending.has(pendingYear)){
        historyPending.add(pendingYear);
        command('history_year',{year:pendingYear});
      }
    }
    app.querySelectorAll('[data-action="period"]').forEach(button => {
      const selected = button.dataset.value === state.period;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  const palette = ['blue','pink','green','purple','amber'];
  function deckColor(deck) {
    if (state.settings.colors?.[deck.id]) return state.settings.colors[deck.id];
    let hash = 0;
    for (const ch of deck.full_name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return palette[Math.abs(hash) % palette.length];
  }
  const due = deck => deck.new + deck.learn + deck.review;
  function flatten(nodes, result = []) {
    for (const node of nodes) {
      result.push(node);
      if (node.children?.length) flatten(node.children, result);
    }
    return result;
  }
  const deckOrder = new Intl.Collator('vi',{numeric:true,sensitivity:'base'});
  const searchText = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/gi,'d').toLowerCase();

  function updateLibraryData(snapshot=false) {
    if(snapshot){
      const key=JSON.stringify(state.snapshot.decks);
      if(key!==deckDataKey){
        deckDataKey=key;deckRevision++;
        allDecks=flatten(state.snapshot.decks);
        deckIndex=new Map(allDecks.map(deck=>[deck.id,deck]));
      }
    }
    const key=JSON.stringify([deckRevision,state.snapshot.total_cards,state.settings.resources,state.settings.favorites,state.settings.colors]);
    if(key===libraryDataKey)return;
    libraryDataKey=key;
    libraryRevision++;
    syncLibraryFooter();
  }

  function syncLibraryFooter() {
    const total = state.snapshot.total_cards;
    $('library-footer-copy').textContent = `${n(allDecks.length)} bộ thẻ · ${n(state.settings.resources?.length || 0)} tài nguyên · ${total == null ? '—' : n(total)} thẻ`;
  }

  function filterTree(nodes, query, favorites) {
    return nodes.map(node => {
      const children = node.children?.length ? filterTree(node.children, query, favorites) : [];
      let match = !query || searchText(node.full_name).includes(query);
      if (state.filter === 'resources') match = false;
      if (state.filter === 'favorites') match = match && favorites.has(node.id);
      if (state.filter === 'due') match = match && due(node) > 0;
      if (state.color) match = match && deckColor(node) === state.color;
      if (!match && !children.length) return null;
      return {...node, visibleChildren: children, forceExpanded: !!query || state.filter === 'favorites' || !!state.color};
    }).filter(Boolean).sort((a,b) => (state.sort === 'due' ? due(b)-due(a) : state.sort === 'total' ? b.total-a.total : 0) || deckOrder.compare(a.name,b.name));
  }

  function deckHTML(deck) {
    const children = deck.visibleChildren || [];
    const expanded = (state.expanded.has(deck.id) || (deck.forceExpanded && children.length > 0)) && !state.collapsed.has(deck.id);
    const favorite = (state.settings.favorites || []).includes(deck.id);
    const buttonId = escape(deck.id);
    const hasChildren = children.length > 0;
    const gathered = deck.gathered ?? (state.snapshot.partial ? null : due(deck));
    const countCopy = deck.filtered
      ? `${gathered == null ? '—' : n(gathered)} thẻ đang gom`
      : `${deck.total == null ? '—' : n(deck.total)} thẻ${deck.children.length?` · ${n(deck.children.length)} bộ con`:''}`;
    return `<div class="deck-group ${deck.children.length?'deck-parent':'deck-leaf'}" data-deck-id="${buttonId}" data-parent-id="${escape(deck.parent_id||'')}">
      <div class="deck-row">
        ${hasChildren ? `<button class="deck-expand" data-action="expand" data-id="${buttonId}" aria-label="${expanded?'Thu gọn':'Mở rộng'} ${escape(deck.name)}" aria-expanded="${!!expanded}" aria-controls="children-${buttonId}">${icon('chevron')}</button>` : '<span class="deck-expand-spacer"></span>'}
        <span class="folder ${deckColor(deck)}" aria-hidden="true"></span>
        <div class="deck-info"><button class="deck-name" data-action="study" data-id="${buttonId}" title="${escape(deck.full_name)}" data-i18n-skip>${escape(deck.name)}</button>
          <div class="deck-meta"><span>${countCopy}</span>${deck.retention==null?'':`<span class="retention-chip" title="Ghi nhớ hôm nay">${icon('chart')}${n(deck.retention)}%</span>`}${deck.filtered?'<span>Bộ lọc</span>':''}</div>
          ${deck.children.length?`<button class="subdecks-button" data-action="${expanded?'expand':'show_children'}" data-id="${buttonId}" aria-expanded="${!!expanded}" aria-controls="children-${buttonId}">${icon(expanded?'down':'layers','small')}${expanded?'Thu gọn deck con':`Xem ${n(deck.children.length)} deck con`}</button>`:''}
        </div>
        <div class="deck-counts" aria-label="${deck.new} mới, ${deck.learn} đang học, ${deck.review} cần ôn"><span class="deck-count-badge new-count${deck.new?'':' is-zero'}" title="Thẻ mới"><i aria-hidden="true"></i>${n(deck.new)}</span><span class="deck-count-badge learn-count${deck.learn?'':' is-zero'}" title="Đang học"><i aria-hidden="true"></i>${n(deck.learn)}</span><span class="deck-count-badge review-count${deck.review?'':' is-zero'}" title="Cần ôn"><i aria-hidden="true"></i>${n(deck.review)}</span></div>
        <button class="study-button" data-action="study" data-id="${buttonId}" aria-label="Học ${escape(deck.name)}">${icon('play')}Học</button>
        <button class="favorite-button ${favorite?'is-favorite':''}" data-action="favorite" data-id="${buttonId}" aria-label="${favorite?'Bỏ sao':'Gắn sao'} ${escape(deck.name)}" aria-pressed="${favorite}">${icon('star')}</button>
        <button class="delete-deck-button" data-action="delete_deck" data-id="${buttonId}" title="Xóa bộ thẻ" aria-label="Xóa ${escape(deck.full_name)}">${icon('trash')}</button>
        <button class="more-button" data-action="deck_menu" data-id="${buttonId}" title="Tùy chọn bộ thẻ" aria-label="Tùy chọn ${escape(deck.name)}">${icon('more')}</button>
      </div>
      ${hasChildren?`<div class="deck-children" id="children-${buttonId}" role="group" aria-label="Bộ con của ${escape(deck.name)}" ${expanded?'':'hidden'}>${expanded?children.map(deckHTML).join(''):''}</div>`:''}
    </div>`;
  }

  function renderLibrary(branch=null) {
    if (!state.snapshot) return;
    // Native startup only indexes the data. Build rows when the library is opened.
    if (!$('library-dialog').open && (native || libraryRenderedOnce)) return;
    const treeKey=JSON.stringify([libraryRevision,state.filter,state.color,state.query,state.sort]);
    const renderKey=JSON.stringify([treeKey,state.settings.view,[...state.expanded],[...state.collapsed]]);
    if(renderKey===libraryRenderKey)return;
    libraryRenderKey=renderKey;
    const sameTree=treeKey===libraryTreeKey;
    if(!sameTree){
      libraryTreeKey=treeKey;
      libraryTree=filterTree(state.snapshot.decks, searchText(state.query.trim()), new Set(state.settings.favorites || []));
      filteredIndex=new Map(flattenFiltered(libraryTree).map(deck=>[deck.id,deck]));
    }
    // Expanding one branch must not replace every sibling (or its focus/scroll).
    const children=branch&&document.getElementById(`children-${branch}`);
    if(sameTree&&children&&filteredIndex.has(branch)){
      children.parentElement.outerHTML=deckHTML(filteredIndex.get(branch));
      return;
    }
    const all = allDecks;
    const resources = state.settings.resources || [];
    const favorites = new Set(state.settings.favorites || []);
    $('count-all').textContent = n(all.length + resources.length);
    $('count-decks').textContent = n(all.length);
    $('count-resources').textContent = n(resources.length);
    $('count-favorites').textContent = n(all.filter(d => favorites.has(d.id)).length);
    app.querySelectorAll('[data-action="filter"]').forEach(button => {
      const selected = button.dataset.value === state.filter && !state.color;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    app.querySelectorAll('[data-action="color_filter"]').forEach(button => {
      const selected = button.dataset.value === state.color;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    const decks = libraryTree;
    $('deck-section').hidden = state.filter === 'resources' || !decks.length;
    $('deck-list').classList.toggle('grid-view', state.settings.view === 'grid');
    $('deck-list').innerHTML = decks.map(deckHTML).join('');
    const visibleCount = nodes => nodes.reduce((sum,node) => sum + 1 + visibleCount(node.visibleChildren || []),0);
    $('deck-result-count').textContent = n(visibleCount(decks));
    const showResources = ['all','resources'].includes(state.filter) && !state.color;
    const matches = resources.filter(r => searchText(r.name).includes(searchText(state.query.trim())));
    $('resources-section').hidden = !showResources || (!matches.length && !!state.query);
    $('resource-result-count').textContent = n(matches.length);
    $('resource-list').innerHTML = matches.length ? matches.map(resource => `<div class="resource-card"><button class="resource-open" data-action="open_resource" data-id="${escape(resource.id)}" title="${escape(resource.path)}"><span class="file-icon ${resource.kind === 'pdf' ? 'pdf' : resource.kind === 'link' ? 'link' : ''}">${icon(resource.kind === 'link' ? 'link' : 'file')}</span><span class="resource-info"><span class="resource-name" data-i18n-skip>${escape(resource.name)}</span><span class="resource-detail">${escape(resource.kind.toUpperCase())} · ${escape(resource.detail)}</span></span></button><button class="more-button" data-action="resource_menu" data-id="${escape(resource.id)}" aria-label="Tùy chọn ${escape(resource.name)}">${icon('more')}</button></div>`).join('') : `<div class="resource-empty">${icon('file')}<span>Gắn PDF, tài liệu hoặc liên kết để học cùng bộ thẻ.</span><button class="text-button" data-action="add_file">Thêm file ${icon('plus','small')}</button></div>`;
    $('empty-state').hidden = decks.length > 0 || (showResources && (matches.length > 0 || !state.query));
    syncLibraryFooter();
    if (!state.snapshot.partial && !all.length && state.filter !== 'resources' && !state.query && !state.color) {
      $('deck-section').hidden = false;
      $('deck-list').innerHTML = `<div class="resource-empty">${icon('folder')}<span>Bộ sưu tập chưa có bộ thẻ.</span><button class="subtle-button" data-action="create_deck">Tạo bộ thẻ</button></div>`;
    }
    // Only treat the hidden library as hydrated once a non-partial snapshot has rendered.
    libraryRenderedOnce = !state.snapshot.partial;
  }
  function flattenFiltered(nodes) {
    return nodes.flatMap(node=>[node,...flattenFiltered(node.visibleChildren||[])]);
  }

  const reducedPageMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const pageMotions = {
    fade: [{opacity: 0}, {opacity: 1}],
    rise: [{opacity: 0, transform: 'translateY(14px)'}, {opacity: 1, transform: 'translateY(0)'}],
    slide: [{opacity: 0, transform: 'translateX(18px)'}, {opacity: 1, transform: 'translateX(0)'}],
    zoom: [{opacity: 0, transform: 'scale(.975)'}, {opacity: 1, transform: 'scale(1)'}],
    spring: [
      {opacity: 0, transform: 'translateY(12px) scale(.98)'},
      {opacity: 1, transform: 'translateY(-2px) scale(1.005)', offset: .72},
      {opacity: 1, transform: 'translateY(0) scale(1)'}
    ],
  };
  const motionDuration = s => Number.isInteger(s.motion_duration) && s.motion_duration >= 120 && s.motion_duration <= 480
    ? s.motion_duration : 220;
  let pageAnimation, previewAnimation;
  function animatePageEnter(node, s = state.settings) {
    if (s.animations === false || s.lite_mode || s.motion_preset === 'none') return;
    if (s.animations == null && reducedPageMotion.matches) return;
    const frames = Object.hasOwn(pageMotions, s.motion_preset) ? pageMotions[s.motion_preset] : pageMotions.fade;
    return node?.animate(frames, {duration: motionDuration(s), easing: 'cubic-bezier(.22,1,.36,1)'});
  }
  reducedPageMotion.addEventListener('change', () => {
    pageAnimation?.cancel();
    previewAnimation?.cancel();
    if (settingsEditor) syncSettingsForm();
  });

  function changePage(page) {
    if (page !== 'home' && window.NOSCustomUI?.isLiveEditing()) return;
    if(page==='library'){openLibrary();return;}
    const wasLibraryOpen = $('library-dialog').open;
    closeLibrary(false);
    closePopups();
    if (page === state.page && !wasLibraryOpen) return;
    const changed = page !== state.page;
    state.page = page;
    app.dataset.page = page;
    const homeNode = app.querySelector('.workspace');
    const statsNode = $('stats-page');
    const dailyNode = $('daily-page');
    homeNode.hidden = page !== 'home';
    statsNode.hidden = page !== 'stats';
    dailyNode.hidden = page !== 'daily';
    app.scrollTop=0;
    if (changed) {
      pageAnimation?.cancel();
      pageAnimation = animatePageEnter(page === 'stats' ? statsNode : page === 'daily' ? dailyNode : homeNode);
    }
    if (page === 'stats') { window.NOSStats?.open(); window.NOSPomodoroStats?.open(); }
    if (page === 'daily') window.NOSDaily?.open();
    app.querySelectorAll('.rail-main [data-action="page"]').forEach(button => {
      button.classList.toggle('active', button.dataset.value === page);
      if (button.dataset.value === page) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
  }

  function openCommands() {
    if(native){command('commands');return;}
    let dialog=$('command-preview-dialog');
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='command-preview-dialog';dialog.className='command-preview-dialog';dialog.setAttribute('aria-label','Lệnh nhanh AnkiNOS');
      const frame=document.createElement('iframe');frame.src='ankios-tools.html?tool=palette&lang='+encodeURIComponent(window.NOSI18n?.language()||'vi');frame.title='Lệnh nhanh';dialog.append(frame);app.append(dialog);
      window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.nosToolClose===true)dialog.close();});
    } else {
      const frame=dialog.querySelector('iframe');
      const targetSrc='ankios-tools.html?tool=palette&lang='+encodeURIComponent(window.NOSI18n?.language()||'vi');
      if(frame&&frame.getAttribute('src')!==targetSrc)frame.src=targetSrc;
    }
    dialog.showModal();
  }

  function receive({event, payload}) {
    if(event==='daily'){window.NOSDaily?.receive(payload);return;}
    if(event==='study_support'){window.NOSStudy?.receive(payload);return;}
    if(event==='study_support_error'){window.NOSStudy?.error(payload);return;}
    if(event==='diagnostics_copied'){toast('Đã sao chép thông tin hỗ trợ (không gồm dữ liệu thẻ).');return;}
    if(event==='backup_status'){
      const status=$('backup-status');if(status)status.textContent=payload.message;
      app.querySelectorAll('[data-action="backup_export"],[data-action="backup_restore"]').forEach(button=>{button.disabled=!!payload.busy;});
      if(!payload.busy)toast(payload.message);return;
    }
    const previousGoal=state.settings.goal;
    const previousGreeting=state.settings.custom_greeting;
    const previousHeatmapDay=state.settings.heatmap_day;
    const previousLibrarySettings = JSON.stringify([
      state.settings.favorites, state.settings.colors, state.settings.resources,
      state.settings.view, state.settings.sidebar_collapsed
    ]);
    if(event==='history_year'&&state.snapshot){
      const {year,days}=payload;
      historyPending.delete(year);
      state.snapshot.days={...Object.fromEntries(Object.entries(state.snapshot.days).filter(([date])=>!date.startsWith(`${year}-`))),...days};
      state.snapshot.history_loaded_years=[...new Set([...(state.snapshot.history_loaded_years||[]),year])];
      heatmapRevision++;
      renderHeatmap();return;
    }
    if(event==='history_error'){
      historyPending.delete(payload.year);heatmapKey='';
      $('heatmap').setAttribute('aria-busy','false');
      $('activity-summary').textContent='Không thể tải lịch sử. Nhấn Làm mới để thử lại.';
      toast(payload.message);return;
    }
    if (event === 'pomodoro_analytics' || event === 'focus_history') { window.NOSPomodoroStats?.render(payload); return; }
    if (event === 'graphs' || event === 'graphs_error') {
      window.NOSStats?.receive(event, payload);
      return;
    }
    if (event === 'image_library') {
      const message = [payload.message, ...(payload.errors || [])].filter(Boolean).join(' ');
      toast(message);
      window.NOSStudio?.notice(message);
      return;
    }
    if (event === 'fullscreen') { fullscreenState(payload); return; }
    if (event === 'error') {
      snapshotPending=false;
      clearTimeout(refreshTimer);
      $('refresh-button').disabled = false;
      toast(payload);
      if (!state.snapshot) $('deck-list').textContent = 'Không thể tải bộ sưu tập. Nhấn Làm mới để thử lại.';
      return;
    }
    if (event === 'snapshot') {
      snapshotPending=false;
      lastSnapshotAt = performance.now();
      heatmapRevision++;
      state.snapshot = payload;
      state.settings = payload.settings || {};
      if (settingsEditor) settingsDraft = {...state.settings, ...pendingSettings};
      fullscreenState(native ? !!payload.fullscreen : !!document.fullscreenElement);
      state.calendar ??= payload.today;
      clearTimeout(refreshTimer);
      $('refresh-button').disabled = false;
      $('connection').innerHTML = `<span class="status-dot"></span>${native ? 'Bộ sưu tập Anki' : 'Bản xem trước'}`;
      if ($('page-footnote')) $('page-footnote').textContent = native ? 'Dữ liệu từ bộ sưu tập Anki của bạn' : 'Dữ liệu minh họa · Mở Anki để dùng bộ sưu tập thật';
    } else if (event === 'settings') {
      state.settings = payload;
      if (settingsEditor) settingsDraft = {...payload, ...pendingSettings};
    }
    if (!state.snapshot) return;
    applySettings();
    if(event==='snapshot'){
      window.NOSStudy?.sync(payload);
      if (state.page === 'daily') window.NOSDaily?.sync();
      window.NOSStats?.syncRevision(payload.support_revision, payload.today);
    }
    if (event === 'settings' || event === 'snapshot') {
      window.NOSStudio?.sync();
      if (state.settings?.pomodoro) window.NOSPomodoro?.receive({config: state.settings.pomodoro});
    }
    if(event==='snapshot'||state.settings.goal!==previousGoal||state.settings.custom_greeting!==previousGreeting) {
      renderStats();
      if (state.page === 'stats') window.NOSStats?.refreshMetrics();
    }
    if (event === 'snapshot' || (event==='settings' && previousHeatmapDay!==state.settings.heatmap_day)) renderHeatmap();
    if (event === 'snapshot') {
      updateLibraryData(true);
      renderLibrary();
    } else if (event === 'settings' && JSON.stringify([
      state.settings.favorites, state.settings.colors, state.settings.resources,
      state.settings.view, state.settings.sidebar_collapsed
    ]) !== previousLibrarySettings) {
      updateLibraryData();
      renderLibrary();
    }
    if(event==='snapshot'&&payload.library_focus) {
      openLibrary({focusDeck:payload.library_focus});
      command('library_ack',{id:payload.library_focus});
    }
    if(event==='snapshot'&&payload.open_page) {
      changePage(payload.open_page);
    }
  }
  window.AnkiNOS = {
    receive,
    saveUI,
    toast,
    getSettings: () => state.settings,
    getSnapshot: () => state.snapshot,
    dailyCommand: payload => command('daily', payload),
    studioCommand: (action, payload) => command(action, payload),
    studioUpdate(patch) {
      Object.assign(state.settings, patch);
      applySettings();
      window.NOSStudio?.sync();
    }
  };

  app.addEventListener('click', event => {
    const navBtn = event.target.closest('.settings-nav-btn[data-settings-tab]');
    if (navBtn) { switchSettingsTab(navBtn.dataset.settingsTab); return; }
    const guideTabBtn = event.target.closest('.guide-tab[data-guide-select]');
    if (guideTabBtn) { switchGuideTab(guideTabBtn.dataset.guideSelect); return; }
    const changelogTabBtn = event.target.closest('[data-changelog-tab]');
    if (changelogTabBtn) { switchChangelogTab(changelogTabBtn.dataset.changelogTab); return; }
    const changelogJump = event.target.closest('[data-changelog-jump]');
    if (changelogJump) {
      const target = changelogJump.dataset.changelogJump;
      closeChangelog(false);
      if (target === 'motion') {
        openSettings($('appearance-dialog'));
        if (settingsEditor === $('appearance-dialog')) switchSettingsTab('layout');
        return;
      }
      if (target === 'studio') return window.NOSStudio?.open();
      if (target === 'custom_ui') {
        if (state.page !== 'home') changePage('home');
        window.NOSCustomUI?.open();
      }
      return;
    }
    const languageBtn = event.target.closest('.language-card[data-set-language]');
    if (languageBtn) {
      const pref = languageBtn.dataset.setLanguage;
      const resolved = pref === 'auto'
        ? (window.NOSI18n?.resolve ? window.NOSI18n.resolve(state.settings.anki_locale || navigator.language || '') : 'vi')
        : pref;
      saveUI({language_pref: pref, language: resolved});
      return;
    }
    const themeBtn = event.target.closest('.theme-pill-btn[data-set-theme]');
    if (themeBtn) { saveUI({theme: themeBtn.dataset.setTheme}); return; }
    const accentBtn = event.target.closest('.accent-dot-btn[data-set-accent]');
    if (accentBtn) { saveUI({accent: accentBtn.dataset.setAccent}); return; }
    const textColorBtn = event.target.closest('[data-set-text-color]');
    if (textColorBtn) {
      const val = textColorBtn.dataset.setTextColor;
      if (val === 'auto') saveUI({text_color: 'auto'});
      else saveUI({text_color: 'custom', custom_text_color: val});
      return;
    }
    const resetRole = event.target.closest('[data-reset-role]');
    if (resetRole && settingsDraft) {
      const overrides = {...settingsDraft.theme_overrides};
      delete overrides[resetRole.dataset.resetRole];
      saveUI({theme_overrides: overrides});
      return;
    }
    const ratingModeBtn = event.target.closest('[data-set-rating-colors]');
    if (ratingModeBtn) { saveUI({rating_colors: ratingModeBtn.dataset.setRatingColors === 'custom' ? 'custom' : 'auto'}); return; }
    if (event.target.closest('#btn-reset-rating-colors')) {
      saveUI({rating_colors: 'auto', rating_color_again: '#f26d85', rating_color_hard: '#f0b85b', rating_color_good: '#6ea8fe', rating_color_easy: '#4fd19b'});
      return;
    }
    const scaleBtn = event.target.closest('.scale-btn[data-scale]');
    if (scaleBtn) { saveUI({ui_scale: Number(scaleBtn.dataset.scale)}); return; }
    const sideBtn = event.target.closest('.side-btn[data-sidebar-side]');
    if (sideBtn) {
      const side = sideBtn.dataset.sidebarSide === 'right' ? 'right' : 'left';
      if (sideBtn.closest('#layout-menu')) {
        closePopups(true);
        saveUI({sidebar_side: side});
        toast(side === 'right' ? 'Sidebar: Bên phải' : 'Sidebar: Bên trái');
      } else {
        saveUI({sidebar_side: side});
      }
      return;
    }
    if (event.target.closest('.settings-footer button')) { applySettingsDraft(); return; }
    if (event.target.closest('#btn-export-settings')) { exportSettings(); return; }
    if (event.target.closest('#btn-import-settings')) { importSettings(); return; }
    if (event.target.closest('#btn-reset-settings')) { resetSettings(); return; }

    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const {action, value, id} = button.dataset;
    if (action === 'appearance') return openSettings($('appearance-dialog'), button);
    if (action === 'preferences') return openSettings($('settings-dialog'), button);
    if (action === 'about') return $('about-dialog')?.open ? closeAbout() : openAbout();
    if (action === 'close_about') return closeAbout();
    if (action === 'changelog') return $('changelog-dialog')?.open ? closeChangelog() : openChangelog('highlights');
    if (action === 'close_changelog') return closeChangelog();
    if (action === 'dismiss_update_pill') return saveUI({whats_new_seen_version: state.settings.addon_version || '1.0.1-beta.2'});
    if (action === 'open_custom_ui') {
      closePopups();
      if (settingsEditor) closeSettings(false);
      if (state.page !== 'home') changePage('home');
      return window.NOSCustomUI?.open();
    }
    if (action === 'close_custom_ui') return window.NOSCustomUI?.close();
    if (action === 'custom_ui_live_start') {
      closePopups();
      if (settingsEditor) closeSettings(false);
      if (state.page !== 'home') changePage('home');
      return window.NOSCustomUI?.startLiveEdit(false);
    }
    if (action === 'custom_ui_open_studio') return window.NOSCustomUI?.openFromLive();
    if (action === 'custom_ui_live_cancel') return window.NOSCustomUI?.finishLiveEdit(false);
    if (action === 'custom_ui_live_save') return window.NOSCustomUI?.finishLiveEdit(true);
    if (action === 'guide') return openGuide(button.dataset.guideTab || 'start');
    if (action === 'close_guide') return closeGuide();
    if (action === 'layout_menu') return togglePopup('layout-menu', 'layout-toggle');
    if (action === 'set_layout') {
      if (button.dataset.layoutCard) return saveUI({layout: button.dataset.layoutCard, custom_ui_active: ''});
      closePopups(true);
      return window.NOSLayout?.choose(button.dataset.layoutId, saveLayout);
    }
    if (action === 'close_settings') return closeSettings();
    if (action === 'toggle_settings_dock') return setSettingsDocked(!settingsEditor?.classList.contains('is-docked'));
    if (action === 'open_anki_prefs') { closeSettings(); return command('preferences'); }
    if (action === 'profile') return togglePopup('profile-panel','profile-toggle');
    if (action === 'launcher') return togglePopup('launcher','launcher-toggle');
    if (action === 'pomodoro') {
      closePopups();
      return window.NOSPomodoro?.toggle(button);
    }
    if (action === 'studio') {
      closePopups();
      closeLibrary(false);
      const focusSlot = button.dataset.studioFocus || '';
      const photoId = focusSlot ? state.settings['image_' + focusSlot] : '';
      window.NOSStudio?.open({slot: focusSlot, photoId});
      return;
    }
    if (action === 'view_profile_image') return openLightbox(button.dataset.kind || 'avatar');
    if (action === 'close_lightbox') return closeLightbox();
    if (action === 'lightbox_edit') {
      const target = lightboxState;
      closeLightbox(false);
      if (target) window.NOSStudio?.open({slot: target.kind, photoId: target.photoId});
      return;
    }
    if (action === 'add_menu') return togglePopup('add-menu','add-toggle');
    if (action === 'library') return $('library-dialog').open?closeLibrary():openLibrary();
    if (action === 'close_library') return closeLibrary();
    if (action === 'show_children') return openLibrary({focusDeck:id});
    if (action === 'page') return changePage(value);
    if (action === 'edge_study_now') {
      closePopups();
      const studyBtn = $('study-now');
      if (studyBtn && !studyBtn.disabled) {
        if (state.page !== 'home') changePage('home');
        studyBtn.click();
      } else {
        openLibrary();
      }
      return;
    }
    if (action === 'edge_toggle_peek') {
      const next = app.dataset.edgesPeek !== 'true';
      if (next) app.dataset.edgesPeek = 'true';
      else delete app.dataset.edgesPeek;
      const peekBtn = $('edge-peek-toggle');
      if (peekBtn) peekBtn.setAttribute('aria-pressed', String(next));
      if (next && state.page !== 'home') changePage('home');
      toast(next ? 'Đang ngắm ảnh nền thuần · di chuột lên 4 cạnh để mở dock' : 'Đã hiện lại bảng học tập');
      return;
    }
    if (action === 'theme') return saveUI({theme:state.settings.theme === 'night' ? 'dusk' : 'night'});
    if (action === 'toggle_animations') {
      const next = state.settings.animations === false;
      saveUI({animations: next});
      toast(next ? 'Đã bật hiệu ứng mượt mà' : 'Đã tắt hiệu ứng mượt mà');
      return;
    }
    if (action === 'dismiss_welcome') return saveUI({welcome_dismissed: true, ...(state.settings.addon_version ? {whats_new_seen_version: state.settings.addon_version} : {})});
    if (action === 'welcome_guide') {
      saveUI({welcome_dismissed: true, ...(state.settings.addon_version ? {whats_new_seen_version: state.settings.addon_version} : {})});
      return openGuide('start');
    }
    if (action === 'welcome_settings') {
      saveUI({welcome_dismissed: true, ...(state.settings.addon_version ? {whats_new_seen_version: state.settings.addon_version} : {})});
      return openSettings();
    }
    if (action === 'copy_diagnostics') {
      const client = {width: innerWidth, height: innerHeight, dpr: Number((devicePixelRatio || 1).toFixed(2))};
      if (native) return command('copy_diagnostics', {client});
      const s = state.settings;
      const report = [
        `AnkiNOS: ${$('about-dialog').querySelector('.version-pill').textContent} (preview)`,
        `Display: ${client.width}x${client.height} @${client.dpr}x · scale=${s.ui_scale || 100}%`,
        `UI: layout=${s.layout || defaultLayout} · theme=${s.theme || 'dusk'}/${s.color_theme || 'nos'} · font=${s.font_family || 'system'} · lang=${s.language || 'vi'}`,
      ].join('\n');
      navigator.clipboard?.writeText?.(report).catch(() => {});
      toast('Đã sao chép thông tin hỗ trợ (không gồm dữ liệu thẻ).');
      return;
    }
    if (action === 'collapse_activity') return saveUI({activity_collapsed:!state.settings.activity_collapsed});
    if (action === 'collapse_launchpad') return saveUI({launchpad_collapsed:!state.settings.launchpad_collapsed});
    if (action === 'collapse_sidebar') return saveUI({sidebar_collapsed:!state.settings.sidebar_collapsed});
    if (action === 'view') { saveUI({view:value}); renderLibrary(); return; }
    if (action === 'filter' || action === 'color_filter' || action === 'reset_filter') {
      state.collapsed.clear();
      state.filter = action === 'filter' ? value : 'all';
      state.color = action === 'color_filter' && state.color !== value ? value : '';
      if (action === 'reset_filter') { state.query = ''; $('library-search').value = ''; }
      renderLibrary();
      return;
    }
    if (action === 'expand') {
      const expanded=button.getAttribute('aria-expanded')==='true';
      if(expanded){state.expanded.delete(id);state.collapsed.add(id);}
      else {state.expanded.add(id);state.collapsed.delete(id);}
      renderLibrary(id);return;
    }
    if (action === 'period') { state.period = value; renderHeatmap(); return; }
    if (action === 'heatmap_month') { state.period='month';setCalendar(calendarAnchor().getFullYear(),Number(button.dataset.month),1);return; }
    if (action === 'calendar_today') { state.calendar=state.snapshot?.today||loadingToday;renderHeatmap();return; }
    if (action === 'year') { const next=calendarStep(Number(value));setCalendar(next.getFullYear(),next.getMonth(),next.getDate());return; }
    closePopups();
    if(action==='snapshot')return command(action,{force:true});
    command(action, id ? {id} : {});
  });

  document.addEventListener('click', event => {
    for (const [id,toggle] of popups) {
      if (id === 'launcher' && event.target.closest('[data-action="launcher"]')) continue;
      if (!$(id).contains(event.target) && !$(toggle).contains(event.target)) setPopup(id,toggle,false);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !$('layout-menu').hidden) closePopups(true);
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === 'KeyL' &&
        !app.querySelector('dialog[open]') && !event.target.closest?.('input,select,textarea,[contenteditable]')) {
      event.preventDefault();
      if (!event.repeat) {
        closePopups(true);
        window.NOSLayout?.cycle(saveLayout);
      }
      return;
    }
    if(event.key==='Tab'&&$('library-dialog').open){
      // Fixed header/footer boundaries avoid measuring every offscreen row.
      const dialog=$('library-dialog'),first=$('library-search'),active=document.activeElement;
      let last=$('refresh-button');
      if(last.disabled)last=Array.from(dialog.querySelectorAll('button,input,select')).reverse().find(node=>!node.disabled&&!node.closest('[hidden]')&&node.getClientRects().length);
      if((event.shiftKey&&active===first)||(!event.shiftKey&&active===last)||!dialog.contains(active)){
        event.preventDefault();(event.shiftKey?last:first)?.focus({preventScroll:true});
      }
    }
    if (event.key === 'Escape') {
      if ($('studio-dialog').open) {
        event.preventDefault();
        window.NOSStudio.close();
        return;
      }
      const nestedMenu=!$('add-menu').hidden;
      closePopups(true);$('heat-tooltip').hidden=$('chart-tooltip').hidden=true;
      if($('welcome-overlay') && !$('welcome-overlay').hidden){event.preventDefault();saveUI({welcome_dismissed:true});}
      if($('image-lightbox-dialog')?.open){event.preventDefault();closeLightbox();}
      if($('about-dialog')?.open){event.preventDefault();closeAbout();}
      if($('changelog-dialog')?.open){event.preventDefault();closeChangelog();}
      if($('custom-ui-dialog')?.open){event.preventDefault();window.NOSCustomUI?.close();}
      if(window.NOSCustomUI?.isLiveEditing?.()){event.preventDefault();window.NOSCustomUI.finishLiveEdit(false);}
      if($('guide-dialog')?.open){event.preventDefault();closeGuide();}
      if(settingsEditor){event.preventDefault();closeSettings();}
      if($('library-dialog').open){event.preventDefault();if(!nestedMenu)closeLibrary();}
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if(event.shiftKey)openLibrary({search:true});else openCommands();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      if (settingsEditor === $('settings-dialog')) closeSettings();
      else if (!settingsEditor) openSettings();
    }
  });
  $('library-search').addEventListener('input', throttleRAF('search', event => { state.query = event.target.value; state.collapsed.clear(); renderLibrary(); }));
  $('library-dialog').addEventListener('cancel',event=>{event.preventDefault();closeLibrary();});
  $('library-dialog').addEventListener('click',event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){
      closeLibrary(false);
      // Forward a single click on the visible rail or topbar so switching tabs never needs 2 clicks.
      const underlying=document.elementFromPoint(event.clientX,event.clientY)?.closest('.rail button, .topbar button, .nos-edge-dock button');
      if(underlying && underlying.id!=='library-toggle' && !underlying.disabled){
        underlying.click();
      }else{
        $('library-toggle').focus({preventScroll:true});
      }
    }
  });
  for (const dialog of [$('settings-dialog'), $('appearance-dialog')]) {
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
    dialog.addEventListener('click', event => {
      if (event.target === event.currentTarget) closeSettings();
    });
    const dragHead = dialog.querySelector('.settings-heading');
    const panel = dialog.querySelector('.settings-panel');
    if (dragHead && panel) {
      let dragging = false, startX = 0, startY = 0, baseX = 0, baseY = 0, maxDx = 240, maxDy = 180;
      dragHead.addEventListener('dblclick', event => {
        if (event.target.closest('button')) return;
        if (dialog.classList.contains('is-docked')) setSettingsDocked(false);
        else resetSettingsPosition();
      });
      dragHead.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button')) return;
        if (dialog.classList.contains('is-docked') || innerWidth <= 640) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        baseX = settingsDragX;
        baseY = settingsDragY;
        const zoom = Number(app.style.zoom) || 1;
        const rect = panel.getBoundingClientRect();
        maxDx = Math.max(40, (innerWidth - rect.width) / (2 * zoom) + rect.width * 0.25 / zoom);
        maxDy = Math.max(24, (innerHeight - rect.height) / (2 * zoom) + 24);
        dragHead.classList.add('is-dragging');
        dragHead.setPointerCapture?.(event.pointerId);
      });
      dragHead.addEventListener('pointermove', event => {
        if (!dragging) return;
        const zoom = Number(app.style.zoom) || 1;
        settingsDragX = Math.max(-maxDx, Math.min(maxDx, baseX + (event.clientX - startX) / zoom));
        settingsDragY = Math.max(-maxDy, Math.min(maxDy, baseY + (event.clientY - startY) / zoom));
        panel.style.setProperty('--drag-x', `${settingsDragX.toFixed(1)}px`);
        panel.style.setProperty('--drag-y', `${settingsDragY.toFixed(1)}px`);
        dialog.classList.add('is-dragged');
      });
      const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        dragHead.classList.remove('is-dragging');
      };
      dragHead.addEventListener('pointerup', endDrag);
      dragHead.addEventListener('pointercancel', endDrag);
    }
  }
  if ($('about-dialog')) {
    $('about-dialog').addEventListener('cancel', event => { event.preventDefault(); closeAbout(); });
    $('about-dialog').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeAbout();
    });
  }
  if ($('changelog-dialog')) {
    $('changelog-dialog').addEventListener('cancel', event => { event.preventDefault(); closeChangelog(); });
    $('changelog-dialog').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeChangelog();
    });
  }
  $('set-update-notice-muted')?.addEventListener('change', e => saveUI({update_notice_muted: e.target.checked}));
  if ($('guide-dialog')) {
    $('guide-dialog').addEventListener('cancel', event => { event.preventDefault(); closeGuide(); });
    $('guide-dialog').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeGuide();
    });
  }
  if ($('image-lightbox-dialog')) {
    $('image-lightbox-dialog').addEventListener('cancel', event => { event.preventDefault(); closeLightbox(); });
    $('image-lightbox-dialog').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeLightbox();
    });
  }
  $('set-blur')?.addEventListener('change', e => saveUI({blur: e.target.checked}));
  $('set-glass-blur')?.addEventListener('input', e => {
    const val = Number(e.target.value);
    if ($('glass-blur-val')) $('glass-blur-val').textContent = `${val} px`;
    saveUI({glass_blur: val});
  });
  $('set-glass-opacity')?.addEventListener('input', e => {
    const val = Number(e.target.value);
    if ($('glass-opacity-val')) $('glass-opacity-val').textContent = `${val}%`;
    saveUI({glass_opacity: val});
  });
  $('set-surface-style').addEventListener('change', e => saveUI({surface_style: e.target.value}));
  $('set-motion-preset').addEventListener('change', e => {
    saveUI({motion_preset: e.target.value});
    previewAnimation?.cancel();
    previewAnimation = animatePageEnter($('motion-sample'), settingsDraft || state.settings);
  });
  $('set-motion-duration').addEventListener('input', e => {
    const val = Number(e.target.value);
    if ($('motion-duration-val')) $('motion-duration-val').textContent = `${val} ms`;
    saveUI({motion_duration: val});
  });
  $('set-motion-duration').addEventListener('change', () => {
    previewAnimation?.cancel();
    previewAnimation = animatePageEnter($('motion-sample'), settingsDraft || state.settings);
  });
  $('motion-preview').addEventListener('click', () => {
    previewAnimation?.cancel();
    previewAnimation = animatePageEnter($('motion-sample'), settingsDraft || state.settings);
  });
  $('set-animations')?.addEventListener('change', e => saveUI({animations: e.target.checked}));
  $('set-stat-retention')?.addEventListener('change', e => saveUI({stat_retention: e.target.checked}));
  $('set-stat-pace')?.addEventListener('change', e => saveUI({stat_pace: e.target.checked}));
  $('set-stat-time')?.addEventListener('change', e => saveUI({stat_time: e.target.checked}));
  $('set-stat-studied')?.addEventListener('change', e => saveUI({stat_studied: e.target.checked}));
  $('set-custom-greeting')?.addEventListener('input', e => saveUI({custom_greeting: e.target.value}));
  $('set-lite-mode')?.addEventListener('change', e => saveUI({lite_mode: e.target.checked}));
  $('set-heatmap-day')?.addEventListener('change', e => saveUI({heatmap_day: e.target.value}));
  $('set-custom-accent')?.addEventListener('input',e=>saveUI({accent:'custom',custom_accent:e.target.value}));
  $('set-custom-text')?.addEventListener('input',e=>saveUI({text_color:'custom',custom_text_color:e.target.value}));
  $('stab-colors').addEventListener('input', event => {
    const role = event.target.dataset.themeRole;
    if (role && settingsDraft) saveUI({theme_overrides: {...settingsDraft.theme_overrides, [role]: event.target.value}});
  });
  $('set-reviewer-card-opacity')?.addEventListener('input',e=>{
    const val = Number(e.target.value);
    if ($('reviewer-card-opacity-val')) $('reviewer-card-opacity-val').textContent = `${val}%`;
    saveUI({reviewer_card_opacity: val});
  });
  for (const [id, key] of [
    ['set-rating-again', 'rating_color_again'],
    ['set-rating-hard', 'rating_color_hard'],
    ['set-rating-good', 'rating_color_good'],
    ['set-rating-easy', 'rating_color_easy'],
  ]) {
    $(id)?.addEventListener('input', e => saveUI({rating_colors: 'custom', [key]: e.target.value}));
  }
  $('set-heatmap-palette')?.addEventListener('change', e => saveUI({heatmap_palette: e.target.value}));
  $('set-goal-num')?.addEventListener('change', e => {
    const val = Math.max(1, Number(e.target.value) || 200);
    saveUI({goal: val});
    if ($('set-goal-range')) $('set-goal-range').value = Math.min(500, val);
  });
  $('set-goal-range')?.addEventListener('input', e => {
    const val = Number(e.target.value);
    if ($('set-goal-num')) $('set-goal-num').value = val;
    saveUI({goal: val});
  });
  window.addEventListener('resize', throttleRAF('resize', positionLibrary), {passive:true});
  $('library-sort').addEventListener('change', event => { state.sort = event.target.value; renderLibrary(); });
  $('heatmap-year-select').addEventListener('change', event => setCalendar(Number(event.target.value),calendarAnchor().getMonth()));
  $('heatmap-month-select').addEventListener('change', event => setCalendar(calendarAnchor().getFullYear(),Number(event.target.value),1));
  document.addEventListener('fullscreenchange',() => fullscreenState(!!document.fullscreenElement));
  for (const svg of app.querySelectorAll('.sparkline')) {
    svg.addEventListener('pointermove', throttleRAF('pointer', event => {
      const rect=svg.getBoundingClientRect();
      chartTooltip(svg,Math.max(0,Math.min(13,Math.round((event.clientX-rect.left)/rect.width*13))));
    }));
    svg.addEventListener('pointerleave',() => { $('chart-tooltip').hidden=true;svg.querySelector('.spark-cursor')?.setAttribute('visibility','hidden'); });
    svg.addEventListener('focus',() => {svg.dataset.index='13';chartTooltip(svg,13);});
    svg.addEventListener('blur',() => { $('chart-tooltip').hidden=true;svg.querySelector('.spark-cursor')?.setAttribute('visibility','hidden'); });
    svg.addEventListener('keydown',event => {
      if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const index=Math.max(0,Math.min(13,Number(svg.dataset.index || 13)+(event.key==='ArrowLeft' ? -1 : 1)));
      svg.dataset.index=String(index);chartTooltip(svg,index);
    });
  }
  $('heatmap').addEventListener('pointerover', event => {
    const cell = event.target.closest('[data-tooltip]');
    if (!cell) return;
    const tip = $('heat-tooltip');
    tip.textContent = window.NOSI18n ? window.NOSI18n.t(cell.dataset.tooltip) : cell.dataset.tooltip;
    tip.hidden = false;
    const rect = cell.getBoundingClientRect();
    tip.style.left = `${Math.max(8,Math.min(rect.left,window.innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8,rect.top - tip.offsetHeight - 8)}px`;
  });
  $('heatmap').addEventListener('pointerleave', () => { $('heat-tooltip').hidden = true; });
  window.addEventListener('scroll', throttleRAF('scroll', () => { $('heat-tooltip').hidden = $('chart-tooltip').hidden = true; }), {passive:true});
  app.addEventListener('scroll', throttleRAF('scroll', () => { $('heat-tooltip').hidden = $('chart-tooltip').hidden = true; }), {passive:true});

  function previewData() {
    // This fixture is used only outside Anki, and is visibly labelled as a preview.
    const today = iso(new Date()), end = parseDate(today), days = {};
    for (let i=180; i>=0; i--) {
      if (i % 9 === 0 && i > 27) continue;
      const count = 55 + ((i * 173 + 79) % 220);
      const accuracy=.86+((i*7)%13)/100;
      const passed = Math.round(count*accuracy);
      days[iso(addDays(end,-i))] = {reviews:count, milliseconds:count*(9500+(i%5)*1200), correct:passed, tested:count, passed};
    }
    days[today] = {reviews:186,milliseconds:2232000,correct:172,tested:170,passed:157};
    const deck = (id,name,total,color,children=[]) => ({id,name,full_name:name,total,new:20,learn:4,review:Number(id)%71+15,retention:92.5,children,filtered:false});
    const yesterday=days[iso(addDays(end,-1))];
    const yPace = Math.round((yesterday.reviews / Math.max(1, yesterday.milliseconds / 60000)) * 10) / 10;
    const tPace = Math.round((186 / Math.max(1, 2232000 / 60000)) * 10) / 10;
    const yRet = Math.round((yesterday.correct / yesterday.reviews) * 1000) / 10;
    const trend=(current,previous,comparison) => ({current,previous,percent:previous ? Math.round((current-previous)/previous*1000)/10 : null,comparison});
    return {today, profile:'Minh Quân', due:248,total_cards:9284,days,
      trends:{retention:trend(92.5,Math.min(89.9, yRet),'hôm qua'),pace:trend(tPace,Math.max(tPace + 0.8, yPace),'cùng giờ hôm qua'),milliseconds:trend(2232000,yesterday.milliseconds,'cùng giờ hôm qua'),reviews:trend(186,yesterday.reviews,'cùng giờ hôm qua')},
      stats:{retention:92.5,true_retention:92.4,correct:172,tested:170,pace:tPace,milliseconds:2232000,reviews:186,streak:27},
      decks:[deck('101','Tiếng Anh — Từ vựng',4872,'blue',[deck('111','Từ vựng theo chủ đề',1520,'blue'),deck('112','Collocations & Phrasal Verbs',2180,'purple'),deck('113','Idioms',1172,'purple')]),deck('102','Tiếng Nhật — N5',1986,'pink'),deck('103','Y học cơ sở',1204,'green'),deck('104','Lịch sử Việt Nam',642,'amber')],
      settings:{goal:200,custom_greeting:'',addon_version:'1.0.1-beta.2',whats_new_seen_version:'1.0.1-beta.2',update_notice_muted:false,custom_ui_presets:[],custom_ui_active:'',theme_overrides:{},layout:state.settings.layout || defaultLayout,theme:'dusk',language:new URLSearchParams(location.search).get('lang')||'vi',language_pref:new URLSearchParams(location.search).get('lang')||'vi',welcome_dismissed:true,view:'list',last_study_deck:'101',study_budget:30,favorites:['101'],colors:{'101':'blue','102':'pink','103':'green','104':'amber','111':'blue','112':'purple','113':'purple'},resources:[{id:'r1',name:'500 Idioms thông dụng',kind:'pdf',detail:'12,4 MB',path:'Tài nguyên minh họa'},{id:'r2',name:'Từ vựng TOEIC',kind:'link',detail:'quizlet.com',path:'Liên kết minh họa'},{id:'r3',name:'Ngữ pháp tiếng Anh',kind:'epub',detail:'5,1 MB',path:'Tài nguyên minh họa'}]}};
  }
  // Paint immediately from inline bootstrap when hosted in Anki so startup
  // feels instantaneous, then pull the prefetched full revlog snapshot if partial.
  const dashboardBootstrap = $('nos-dashboard-bootstrap');
  if (native && dashboardBootstrap) {
    try {
      const boot = JSON.parse(dashboardBootstrap.textContent);
      receive({event: 'snapshot', payload: boot});
      if (boot.partial) command('snapshot');
    } catch {
      renderHeatmap();
      command('snapshot');
    }
  } else {
    renderHeatmap();
    command('snapshot');
  }
  if (native) {
    // Keep live card counts (including intraday learning steps) synced while visible.
    let pollTimer = 0;
    const pollSnapshot = () => {
      if (!document.hidden) command('snapshot');
      pollTimer = setTimeout(pollSnapshot, 30000);
    };
    pollTimer = setTimeout(pollSnapshot, 30000);
    const maybeSyncOnFocus = () => {
      const anyDialogOpen = ['appearance-dialog','settings-dialog','studio-dialog','about-dialog','guide-dialog','image-lightbox-dialog']
        .some(id => $(id)?.open);
      if (!anyDialogOpen && !document.hidden && performance.now() - lastSnapshotAt > 4000)
        command('snapshot');
    };
    window.addEventListener('focus', maybeSyncOnFocus, {passive:true});
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) maybeSyncOnFocus();
    }, {passive:true});
  }
})();
