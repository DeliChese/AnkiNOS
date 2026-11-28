(function initializeOverview() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',initializeOverview,{once:true});
    return;
  }
  const app=document.getElementById('nos-app');
  if (!app || window.AnkiNOS) return;
  const $=id=>document.getElementById(id);
  const native=app.dataset.native==='true' || typeof window.pycmd==='function';
  const number=window.NOSI18n.numberFormat();
  const n=value=>number.format(value??0);
  const state={snapshot:null,settings:{},started:false};
  const loadedAt=performance.now();
  let toastTimer;
  let snapshotPending=false, lastSnapshotAt=0;

  function toast(message) {
    $('overview-toast').textContent=message;
    $('overview-toast').hidden=false;
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{$('overview-toast').hidden=true;},5000);
  }

  function fullscreen(active) {
    const button=$('overview-fullscreen');
    button.setAttribute('aria-pressed',String(active));
    button.title=active?'Thoát toàn màn hình':'Toàn màn hình';
    button.setAttribute('aria-label',button.title);
  }

  function command(action,args={}) {
    if (!native) {
      if (action==='snapshot') { receive({event:'overview_snapshot',payload:preview()});return; }
      if (action==='save_ui') return;
      if (action==='fullscreen') {
        const request=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();
        request.catch(()=>toast('Không thể mở toàn màn hình trong cửa sổ xem trước này.'));
        return;
      }
      if (action==='back') { location.href='ankios-ui.html';return; }
      toast('Bản xem trước. Mở Anki để học với bộ sưu tập của bạn.');
      return;
    }
    if (typeof window.pycmd!=='function') {
      if (performance.now()-loadedAt<15000) setTimeout(()=>command(action,args),50);
      else receive({event:'error',payload:'Cầu nối Anki chưa sẵn sàng. Nhấn Thử lại để kết nối.'});
      return;
    }
    if (action==='snapshot') {
      if (snapshotPending) return;
      snapshotPending=true;
    }
    window.pycmd(`nos:${JSON.stringify({action,...args})}`);
  }

  function menu(show,restore=false) {
    $('overview-menu').hidden=!show;
    $('overview-menu-toggle').setAttribute('aria-expanded',String(show));
    if (show) $('overview-menu').querySelector('button[data-action="native"]').focus();
    else if (restore) $('overview-menu-toggle').focus();
  }

  window.NOSTheme.watch(app,()=>state.settings,true);
  function theme() {
    const st = state.settings;
    window.NOSTheme.apply(app,st,true);
    window.NOSI18n?.set(st.language || 'vi');
    app.classList.toggle('lite-mode', !!st.lite_mode);
    app.classList.toggle('no-blur', st.blur === false);
    app.classList.toggle('reduce-motion', st.animations === false);
    app.dataset.animations = st.animations === false ? 'off' : 'on';
    app.style.zoom = [85,90,100,110,120].includes(st.ui_scale) && st.ui_scale !== 100 ? String(st.ui_scale / 100) : '';
    const selected = (st.images || []).find(image => image.id === st.image_overview);
    const safe = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}(?:-wall)?\.(?:png|jpg|webp)$/;
    const imageUrl = [selected?.wall_url, selected?.url].find(url => url && safe.test(url)) || '';
    app.dataset.customBackground = imageUrl ? 'true' : 'false';
    const int = (v, lo, hi, d) => Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d, blur = int(st.wallpaper_blur, 0, 24, 0);
    const frame = st.image_frames?.overview || {};
    const fx = int(frame.x, 0, 100, 50), fy = int(frame.y, 0, 100, 50), fz = int(frame.zoom, 100, 250, 100);
    app.style.setProperty('--wall-fit', st.image_fit_overview === 'contain' ? 'contain' : 'cover');
    app.style.setProperty('--wall-dim', String(int(st.wallpaper_dim, 0, 80, 28) / 100));
    app.style.setProperty('--wall-blur', blur + 'px');
    app.style.setProperty('--wall-pos-x', fx + '%');
    app.style.setProperty('--wall-pos-y', fy + '%');
    app.style.setProperty('--wall-scale', ((fz / 100) * (blur ? 1.06 : 1)).toFixed(3));
    const wallpaperImage=app.querySelector('.nos-wallpaper-image');
    if (wallpaperImage) {
      if(imageUrl && wallpaperImage.getAttribute('src')!==imageUrl) wallpaperImage.src=imageUrl;
      if(!imageUrl) wallpaperImage.removeAttribute('src');
      wallpaperImage.hidden=!imageUrl;
    }
    $('overview-theme-label').textContent=st.theme==='night'?'Chuyển sang kính hoàng hôn':'Chuyển sang kính tối';
  }

  function time(milliseconds) {
    if (!milliseconds) return 'Chưa bắt đầu';
    if (milliseconds<60000) return `${Math.max(1,Math.round(milliseconds/1000))} giây`;
    const minutes=Math.floor(milliseconds/60000);
    return minutes>=60?`${Math.floor(minutes/60)} giờ ${minutes%60} phút`:`${minutes} phút`;
  }

  function render() {
    const data=state.snapshot;
    if (!data) return;
    $('overview-name').setAttribute('data-i18n-skip','');
    $('overview-name').textContent=data.name;
    const hasParent=data.full_name.includes('::');
    if(hasParent)$('overview-parent').setAttribute('data-i18n-skip','');
    else $('overview-parent').removeAttribute('data-i18n-skip');
    $('overview-parent').textContent=hasParent?data.full_name.split('::').slice(0,-1).join(' / '):'Chuẩn bị học';
    $('overview-type').textContent=data.filtered?'BỘ THẺ LỌC':'BỘ THẺ CỦA BẠN';
    $('overview-description-wrap').hidden=!data.description;
    $('overview-intro').hidden=!!data.description;
    $('overview-description').setAttribute('data-i18n-skip','');
    $('overview-description').textContent=data.description||'';
    $('overview-description-toggle').hidden=(data.description||'').length<220;
    for (const key of ['new','learn','review']) $(`overview-${key}`).textContent=n(data[key]);
    const completed = !data.available;
    app.dataset.overviewState = completed ? 'completed' : 'ready';
    if ($('overview-ready-label')) $('overview-ready-label').textContent = completed ? 'Đã hoàn thành' : 'Sẵn sàng học';
    if ($('overview-complete-banner')) $('overview-complete-banner').hidden = !completed;
    if ($('overview-complete-copy')) {
      $('overview-complete-copy').textContent = data.filtered
        ? 'Bộ thẻ lọc này đã hết thẻ. Nhấn Tái tạo để gom thẻ mới hoặc Làm trống để trả thẻ về bộ gốc.'
        : 'Mọi thẻ đến hạn hôm nay đã hoàn tất. Bạn có thể quay về chọn bộ khác hoặc dùng Học tùy biến để ôn thêm.';
    }
    $('overview-available').textContent=data.available?`${n(data.available)} thẻ sẵn sàng cho phiên học`:'Đã hoàn thành phiên học hôm nay';
    if ($('overview-available-hint')) $('overview-available-hint').textContent = completed ? 'Không còn thẻ đến hạn trong bộ thẻ này.' : 'Số thẻ theo giới hạn học hôm nay.';
    const start=$('study');
    start.disabled=!data.available;
    start.hidden=completed;
    if ($('overview-complete-actions')) $('overview-complete-actions').hidden = !completed;
    if ($('overview-done-custom')) $('overview-done-custom').hidden = !!data.filtered;
    if ($('overview-done-rebuild')) $('overview-done-rebuild').hidden = !data.filtered;
    if ($('overview-done-empty')) $('overview-done-empty').hidden = !data.filtered;
    if ($('overview-done-unbury')) $('overview-done-unbury').hidden = !data.has_buried;
    state.started=false;
    $('overview-today-reviews').textContent=data.today_reviews==null?'—':n(data.today_reviews);
    $('overview-today-message').textContent=data.partial?'Bạn có thể bắt đầu ngay. Thống kê đang cập nhật.':data.today_reviews?'Những điều đã học đang dần trở nên quen thuộc.':'Chưa có lượt ôn hôm nay. Bắt đầu từ một thẻ nhé.';
    $('overview-today-time').textContent=data.today_milliseconds==null?'—':time(data.today_milliseconds);
    $('overview-retention').textContent=data.retention==null?'—':`${n(data.retention)}%`;
    $('overview-retention').title=data.retention==null?'Chưa có lượt ôn trong hôm nay.':'Tỷ lệ trả lời đúng trong các lượt ôn hôm nay.';
    $('overview-total').textContent=data.total==null?'— thẻ':`${n(data.total)} thẻ`;
    $('overview-children').textContent=data.children?`Gồm ${n(data.children)} bộ thẻ con`:'';
    $('overview-children-button').hidden=!data.children;
    $('overview-custom-study').hidden=data.filtered;
    $('overview-edit-description').hidden=data.filtered;
    $('overview-rebuild').hidden=!data.filtered;
    $('overview-empty-filtered').hidden=!data.filtered;
    $('overview-unbury').hidden=!data.has_buried;
    $('overview-error').hidden=true;
    $('overview-connection').innerHTML=`<span class="status-dot"></span>${native?'Bộ sưu tập Anki':'Bản xem trước'}`;
    $('overview-footnote').textContent=native?'Dữ liệu từ bộ sưu tập Anki của bạn':'Dữ liệu minh họa · Mở Anki để học thật';
    theme();
    fullscreen(native?!!data.fullscreen:!!document.fullscreenElement);
    if (data.available && [document.body,document.documentElement].includes(document.activeElement)) start.focus({preventScroll:true});
  }

  function receive({event,payload}) {
    if (event==='fullscreen') {fullscreen(payload);return;}
    if (event==='error') {
      snapshotPending=false;
      state.started=false;
      if (state.snapshot?.available) $('study').disabled=false;
      if (state.snapshot) toast(payload);
      else {
        $('overview-error-copy').textContent=payload;
        $('overview-error').hidden=false;
        $('overview-available').textContent='Không thể đọc lịch học';
      }
      return;
    }
    if (event==='overview_snapshot') {
      snapshotPending=false;
      lastSnapshotAt=performance.now();
      state.snapshot=payload;state.settings=payload.settings||{};render();
    }
    else if (event==='settings') {state.settings=payload;theme();}
  }
  window.AnkiNOS={receive};

  function start() {
    if (!state.snapshot?.available || state.started) return;
    if (native) {state.started=true;$('study').disabled=true;}
    command('overview_native',{command:'study'});
  }

  app.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action=button.dataset.action;
    if (action==='menu') {menu($('overview-menu').hidden);return;}
    if (action==='description_toggle') {
      const expanded=$('overview-description').classList.toggle('expanded');
      button.setAttribute('aria-expanded',String(expanded));
      button.firstChild.textContent=expanded?'Thu gọn':'Xem thêm';
      return;
    }
    if (action==='theme') {
      state.settings.theme=state.settings.theme==='night'?'dusk':'night';theme();
      command('save_ui',{values:{theme:state.settings.theme}});return;
    }
    menu(false);
    if (action==='start') {start();return;}
    if (action==='native') {command('overview_native',{command:button.dataset.command});return;}
    if (action==='delete_deck') {command('delete_deck',{id:state.snapshot?.id});return;}
    if (action==='show_children') {command('show_children',{id:state.snapshot?.id});return;}
    command(action,action==='browse'&&state.snapshot?{id:state.snapshot.id}:{});
  });
  document.addEventListener('click',event=>{
    if (!$('overview-menu').contains(event.target)&&!$('overview-menu-toggle').contains(event.target)) menu(false);
  });
  document.addEventListener('keydown',event=>{
    if (event.key==='Escape') menu(false,true);
    if (event.key==='Enter' && [document.body,document.documentElement].includes(event.target)) {event.preventDefault();start();}
  });
  document.addEventListener('fullscreenchange',()=>fullscreen(!!document.fullscreenElement));
  // Subtle 3D tilt on queue cards + ripple feedback when animations are active.
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const motionOff = () => app.classList.contains('reduce-motion') || app.classList.contains('lite-mode') || (app.dataset.animations !== 'on' && reducedMotion.matches);
  let tiltFrame = 0, tiltedCard = null, ptrX = 0, ptrY = 0, ptrNode = null;
  function clearTilt() {
    if (tiltFrame) { cancelAnimationFrame(tiltFrame); tiltFrame = 0; }
    if (tiltedCard) { tiltedCard.style.removeProperty('transform'); tiltedCard = null; }
  }
  app.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || motionOff()) { clearTilt(); return; }
    ptrX = event.clientX; ptrY = event.clientY; ptrNode = event.target;
    if (!tiltFrame) tiltFrame = requestAnimationFrame(() => {
      tiltFrame = 0;
      const card = ptrNode?.closest('.overview-count');
      if (tiltedCard && tiltedCard !== card) { tiltedCard.style.removeProperty('transform'); tiltedCard = null; }
      if (!card) return;
      const box = card.getBoundingClientRect();
      const rx = ((ptrY - box.top) / box.height - .5) * -8;
      const ry = ((ptrX - box.left) / box.width - .5) * 10;
      card.style.transform = `perspective(700px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-4px)`;
      tiltedCard = card;
    });
  }, {passive: true});
  app.addEventListener('pointerleave', clearTilt);
  app.addEventListener('pointerdown', event => {
    if (event.button !== 0 || motionOff()) return;
    const button = event.target.closest('.overview-start,.overview-menu-items > button');
    if (!button || button.disabled) return;
    const box = button.getBoundingClientRect();
    const zoom = Number(app.style.zoom) || 1;
    const size = Math.max(box.width, box.height) * 2.2 / zoom;
    const ripple = document.createElement('span');
    ripple.className = 'nos-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.cssText = `position:absolute;border-radius:50%;pointer-events:none;background:currentColor;opacity:.28;transform:translate(-50%,-50%) scale(0);transition:transform 520ms ease-out,opacity 520ms ease-out;width:${size}px;height:${size}px;left:${(event.clientX - box.left) / zoom}px;top:${(event.clientY - box.top) / zoom}px`;
    button.appendChild(ripple);
    requestAnimationFrame(() => { ripple.style.transform = 'translate(-50%,-50%) scale(1)'; ripple.style.opacity = '0'; });
    setTimeout(() => ripple.remove(), 560);
  });

  function preview() {
    return {id:'101',name:'Chinese Vocabulary in Chunks',full_name:'Ngoại ngữ::Chinese Vocabulary in Chunks',
      description:'Beginner Mandarin vocabulary grouped into practical chunks and sentence patterns. Vietnamese explanations and pinyin included.',
      filtered:false,new:20,learn:4,review:0,available:24,total:1480,children:0,has_buried:false,
      today_reviews:4,today_milliseconds:76000,retention:88.5,settings:{theme:'dusk',language:new URLSearchParams(location.search).get('lang')||'vi'}};
  }
  document.addEventListener('nos:language',()=>{if(state.snapshot)render();});
  const bootstrap=$('nos-overview-bootstrap');
  if (native && bootstrap) {
    try {receive({event:'overview_snapshot',payload:JSON.parse(bootstrap.textContent)});}
    catch {command('snapshot');}
    if(state.snapshot?.auto_start && state.snapshot.available)start();
    // Paint the bootstrap immediately. Fetch the heavier live stats only after
    // the initial view has settled, rather than blocking the first interaction.
    const fetchFull=()=>{if(!state.started && !document.hidden)command('snapshot');};
    if ('requestIdleCallback' in window)
      requestIdleCallback(fetchFull,{timeout:1200});
    else setTimeout(fetchFull,600);
  } else command('snapshot');
  if (native) {
    const syncLive=()=>{
      if(!document.hidden && !state.started && !snapshotPending &&
         performance.now()-lastSnapshotAt>3000) command('snapshot');
    };
    setInterval(()=>{
      if(!document.hidden && !state.started && !snapshotPending &&
         performance.now()-lastSnapshotAt>15000) command('snapshot');
    },20000);
    window.addEventListener('focus',syncLive,{passive:true});
  }
})();
