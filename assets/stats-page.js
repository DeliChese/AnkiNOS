/* AnkiNOS statistics workspace.
 * Uses the native Anki GraphsResponse, never estimates scheduling data.
 * Pure SVG: no CDN, canvas screenshots, or duplicate stock Anki window. */
(function initNOSStats() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNOSStats, {once:true});
    return;
  }
  const app = document.getElementById('nos-app');
  if (!app || window.NOSStats) return;
  const $ = id => document.getElementById(id);
  const locale = new Intl.NumberFormat('vi-VN', {maximumFractionDigits:1});
  const fmt = n => locale.format(Number(n) || 0);
  const num = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const colors = ['#97c5ff','#91ebc4','#ffc98d','#d3aaff','#ff93a6','#a4d9e9','#efda9e'];
  const native = app.dataset.native === 'true';
  const cache = new Map();
  let loading = false, metricData = null;
  let reportedKey = '';
  let renderedKey = '';
  let paintingKey = '';
  let renderEpoch = 0;
  const scope = () => $('stats-scope').value;
  const days = () => Number($('stats-period').value);
  const cacheKey = () => scope() + '/' + days();
  const getField = (object,key) => num(object?.[key]);
  const sum = arr => arr.reduce((total,n) => total+num(n),0);
  const mapRows = object => Object.entries(object || {}).map(([key, value]) => ({
    x: Number(key), value: num(value)
  })).filter(p => Number.isFinite(p.x)).sort((a,b) => a.x-b.x);
  const totals = (v,keys) => sum(keys.map(k => getField(v,k)));
  const empty = () => '<p class="stats-note">Chưa có dữ liệu cho phạm vi này.</p>';
  const countLabel = value => fmt(value) + ' lượt';
  const minutes = millis => {
    const m = num(millis) / 60000;
    return m < 1 ? fmt(m * 60) + ' giây' : fmt(m) + ' phút';
  };
  const percent = (passed,failed) => {
    const total = num(passed)+num(failed);
    return total ? fmt(100*num(passed)/total)+'%' : '—';
  };
  function frame(title,caption,body,footer='',wide=false) {
    return '<article class="stats-native-card'+(wide?' stats-card-wide':'')+'">' +
      '<h3>'+esc(title)+'</h3><p class="stats-card-caption">'+esc(caption)+'</p>'+body+
      (footer?'<footer class="stats-card-foot">'+footer+'</footer>':'')+'</article>';
  }
  function legend(items) {
    return '<div class="stats-legend">'+items.map(([name,color]) =>
      '<span><i style="background:'+color+'"></i>'+esc(name)+'</span>').join('')+'</div>';
  }
  // Reduce a long native series to a bounded number of real sum buckets.
  function groupRows(items, maxBars=50, kinds=null) {
    if (items.length <= maxBars) return items;
    const stride = Math.ceil(items.length/maxBars);
    const result = [];
    for(let i=0; i<items.length; i+=stride) {
      const slice = items.slice(i,i+stride);
      const first = slice[0], last = slice[slice.length-1];
      const label = first.label && last.label ?
        (first.label === last.label ? first.label : first.label+' – '+last.label) :
        (first.x === last.x ? String(first.x) : first.x+' … '+last.x);
      if(kinds) {
        const values = Object.fromEntries(kinds.map(k => [k,sum(slice.map(p => p.values?.[k]))]));
        result.push({x:first.x,label,values});
      } else {
        result.push({x:first.x,label,value:sum(slice.map(p=>p.value))});
      }
    }
    return result;
  }
  function barPlot(input, opts={}) {
    const rows = groupRows(input, opts.maxBars || 50);
    if(!rows.length) return empty();
    const max = Math.max(1,...rows.map(x=>num(x.value)));
    const W=620,H=214,L=40,R=11,T=15,B=31,h=H-T-B,w=W-L-R;
    const bw=w/rows.length;
    let svg='<svg class="stats-chart" role="img" aria-label="'+esc(opts.aria||'Biểu đồ cột')+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
    for(let j=0;j<=4;j++) {
      const y=T+h*j/4;
      svg+='<line class="stats-plot-grid" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/>';
      svg+='<text class="stats-axis-txt" text-anchor="end" x="'+(L-6)+'" y="'+(y+3)+'">'+esc(opts.tick ? opts.tick(max*(4-j)/4) : fmt(max*(4-j)/4))+'</text>';
    }
    const minHeight=2.1;
    rows.forEach((r,i)=>{
      const v=num(r.value);
      const height=v?Math.max(minHeight,v/max*h):minHeight;
      const x=L+i*bw+bw*.13, y=T+h-height;
      const label=String(r.label??r.x);
      svg+='<rect class="stats-bar" x="'+x.toFixed(2)+'" y="'+y.toFixed(2)+'" width="'+Math.max(1.7,bw*.74).toFixed(2)+'" height="'+height.toFixed(2)+'" rx="1.8" fill="'+esc(opts.color||colors[0])+'"><title>'+esc(label+': '+(opts.tooltip ? opts.tooltip(v) : fmt(v)))+'</title></rect>';
    });
    if(opts.percentLine && Array.isArray(opts.percentLine) && rows.length === opts.percentLine.length) {
      let path='', active=false;
      opts.percentLine.forEach((ratio,i) => {
        if(ratio===null || !Number.isFinite(Number(ratio))) {active=false;return;}
        const x=L+(i+.5)*bw, y=T+h-Math.max(0,Math.min(100,Number(ratio)))/100*h;
        path+=(active?' L':' M')+x.toFixed(1)+' '+y.toFixed(1);
        active=true;
      });
      svg+='<path class="stats-line" d="'+path+'" stroke="'+(opts.lineColor||'#ffd996')+'"/>';
      svg+='<text class="stats-axis-txt" text-anchor="end" x="'+(W-R)+'" y="'+(T+9)+'">100%</text>';
    }
    if(opts.cumulative) {
      let accumulated=0;
      const all=sum(rows.map(r=>r.value))||1;
      let points='';
      rows.forEach((r,i)=>{
        accumulated+=num(r.value);
        const x=L+(i+.5)*bw,y=T+h-accumulated/all*h;
        points+=(i?' L':'M')+x.toFixed(1)+' '+y.toFixed(1);
      });
      svg+='<path class="stats-line" d="'+points+'" stroke="#e8f1ff" opacity=".65"/>';
    }
    for(let i=0;i<Math.min(6,rows.length);i++){
      const idx=Math.round(i*(rows.length-1)/Math.max(1,Math.min(6,rows.length)-1));
      const x=L+(idx+.5)*bw;
      svg+='<text class="stats-axis-txt" text-anchor="middle" x="'+x+'" y="'+(H-9)+'">'+esc(String(rows[idx].label??rows[idx].x).slice(0,14))+'</text>';
    }
    return svg+'</svg>';
  }
  function stackPlot(input, kinds, opts={}) {
    const rows = groupRows(input, opts.maxBars||50, kinds.map(k=>k.key));
    if(!rows.length) return empty();
    const max=Math.max(1,...rows.map(r=>sum(kinds.map(k=>getField(r.values,k.key)))));
    const W=620,H=214,L=39,R=8,T=13,B=28,h=H-T-B,bw=(W-L-R)/rows.length;
    let svg='<svg class="stats-chart" role="img" aria-label="'+esc(opts.aria||'Biểu đồ phân loại')+'" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">';
    for(let j=0;j<=4;j++){
      const y=T+h*j/4;
      svg+='<line class="stats-plot-grid" x1="'+L+'" y1="'+y+'" x2="'+(W-R)+'" y2="'+y+'"/><text class="stats-axis-txt" text-anchor="end" x="'+(L-5)+'" y="'+(y+3)+'">'+esc(opts.tick?opts.tick(max*(4-j)/4):fmt(max*(4-j)/4))+'</text>';
    }
    rows.forEach((r,i)=>{
      let bottom=T+h;
      for(const k of kinds){
        const v=getField(r.values,k.key);
        if(!v) continue;
        const height=Math.max(1.8,v/max*h);
        bottom-=height;
        svg+='<rect x="'+(L+i*bw+bw*.1).toFixed(2)+'" y="'+Math.max(T,bottom).toFixed(2)+'" width="'+Math.max(2,bw*.78).toFixed(2)+'" height="'+height.toFixed(2)+'" fill="'+k.color+'" opacity=".92"><title>'+esc(String(r.label??r.x)+' · '+k.name+': '+(opts.tooltip?opts.tooltip(v):fmt(v)))+'</title></rect>';
      }
      if(i===0||i===rows.length-1||i===Math.floor(rows.length/2)){
        svg+='<text class="stats-axis-txt" text-anchor="middle" x="'+(L+(i+.5)*bw)+'" y="'+(H-8)+'">'+esc(String(r.label??r.x).slice(0,15))+'</text>';
      }
    });
    return svg+'</svg>'+legend(kinds.map(k=>[k.name,k.color]));
  }
  function rowsByDays(object, period, mapper, includeToday=true) {
    const values=Object.entries(object||{}).map(([k,v])=>[Number(k),v]).filter(([k])=>Number.isInteger(k) && k<=0);
    const min=period===0 ? Math.max(-12000,Math.min(0,...values.map(([x])=>x))) : -364;
    const max=includeToday?0:-1;
    const lookup=new Map(values);
    const rows=[];
    for(let day=min;day<=max;day++) {
      const v=mapper(lookup.get(day));
      rows.push({x:day,label:day===0?'Hôm nay':day+' ngày',...(typeof v==='object'?{values:v}:{value:num(v)})});
    }
    return rows;
  }
  function todaySection(g) {
    const data=g.today||{};
    const answered=getField(data,'answer_count'), correct=getField(data,'correct_count');
    const count=getField(data,'mature_count'), mature=getField(data,'mature_correct');
    const blocks=[
      ['Đã học',fmt(answered)+' lượt'],
      ['Tổng thời gian',minutes(getField(data,'answer_millis'))],
      ['Trả lời đạt',answered?percent(correct,answered-correct):'—'],
      ['Đúng thẻ trưởng thành',count?percent(mature,count-mature):'—']
    ];
    const body='<div class="stats-today-grid">'+blocks.map(([label,value])=>
      '<div class="stats-today-value"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span></div>').join('')+'</div>';
    const footer='<span>Học mới: <strong>'+fmt(getField(data,'learn_count'))+'</strong></span>'+
      '<span>Ôn: <strong>'+fmt(getField(data,'review_count'))+'</strong></span>'+
      '<span>Học lại: <strong>'+fmt(getField(data,'relearn_count'))+'</strong></span>'+
      '<span>Học sớm: <strong>'+fmt(getField(data,'early_review_count'))+'</strong></span>';
    return frame('Hôm nay','Lượt trả lời và thời gian tính theo ngày học của Anki.',body,footer,true);
  }
  function futureSection(g) {
    const f=g.future_due||{};
    const d=f.future_due||{};
    const range=30;
    const backlog=Boolean(f.have_backlog);
    const list=[];
    if (backlog) for(let day=-30;day<0;day++) list.push({x:day,label:String(day),value:getField(d,String(day))});
    for(let day=0;day<=range;day++) list.push({x:day,label:day===0?'Hôm nay':'+'+day,value:getField(d,String(day))});
    return frame('Dự báo đến hạn','Ước tính lịch ôn sắp tới theo scheduler của Anki. Không bao gồm thẻ học mới chưa lên lịch.',
      barPlot(list,{color:colors[1],cumulative:true,aria:'Lượt ôn đến hạn và tổng cộng dồn 30 ngày'}),'<span>Khối lượng/ngày: <strong>'+fmt(getField(f,'daily_load'))+' thẻ</strong></span>'+
      (backlog?'<span>Có thẻ tồn đọng</span>':''),true);
  }
  const TYPES = [
    {key:'mature',name:'Trưởng thành',color:'#64d6a2'},
    {key:'young',name:'Thẻ trẻ',color:'#9dc8ff'},
    {key:'relearn',name:'Học lại',color:'#ff98aa'},
    {key:'learn',name:'Đang học',color:'#ffd08b'},
    {key:'filtered',name:'Học tùy biến',color:'#cba8fd'}
  ];
  function reviewSection(g, time=false, period=365) {
    const rows=rowsByDays(g.reviews?.[time?'time':'count'],period,
      v=>Object.fromEntries(TYPES.map(k=>[k.key,time?getField(v,k.key)/60000:getField(v,k.key)])));
    const total=sum(rows.map(r=>totals(r.values,TYPES.map(k=>k.key))));
    const title=time?'Thời gian ôn tập':'Lượt ôn theo ngày';
    const subtitle=time?'Tổng phút trả lời, phân theo loại thẻ.':'Số lượt trả lời, phân theo loại thẻ. Không tính thao tác lên lịch thủ công.';
    return frame(title,subtitle,stackPlot(rows,TYPES,{maxBars:50,tick:time?v=>fmt(v)+'p':undefined,tooltip:time?v=>fmt(v)+' phút':undefined}),
      '<span>Tổng: <strong>'+fmt(total)+(time?' phút':' lượt')+'</strong></span>');
  }
  function countSection(g) {
    const data=g.card_counts?.excluding_inactive||{};
    const keys=[
      ['newCards','Chưa học','#8cc1ff'],['learn','Đang học','#ffd19a'],
      ['relearn','Học lại','#ff9baa'],['young','Thẻ trẻ','#af90ff'],
      ['mature','Trưởng thành','#7ce2b1'],['suspended','Tạm ngưng','#96a5c2'],
      ['buried','Chôn','#b5b9c8']
    ];
    const values=keys.map(([key,name,color])=>({value:getField(data,key),name,color}));
    const total=sum(values.map(v=>v.value));
    if(!total)return frame('Phân loại thẻ','Cơ cấu thẻ hiện có của bộ thẻ/bộ sưu tập.',empty());
    const r=67,circ=2*Math.PI*r;
    let offset=0;
    const circles=values.map(v=>{
      if(!v.value)return '';
      const span=v.value/total*circ;
      const circle='<circle class="stats-slice" cx="110" cy="95" r="'+r+'" fill="none" stroke="'+v.color+'" stroke-width="25" stroke-dasharray="'+span+' '+(circ-span)+'" stroke-dashoffset="'+(-offset)+'" transform="rotate(-90 110 95)"><title>'+esc(v.name+': '+fmt(v.value))+'</title></circle>';
      offset+=span;
      return circle;
    }).join('');
    const svg='<svg class="stats-chart" viewBox="0 0 220 190" role="img" aria-label="Tỷ lệ các loại thẻ">'+circles+
      '<text x="110" y="89" text-anchor="middle" fill="currentColor" font-size="23" font-weight="650">'+fmt(total)+'</text>'+
      '<text x="110" y="109" text-anchor="middle" fill="currentColor" font-size="11">thẻ</text></svg>';
    const legendList='<ul class="stats-donut-legend">'+values.filter(v=>v.value).map(v=>
      '<li><i style="background:'+v.color+'"></i>'+esc(v.name)+'<strong>'+fmt(v.value)+'</strong></li>').join('')+'</ul>';
    return frame('Phân loại thẻ','Loại thẻ được Anki phân tích theo trạng thái lập lịch.',
      '<div class="stats-donut-shell">'+svg+legendList+'</div>');
  }
  function distribution(title,subtitle,mapping,color,unit='',average=null) {
    const rows=mapRows(mapping).map(p=>({...p,label:fmt(p.x)+unit}));
    let footer='';
    if(average!==null && Number.isFinite(Number(average))) footer='<span>Trung bình: <strong>'+fmt(average)+unit+'</strong></span>';
    footer+='<span>Số thẻ: <strong>'+fmt(sum(rows.map(x=>x.value)))+'</strong></span>';
    return frame(title,subtitle,barPlot(rows,{color,aria:title}),footer);
  }
  function trueRetentionSection(g, period) {
    const keys=[['today','Hôm nay'],['yesterday','Hôm qua'],['week','7 ngày'],['month','30 ngày'],['year','12 tháng']];
    if(period===0)keys.push(['all_time','Toàn bộ']);
    let count=0;
    const rows=keys.map(([key,title])=>{
      const data=g.true_retention?.[key]||{};
      const yp=getField(data,'young_passed'),yf=getField(data,'young_failed');
      const mp=getField(data,'mature_passed'),mf=getField(data,'mature_failed');
      count+=yp+yf+mp+mf;
      return '<tr><td>'+esc(title)+'</td><td>'+fmt(yp+yf+mp+mf)+'</td>'+
        '<td>'+percent(yp,yf)+'</td><td>'+percent(mp,mf)+'</td>'+
        '<td><strong>'+percent(yp+mp,yf+mf)+'</strong></td></tr>';
    }).join('');
    const table='<table class="stats-mini-table"><thead><tr><th>Khoảng thời gian</th><th>Lượt kiểm tra</th><th>Thẻ trẻ</th><th>Trưởng thành</th><th>Chung</th></tr></thead><tbody>'+rows+'</tbody></table>';
    return frame('True Retention','Anki chỉ tính lần ôn đầu tiên của mỗi thẻ trong ngày; Hard/Good/Easy là đạt. Không phải dự đoán FSRS.',count?table:empty(),'');
  }
  function hoursSection(g,period) {
    const source=period===0?g.hours?.all_time:g.hours?.one_year;
    const arr=Array.isArray(source)?source:[];
    const rows=Array.from({length:24},(_,i)=>({x:i,label:i+'h',value:getField(arr[i],'total')}));
    const total=sum(rows.map(r=>r.value));
    if(!total)return frame('Giờ học hiệu quả','Số lượt ôn theo từng khung giờ, tính bằng dữ liệu Anki.',empty());
    const ratios=Array.from({length:24},(_,i)=>getField(arr[i],'total')>0?
      getField(arr[i],'correct')/getField(arr[i],'total')*100:null);
    const chart=barPlot(rows,{color:colors[0],maxBars:24,percentLine:ratios,
      aria:'Lượt ôn theo giờ và tỷ lệ đúng (%)'});
    return frame('Giờ học hiệu quả','Cột xanh: lượt ôn theo giờ. Đường vàng: tỷ lệ trả lời đạt.',chart,
      '<span>Đã ghi: <strong>'+fmt(total)+' lượt</strong></span>'+
      '<span>Tỷ lệ trả lời đạt: <strong>'+percent(sum(arr.map(d=>getField(d,'correct'))),total-sum(arr.map(d=>getField(d,'correct'))))+'</strong></span>');
  }
  function buttonsSection(g,period) {
    const source=period===0?g.buttons?.all_time:g.buttons?.one_year;
    const keys=[['learning','Đang học'],['young','Thẻ trẻ'],['mature','Trưởng thành']];
    const btnColors=['#ff95ac','#ffd39b','#91dcb4','#89bff9'];
    const rows=keys.map(([key,label])=>({x:label,label,values:
      Object.fromEntries([0,1,2,3].map(i=>['b'+i,num(source?.[key]?.[i])]))}));
    const sumAll=sum(rows.map(v=>totals(v.values,['b0','b1','b2','b3'])));
    const groups=['Quên','Khó','Tốt','Dễ'].map((name,i)=>({key:'b'+i,name,color:btnColors[i]}));
    return frame('Nút đánh giá','Số lần nhấn Quên / Khó / Tốt / Dễ theo loại thẻ.',sumAll?stackPlot(rows,groups,{maxBars:4}):empty(),
      '<span>Tổng: <strong>'+fmt(sumAll)+' lượt</strong></span>');
  }
  function addedSection(g,period) {
    const rows=rowsByDays(g.added?.added,period,v=>num(v));
    const total=sum(rows.map(r=>r.value));
    return frame('Thẻ đã thêm','Thời điểm thêm thẻ trong khoảng lịch sử đang chọn.',
      barPlot(rows,{color:colors[3],aria:'Số thẻ thêm theo ngày'}),'<span>Tổng: <strong>'+fmt(total)+' thẻ</strong></span>');
  }
  function render(payload) {
    const g=payload?.data||{}, period=payload.days;
    const fsrs=!!g.fsrs;
    const key=payload.scope+'/'+payload.days;
    // Defer expensive SVG generation into small batches on the Anki WebView.
    // Existing DOM is kept when reopening a report with identical filters.
    const sections=[
      () => todaySection(g),
      () => futureSection(g),
      () => reviewSection(g,false,period),
      () => reviewSection(g,true,period),
      () => countSection(g),
      () => distribution('Khoảng cách ôn','Phân bố số ngày đến lượt ôn tiếp theo.',
        g.intervals?.intervals,colors[0],' ngày'),
      ...(fsrs?[
        () => distribution('Độ ổn định FSRS','Số ngày để khả năng nhớ giảm xuống 90% theo mô hình FSRS.',
          g.stability?.intervals,colors[1],' ngày'),
      ]:[]),
      () => distribution('Độ dễ của thẻ','Độ dễ SM-2, tính theo phần trăm.',
        g.eases?.eases,colors[2],'%',g.eases?.average),
      ...(fsrs?[
        () => distribution('Độ khó FSRS','Phân bố độ khó của thẻ do FSRS ước lượng.',
          g.difficulty?.eases,colors[3],'%',g.difficulty?.average),
        () => distribution('Khả năng nhớ FSRS','Retrievability là xác suất ghi nhớ được FSRS tính.',
          g.retrievability?.retrievability,colors[4],'%',g.retrievability?.average),
      ]:[]),
      () => trueRetentionSection(g,period),
      () => hoursSection(g,period),
      () => buttonsSection(g,period),
      () => addedSection(g,period)
    ];
    const epoch=++renderEpoch;
    renderedKey='';
    paintingKey=key;
    const report=$('stats-report');
    report.replaceChildren();
    $('stats-metric-scope').textContent=
      'Đang xem '+(payload.scope==='deck'?'bộ thẻ hiện tại và các bộ con':'toàn bộ bộ sưu tập')+
      ' · '+(period===0?'toàn bộ lịch sử':'12 tháng');
    // Update the numeric summary immediately; graphs paint incrementally.
    updateMetricCards(g);
    if (native) {
      $('stats-loading').hidden=false;
      $('stats-loading').textContent='Đang vẽ biểu đồ…';
    }
    let offset=0;
    const paintBatch=()=>{
      if (epoch!==renderEpoch || key!==cacheKey()) return;
      const end=native?Math.min(offset+2,sections.length):sections.length;
      let markup='';
      for (;offset<end;offset++) markup+=sections[offset]();
      report.insertAdjacentHTML('beforeend',markup);
      if (offset<sections.length) {
        requestAnimationFrame(paintBatch);
      } else {
        renderedKey=key;
        paintingKey='';
        $('stats-loading').hidden=true;
        if (!native) $('stats-metric-scope').textContent+=' · Dữ liệu minh họa';
      }
    };
    if(native) requestAnimationFrame(paintBatch);
    else paintBatch();
  }
  function updateMetricCards(g) {
    metricData=g;
    const t=g.today||{};
    const reviews=getField(t,'answer_count'),ms=getField(t,'answer_millis');
    const pace=ms ? Math.round(reviews/ms*3600000) : null;
    const month=g.true_retention?.month||{};
    const passed=getField(month,'young_passed')+getField(month,'mature_passed');
    const failed=getField(month,'young_failed')+getField(month,'mature_failed');
    const retention=passed+failed?passed/(passed+failed)*100:null;
    if($('stat-retention'))$('stat-retention').textContent=retention===null?'—':fmt(retention)+'%';
    if($('retention-detail'))$('retention-detail').textContent='True Retention · 30 ngày';
    if($('stat-pace'))$('stat-pace').innerHTML=(pace===null?'—':fmt(pace))+' <small>lượt/giờ</small>';
    if($('stat-time'))$('stat-time').textContent=minutes(ms);
    if($('stat-studied'))$('stat-studied').innerHTML=fmt(reviews)+' <small>lượt</small>';
  }
  function preview() {
    const a={};
    for(let i=0;i<=30;i++)a[i]=Math.round(2+10*Math.abs(Math.sin(i*.37)));
    const count={}, time={}, added={};
    for(let d=-364;d<=0;d++)if(d%4===0) {
      count[d]={learn:4+(d%7+7)%7,young:11,mature:7,relearn:2,filtered:0};
      time[d]={learn:240000,young:350000,mature:245000,relearn:60000,filtered:0};
      added[d]=Math.abs(d%13)*3;
    }
    return {scope:scope(),days:days(),data:{
      today:{answer_count:24,answer_millis:960000,correct_count:20,mature_count:12,mature_correct:11,learn_count:7,review_count:15,relearn_count:2},
      future_due:{future_due:a,daily_load:7,have_backlog:true},
      reviews:{count,time},added:{added},
      card_counts:{excluding_inactive:{newCards:110,learn:20,relearn:9,young:120,mature:310,suspended:11,buried:4}},
      intervals:{intervals:{"1":26,"3":31,"7":41,"14":32,"21":50,"30":70,"90":20}},
      eases:{eases:{"130":9,"180":20,"200":45,"220":64,"250":50,"280":25},average:224},
      difficulty:{eases:{"10":20,"30":27,"60":40,"80":21},average:51},
      stability:{intervals:{"1":22,"4":37,"9":56,"19":29,"40":18}},
      retrievability:{retrievability:{"40":12,"50":23,"60":34,"70":46,"80":56,"90":78},average:79},
      fsrs:true,
      true_retention:{today:{young_passed:9,young_failed:2,mature_passed:8,mature_failed:1},
        month:{young_passed:222,young_failed:36,mature_passed:210,mature_failed:18},
        year:{young_passed:410,young_failed:69,mature_passed:390,mature_failed:38}},
      hours:{one_year:Array.from({length:24},(_,i)=>({total:Math.max(0,Math.round(30*Math.sin((i-5)/13*Math.PI))),correct:Math.max(0,Math.round(23*Math.sin((i-5)/13*Math.PI)))}))},
      buttons:{one_year:{learning:[10,15,53,8],young:[12,29,81,11],mature:[4,17,77,16]}}
    }};
  }
  function request(force=false) {
    const key=cacheKey();
    if (!force && cache.has(key)) {
      loading=false;
      if (renderedKey !== key && paintingKey !== key) render(cache.get(key));
      return;
    }
    if (loading && reportedKey===key && !force) return;
    loading=true;
    reportedKey=key;
    ++renderEpoch; // Cancel a previous chart batch if the filters changed.
    renderedKey='';
    paintingKey='';
    $('stats-loading').hidden=false;
    $('stats-loading').textContent='Đang tổng hợp toàn bộ biểu đồ từ Anki…';
    // Keep the prior report visible during a manual refresh; replacing it
    // every time makes switching a view feel like a full-page flash.
    if (!force) $('stats-report').replaceChildren();
    if(!native) {
      const payload=preview();
      cache.set(key,payload);
      loading=false;
      render(payload);
      return;
    }
    if(typeof window.pycmd!=='function') {
      loading=false;
      $('stats-loading').textContent='Cầu nối Anki chưa sẵn sàng. Nhấn Làm mới để thử lại.';
      return;
    }
    window.pycmd('nos:'+JSON.stringify({action:'graphs',scope:scope(),days:days()}));
  }
  function receive(event,payload) {
    if(event==='graphs_error') {
      loading=false;
      $('stats-loading').hidden=false;
      $('stats-loading').textContent=String(payload);
      return;
    }
    if(event!=='graphs'||!payload||!payload.data) return;
    cache.set(payload.scope+'/'+payload.days,payload);
    if(payload.scope!==scope()||Number(payload.days)!==days()) return;
    loading=false;
    render(payload);
  }
  function open() {
    if(!$('stats-page').hidden) request(false);
  }
  function reload() { cache.delete(cacheKey()); request(true); }
  function refreshMetrics() {
    if(metricData && app.dataset.page==='stats')updateMetricCards(metricData);
  }
  $('stats-scope')?.addEventListener('change',()=>request(false));
  $('stats-period')?.addEventListener('change',()=>request(false));
  $('stats-refresh')?.addEventListener('click',reload);
  $('stats-save-pdf')?.addEventListener('click',()=>{
    if(!native) {
      $('stats-loading').hidden=false;
      $('stats-loading').textContent='Lưu PDF chỉ hỗ trợ trong Anki. Đây là bản xem trước.';
      return;
    }
    if (loading || renderedKey !== cacheKey()) {
      $('stats-loading').hidden=false;
      $('stats-loading').textContent='Đang hoàn thiện biểu đồ. Thử xuất PDF sau khi tải xong.';
      return;
    }
    if(typeof window.pycmd==='function') window.pycmd('nos:'+JSON.stringify({action:'stats_pdf'}));
  });
  window.NOSStats={open,reload,receive,refreshMetrics};
})();
