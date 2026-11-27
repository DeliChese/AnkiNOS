(function initializeNOSReview(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initializeNOSReview,{once:true});return;}
  const shell=document.getElementById('nos-review-shell');
  if(!shell||window.NOSReview)return;
  document.documentElement.classList.add('nos-review-page');
  const $=id=>document.getElementById(id);
  const initial=JSON.parse($('nos-review-bootstrap')?.textContent||'{}');
  window.NOSTheme.watch(shell,()=>initial,true);
  const initLang=initial.language||(typeof window.pycmd!=='function'?new URLSearchParams(location.search).get('lang'):'')||'vi';
  window.NOSI18n?.set(initLang);
  const background = typeof initial.background === 'string' &&
    /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}(?:-wall)?\.(?:png|jpg|webp)$/.test(initial.background) ? initial.background : '';
  shell.dataset.customBackground = background ? 'true' : 'false';
  {
    const int=(v,lo,hi,d)=>Number.isInteger(v)?Math.min(hi,Math.max(lo,v)):d, blur=int(initial.wallpaper_blur,0,24,0);
    shell.style.setProperty('--wall-fit',initial.background_fit==='contain'?'contain':'cover');
    shell.style.setProperty('--wall-dim',String(int(initial.wallpaper_dim,0,80,28)/100));
    shell.style.setProperty('--wall-blur',blur+'px');
    shell.style.setProperty('--wall-scale',blur?'1.06':'1');
  }
  const wallpaperImage=shell.querySelector('.nos-review-wallpaper-image');
  if(wallpaperImage){
    if(background) wallpaperImage.src=background;
    wallpaperImage.hidden=!background;
  }
  shell.dataset.side='question';
  shell.style.zoom=String(([85,90,100,110,120].includes(initial.ui_scale)?initial.ui_scale:100)/100);
  shell.classList.toggle('lite-mode',!!initial.lite_mode);
  shell.classList.toggle('no-blur',initial.blur===false);
  const motionDisabled=initial.animations===false||!!initial.lite_mode;
  shell.classList.toggle('no-motion',motionDisabled);
  shell.dataset.animations=motionDisabled?'off':'on';
  const summary=document.createElement('section');
  summary.id='nos-focus-summary';summary.hidden=true;summary.setAttribute('role','status');
  const summaryText=document.createElement('p');summaryText.id='nos-focus-summary-text';
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Tiếp tục học';
  dismiss.addEventListener('click',()=>{summary.hidden=true;});
  const back=document.createElement('button');back.type='button';back.textContent='Về trang chủ';
  back.addEventListener('click',()=>{if(typeof window.pycmd==='function')window.pycmd('nos-review:back');});
  summary.append(summaryText,dismiss,back);shell.querySelector('#nos-review-stage').before(summary);
  let lastSummary='';
  $('nos-review-header').innerHTML=`<button data-nos-review="back" aria-label="Về danh sách bộ thẻ"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h14"/></svg><span class="nos-back-label">Bộ thẻ</span></button><div id="nos-review-heading"><span id="nos-review-deck"></span><span id="nos-review-progress"></span></div><div id="nos-review-tools"><span id="nos-review-side">Mặt trước</span><div class="nos-focus-controls"><select id="nos-focus-duration" aria-label="Thời lượng Focus"><option value="5">5 phút</option><option value="15">15 phút</option><option value="25" selected>25 phút</option><option value="45">45 phút</option><option value="60">60 phút</option><option value="90">90 phút</option></select><span id="nos-focus-time" aria-live="off">25:00</span><button type="button" id="nos-focus-start" data-nos-review="focus:start" title="Bắt đầu tập trung">Focus</button><button type="button" id="nos-focus-pause" data-nos-review="focus:pause" hidden>Tạm dừng</button><button type="button" id="nos-focus-resume" data-nos-review="focus:resume" hidden>Tiếp tục</button><button type="button" id="nos-focus-stop" data-nos-review="focus:stop" hidden>Kết thúc</button></div><button data-nos-review="more" aria-label="Tùy chọn thẻ" title="Tùy chọn thẻ (M)">⋯</button></div>`;
  $('nos-focus-duration').add(new Option('30 phút','30'),$('nos-focus-duration').querySelector('[value="45"]'));
  const notebookButton=document.createElement('button');notebookButton.type='button';notebookButton.textContent='Ghi chú';notebookButton.dataset.nosReview='notebook';notebookButton.title='Ghi chú cho note đang học';
  $('nos-review-tools').append(notebookButton);
  if(initial.deck)$('nos-review-deck').setAttribute('data-i18n-skip','');
  $('nos-review-deck').textContent=initial.deck||'Phiên ôn tập';
  $('nos-review-deck').title=initial.deck||'Phiên ôn tập';
  const format=window.NOSI18n?window.NOSI18n.numberFormat():new Intl.NumberFormat('vi-VN');
  const card=$('nos-review-card');
  let lastState={side:'question',answered:initial.answered||0};
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
  let sideTimer=0;
  function setState(value){
    lastState=value;
    const changed=shell.dataset.side!==value.side;
    shell.dataset.side=value.side;
    const sidePill=$('nos-review-side');
    sidePill.textContent=value.side==='answer'?'Đáp án':'Mặt trước';
    if(changed&&!shell.classList.contains('no-motion')){
      sidePill.classList.remove('nos-side-pulse');
      void sidePill.offsetWidth;
      sidePill.classList.add('nos-side-pulse');
      clearTimeout(sideTimer);
      sideTimer=setTimeout(()=>sidePill.classList.remove('nos-side-pulse'),360);
    }
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
    const duration=String(value.target_seconds/60);
    if(Array.from($('nos-focus-duration').options).some(option=>option.value===duration))$('nos-focus-duration').value=duration;
    const ended=value.last_session;
    if(!active&&ended){
      const key=JSON.stringify(ended);
      if(key!==lastSummary){
        lastSummary=key;
        summaryText.textContent=(ended.status==='completed'?'Đã đủ thời gian Focus. ':'Đã lưu phiên Focus. ')+
          Math.floor(ended.seconds/60)+' phút '+(ended.seconds%60)+' giây tập trung · '+ended.cards+' lượt trả lời. Bạn có thể nghỉ hoặc tiếp tục khi sẵn sàng.';
        summary.hidden=false;
      }
    } else if(active){summary.hidden=true;lastSummary='';}
    $('nos-focus-duration').hidden=active;
    $('nos-focus-start').hidden=active;
    $('nos-focus-pause').hidden=!active||paused;
    $('nos-focus-resume').hidden=!active||!paused;
    $('nos-focus-stop').hidden=!active;
    $('nos-focus-time').dataset.paused=String(paused);
    $('nos-focus-time').dataset.running=String(active&&!paused);
    if(!active&&previous)$('nos-focus-time').title='Đã lưu phiên Focus';
    updateFocusClock();
  }
  setInterval(updateFocusClock,1000);
  window.NOSReview={setState,setFocus};
  setFocus(focusState);
  setState({side:'question',answered:initial.answered||0});
  document.addEventListener('nos:language',()=>{setState(lastState);updateFocusClock();});
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
