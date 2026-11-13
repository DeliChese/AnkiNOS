(function initializeNOSRatings(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initializeNOSRatings,{once:true});return;}
  const middle=document.getElementById('middle');
  if(!middle)return;
  const keys=JSON.parse(document.getElementById('nos-rating-keys')?.textContent||'{}');
  function decorate(){
    for(const button of middle.querySelectorAll('button[data-ease]')){
      if(button.dataset.nosReady)continue;
      button.dataset.nosReady='true';
      if(keys[button.dataset.ease])button.dataset.nosKey=keys[button.dataset.ease];
    }
  }
  new MutationObserver(decorate).observe(middle,{childList:true,subtree:true});
  decorate();
})();
