(function initNotebook(){
  'use strict';
  const setup=()=>{
    const T=window.NOSTool;if(!T||T.kind!=='workspace')return;
    const {$,element:el}=T;let rows=[],selected=null,dirty=false,archived=false,trash=false,timer;
    const load=()=>T.send('load',{query:$('note-search').value,trash,archived});
    const setDirty=next=>{dirty=next;const badge=$('note-dirty-badge');if(badge)badge.hidden=!dirty;};
    function select(note){
      if(dirty&&!confirm('Bỏ các thay đổi ghi chú chưa lưu?'))return;
      selected=note||null;setDirty(false);
      $('note-title').value=note?.title||'';$('note-body').value=note?.body||'';
      $('note-save').disabled=archived||trash;$('note-trash').hidden=!note||archived;
      $('note-trash').textContent=trash?'Khôi phục ghi chú':'Chuyển vào thùng rác';
      $('note-source').hidden=!note?.note_id||archived||trash;
      $('note-context').textContent=archived?'Bản lưu từ bộ sưu tập khác · chỉ xem, không tự liên kết note.':
        note?.note_id?'Gắn với note Anki '+note.note_id:T.initial.note_id?'Ghi chú mới sẽ gắn với note '+T.initial.note_id:'Ghi chú của bộ thẻ này';
      $('note-title').readOnly=$('note-body').readOnly=archived||trash;
      $('note-list').querySelectorAll('button').forEach(button=>button.setAttribute('aria-current',String(button.dataset.id===note?.id)));
    }
    function render(data){
      rows=data.notes||[];archived=!!data.archived;trash=!!data.trash;
      $('note-scope').value=archived?'archived':trash?'trash':'current';
      if($('note-count'))$('note-count').textContent=String(rows.length);
      $('note-list').replaceChildren(...rows.map(note=>{
        const button=el('button',undefined,'note-item');button.type='button';button.dataset.id=note.id;
        button.append(el('strong',note.title||note.body.slice(0,60)),el('small',note.deck_name+' · '+note.body.slice(0,100)));
        button.addEventListener('click',()=>select(note));return button;
      }));
      if(!rows.length){
        const empty=el('div',undefined,'note-empty');
        empty.append(el('strong',trash?'Thùng rác đang trống':'Chưa có ghi chú nào'),el('p',trash?'Ghi chú đã xóa của bộ thẻ này sẽ hiện ở đây.':'Nhấn “+ Ghi chú mới” để ghi lại ý chính, mẹo nhớ hoặc ví dụ.'));
        $('note-list').append(empty);
      }
      const desired=rows.find(n=>n.id===(selected?.id||data.selected_note));
      if(!dirty)select(desired||null);
      $('note-archive-banner').hidden=!archived;
      T.notice('Tối đa 100 ghi chú mỗi lần tìm · ghi chú không tự hết hạn.');
    }
    window.NOSNotebook={init(){
      $('tool-content').innerHTML=`<div class="notebook-layout"><section class="panel note-sidebar"><div class="note-sidebar-head"><div class="note-sidebar-title"><span>Danh sách ghi chú</span><span id="note-count" class="note-count-pill">0</span></div><button type="button" id="note-new" class="note-new-btn">+ Ghi chú mới</button></div><div class="note-toolbar"><div class="note-search-wrap"><svg class="note-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg><input id="note-search" type="search" placeholder="Tìm ghi chú không cần dấu…" aria-label="Tìm ghi chú"></div><select id="note-scope" aria-label="Phạm vi ghi chú"><option value="current">Bộ thẻ này</option><option value="trash">Thùng rác của bộ này</option><option value="archived">Bản lưu từ bộ sưu tập khác</option></select></div><div id="note-list" class="note-list" aria-label="Danh sách ghi chú"></div></section><section class="panel note-editor-panel"><div class="note-editor-meta"><span id="note-context" class="note-context-badge"></span><span id="note-dirty-badge" class="note-dirty-badge" hidden>Chưa lưu</span></div><p id="note-archive-banner" class="notice" hidden>Dữ liệu này thuộc bộ sưu tập khác. Chỉ xem bản lưu; không tự gắn ID vào bộ sưu tập hiện tại.</p><label class="note-field note-field-title"><span>Tiêu đề</span><input id="note-title" maxlength="160" placeholder="Đặt tiêu đề ngắn gọn dễ tìm…"></label><label class="note-field note-field-body"><span>Nội dung</span><textarea id="note-body" rows="12" maxlength="20000" placeholder="Ghi lại ý nghĩa, cách phân biệt, câu ví dụ hoặc ngữ cảnh…"></textarea></label><div class="actions note-editor-footer"><button type="button" class="primary" id="note-save" data-wait>Lưu ghi chú</button><button type="button" id="note-source" hidden>Mở note nguồn</button><span></span><button type="button" id="note-trash" class="danger" hidden>Chuyển vào thùng rác</button></div></section></div><div class="actions note-utility-bar"><span>Ghi chú đồng bộ cục bộ theo hồ sơ AnkiNOS</span><button type="button" id="notebook-backup">Sao lưu dữ liệu AnkiNOS…</button></div>`;
      $('note-new').addEventListener('click',()=>{if(archived||trash){$('note-scope').value='current';archived=trash=false;selected=null;setDirty(false);load();}else select(null);$('note-title').focus();});
      for(const id of ['note-title','note-body'])$(id).addEventListener('input',()=>{setDirty(true);});
      $('note-save').addEventListener('click',()=>{if(!$('note-body').value.trim()){T.notice('Nhập nội dung ghi chú trước khi lưu.',true);return;}T.busy(true);setDirty(false);T.send('save',{id:selected?.id,title:$('note-title').value,body:$('note-body').value});});
      $('note-trash').addEventListener('click',()=>{setDirty(false);T.send('trash',{id:selected?.id,restore:trash});selected=null;});
      $('note-source').addEventListener('click',()=>T.send('open_source',{id:selected?.id}));
      $('note-search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(load,160);});
      $('note-scope').addEventListener('change',()=>{if(dirty&&!confirm('Bỏ thay đổi chưa lưu để đổi phạm vi?')){$('note-scope').value=archived?'archived':trash?'trash':'current';return;}setDirty(false);selected=null;archived=$('note-scope').value==='archived';trash=$('note-scope').value==='trash';load();});
      $('notebook-backup').addEventListener('click',()=>T.send('backup'));select(null);
    },receive(event,data){if(event==='notebook')render(data);if(event==='note_focus')select(data);
      if(event==='note_context'){T.initial.note_id=data.note_id;if(!selected&&!archived&&!trash)$('note-context').textContent=data.note_id?'Ghi chú mới sẽ gắn với note '+data.note_id:'Ghi chú của bộ thẻ này';}
    },failed(){setDirty(true);},preview(action,data){
      if(action==='boot'||action==='load')render({notes:[],archived:!!data.archived,trash:!!data.trash});
      else T.notice('Bản xem trước · ghi chú chỉ được lưu trong Anki.');
    }};
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
