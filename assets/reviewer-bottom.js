(function initializeNOSRatings(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initializeNOSRatings,{once:true});return;}
  const middle=document.getElementById('middle');
  if(!middle)return;
  const appearance=JSON.parse(document.getElementById('nos-theme-bootstrap')?.textContent||'{}');
  document.documentElement.dataset.nosRatings='true';
  const motionOff=appearance.animations===false||!!appearance.lite_mode;
  document.documentElement.dataset.animations=motionOff?'off':'on';
  document.documentElement.classList.toggle('no-motion',motionOff);
  window.NOSTheme.watch(document.documentElement,()=>appearance,true);
  const keys=JSON.parse(document.getElementById('nos-rating-keys')?.textContent||'{}');
  function attachFill(button){
    if(button.querySelector('.nos-btn-fill'))return;
    const fill=document.createElement('span');
    fill.className='nos-btn-fill';
    fill.setAttribute('aria-hidden','true');
    button.prepend(fill);
  }
  function decorate(){
    let idx=0;
    for(const button of middle.querySelectorAll('button')){
      attachFill(button);
      if(!button.hasAttribute('data-ease')||button.dataset.nosReady)continue;
      button.dataset.nosReady='true';
      button.style.setProperty('--rate-i',String(idx++));
      if(keys[button.dataset.ease])button.dataset.nosKey=keys[button.dataset.ease];
    }
  }
  function updateFillOrigin(event){
    const button=event.target?.closest?.('button');
    if(!button||!middle.contains(button))return;
    const rect=button.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const mx=(((event.clientX-rect.left)/rect.width)*100).toFixed(1)+'%';
    const my=(((event.clientY-rect.top)/rect.height)*100).toFixed(1)+'%';
    button.style.setProperty('--mx',mx);
    button.style.setProperty('--my',my);
  }
  middle.addEventListener('pointerover',updateFillOrigin);
  middle.addEventListener('pointermove',updateFillOrigin);
  new MutationObserver(decorate).observe(middle,{childList:true,subtree:true});
  decorate();
})();
