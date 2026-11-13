(function initializeNOSReview(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initializeNOSReview,{once:true});return;}
  const shell=document.getElementById('nos-review-shell');
  if(!shell||window.NOSReview)return;
  document.documentElement.classList.add('nos-review-page');
  const $=id=>document.getElementById(id);
  const initial=JSON.parse($('nos-review-bootstrap')?.textContent||'{}');
  shell.dataset.theme=initial.theme||'dusk';
  const background = typeof initial.background === 'string' &&
    /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}\.(?:png|jpg|webp)$/.test(initial.background) ? initial.background : '';
  shell.dataset.customBackground = background ? 'true' : 'false';
  shell.style.setProperty('--nos-review-background', background ? 'url("' + background + '")' : 'none');
  shell.style.setProperty('--nos-review-fit', ['contain','cover'].includes(initial.background_fit) ? initial.background_fit : 'contain');
  shell.style.setProperty('--nos-review-position', ['center','top','bottom','left','right'].includes(initial.background_position) ? initial.background_position : 'center');
  shell.dataset.side='question';
  $('nos-review-header').innerHTML=`<button data-nos-review="back" aria-label="Về danh sách bộ thẻ"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h14"/></svg><span class="nos-back-label">Bộ thẻ</span></button><div id="nos-review-heading"><span id="nos-review-deck"></span><span id="nos-review-progress"></span></div><div id="nos-review-tools"><span id="nos-review-side">Mặt trước</span><button data-nos-review="more" aria-label="Tùy chọn thẻ" title="Tùy chọn thẻ (M)">⋯</button></div>`;
  $('nos-review-deck').textContent=initial.deck||'Phiên ôn tập';
  $('nos-review-deck').title=initial.deck||'Phiên ôn tập';
  const format=new Intl.NumberFormat('vi-VN');
  const card=$('nos-review-card');
  let frame=0,lastBackground='',lastImage='';
  // Use Anki's own no-fade path, also used by its software renderer.
  // Card replacement and the answer controls remain entirely native.
  window.qFade=0;
  function preserveCardStyle(){
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const style=getComputedStyle(document.body);
      const background=style.backgroundColor==='rgba(0, 0, 0, 0)'?'':style.backgroundColor;
      if(background!==lastBackground){card.style.backgroundColor=background;lastBackground=background;}
      if(style.backgroundImage!==lastImage){card.style.backgroundImage=style.backgroundImage;lastImage=style.backgroundImage;}
    });
  }
  function setState(value){
    shell.dataset.side=value.side;
    $('nos-review-side').textContent=value.side==='answer'?'Đáp án':'Mặt trước';
    const progress=`Đã ôn ${format.format(value.answered||0)} lượt trong phiên này`;
    if($('nos-review-progress').textContent!==progress)$('nos-review-progress').textContent=progress;
    preserveCardStyle();
  }
  window.NOSReview={setState};
  setState({side:'question',answered:initial.answered||0});
  // Watch only card replacements / body theme changes. MathJax, typing and
  // template scripts can mutate thousands of descendants without NOS work.
  const observer=new MutationObserver(preserveCardStyle);
  observer.observe($('qa'),{childList:true});
  observer.observe(document.body,{attributes:true,attributeFilter:['class','style']});
  $('nos-review-header').addEventListener('click',event=>{
    const action=event.target.closest('[data-nos-review]')?.dataset.nosReview;
    if(action&&typeof window.pycmd==='function')window.pycmd(`nos-review:${action}`);
  });
})();
