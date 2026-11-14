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
  const wallpaperImage=shell.querySelector('.nos-review-wallpaper-image');
  if(wallpaperImage){
    if(background) wallpaperImage.src=background;
    wallpaperImage.hidden=!background;
  }
  shell.dataset.side='question';
  $('nos-review-header').innerHTML=`<button data-nos-review="back" aria-label="Về danh sách bộ thẻ"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h14"/></svg><span class="nos-back-label">Bộ thẻ</span></button><div id="nos-review-heading"><span id="nos-review-deck"></span><span id="nos-review-progress"></span></div><div id="nos-review-tools"><span id="nos-review-side">Mặt trước</span><div class="nos-focus-controls"><select id="nos-focus-duration" aria-label="Thời lượng Focus"><option value="5">5 phút</option><option value="15">15 phút</option><option value="25" selected>25 phút</option><option value="45">45 phút</option><option value="60">60 phút</option><option value="90">90 phút</option></select><span id="nos-focus-time" aria-live="off">25:00</span><button type="button" id="nos-focus-start" data-nos-review="focus:start" title="Bắt đầu tập trung">Focus</button><button type="button" id="nos-focus-pause" data-nos-review="focus:pause" hidden>Tạm dừng</button><button type="button" id="nos-focus-resume" data-nos-review="focus:resume" hidden>Tiếp tục</button><button type="button" id="nos-focus-stop" data-nos-review="focus:stop" hidden>Kết thúc</button></div><button data-nos-review="more" aria-label="Tùy chọn thẻ" title="Tùy chọn thẻ (M)">⋯</button></div>`;
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
  let focusState=initial.focus||{active:false,paused:false,seconds:0,target_seconds:1500,cards:0};
  let focusAnchor=performance.now(),completionSent=false;
  const focusClockText=value=>{
    value=Math.max(0,Math.ceil(value));
    return String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  };
  function updateFocusClock(){
    const running=focusState.active&&!focusState.paused;
    const elapsed=focusState.seconds+(running?(performance.now()-focusAnchor)/1000:0);
    const remaining=Math.max(0,focusState.target_seconds-elapsed);
    $('nos-focus-time').textContent=focusClockText(remaining);
    $('nos-focus-time').title=String(focusState.cards||0)+' lượt ôn trong phiên Focus';
    if(running&&remaining===0&&!completionSent&&typeof window.pycmd==='function'){
      completionSent=true;
      window.pycmd('nos-review:focus:complete');
    }
  }
  function setFocus(value){
    if(!value)return;
    const previous=focusState.active;
    focusState=value;
    focusAnchor=performance.now();
    completionSent=false;
    const active=!!value.active,paused=!!value.paused;
    $('nos-focus-duration').hidden=active;
    $('nos-focus-start').hidden=active;
    $('nos-focus-pause').hidden=!active||paused;
    $('nos-focus-resume').hidden=!active||!paused;
    $('nos-focus-stop').hidden=!active;
    $('nos-focus-time').dataset.paused=String(paused);
    if(!active&&previous)$('nos-focus-time').title='Đã lưu phiên Focus';
    updateFocusClock();
  }
  setInterval(updateFocusClock,1000);
  window.NOSReview={setState,setFocus};
  setFocus(focusState);
  setState({side:'question',answered:initial.answered||0});
  // Watch only card replacements / body theme changes. MathJax, typing and
  // template scripts can mutate thousands of descendants without NOS work.
  const observer=new MutationObserver(preserveCardStyle);
  observer.observe($('qa'),{childList:true});
  observer.observe(document.body,{attributes:true,attributeFilter:['class','style']});
  $('nos-review-header').addEventListener('click',event=>{
    const action=event.target.closest('[data-nos-review]')?.dataset.nosReview;
    if(action&&typeof window.pycmd==='function')window.pycmd('nos-review:'+action+(action==='focus:start'?':'+$('nos-focus-duration').value:''));
  });
})();
