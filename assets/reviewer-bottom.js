(function initializeNOSRatings(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initializeNOSRatings,{once:true});return;}
  const middle=document.getElementById('middle');
  if(!middle)return;
  const outer=document.getElementById('outer');
  if(outer)outer.setAttribute('data-i18n-skip','');
  const appearance=JSON.parse(document.getElementById('nos-theme-bootstrap')?.textContent||'{}');
  document.documentElement.dataset.nosRatings='true';
  const motionOff=appearance.animations===false||!!appearance.lite_mode;
  document.documentElement.dataset.animations=motionOff?'off':'on';
  document.documentElement.classList.toggle('no-motion',motionOff);
  window.NOSTheme.watch(document.documentElement,()=>appearance,true);
  const initLang=appearance.language||(typeof window.pycmd!=='function'?new URLSearchParams(location.search).get('lang'):'')||'vi';
  const keys=JSON.parse(document.getElementById('nos-rating-keys')?.textContent||'{}');
  const tr=text=>window.NOSI18n?window.NOSI18n.t(text):text;
  const activeLang=()=>(window.NOSI18n?window.NOSI18n.language():initLang)||'vi';
  const rawDue=new WeakMap();
  const DUE_UNIT_MAP={
    s:'s',sec:'s',secs:'s',second:'s',seconds:'s','giây':'s','秒':'s',
    m:'m',min:'m',mins:'m',minute:'m',minutes:'m','phút':'m','分钟':'m','分':'m',
    h:'h',hr:'h',hrs:'h',hour:'h',hours:'h','giờ':'h','小时':'h',
    d:'d',day:'d',days:'d','ngày':'d','天':'d',
    mo:'mo',mos:'mo',month:'mo',months:'mo','tháng':'mo','个月':'mo','月':'mo',
    y:'y',yr:'y',yrs:'y',year:'y',years:'y','năm':'y','年':'y',
  };
  const DUE_LABELS={
    vi:{s:' giây',m:' phút',h:' giờ',d:' ngày',mo:' tháng',y:' năm'},
    en:{s:'s',m:'m',h:'h',d:'d',mo:'mo',y:'y'},
    'zh-cn':{s:' 秒',m:' 分钟',h:' 小时',d:' 天',mo:' 个月',y:' 年'},
  };
  const DUE_RE=/^(<\s*|≤\s*)?(\d+(?:[.,]\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|min|m|hours?|hrs?|hr|h|days?|d|months?|mos?|mo|years?|yrs?|yr|y|giây|phút|giờ|ngày|tháng|năm|分钟|个月|小时|秒|分|天|月|年)\.?$/i;

  function setButtonLabel(button,label){
    let target=null;
    for(const node of button.childNodes){
      if(node.nodeType===3&&/\S/.test(node.nodeValue||'')){target=node;break;}
    }
    if(target){
      if(target.nodeValue!==label)target.nodeValue=label;
      return;
    }
    const textNode=document.createTextNode(label);
    const fill=button.querySelector(':scope > .nos-btn-fill');
    if(fill)fill.after(textNode);
    else button.prepend(textNode);
  }

  function localizeInterval(span){
    let textNode=null;
    for(const node of span.childNodes){
      if(node.nodeType===3&&/\S/.test(node.nodeValue||'')){textNode=node;break;}
    }
    if(!textNode)return;
    let source=rawDue.get(span);
    if(source===undefined){
      source=(textNode.nodeValue||'').trim();
      rawDue.set(span,source);
    }
    if(!source)return;
    let next=source;
    if(/^\((?:end|kết thúc|结束)\)$/i.test(source)){
      next=tr('(Kết thúc)');
    }else{
      const match=DUE_RE.exec(source);
      if(match){
        const prefix=(match[1]||'').replace(/\s+/g,'');
        const unitKey=DUE_UNIT_MAP[match[3].toLowerCase()];
        const table=DUE_LABELS[activeLang()]||DUE_LABELS.vi;
        if(unitKey&&table[unitKey])next=prefix+match[2]+table[unitKey];
      }
    }
    if(textNode.nodeValue!==next)textNode.nodeValue=next;
  }

  function localizeChrome(){
    const table=document.getElementById('innertable');
    if(table){
      const editBtn=table.querySelector('button[onclick*="edit"]')||table.querySelector('td.stat:first-child > button');
      if(editBtn){
        setButtonLabel(editBtn,tr('Sửa'));
        const editTitle=tr('Chỉnh sửa thẻ (E)');
        if(editBtn.title!==editTitle)editBtn.title=editTitle;
      }
      const moreBtn=table.querySelector('button[onclick*="more"]')||table.querySelector('td.stat:last-child > button');
      if(moreBtn&&moreBtn!==editBtn){
        setButtonLabel(moreBtn,tr('Thêm ⋯'));
        const moreTitle=tr('Tùy chọn thẻ (M)');
        if(moreBtn.title!==moreTitle)moreBtn.title=moreTitle;
      }
    }
    const ansBtn=document.getElementById('ansbut');
    if(ansBtn){
      setButtonLabel(ansBtn,tr('Hiện đáp án'));
      const ansTitle=tr('Hiện đáp án (Space)');
      if(ansBtn.title!==ansTitle)ansBtn.title=ansTitle;
    }
    const easeButtons=Array.from(middle.querySelectorAll('button[data-ease]'));
    if(easeButtons.length){
      const easeLabels=easeButtons.length===2
        ?{'1':'Quên','2':'Tốt'}
        :easeButtons.length===3
          ?{'1':'Quên','2':'Tốt','3':'Dễ'}
          :{'1':'Quên','2':'Khó','3':'Tốt','4':'Dễ'};
      for(const button of easeButtons){
        const ease=button.dataset.ease;
        if(easeLabels[ease])setButtonLabel(button,tr(easeLabels[ease]));
        if(keys[ease]){
          const title=tr('Phím tắt: '+keys[ease]);
          if(button.title!==title)button.title=title;
        }
        const due=button.querySelector('.nobold');
        if(due)localizeInterval(due);
      }
    }
  }

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
    localizeChrome();
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
  function setCounts(counts, activeIdx){
    const btn=document.getElementById('ansbut');
    if(!btn||!Array.isArray(counts)||counts.length!==3)return;
    const stat=btn.querySelector('.stattxt');
    if(!stat)return;
    const classes=['new-count','learn-count','review-count'];
    const existing=classes.map(cls=>stat.querySelector('.'+cls));
    if(existing.every(Boolean)){
      classes.forEach((cls,i)=>{
        const node=existing[i];
        const value=String(Number(counts[i])||0);
        if(i===activeIdx){
          node.innerHTML=`<u>${value}</u>`;
        }else{
          node.textContent=value;
        }
      });
    }else if(stat.querySelector('.new-count,.learn-count,.review-count')||!stat.textContent.trim()){
      stat.innerHTML=classes.map((cls,i)=>{
        const value=String(Number(counts[i])||0);
        return `<span class="${cls}">${i===activeIdx?`<u>${value}</u>`:value}</span>`;
      }).join(' + ');
    }
  }
  function setLanguage(lang){
    window.NOSI18n?.set(lang);
    localizeChrome();
  }
  window.NOSI18n?.set(initLang);
  window.NOSRatings={setCounts,setLanguage};
  middle.addEventListener('pointerover',updateFillOrigin);
  middle.addEventListener('pointermove',updateFillOrigin);
  document.addEventListener('nos:language',localizeChrome);
  new MutationObserver(decorate).observe(middle,{childList:true,subtree:true});
  decorate();
})();
