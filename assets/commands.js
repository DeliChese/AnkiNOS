(function initCommands(){
  'use strict';
  const setup=()=>{
    const T=window.NOSTool;if(!T||T.kind!=='palette')return;
    const {$,element:el}=T;let sequence=0,items=[],active=0,timer;
    function highlight(){Array.from($('command-results').children).forEach((node,i)=>{node.classList.toggle('active',i===active);node.setAttribute('aria-selected',String(i===active));});}
    function execute(item){if(item)T.send('execute',item);}
    function search(){sequence++;T.send('search',{query:$('command-query').value,seq:sequence});}
    function render(data){if(Number(data.seq)<sequence)return;items=data.items||[];active=0;
      $('command-results').replaceChildren(...items.map((item,i)=>{
        const button=el('button',undefined,'command-result');button.type='button';button.role='option';button.id='command-result-'+i;
        button.append(el('span',item.title),el('small',item.detail));button.addEventListener('click',()=>execute(item));return button;
      }));highlight();T.notice(items.length?`${items.length} kết quả · ↑ ↓ để chọn · Enter để mở`:'Chưa tìm thấy. Thử tên bộ thẻ, ghi chú hoặc lệnh như “thêm thẻ”.');
    }
    window.NOSCommands={init(){
      $('tool-content').innerHTML='<label for="command-query">Tìm bộ thẻ, tài nguyên, ghi chú hoặc lệnh</label><input id="command-query" class="command-search" type="search" autocomplete="off" placeholder="Ví dụ: học tiếp, thêm thẻ, sổ tay…" role="combobox" aria-controls="command-results" aria-expanded="true"><div id="command-results" class="command-results" role="listbox" aria-label="Kết quả tìm kiếm"></div>';
      $('command-query').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(search,120);});
      $('command-query').addEventListener('keydown',event=>{
        if(event.isComposing)return;
        if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+Math.max(1,items.length))%Math.max(1,items.length);highlight();$('command-query').setAttribute('aria-activedescendant','command-result-'+active);$('command-results').children[active]?.scrollIntoView({block:'nearest'});}
        if(event.key==='Enter'){event.preventDefault();execute(items[active]);}
      });$('command-query').focus();
    },receive(event,data){if(event==='results')render(data);},preview(action,data){
      if(action==='boot'||action==='search'){
        const fold=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');
        const sample=[{kind:'action',id:'study',title:'Học bộ thẻ hiện tại',detail:'Lệnh'},{kind:'action',id:'notebook',title:'Sổ tay',detail:'Lệnh'},{kind:'action',id:'add',title:'Thêm thẻ Anki',detail:'Lệnh'},{kind:'deck',id:'1',title:'Ngoại ngữ::Tiếng Anh',detail:'Bộ thẻ'}];
        render({seq:data.seq||0,items:sample.filter(x=>fold(x.title).includes(fold(data.query||'')))});
      }else T.notice('Bản xem trước · mở Anki để chạy lệnh.');
    }};
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
