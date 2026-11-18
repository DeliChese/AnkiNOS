(function initTools(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initTools,{once:true});return;}
  const $=id=>document.getElementById(id), root=$('nos-tool');
  if(!root||window.NOSTool)return;
  let initial={};try{initial=JSON.parse($('nos-tool-bootstrap')?.textContent||'{}');}catch{}
  window.NOSTheme.watch(root,()=>initial.settings||{},true);
  const requested=initial.kind||new URLSearchParams(location.search).get('tool');
  const kind=['palette','workspace'].includes(requested)?requested:'workspace';
  const native=initial.native===true, started=performance.now();
  const titles={palette:'Lệnh nhanh',workspace:'Sổ tay & tài liệu'};
  $('tool-title').textContent=titles[kind];
  $('tool-context').textContent=initial.deck||'Bộ thẻ minh họa';
  $('tool-preview').hidden=native;
  function element(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
  function notice(text,error=false){$('tool-status').textContent=String(text||'');$('tool-status').classList.toggle('error',error);}
  const busyControls=new Map();
  function busy(value){
    if(value)root.querySelectorAll('[data-wait]').forEach(el=>{if(!busyControls.has(el))busyControls.set(el,el.disabled);el.disabled=true;});
    else{for(const [el,disabled] of busyControls)el.disabled=disabled;busyControls.clear();}
  }
  function module(){return {palette:window.NOSCommands,workspace:window.NOSNotebook}[kind];}
  function send(action,data={}){
    if(action==='close'&&!native){if(window.parent!==window)window.parent.postMessage({nosToolClose:true},'*');else notice('Bản xem trước. Có thể đóng tab này.');return;}
    if(!native){module()?.preview?.(action,data);return;}
    if(typeof window.pycmd!=='function'){
      if(performance.now()-started<10000)setTimeout(()=>send(action,data),50);
      else{busy(false);notice('Cầu nối Anki chưa sẵn sàng. Đóng cửa sổ rồi mở lại.',true);}return;
    }
    window.pycmd('nostool:'+JSON.stringify({action,...data}));
  }
  function receive({event,payload}){
    if(event==='error'){busy(false);notice(payload,true);module()?.failed?.();return;}
    if(event==='notice'){notice(payload);return;}
    busy(false);
    module()?.receive(event,payload);
  }
  window.NOSTool={send,receive,notice,busy,element,$,initial,kind,native,
    uuid:()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')};
  $('tool-close').addEventListener('click',()=>send('close'));
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&kind==='palette'){event.preventDefault();send('close');}});
  setTimeout(()=>{module()?.init();send('boot');},0);
})();
