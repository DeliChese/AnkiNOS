(function initTools(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initTools,{once:true});return;}
  const $=id=>document.getElementById(id), root=$('nos-tool');
  if(!root||window.NOSTool)return;
  let initial={};try{initial=JSON.parse($('nos-tool-bootstrap')?.textContent||'{}');}catch{}
  const toolMotionOff=initial.settings?.animations===false||!!initial.settings?.lite_mode;
  const toolBlurOff=initial.settings?.blur===false||!!initial.settings?.lite_mode;
  root.dataset.animations=toolMotionOff?'off':'on';
  root.classList.toggle('no-motion',toolMotionOff);
  root.classList.toggle('no-blur',toolBlurOff);
  if(initial.frameless){
    document.documentElement.classList.add('tool-frameless');
    root.classList.add('tool-frameless');
  }
  window.NOSTheme.watch(root,()=>initial.settings||{},true);
  const requested=initial.kind||new URLSearchParams(location.search).get('tool');
  const kind=['palette','workspace'].includes(requested)?requested:'workspace';
  root.dataset.toolKind=kind;
  const native=initial.native===true, started=performance.now();
  const initLang=initial.settings?.language||(!native?new URLSearchParams(location.search).get('lang'):'')||'vi';
  window.NOSI18n?.set(initLang);
  const titles={palette:'Lệnh nhanh',workspace:'Sổ tay'};
  $('tool-title').textContent=titles[kind];
  if(initial.deck)$('tool-context').setAttribute('data-i18n-skip','');
  $('tool-context').textContent=kind==='workspace'?(initial.deck||'Ghi chú tự do · Bộ thẻ tùy chọn'):(initial.deck||'Bộ thẻ minh họa');
  $('tool-preview').hidden=native;
  if($('tool-minimize'))$('tool-minimize').hidden=kind!=='workspace';
  let minimized=false;
  function applyMinimized(next){
    minimized=!!next;
    root.classList.toggle('is-minimized',minimized);
    document.documentElement.classList.toggle('is-minimized',minimized);
    if($('tool-mini-dock'))$('tool-mini-dock').hidden=!minimized;
  }
  function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
  function notice(text,error=false){$('tool-status').textContent=String(text||'');$('tool-status').classList.toggle('error',error);}
  const busyControls=new Map();
  function busy(value){
    if(value)root.querySelectorAll('[data-wait]').forEach(el=>{if(!busyControls.has(el))busyControls.set(el,el.disabled);el.disabled=true;});
    else{for(const [el,disabled] of busyControls)el.disabled=disabled;busyControls.clear();}
  }
  function module(){return {palette:window.NOSCommands,workspace:window.NOSNotebook}[kind];}
  function send(action,data={}){
    if(action==='minimize'){
      applyMinimized(true);
      if(native&&typeof window.pycmd==='function')window.pycmd('nostool:'+JSON.stringify({action:'minimize'}));
      return;
    }
    if(action==='restore'){
      applyMinimized(false);
      if(native&&typeof window.pycmd==='function')window.pycmd('nostool:'+JSON.stringify({action:'restore'}));
      return;
    }
    if(action==='drag_start'){
      if(native&&typeof window.pycmd==='function')window.pycmd('nostool:'+JSON.stringify({action:'drag_start'}));
      return;
    }
    if(action==='close'&&!native){if(window.parent!==window)window.parent.postMessage({nosToolClose:true},'*');else notice('Bản xem trước. Có thể đóng tab này.');return;}
    if(!native){module()?.preview?.(action,data);return;}
    if(typeof window.pycmd!=='function'){
      if(performance.now()-started<10000)setTimeout(()=>send(action,data),50);
      else{busy(false);notice('Cầu nối Anki chưa sẵn sàng. Đóng cửa sổ rồi mở lại.',true);}return;
    }
    window.pycmd('nostool:'+JSON.stringify({action,...data}));
  }
  function receive({event,payload}){
    if(event==='window_state'){applyMinimized(!!payload?.minimized);return;}
    if(event==='settings'&&payload){
      initial.settings={...(initial.settings||{}),...payload};
      window.NOSTheme.apply(root,initial.settings,true);
      if(payload.language)window.NOSI18n?.set(payload.language);
      return;
    }
    if(event==='error'){busy(false);notice(payload,true);module()?.failed?.();return;}
    if(event==='notice'){notice(payload);return;}
    busy(false);
    module()?.receive(event,payload);
  }
  window.NOSTool={send,receive,notice,busy,element,$,initial,kind,native,
    setMinimized:applyMinimized,
    isMinimized:()=>minimized,
    uuid:()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};
  $('tool-close')?.addEventListener('click',()=>send('close'));
  $('tool-minimize')?.addEventListener('click',()=>send('minimize'));
  $('tool-mini-dock')?.addEventListener('click',()=>send('restore'));
  $('tool-drag-bar')?.addEventListener('mousedown',event=>{
    if(event.button!==0||event.target.closest('button,input,select,a'))return;
    if(native&&initial.frameless)send('drag_start');
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&kind==='palette'){event.preventDefault();send('close');}});
  setTimeout(()=>{module()?.init();send('boot');},0);
})();
