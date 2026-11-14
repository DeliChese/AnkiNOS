/* Focus history is profile-local and independent from Anki's review timer. */
(function initNOSFocusDashboard(){
  'use strict';
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initNOSFocusDashboard,{once:true});return;}
  const root=document.getElementById('nos-focus-history');
  if(!root||window.NOSFocusHistory)return;
  const byId=id=>document.getElementById(id);
  const duration=seconds=>{
    const mins=Math.round((Number(seconds)||0)/60);
    return mins>=60?Math.floor(mins/60)+' giờ '+String(mins%60).padStart(2,'0')+' phút':mins+' phút';
  };
  const dateLabel=value=>{
    const d=new Date(value);
    return Number.isNaN(d.getTime())?value:new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d);
  };
  let loaded=false;
  function request(){
    if(typeof window.pycmd==='function'){window.pycmd('nos:'+JSON.stringify({action:'focus_history'}));}
    else{
      render({today_seconds:0,week_seconds:0,total_seconds:0,total_sessions:0,
              completed_sessions:0,total_cards:0,daily:[],sessions:[]},true);
    }
  }
  function render(data,preview=false){
    loaded=true;
    byId('nos-focus-today').textContent=duration(data.today_seconds);
    byId('nos-focus-week').textContent=duration(data.week_seconds);
    byId('nos-focus-total').textContent=duration(data.total_seconds);
    byId('nos-focus-sessions').textContent=String(data.total_sessions);
    byId('nos-focus-completed').textContent=String(data.completed_sessions);
    byId('nos-focus-cards').textContent=String(data.total_cards);
    byId('nos-focus-average').textContent=duration(data.total_sessions?data.total_seconds/data.total_sessions:0);
    const chart=byId('nos-focus-days');
    chart.replaceChildren();
    const days=Array.isArray(data.daily)?data.daily:[];
    const largest=Math.max(60,...days.map(x=>Number(x.seconds)||0));
    for(const day of days){
      const col=document.createElement('div');
      col.className='nos-focus-day';
      col.title=day.date+': '+duration(day.seconds)+' · '+day.sessions+' phiên';
      const bar=document.createElement('div');
      bar.className='nos-focus-bar';
      bar.style.height=Math.max(2,Math.round((day.seconds||0)/largest*100))+'%';
      const dayLabel=document.createElement('span');
      dayLabel.textContent=day.date.slice(8);
      col.append(bar,dayLabel);chart.append(col);
    }
    const history=byId('nos-focus-session-list');
    history.replaceChildren();
    const sessions=Array.isArray(data.sessions)?data.sessions:[];
    if(!sessions.length){
      const empty=document.createElement('p');
      empty.textContent=preview?'Bản xem trước. Lịch sử thật chỉ hiển thị trong Anki.':'Chưa có phiên Focus nào. Bắt đầu Focus khi ôn tập để lưu lịch sử.';
      history.append(empty);
    }
    for(const entry of sessions){
      const item=document.createElement('div');
      item.className='nos-focus-session';
      const first=document.createElement('strong');
      first.textContent=dateLabel(entry.started_at);
      const second=document.createElement('span');
      second.textContent=duration(entry.seconds)+' · '+entry.cards+' lượt ôn · '+(
        entry.status==='completed'?'Đạt mục tiêu':
        entry.status==='interrupted'?'Gián đoạn':'Kết thúc sớm');
      item.append(first,second);history.append(item);
    }
    byId('nos-focus-history-status').textContent=preview?'Bản xem trước · chưa có dữ liệu thật':'Dữ liệu Focus lưu cục bộ theo hồ sơ, không đồng bộ AnkiWeb';
  }
  window.NOSFocusHistory={request,render,open(){request();}};
  byId('nos-focus-refresh').addEventListener('click',request);
})();
