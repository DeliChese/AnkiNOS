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
  const number=new Intl.NumberFormat('vi-VN');
  const n=value=>number.format(value??0);
  const state={snapshot:null,settings:{},started:false};
  const loadedAt=performance.now();
  let toastTimer;

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
    window.pycmd(`nos:${JSON.stringify({action,...args})}`);
  }

  function menu(show,restore=false) {
    $('overview-menu').hidden=!show;
    $('overview-menu-toggle').setAttribute('aria-expanded',String(show));
    if (show) $('overview-menu').querySelector('button[data-action="native"]').focus();
    else if (restore) $('overview-menu-toggle').focus();
  }

  function theme() {
    app.dataset.theme=state.settings.theme||'dusk';
    $('overview-theme-label').textContent=state.settings.theme==='night'?'Chuyển sang kính hoàng hôn':'Chuyển sang kính tối';
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
    $('overview-name').textContent=data.name;
    $('overview-parent').textContent=data.full_name.includes('::')?data.full_name.split('::').slice(0,-1).join(' / '):'Chuẩn bị học';
    $('overview-type').textContent=data.filtered?'BỘ THẺ LỌC':'BỘ THẺ CỦA BẠN';
    $('overview-description-wrap').hidden=!data.description;
    $('overview-intro').hidden=!!data.description;
    $('overview-description').textContent=data.description||'';
    $('overview-description-toggle').hidden=(data.description||'').length<220;
    for (const key of ['new','learn','review']) $(`overview-${key}`).textContent=n(data[key]);
    $('overview-available').textContent=data.available?`${n(data.available)} thẻ sẵn sàng cho phiên học`:'Chưa có thẻ đến hạn lúc này';
    const start=$('study');
    start.disabled=!data.available;
    state.started=false;
    $('overview-today-reviews').textContent=data.today_reviews==null?'—':n(data.today_reviews);
    $('overview-today-message').textContent=data.partial?'Bạn có thể bắt đầu ngay. Thống kê đang cập nhật.':data.today_reviews?'Những điều đã học đang dần trở nên quen thuộc.':'Chưa có lượt ôn hôm nay. Bắt đầu từ một thẻ nhé.';
    $('overview-today-time').textContent=data.today_milliseconds==null?'—':time(data.today_milliseconds);
    $('overview-retention').textContent=data.retention==null?'—':`${n(data.retention)}%`;
    $('overview-retention').title=data.retention==null?'Chưa có lượt ôn đến hạn trong 30 ngày.':'Tỷ lệ trả lời đúng ở các lượt ôn đến hạn trong 30 ngày.';
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
    if (event==='overview_snapshot') {state.snapshot=payload;state.settings=payload.settings||{};render();}
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

  function preview() {
    return {id:'101',name:'Chinese Vocabulary in Chunks',full_name:'Ngoại ngữ::Chinese Vocabulary in Chunks',
      description:'Beginner Mandarin vocabulary grouped into practical chunks and sentence patterns. Vietnamese explanations and pinyin included.',
      filtered:false,new:20,learn:4,review:0,available:24,total:1480,children:0,has_buried:false,
      today_reviews:4,today_milliseconds:76000,retention:88.5,settings:{theme:'dusk'}};
  }
  const bootstrap=$('nos-overview-bootstrap');
  if (native && bootstrap) {
    try {receive({event:'overview_snapshot',payload:JSON.parse(bootstrap.textContent)});}
    catch {command('snapshot');}
    setTimeout(()=>{if(!state.started)command('snapshot');},250);
  } else command('snapshot');
  if (native) setInterval(()=>{if(!document.hidden&&!state.started)command('snapshot');},60000);
})();
