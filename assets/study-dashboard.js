/* Small study entry point, transparent estimates, and actionable insights. */
(function initializeStudyDashboard() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeStudyDashboard, {once:true}); return;
  }
  const root=document.getElementById('study-launchpad');
  if(!root||window.NOSStudy)return;
  const $=id=>document.getElementById(id), fmt=new Intl.NumberFormat('vi-VN');
  const n=value=>fmt.format(value||0);
  let snapshot=null, support=null, selected='', budget=30, pending=false, requestAt=0, revision='';
  const command=(action,args={})=>window.AnkiNOS?.studioCommand(action,args);
  const allDecks=nodes=>nodes.flatMap(node=>[node,...allDecks(node.children||[])]);
  const queue=deck=>(deck?.new||0)+(deck?.learn||0)+(deck?.review||0);
  const title=deck=>deck.full_name||deck.name;
  const minutes=ms=>Math.max(1,Math.ceil(ms/60000));
  function request(force=false){
    if(!snapshot)return;
    if(!force&&(pending||performance.now()-requestAt<1500))return;
    pending=true;requestAt=performance.now();
    if(!support)render();
    if(typeof window.pycmd==='function')command('study_support',{force:!!force});
    else if(!document.getElementById('nos-app').dataset.native){
      // Preview only; actual collection data never falls back to these numbers.
      receive({timing:{all:{samples:250,median_ms:22000,low_ms:14000,high_ms:35000}},
        decks:{'101':{name:'Tiếng Anh — Từ vựng',samples:80,previous_samples:90,retention:80,previous_retention:92,change_points:-12,repeated_lapses:4}},
        source:'Dữ liệu minh họa · Lịch sử trả lời 30 ngày, mọi bộ thẻ.',period_days:30,minimum_samples:20});
    }
  }
  function choose(){
    const decks=allDecks(snapshot.decks||[]), index=new Map(decks.map(x=>[String(x.id),x]));
    const last=String(snapshot.settings?.last_study_deck||snapshot.selected_deck||'');
    if(!index.has(selected)){
      const recent=index.get(last), due=(snapshot.decks||[]).filter(x=>queue(x)>0).sort((a,b)=>queue(b)-queue(a));
      selected=String((queue(recent)?recent:due[0]||recent||decks[0])?.id||'');
    }
    // Keep options small even for collections containing thousands of decks.
    const choices=[index.get(selected),index.get(last),...(snapshot.decks||[]).filter(x=>queue(x)>0).sort((a,b)=>queue(b)-queue(a)),...(snapshot.decks||[])];
    const unique=[...new Map(choices.filter(Boolean).map(x=>[String(x.id),x])).values()].slice(0,12);
    const key=JSON.stringify(unique.map(x=>[x.id,title(x)]));
    if($('study-deck').dataset.key!==key){
      $('study-deck').replaceChildren(...unique.map(deck=>{const option=document.createElement('option');option.value=deck.id;option.textContent=title(deck);return option;}));
      $('study-deck').dataset.key=key;
    }
    $('study-deck').value=selected;
    return index.get(selected);
  }
  function estimate(deck){
    const pooled=support?.timing?.all;
    if(!pooled?.median_ms)return null;
    let low=0,median=0,high=0;
    for(const kind of ['new','learn','review']){
      const stats=support.timing[kind]?.median_ms?support.timing[kind]:pooled;
      low+=(deck[kind]||0)*stats.low_ms;median+=(deck[kind]||0)*stats.median_ms;high+=(deck[kind]||0)*stats.high_ms;
    }
    return {low:minutes(low),median:minutes(median),high:minutes(high),
      capacity:Math.max(1,Math.floor(budget*60000/pooled.median_ms)),samples:pooled.samples};
  }
  function render(){
    if(!snapshot)return;
    const deck=choose(), available=queue(deck), estimated=deck&&available?estimate(deck):null;
    $('study-deck').disabled=!deck;
    $('study-now').disabled=$('study-focus').disabled=!available;
    $('study-title').textContent=deck?(String(deck.id)===String(snapshot.settings?.last_study_deck)?'Tiếp tục học':'Sẵn sàng cho phiên học'):'Bắt đầu từ bộ thẻ đầu tiên';
    $('study-queue').textContent=deck?`${n(deck.new)} mới · ${n(deck.learn)} đang học · ${n(deck.review)} cần ôn`:'Tạo hoặc nhập bộ thẻ để bắt đầu.';
    $('study-now').textContent=available?'Học ngay':'Chưa có thẻ sẵn sàng';
    $('study-focus').textContent=`Focus ${budget} phút`;
    $('study-budget').value=String(budget);
    const brief=$('study-brief');
    if(brief){
      if(!available) brief.textContent=deck?'Bộ thẻ này đã xong lúc này.':'Mở thư viện để quản lý bộ thẻ.';
      else if(estimated) brief.textContent=`Khoảng ${n(Math.min(available,estimated.capacity))} lượt trong ${budget} phút · cả hàng đợi ${estimated.low}–${estimated.high} phút`;
      else brief.textContent=pending?'Đang ước lượng thời gian…':'Chưa đủ dữ liệu ước lượng · vẫn bắt đầu Focus được.';
    }
    if(!available){
      $('study-estimate').textContent=deck?'Bộ thẻ này đã xong lúc này. Bạn có thể chọn bộ khác hoặc quay lại khi thẻ đến hạn.':'Mở thư viện để quản lý bộ thẻ.';
      $('study-capacity').textContent='';
    }else if(estimated){
      $('study-estimate').textContent=`Khoảng ${estimated.low}–${estimated.high} phút cho các lượt hiện có (mốc giữa ${estimated.median} phút).`;
      $('study-capacity').textContent=`Trong ${budget} phút: khoảng ${n(Math.min(available,estimated.capacity))} lượt đầu, theo nhịp trả lời gần đây.`;
    }else{
      $('study-estimate').textContent=pending?'Đang đọc lịch sử để ước lượng…':'Chưa đủ 20 lượt có ghi thời gian trong 30 ngày để ước lượng. Bạn vẫn có thể bắt đầu Focus.';
      $('study-capacity').textContent='';
    }
    $('study-estimate-source').textContent=estimated?`${n(estimated.samples)} lượt có thời gian · 30 ngày · mọi bộ thẻ. Khoảng được quy đổi từ phân vị 25–75% của thời gian mỗi lượt, không phải cam kết. Thẻ học có thể xuất hiện lại; âm thanh, nghỉ và độ khó làm thời gian thay đổi.`:'Ước lượng dựa trên lịch sử cá nhân; không dùng tốc độ giả định.';
    $('study-planning-note').textContent='Focus nhắc bạn khi đủ giờ. Anki tiếp tục quản lý thứ tự và lịch ôn; phiên không giới hạn số thẻ.';
    renderInsights();
  }
  function renderInsights(){
    const list=$('study-insights-list');
    if(!support){$('study-insights-status').textContent='Đang đọc lịch sử học…';return;}
    const scope=$('study-insight-scope').value;
    const rows=Object.entries(support.decks||{}).filter(([did])=>scope==='all'||did===selected);
    const usable=rows.filter(([,v])=>v.samples>=20&&v.previous_samples>=20);
    const drops=usable.filter(([,v])=>v.change_points<=-5).sort((a,b)=>a[1].change_points-b[1].change_points);
    const repeated=rows.filter(([,v])=>v.repeated_lapses>0).sort((a,b)=>b[1].repeated_lapses-a[1].repeated_lapses);
    const entries=[...drops.map(([id,v])=>({id,v,kind:'retention_drop'})),...repeated.map(([id,v])=>({id,v,kind:'repeated_lapses'}))];
    // Prefer one signal per branch: parent/child aggregates must not look independent.
    const chosen=[];
    for(const entry of entries){
      if(chosen.some(x=>entry.v.name===x.v.name||entry.v.name.startsWith(x.v.name+'::')||x.v.name.startsWith(entry.v.name+'::')))continue;
      chosen.push(entry);if(chosen.length===5)break;
    }
    const key=JSON.stringify([scope,selected,chosen,support.start,support.end]);
    if(list.dataset.key!==key){
      list.replaceChildren();list.dataset.key=key;
      for(const {id,v,kind} of chosen){
        const article=document.createElement('article');article.className='study-insight';
        const heading=document.createElement('h3');heading.textContent=v.name;
        const text=document.createElement('p');
        text.textContent=kind==='retention_drop'?`Tỷ lệ trả lời đúng giảm ${n(-v.change_points)} điểm phần trăm: ${n(v.previous_retention)}% → ${n(v.retention)}%.`:`${n(v.repeated_lapses)} thẻ được trả lời Quên ít nhất 3 lần trong 30 ngày.`;
        const detail=document.createElement('small');
        detail.textContent=kind==='retention_drop'?`${n(v.samples)} lượt ôn đến hạn trong 30 ngày gần nhất, so với ${n(v.previous_samples)} lượt ở 30 ngày trước. Đây là quan sát, chưa kết luận nguyên nhân.`:'Đếm lượt ôn đến hạn và học lại; mỗi thẻ chỉ đếm một lần. Xem lại cách hỏi hoặc tách thẻ quá nhiều ý.';
        const action=document.createElement('button');action.type='button';action.className='subtle-button';action.textContent='Xem các thẻ liên quan';
        action.addEventListener('click',()=>command('insight_browse',{id,kind}));
        article.append(heading,text,detail,action);list.append(article);
      }
    }
    $('study-insights-status').textContent=chosen.length?'Gợi ý từ dữ liệu · không thay đổi lịch ôn của bạn':
      usable.length?'Chưa có mức giảm từ 5 điểm phần trăm hoặc thẻ quên lặp lại cần nhắc.':'Chưa đủ mẫu để so sánh: cần ít nhất 20 lượt ôn đến hạn trong mỗi khoảng 30 ngày.';
    $('study-insight-period').textContent=support.start&&support.end?`Dữ liệu theo ngày học Anki · ${support.start.replace('T',' ')} → ${support.end.replace('T',' ')} · gồm bộ thẻ con.`:'Bản xem trước · dữ liệu minh họa';
  }
  function receive(payload){support=payload;pending=false;render();}
  function sync(data){
    const key=JSON.stringify([data.today,data.stats?.reviews,data.support_revision]);
    const changed=revision!==key;revision=key;snapshot=data;
    budget=[15,30,60].includes(data.settings?.study_budget)?data.settings.study_budget:budget;
    render();if(changed||!support)request(true);
  }
  $('study-deck').addEventListener('change',e=>{selected=e.target.value;render();});
  $('study-budget').addEventListener('change',e=>{budget=Number(e.target.value);command('save_ui',{values:{study_budget:budget}});render();});
  $('study-now').addEventListener('click',()=>command('quick_study',{id:selected}));
  $('study-focus').addEventListener('click',()=>command('quick_study',{id:selected,minutes:budget}));
  $('study-insight-scope').addEventListener('change',renderInsights);
  $('study-insights-refresh').addEventListener('click',()=>request(true));
  $('stats-refresh')?.addEventListener('click',()=>request(true));
  window.NOSStudy={sync,receive,refresh:request,error(message){pending=false;$('study-insights-status').textContent=message;$('study-insights-list').replaceChildren();$('study-insights-list').dataset.key='';$('study-estimate').textContent='Không thể tải ước lượng. Bạn vẫn có thể học bình thường.';}};
  const initialSnapshot=window.AnkiNOS?.getSnapshot?.();
  if(initialSnapshot)window.NOSStudy.sync(initialSnapshot);
})();
