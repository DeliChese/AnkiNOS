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
  const format = new Intl.NumberFormat('vi-VN');
  const historyDate = new Intl.DateTimeFormat('vi-VN', {day:'numeric',month:'long',year:'numeric'});
  const n = value => format.format(value ?? 0);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const iso = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const parseDate = value => new Date(`${value}T12:00:00`);
  const addDays = (date, days) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
  const state = {snapshot: null, settings: {}, filter: 'all', color: '', query: '', sort: 'name', period: 'year', year: null, expanded: new Set(), collapsed: new Set(), page: 'home'};
  let toastTimer;
  let refreshTimer;
  let snapshotPending=false;
  const historyPending=new Set();
  const loadingToday=iso(new Date());
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
      if (performance.now() - bridgeStarted < 15000) setTimeout(() => command(action,args),50);
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
    Object.assign(state.settings, patch);
    applySettings();
    command('save_ui', {values: patch});
  }

  function setPopup(id, toggle, show) {
    $(id).hidden = !show;
    $(toggle).setAttribute('aria-expanded', String(show));
  }

  function closePopups(restoreFocus = false) {
    for (const [id, toggle] of [['profile-panel','profile-toggle'],['launcher','launcher-toggle'],['add-menu','add-toggle'],['info-panel','info-toggle']]) {
      if (!$(id).hidden && restoreFocus) $(toggle).focus();
      setPopup(id, toggle, false);
    }
  }

  function togglePopup(id, toggle) {
    const show = $(id).hidden;
    closePopups();
    setPopup(id, toggle, show);
    if (show) $(id).querySelector('button')?.focus();
  }

  function positionLibrary(prepare=false) {
    const dialog=$('library-dialog');
    if(!dialog.open&&prepare!==true)return;
    const anchor=$('library-toggle').getBoundingClientRect();
    const narrow=innerWidth<=720;
    const height=Math.min(760,innerHeight-(narrow?125:56));
    const left=narrow?16:anchor.right+24;
    const width=narrow?innerWidth-32:Math.min(1280,innerWidth-left-24);
    const top=narrow?16:Math.max(24,Math.min(anchor.top-50,innerHeight-height-28));
    dialog.dataset.side=narrow?'bottom':'left';
    Object.entries({'--popover-left':`${left}px`,'--popover-top':`${top}px`,'--popover-width':`${width}px`,'--popover-height':`${height}px`,'--anchor-y':`${Math.max(30,Math.min(height-30,anchor.top+anchor.height/2-top))}px`,'--anchor-x':`${Math.max(30,Math.min(width-30,anchor.left+anchor.width/2-left))}px`}).forEach(([key,value])=>dialog.style.setProperty(key,value));
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
    closePopups();
    if(focusDeck&&state.snapshot) {
      const target=deckIndex.get(focusDeck);
      state.filter='all';state.color='';state.query='';$('library-search').value='';
      if(target)for(const deck of allDecks) {
        if(deck.id===focusDeck||target.full_name.startsWith(deck.full_name+'::')) {
          state.expanded.add(deck.id);state.collapsed.delete(deck.id);
        }
      }
      renderLibrary(focusDeck);
    }
    const dialog=$('library-dialog');
    // Set the final geometry before showModal's first layout/focus pass.
    positionLibrary(true);
    if(!dialog.open)dialog.showModal();
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

  const ACCENT_MAP = {
    blue: '#83b8ff',
    cyan: '#38bdf8',
    mint: '#34d399',
    purple: '#c084fc',
    amber: '#fbbf24',
    pink: '#f472b6'
  };

  function openSettings(initialTab = 'appearance') {
    closePopups();
    closeLibrary(false);
    switchSettingsTab(initialTab);
    syncSettingsForm();
    const dialog = $('settings-dialog');
    if (!dialog.open) dialog.showModal();
    app.classList.add('settings-open');
    $('settings-close')?.focus({preventScroll: true});
  }

  function closeSettings(restoreFocus = true) {
    const dialog = $('settings-dialog');
    if (!dialog.open) return;
    dialog.close();
    app.classList.remove('settings-open');
    if (restoreFocus) app.querySelector('[data-action="preferences"]')?.focus({preventScroll: true});
  }

  function switchSettingsTab(tabName) {
    app.querySelectorAll('.settings-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.settingsTab === tabName);
    });
    app.querySelectorAll('.settings-tab-pane').forEach(pane => {
      pane.hidden = pane.id !== `stab-${tabName}`;
    });
  }

  function syncSettingsForm() {
    const s = state.settings;
    app.querySelectorAll('.theme-pill-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.setTheme || 'dusk') === (s.theme || 'dusk'));
    });
    app.querySelectorAll('.accent-dot-btn').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.setAccent || 'blue') === (s.accent || 'blue'));
    });
    if ($('set-blur')) $('set-blur').checked = s.blur !== false;
    if ($('set-animations')) $('set-animations').checked = s.animations !== false;
    if ($('set-stat-retention')) $('set-stat-retention').checked = s.stat_retention !== false;
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
  }

  function exportSettings() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state.settings, null, 2));
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
            saveUI(imported);
            syncSettingsForm();
            toast('Đã nhập và áp dụng cấu hình AnkiNOS.');
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
    if (confirm('Khôi phục toàn bộ cài đặt AnkiNOS về mặc định ban đầu?')) {
      const defaults = {
        goal: 200, theme: 'dusk', accent: 'blue',
        blur: true, animations: true, ui_scale: 100,
        stat_retention: true, stat_pace: true, stat_time: true, stat_studied: true,
        heatmap_day: 'monday', heatmap_palette: 'default', lite_mode: false
      };
      saveUI(defaults);
      syncSettingsForm();
      heatmapKey = '';
      renderHeatmap();
      renderStats();
      toast('Đã đặt lại cấu hình AnkiNOS về mặc định.');
    }
  }

  function applySettings() {
    const s = state.settings;
    app.dataset.theme = s.theme || 'dusk';
    const accentHex = ACCENT_MAP[s.accent] || ACCENT_MAP.blue;
    app.style.setProperty('--blue', accentHex);

    app.classList.toggle('lite-mode', !!s.lite_mode);
    app.classList.toggle('no-blur', s.blur === false);
    app.classList.toggle('reduce-motion', s.animations === false);
    if (s.ui_scale && s.ui_scale !== 100) {
      app.style.zoom = String(s.ui_scale / 100);
    } else {
      app.style.zoom = '';
    }

    if ($('card-retention')) $('card-retention').hidden = s.stat_retention === false;
    if ($('card-pace')) $('card-pace').hidden = s.stat_pace === false;
    if ($('card-time')) $('card-time').hidden = s.stat_time === false;
    if ($('card-studied')) $('card-studied').hidden = s.stat_studied === false;

    app.dataset.heatPalette = s.heatmap_palette || 'default';

    for (const [panel, key, action, label] of [['activity-panel','activity_collapsed','collapse_activity','hoạt động']]) {
      const collapsed = !!s[key];
      $(panel).classList.toggle('collapsed', collapsed);
      const button = app.querySelector(`[data-action="${action}"]`);
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', `${collapsed ? 'Mở rộng' : 'Thu gọn'} ${label}`);
      button.title = button.getAttribute('aria-label');
    }
    $('library-panel').classList.toggle('sidebar-hidden', !!s.sidebar_collapsed);
    $('sidebar-toggle').setAttribute('aria-expanded', String(!s.sidebar_collapsed));
    $('sidebar-toggle').setAttribute('aria-label', s.sidebar_collapsed ? 'Hiện bộ lọc' : 'Ẩn bộ lọc');
    $('theme-label').textContent = s.theme === 'night' ? 'Chuyển sang kính hoàng hôn' : 'Chuyển sang kính tối';
    app.querySelectorAll('[data-action="view"]').forEach(button => {
      const selected = button.dataset.value === (s.view || 'list');
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    syncSettingsForm();
  }

  function duration(ms) {
    const minutes = Math.floor(ms / 60000);
    if (minutes >= 60) return `${Math.floor(minutes / 60)}<small>h</small> ${minutes % 60}<small>m</small>`;
    if (minutes) return `${minutes} <small>phút</small>`;
    return `${Math.floor(ms / 1000)} <small>giây</small>`;
  }

  function renderStats() {
    const data = state.snapshot, stats = data.stats;
    const goal = Math.max(1, Number(state.settings.goal) || 200);
    const percent = Math.round(stats.reviews / goal * 100);
    const initials = data.profile.trim().split(/\s+/).slice(-2).map(word => [...word][0]).join('').toUpperCase();
    $('avatar-initials').textContent = $('profile-initials').textContent = initials || 'A';
    $('profile-name').textContent = data.profile;
    const now = new Date(), hour = now.getHours();
    const salutation = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
    $('greeting-title').innerHTML = `${salutation}, ${escape(data.profile)} <span class="greeting-spark">✦</span>`;
    $('today-label').textContent = new Intl.DateTimeFormat('vi-VN', {weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(now).toUpperCase();
    $('greeting-caption').textContent = data.due ? `${n(data.due)} thẻ đang chờ bạn. Bắt đầu một chút, nhớ thêm thật nhiều.` : 'Một khoảng lặng để học, một bước nhỏ để tiến xa.';
    $('goal-ring').style.setProperty('--progress', `${Math.min(100, percent)}%`);
    $('goal-percent').textContent = `${percent}%`;
    $('goal-copy').textContent = `${n(stats.reviews)} / ${n(goal)} lượt ôn`;
    $('profile-goal-text').textContent = `${n(stats.reviews)} / ${n(goal)}`;
    $('profile-goal-fill').style.width = `${Math.min(100, percent)}%`;
    const retention = stats.retention == null ? '—' : `${n(stats.retention)}%`;
    $('stat-retention').textContent = $('profile-retention').textContent = retention;
    $('retention-detail').textContent = stats.tested ? `${n(stats.tested)} lượt kiểm tra · 30 ngày` : 'Chưa có lượt ôn đến hạn';
    $('stat-pace').innerHTML = `${stats.pace == null ? '—' : n(stats.pace)} <small>lượt/giờ</small>`;
    $('stat-time').innerHTML = duration(stats.milliseconds);
    $('stat-studied').innerHTML = `${n(stats.reviews)} <small>lượt</small>`;
    $('studied-detail').textContent = `${n(data.total_cards)} thẻ trong bộ sưu tập`;
    $('streak-copy').textContent = `${n(stats.streak)} ngày liên tiếp`;
    $('profile-streak').textContent = `${n(stats.streak)} ngày`;
    $('profile-total').textContent = `${n(data.total_cards)} thẻ`;
    const recent = Array.from({length:14}, (_, i) => {
      const date = iso(addDays(parseDate(data.today), i - 13));
      return {date, ...(data.days[date] || {reviews:0, milliseconds:0, tested:0, passed:0})};
    });
    for (const [id,key,unit,value] of [
      ['retention','retention','%', d => d.tested ? d.passed / d.tested * 100 : null],
      ['pace','pace','lượt/giờ', d => d.milliseconds ? d.reviews / (d.milliseconds / 3600000) : null],
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
    const values = available.map(point => point.value), min = Math.min(...values), max = Math.max(...values);
    const range = max - min || Math.max(Math.abs(max)*.1,1);
    const points = series.map((point,i) => point.value == null ? null : {x:6+i*148/(series.length-1),y:max === min ? 30 : 52-(point.value-min)/range*44});
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
    }).join('') + points.filter(Boolean).map(({x,y}) => `<circle class="spark-point" cx="${x}" cy="${y}" r="1.5" fill="currentColor"/>`).join('') + '<line class="spark-cursor" y1="4" y2="59" stroke="currentColor" stroke-dasharray="2 3" visibility="hidden"/>';
  }

  function chartTooltip(svg,index) {
    const data=chartSeries.get(svg.id);
    if (!data) return;
    const point=data.series[index], tip=$('chart-tooltip'), rect=svg.getBoundingClientRect();
    tip.textContent = `${new Intl.DateTimeFormat('vi-VN',{day:'numeric',month:'numeric'}).format(parseDate(point.date))} · ${point.value == null ? 'Chưa có lượt đo' : `${n(Math.round(point.value*10)/10)} ${data.unit}`}`;
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

  function heatCell(date, year, month = null) {
    const waiting=!state.snapshot||(state.snapshot.history_loaded_years&&!state.snapshot.history_loaded_years.includes(year));
    const key = iso(date), data = waiting?null:state.snapshot.days[key];
    const reviews = data?.reviews || 0;
    const level = reviews >= 200 ? 4 : reviews >= 100 ? 3 : reviews >= 40 ? 2 : reviews ? 1 : 0;
    const blank = date.getFullYear() !== year || (month != null && date.getMonth() !== month);
    const future = key > (state.snapshot?.today||loadingToday);
    const label = !waiting ? `${historyDate.format(date)} · ${n(reviews)} lượt ôn${future ? ' · Chưa đến ngày' : ''}` : 'Đang tải lịch sử ôn tập…';
    return `<div class="heat-cell heat-${level}${blank ? ' blank' : ''}${future ? ' future' : ''}" ${blank ? 'aria-hidden="true"' : `data-tooltip="${escape(label)}" aria-label="${escape(label)}" role="img"`}>${month != null && !blank ? date.getDate() : ''}</div>`;
  }

  function renderHeatmap() {
    const data=state.snapshot||{days:{},today:loadingToday};
    const key=JSON.stringify([!!state.snapshot,data.days,data.today,data.history_start_year,data.history_loaded_years,state.period,state.year]);
    if(key===heatmapKey)return;
    heatmapKey=key;
    const target = $('heatmap'), today = parseDate(data.today), year = state.year??today.getFullYear();
    const awaiting=!!data.history_loaded_years&&!data.history_loaded_years.includes(year);
    target.setAttribute('aria-busy',String(!state.snapshot||awaiting));
    const isSunday = (state.settings.heatmap_day || 'monday') === 'sunday';
    const dayNames = isSunday ? ['CN','T2','T3','T4','T5','T6','T7'] : ['T2','T3','T4','T5','T6','T7','CN'];
    let start, end, html = '';
    const earliest = data.history_start_year??Math.min(today.getFullYear(), ...Object.keys(data.days).map(key => Number(key.slice(0,4))));
    app.querySelector('[data-action="year"][data-value="-1"]').disabled = year <= earliest;
    app.querySelector('[data-action="year"][data-value="1"]').disabled = year >= today.getFullYear();
    target.className = 'heatmap';
    if (state.period === 'year') {
      $('heatmap-year').textContent = year;
      const first = new Date(year,0,1,12);
      const offset = isSunday ? first.getDay() : ((first.getDay()+6)%7);
      start = addDays(first, -offset);
      end = new Date(year,11,31,12);
      const weeks = Math.ceil((Math.round((end-start)/86400000)+1)/7);
      target.style.setProperty('--weeks', weeks);
      html = '<span></span>';
      let lastMonth = -1;
      for (let week = 0; week < weeks; week++) {
        const date = addDays(start, week*7+3);
        const month = date.getMonth();
        const label = date.getFullYear() === year && month !== lastMonth ? `Tháng ${month+1}` : '';
        html += `<span class="heat-month">${label}</span>`;
        if (date.getFullYear() === year) lastMonth = month;
      }
      for (let day = 0; day < 7; day++) {
        html += `<span class="heat-day">${dayNames[day]}</span>`;
        for (let week = 0; week < weeks; week++) html += heatCell(addDays(start, week*7+day), year);
      }
    } else if (state.period === 'month') {
      const month = today.getMonth();
      $('heatmap-year').textContent = `T${month+1} · ${year}`;
      target.classList.add('month-map');
      const first = new Date(year,month,1,12);
      const mOffset = isSunday ? first.getDay() : ((first.getDay()+6)%7);
      start = addDays(first,-mOffset);
      end = new Date(year,month+1,0,12);
      const cells = Math.ceil((Math.round((end-start)/86400000)+1)/7)*7;
      html = dayNames.map(day => `<span class="heat-day">${day}</span>`).join('');
      for (let i=0; i<cells; i++) html += heatCell(addDays(start,i),year,month);
    } else {
      const anchor = new Date(year,today.getMonth(),today.getDate(),12);
      const wOffset = isSunday ? anchor.getDay() : ((anchor.getDay()+6)%7);
      start = addDays(anchor,-wOffset);
      end = addDays(start,6);
      $('heatmap-year').textContent = year;
      const values = Array.from({length:7}, (_,i) => data.days[iso(addDays(start,i))]?.reviews || 0);
      const max = Math.max(...values,1);
      html = '<div class="week-chart">' + values.map((count,i) => `<div class="week-day"><span class="week-count">${n(count)}</span><div class="week-bar" style="height:${Math.max(2,count/max*100)}px"></div><span>${dayNames[i]} · ${addDays(start,i).getDate()}/${addDays(start,i).getMonth()+1}</span></div>`).join('') + '</div>';
    }
    target.innerHTML = html;
    const from = state.period === 'year' ? `${year}-01-01` : state.period === 'month' ? iso(new Date(year,today.getMonth(),1,12)) : iso(start);
    const to = iso(end);
    const entries = Object.entries(data.days).filter(([key]) => key >= from && key <= to);
    const total = entries.reduce((sum, [,day]) => sum + day.reviews,0);
    if(state.snapshot)$('activity-summary').textContent = `${n(total)} lượt ôn · ${n(entries.filter(([,day]) => day.reviews > 0).length)} ngày học ${state.period === 'year' ? `trong năm ${year}` : state.period === 'month' ? 'trong tháng' : 'trong tuần'}`;
    if(awaiting){
      $('activity-summary').textContent=`Đang tải lịch sử năm ${year}…`;
      if(!historyPending.has(year)){
        historyPending.add(year);
        command('history_year',{year});
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
  const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children || [])]);
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
  }

  function filterTree(nodes,query=searchText(state.query.trim())) {
    return nodes.map(node => {
      const children = filterTree(node.children || [],query);
      let match = searchText(node.full_name).includes(query);
      if (state.filter === 'resources') match = false;
      if (state.filter === 'favorites') match = match && (state.settings.favorites || []).includes(node.id);
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
    return `<div class="deck-group ${deck.children.length?'deck-parent':'deck-leaf'}" data-deck-id="${buttonId}" data-parent-id="${escape(deck.parent_id||'')}">
      <div class="deck-row">
        ${hasChildren ? `<button class="deck-expand" data-action="expand" data-id="${buttonId}" aria-label="${expanded?'Thu gọn':'Mở rộng'} ${escape(deck.name)}" aria-expanded="${!!expanded}" aria-controls="children-${buttonId}">${icon('chevron')}</button>` : '<span class="deck-expand-spacer"></span>'}
        <span class="folder ${deckColor(deck)}" aria-hidden="true"></span>
        <div class="deck-info"><button class="deck-name" data-action="study" data-id="${buttonId}" title="${escape(deck.full_name)}">${escape(deck.name)}</button>
          <div class="deck-meta"><span>${n(deck.total)} thẻ${deck.children.length?` · ${n(deck.children.length)} bộ con`:''}</span>${deck.retention==null?'':`<span class="retention-chip" title="Ghi nhớ trong 30 ngày">${icon('chart')}${n(deck.retention)}%</span>`}${deck.filtered?'<span>Bộ lọc</span>':''}</div>
          ${deck.children.length?`<button class="subdecks-button" data-action="${expanded?'expand':'show_children'}" data-id="${buttonId}" aria-expanded="${!!expanded}" aria-controls="children-${buttonId}">${icon(expanded?'down':'layers','small')}${expanded?'Thu gọn deck con':`Xem ${n(deck.children.length)} deck con`}</button>`:''}
        </div>
        <div class="deck-counts" aria-label="${deck.new} mới, ${deck.learn} đang học, ${deck.review} cần ôn"><span class="new-count" title="Thẻ mới">${n(deck.new)}</span><span class="learn-count" title="Đang học">${n(deck.learn)}</span><span class="review-count" title="Cần ôn">${n(deck.review)}</span></div>
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
    const treeKey=JSON.stringify([libraryRevision,state.filter,state.color,state.query,state.sort]);
    const renderKey=JSON.stringify([treeKey,state.settings.view,[...state.expanded],[...state.collapsed]]);
    if(renderKey===libraryRenderKey)return;
    libraryRenderKey=renderKey;
    const sameTree=treeKey===libraryTreeKey;
    if(!sameTree){
      libraryTreeKey=treeKey;
      libraryTree=filterTree(state.snapshot.decks);
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
    $('resource-list').innerHTML = matches.length ? matches.map(resource => `<div class="resource-card"><button class="resource-open" data-action="open_resource" data-id="${escape(resource.id)}" title="${escape(resource.path)}"><span class="file-icon ${resource.kind === 'pdf' ? 'pdf' : resource.kind === 'link' ? 'link' : ''}">${icon(resource.kind === 'link' ? 'link' : 'file')}</span><span class="resource-info"><span class="resource-name">${escape(resource.name)}</span><span class="resource-detail">${escape(resource.kind.toUpperCase())} · ${escape(resource.detail)}</span></span></button><button class="more-button" data-action="resource_menu" data-id="${escape(resource.id)}" aria-label="Tùy chọn ${escape(resource.name)}">${icon('more')}</button></div>`).join('') : `<div class="resource-empty">${icon('file')}<span>Gắn PDF, tài liệu hoặc liên kết để học cùng bộ thẻ.</span><button class="text-button" data-action="add_file">Thêm file ${icon('plus','small')}</button></div>`;
    $('empty-state').hidden = decks.length > 0 || (showResources && (matches.length > 0 || !state.query));
    $('library-footer-copy').textContent = `${n(all.length)} bộ thẻ · ${n(resources.length)} tài nguyên · ${n(state.snapshot.total_cards)} thẻ`;
    if (!all.length && state.filter !== 'resources' && !state.query && !state.color) {
      $('deck-section').hidden = false;
      $('deck-list').innerHTML = `<div class="resource-empty">${icon('folder')}<span>Bộ sưu tập chưa có bộ thẻ.</span><button class="subtle-button" data-action="create_deck">Tạo bộ thẻ</button></div>`;
    }
  }
  function flattenFiltered(nodes) {
    return nodes.flatMap(node=>[node,...flattenFiltered(node.visibleChildren||[])]);
  }

  function changePage(page) {
    if(page==='library'){openLibrary();return;}
    closeLibrary(false);
    state.page = page;
    app.dataset.page = page;
    app.scrollTop=0;
    app.querySelectorAll('.rail-main [data-action="page"]').forEach(button => {
      button.classList.toggle('active', button.dataset.value === page);
      if (button.dataset.value === page) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    });
    closePopups();
  }

  function receive({event, payload}) {
    const previousGoal=state.settings.goal;
    if(event==='history_year'&&state.snapshot){
      const {year,days}=payload;
      historyPending.delete(year);
      state.snapshot.days={...Object.fromEntries(Object.entries(state.snapshot.days).filter(([date])=>!date.startsWith(`${year}-`))),...days};
      state.snapshot.history_loaded_years=[...new Set([...(state.snapshot.history_loaded_years||[]),year])];
      renderHeatmap();return;
    }
    if(event==='history_error'){
      historyPending.delete(payload.year);heatmapKey='';
      $('heatmap').setAttribute('aria-busy','false');
      $('activity-summary').textContent='Không thể tải lịch sử. Nhấn Làm mới để thử lại.';
      toast(payload.message);return;
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
      state.snapshot = payload;
      state.settings = payload.settings || {};
      fullscreenState(native ? !!payload.fullscreen : !!document.fullscreenElement);
      state.year ??= Number(payload.today.slice(0,4));
      clearTimeout(refreshTimer);
      $('refresh-button').disabled = false;
      $('connection').innerHTML = `<span class="status-dot"></span>${native ? 'Bộ sưu tập Anki' : 'Bản xem trước'}`;
      $('page-footnote').textContent = native ? 'Dữ liệu từ bộ sưu tập Anki của bạn' : 'Dữ liệu minh họa · Mở Anki để dùng bộ sưu tập thật';
    } else if (event === 'settings') state.settings = payload;
    if (!state.snapshot) return;
    applySettings();
    if(event==='snapshot'||state.settings.goal!==previousGoal)renderStats();
    if (event === 'snapshot') renderHeatmap();
    updateLibraryData(event==='snapshot');
    renderLibrary();
    if(event==='snapshot'&&payload.library_focus) {
      openLibrary({focusDeck:payload.library_focus});
      command('library_ack',{id:payload.library_focus});
    }
  }
  window.AnkiNOS = {receive};

  app.addEventListener('click', event => {
    const navBtn = event.target.closest('.settings-nav-btn[data-settings-tab]');
    if (navBtn) { switchSettingsTab(navBtn.dataset.settingsTab); return; }
    const themeBtn = event.target.closest('.theme-pill-btn[data-set-theme]');
    if (themeBtn) { saveUI({theme: themeBtn.dataset.setTheme}); return; }
    const accentBtn = event.target.closest('.accent-dot-btn[data-set-accent]');
    if (accentBtn) { saveUI({accent: accentBtn.dataset.setAccent}); return; }
    const scaleBtn = event.target.closest('.scale-btn[data-scale]');
    if (scaleBtn) { saveUI({ui_scale: Number(scaleBtn.dataset.scale)}); return; }
    if (event.target.closest('#btn-export-settings')) { exportSettings(); return; }
    if (event.target.closest('#btn-import-settings')) { importSettings(); return; }
    if (event.target.closest('#btn-reset-settings')) { resetSettings(); return; }

    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const {action, value, id} = button.dataset;
    if (action === 'preferences') return $('settings-dialog').open ? closeSettings() : openSettings();
    if (action === 'close_settings') return closeSettings();
    if (action === 'open_anki_prefs') { closeSettings(); return command('preferences'); }
    if (action === 'profile') return togglePopup('profile-panel','profile-toggle');
    if (action === 'launcher') return togglePopup('launcher','launcher-toggle');
    if (action === 'info') {
      closeLibrary(false);
      const anchor=$('info-toggle').getBoundingClientRect();
      $('info-panel').style.top=innerWidth<=720?'auto':`${Math.max(16,Math.min(anchor.top-12,innerHeight-130))}px`;
      return togglePopup('info-panel','info-toggle');
    }
    if (action === 'add_menu') return togglePopup('add-menu','add-toggle');
    if (action === 'library') return $('library-dialog').open?closeLibrary():openLibrary();
    if (action === 'close_library') return closeLibrary();
    if (action === 'show_children') return openLibrary({focusDeck:id});
    if (action === 'page') return changePage(value);
    if (action === 'theme') return saveUI({theme:state.settings.theme === 'night' ? 'dusk' : 'night'});
    if (action === 'collapse_activity') return saveUI({activity_collapsed:!state.settings.activity_collapsed});
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
    if (action === 'period') { state.period = value; if (state.snapshot) renderHeatmap(); return; }
    if (action === 'year') { state.year += Number(value); renderHeatmap(); return; }
    closePopups();
    if(action==='snapshot')return command(action,{force:true});
    command(action, id ? {id} : {});
  });

  document.addEventListener('click', event => {
    for (const [id,toggle] of [['profile-panel','profile-toggle'],['launcher','launcher-toggle'],['add-menu','add-toggle'],['info-panel','info-toggle']]) {
      if (!$(id).contains(event.target) && !$(toggle).contains(event.target)) setPopup(id,toggle,false);
    }
  });
  document.addEventListener('keydown', event => {
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
      const nestedMenu=!$('add-menu').hidden;
      closePopups(true);$('heat-tooltip').hidden=$('chart-tooltip').hidden=true;
      if($('settings-dialog')&&$('settings-dialog').open){event.preventDefault();closeSettings();}
      if($('library-dialog').open){event.preventDefault();if(!nestedMenu)closeLibrary();}
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openLibrary({search:true});
    }
    if ((event.ctrlKey || event.metaKey) && event.key === ',') {
      event.preventDefault();
      $('settings-dialog')?.open ? closeSettings() : openSettings();
    }
  });
  $('library-search').addEventListener('input', throttleRAF('search', event => { state.query = event.target.value; state.collapsed.clear(); renderLibrary(); }));
  $('library-dialog').addEventListener('cancel',event=>{event.preventDefault();closeLibrary();});
  $('library-dialog').addEventListener('click',event=>{
    if(event.target!==event.currentTarget)return;
    const rect=event.currentTarget.getBoundingClientRect();
    if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeLibrary();
  });
  if ($('settings-dialog')) {
    $('settings-dialog').addEventListener('cancel', event => { event.preventDefault(); closeSettings(); });
    $('settings-dialog').addEventListener('click', event => {
      if (event.target === event.currentTarget) closeSettings();
    });
  }
  $('set-blur')?.addEventListener('change', e => saveUI({blur: e.target.checked}));
  $('set-animations')?.addEventListener('change', e => saveUI({animations: e.target.checked}));
  $('set-stat-retention')?.addEventListener('change', e => saveUI({stat_retention: e.target.checked}));
  $('set-stat-pace')?.addEventListener('change', e => saveUI({stat_pace: e.target.checked}));
  $('set-stat-time')?.addEventListener('change', e => saveUI({stat_time: e.target.checked}));
  $('set-stat-studied')?.addEventListener('change', e => saveUI({stat_studied: e.target.checked}));
  $('set-lite-mode')?.addEventListener('change', e => saveUI({lite_mode: e.target.checked, blur: !e.target.checked}));
  $('set-heatmap-day')?.addEventListener('change', e => { saveUI({heatmap_day: e.target.value}); heatmapKey=''; renderHeatmap(); });
  $('set-heatmap-palette')?.addEventListener('change', e => saveUI({heatmap_palette: e.target.value}));
  $('set-goal-num')?.addEventListener('change', e => {
    const val = Math.max(1, Number(e.target.value) || 200);
    saveUI({goal: val});
    if ($('set-goal-range')) $('set-goal-range').value = Math.min(500, val);
    renderStats();
  });
  $('set-goal-range')?.addEventListener('input', e => {
    const val = Number(e.target.value);
    if ($('set-goal-num')) $('set-goal-num').value = val;
    saveUI({goal: val});
    renderStats();
  });
  window.addEventListener('resize', throttleRAF('resize', positionLibrary), {passive:true});
  $('library-sort').addEventListener('change', event => { state.sort = event.target.value; renderLibrary(); });
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
    tip.textContent = cell.dataset.tooltip;
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
      days[iso(addDays(end,-i))] = {reviews:count, milliseconds:count*(17000+(i%5)*2300), tested:count, passed:Math.round(count*accuracy)};
    }
    days[today] = {reviews:186,milliseconds:6120000,tested:170,passed:157};
    const deck = (id,name,total,color,children=[]) => ({id,name,full_name:name,total,new:20,learn:4,review:Number(id)%71+15,retention:92.4,children,filtered:false});
    const yesterday=days[iso(addDays(end,-1))];
    const trend=(current,previous,comparison) => ({current,previous,percent:previous ? Math.round((current-previous)/previous*1000)/10 : null,comparison});
    return {today, profile:'Minh Quân', due:248,total_cards:9284,days,
      trends:{retention:trend(92.4,89.9,'30 ngày trước'),pace:trend(109,Math.round(yesterday.reviews/yesterday.milliseconds*3600000),'cùng giờ hôm qua'),milliseconds:trend(6120000,yesterday.milliseconds,'cùng giờ hôm qua'),reviews:trend(186,yesterday.reviews,'cùng giờ hôm qua')},
      stats:{retention:92.4,pace:109,milliseconds:6120000,reviews:186,streak:27,tested:3248},
      decks:[deck('101','Tiếng Anh — Từ vựng',4872,'blue',[deck('111','Từ vựng theo chủ đề',1520,'blue'),deck('112','Collocations & Phrasal Verbs',2180,'purple'),deck('113','Idioms',1172,'purple')]),deck('102','Tiếng Nhật — N5',1986,'pink'),deck('103','Y học cơ sở',1204,'green'),deck('104','Lịch sử Việt Nam',642,'amber')],
      settings:{goal:200,theme:'dusk',view:'list',favorites:['101'],colors:{'101':'blue','102':'pink','103':'green','104':'amber','111':'blue','112':'purple','113':'purple'},resources:[{id:'r1',name:'500 Idioms thông dụng',kind:'pdf',detail:'12,4 MB',path:'Tài nguyên minh họa'},{id:'r2',name:'Từ vựng TOEIC',kind:'link',detail:'quizlet.com',path:'Liên kết minh họa'},{id:'r3',name:'Ngữ pháp tiếng Anh',kind:'epub',detail:'5,1 MB',path:'Tài nguyên minh họa'}]}};
  }
  // Show the calendar structure immediately, then request real data without
  // introducing an artificial startup delay.
  renderHeatmap();
  command('snapshot');
  if (native) {
    // Poll at most every 5 minutes, and only when the window is visible.
    let pollTimer = 0;
    const pollSnapshot = () => {
      if (!document.hidden) command('snapshot');
      pollTimer = setTimeout(pollSnapshot, 300000);
    };
    pollTimer = setTimeout(pollSnapshot, 300000);
    window.addEventListener('focus', () => command('snapshot'), {passive:true});
  }
})();
