/* Native escape hatch even if a UI module fails before registering its handlers. */
(function installNOSRuntimeGuard(){
  'use strict';
  const ownBase=document.currentScript?.src?.replace(/[^/]+$/,'');
  let sent=false;
  function recover(reason){
    if(sent||typeof window.pycmd!=='function')return;
    sent=true;
    if(document.getElementById('nos-review-shell'))window.pycmd('nos-review:native');
    else window.pycmd('nos:'+JSON.stringify({action:'runtime_failure',message:String(reason).slice(0,1000)}));
  }
  window.addEventListener('error',event=>{
    if(ownBase && (event.filename||'').startsWith(ownBase) && /\/(?:dashboard|overview|reviewer|study-dashboard|stats-page)\.js(?:\?|$)/.test(event.filename||''))recover(event.message);
  });
  window.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>{
      const app=document.getElementById('nos-app');
      if(app?.dataset.native==='true'&&!window.AnkiNOS)recover('Không thể khởi tạo giao diện AnkiNOS.');
    },8000);
  },{once:true});
})();
