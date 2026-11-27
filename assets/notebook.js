(function initNotebook(){
  'use strict';
  const setup=()=>{
    const T=window.NOSTool;if(!T||T.kind!=='workspace')return;
    const {$,element:el}=T;
    const tr=s=>window.NOSI18n?window.NOSI18n.t(s):s;
    let rows=[],decks=[],selected=null,dirty=false,archived=false,trash=false,scope=T.initial.default_scope||'all',previewing=false,timer;
    const GENERAL_LABEL='Ghi chú chung';
    const currentScope=()=>archived?'archived':trash?'trash':scope;
    const load=()=>T.send('load',{query:$('note-search').value,trash,archived,scope});
    const setDirty=next=>{dirty=next;const badge=$('note-dirty-badge');if(badge)badge.hidden=!dirty;};

    function updateWordCount(){
      const elCount=$('note-word-count');
      if(!elCount)return;
      const text=($('note-body')?.value||'').trim();
      const words=text?text.split(/\s+/).length:0;
      elCount.textContent=`${words} từ · ${($('note-body')?.value||'').length} ký tự`;
    }

    function renderDecks(list){
      if(Array.isArray(list))decks=list;
      const selectEl=$('note-deck');
      if(!selectEl)return;
      const prev=selectEl.value;
      const options=[{id:'',name:'Không gắn bộ thẻ (Ghi chú chung)'},...decks];
      selectEl.replaceChildren(...options.map(d=>{
        const opt=document.createElement('option');
        opt.value=String(d.id);
        opt.textContent=d.name;
        if(d.id!=='')opt.setAttribute('data-i18n-skip','');
        return opt;
      }));
      if(options.some(d=>String(d.id)===prev))selectEl.value=prev;
      const scopeCur=$('note-scope')?.querySelector('option[value="current"]');
      if(scopeCur)scopeCur.hidden=!T.initial.deck_id;
    }

    // Safe inline Markdown formatter (escapes raw HTML first; zero XSS).
    function formatInline(raw){
      const frag=document.createDocumentFragment();
      const pattern=/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
      let last=0,match;
      while((match=pattern.exec(raw))!==null){
        if(match.index>last)frag.append(document.createTextNode(raw.slice(last,match.index)));
        const token=match[0];
        if(token.startsWith('**')){frag.append(el('strong',token.slice(2,-2)));}
        else if(token.startsWith('*')){frag.append(el('em',token.slice(1,-1)));}
        else if(token.startsWith('`')){frag.append(el('code',token.slice(1,-1)));}
        last=match.index+token.length;
      }
      if(last<raw.length)frag.append(document.createTextNode(raw.slice(last)));
      return frag;
    }

    function renderMarkdownPreview(){
      const box=$('note-md-preview');
      if(!box)return;
      const lines=($('note-body')?.value||'').split('\n');
      const frag=document.createDocumentFragment();
      let list=null;
      const flushList=()=>{if(list){frag.append(list);list=null;}};
      lines.forEach((line,lineIdx)=>{
        if(/^\s*---+\s*$/.test(line)){flushList();frag.append(document.createElement('hr'));return;}
        const heading=line.match(/^(#{1,3})\s+(.*)$/);
        if(heading){flushList();const h=el('h'+Math.min(4,heading[1].length+1));h.append(formatInline(heading[2]));frag.append(h);return;}
        const quote=line.match(/^>\s?(.*)$/);
        if(quote){flushList();const q=el('blockquote');q.append(formatInline(quote[1]));frag.append(q);return;}
        const check=line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
        if(check){
          if(!list||!list.classList.contains('md-checklist')){flushList();list=el('ul',undefined,'md-checklist');}
          const li=el('li');
          const cb=document.createElement('input');cb.type='checkbox';cb.checked=check[1].toLowerCase()==='x';
          cb.disabled=archived||trash;
          cb.addEventListener('change',()=>{
            const all=$('note-body').value.split('\n');
            all[lineIdx]=all[lineIdx].replace(/^([-*]\s+\[)[ xX](\])/,`$1${cb.checked?'x':' '}$2`);
            $('note-body').value=all.join('\n');
            setDirty(true);updateWordCount();
          });
          const label=el('label',undefined,'md-check-row');
          const span=el('span');span.append(formatInline(check[2]));
          if(cb.checked)span.classList.add('is-done');
          label.append(cb,span);li.append(label);list.append(li);return;
        }
        const bullet=line.match(/^[-*•]\s+(.*)$/);
        if(bullet){
          if(!list||list.classList.contains('md-checklist')){flushList();list=el('ul');}
          const li=el('li');li.append(formatInline(bullet[1]));list.append(li);return;
        }
        flushList();
        if(line.trim()===''){frag.append(el('div',undefined,'md-gap'));return;}
        const p=el('p');p.append(formatInline(line));frag.append(p);
      });
      flushList();
      if(!frag.childNodes.length){
        box.removeAttribute('data-i18n-skip');
        frag.append(el('p','Chưa có nội dung để xem trước.','muted'));
      }else{
        box.setAttribute('data-i18n-skip','');
      }
      box.replaceChildren(frag);
    }

    function setPreview(next){
      previewing=!!next;
      const body=$('note-body'), box=$('note-md-preview'), btn=$('note-preview-toggle');
      if(!body||!box)return;
      body.hidden=previewing;
      box.hidden=!previewing;
      if(btn){
        btn.setAttribute('aria-pressed',String(previewing));
        btn.classList.toggle('is-active',previewing);
        btn.textContent=previewing?'Soạn thảo':'Xem trước';
      }
      if(previewing)renderMarkdownPreview();
    }

    function applyFormat(cmd){
      const area=$('note-body');
      if(!area||area.readOnly)return;
      if(previewing)setPreview(false);
      const start=area.selectionStart, end=area.selectionEnd, val=area.value;
      const selectedText=val.slice(start,end);
      const insert=(replacement,selStartOffset,selEndOffset)=>{
        area.value=val.slice(0,start)+replacement+val.slice(end);
        area.focus();
        area.setSelectionRange(start+selStartOffset,start+selEndOffset);
        setDirty(true);updateWordCount();
      };
      if(cmd==='bold'){const t=selectedText||tr('chữ đậm');insert(`**${t}**`,2,2+t.length);}
      else if(cmd==='italic'){const t=selectedText||tr('chữ nghiêng');insert(`*${t}*`,1,1+t.length);}
      else if(cmd==='code'){const t=selectedText||tr('thuật ngữ');insert('`'+t+'`',1,1+t.length);}
      else if(cmd==='heading'){
        const prefix=(start>0&&val[start-1]!=='\n')?'\n## ':'## ';
        const t=selectedText||tr('Tiêu đề mục');
        insert(prefix+t,prefix.length,prefix.length+t.length);
      } else if(cmd==='bullet'||cmd==='check'||cmd==='quote'){
        const mark={bullet:'- ',check:'- [ ] ',quote:'> '}[cmd];
        const block=selectedText?selectedText.split('\n').map(l=>mark+l).join('\n'):mark;
        const lead=(start>0&&val[start-1]!=='\n')?'\n':'';
        insert(lead+block,lead.length+block.length,lead.length+block.length);
      } else if(cmd==='hr'){
        const lead=(start>0&&val[start-1]!=='\n')?'\n\n':'\n';
        const rep=lead+'---\n';
        insert(rep,rep.length,rep.length);
      } else if(cmd==='time'){
        const d=new Date(), pad=n=>String(n).padStart(2,'0');
        const stamp=`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        insert(stamp,stamp.length,stamp.length);
      }
    }

    function select(note){
      if(dirty&&!confirm(tr('Bỏ các thay đổi ghi chú chưa lưu?')))return;
      selected=note||null;setDirty(false);setPreview(false);
      $('note-title').value=note?.title||'';$('note-body').value=note?.body||'';
      const defaultDeckId=scope==='current'?(T.initial.deck_id||''):'';
      const noteDeckId=note?String(note.deck_id||''):defaultDeckId;
      if($('note-deck')){
        if(noteDeckId&&!Array.from($('note-deck').options).some(o=>o.value===noteDeckId)){
          const opt=document.createElement('option');opt.value=noteDeckId;opt.textContent=note?.deck_name||T.initial.deck||('Deck '+noteDeckId);
          $('note-deck').append(opt);
        }
        $('note-deck').value=noteDeckId;
        $('note-deck').disabled=archived||trash;
      }
      $('note-save').disabled=archived||trash;$('note-trash').hidden=!note||archived;
      $('note-trash').textContent=trash?'Khôi phục ghi chú':'Chuyển vào thùng rác';
      $('note-source').hidden=!note?.note_id||archived||trash;
      const deckLabel=note?(note.deck_name||GENERAL_LABEL):(noteDeckId?(T.initial.deck||GENERAL_LABEL):GENERAL_LABEL);
      $('note-context').textContent=archived?'Bản lưu từ bộ sưu tập khác · chỉ xem, không tự liên kết note.':
        note?.note_id?'Gắn với note Anki '+note.note_id:
        T.initial.note_id?'Ghi chú mới sẽ gắn với note '+T.initial.note_id:
        noteDeckId?('Bộ thẻ: '+deckLabel):'Ghi chú chung · không bắt buộc gắn bộ thẻ';
      $('note-title').readOnly=$('note-body').readOnly=archived||trash;
      $('note-list').querySelectorAll('button').forEach(button=>button.setAttribute('aria-current',String(button.dataset.id===note?.id)));
      updateWordCount();
    }

    function render(data){
      rows=data.notes||[];archived=!!data.archived;trash=!!data.trash;
      if(data.scope&&['all','general','current'].includes(data.scope))scope=data.scope;
      renderDecks(data.decks);
      $('note-scope').value=currentScope();
      if($('note-count'))$('note-count').textContent=String(rows.length);
      if($('tool-mini-count'))$('tool-mini-count').textContent=`${rows.length} ghi chú · Nhấn để mở`;
      $('note-list').replaceChildren(...rows.map(note=>{
        const button=el('button',undefined,'note-item');button.type='button';button.dataset.id=note.id;
        const deckTag=note.deck_name||GENERAL_LABEL;
        const titleEl=el('strong',note.title||note.body.slice(0,60));
        titleEl.setAttribute('data-i18n-skip','');
        const sub=el('small');
        const tagSpan=el('span',deckTag);
        if(note.deck_name&&note.deck_name!==GENERAL_LABEL)tagSpan.setAttribute('data-i18n-skip','');
        const bodySpan=el('span',' · '+note.body.slice(0,100));
        bodySpan.setAttribute('data-i18n-skip','');
        sub.append(tagSpan,bodySpan);
        button.append(titleEl,sub);
        button.addEventListener('click',()=>select(note));return button;
      }));
      if(!rows.length){
        const empty=el('div',undefined,'note-empty');
        empty.append(el('strong',trash?'Thùng rác đang trống':'Chưa có ghi chú nào'),el('p',trash?'Ghi chú đã xóa sẽ hiện ở đây để bạn khôi phục.':'Nhấn “+ Ghi chú mới” để ghi chú tự do hoặc gắn tùy chọn vào một bộ thẻ.'));
        $('note-list').append(empty);
      }
      const desired=rows.find(n=>n.id===(selected?.id||data.selected_note));
      if(!dirty)select(desired||null);
      $('note-archive-banner').hidden=!archived;
      T.notice('Tối đa 100 ghi chú mỗi lần tìm · ghi chú không tự hết hạn.');
    }

    window.NOSNotebook={init(){
      $('tool-content').innerHTML=`<div class="notebook-layout"><section class="panel note-sidebar"><div class="note-sidebar-head"><div class="note-sidebar-title"><span>Danh sách ghi chú</span><span id="note-count" class="note-count-pill">0</span></div><button type="button" id="note-new" class="note-new-btn">+ Ghi chú mới</button></div><div class="note-toolbar"><div class="note-search-wrap"><svg class="note-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg><input id="note-search" type="search" placeholder="Tìm ghi chú không cần dấu…" aria-label="Tìm ghi chú"></div><select id="note-scope" aria-label="Phạm vi ghi chú"><option value="all">Tất cả ghi chú</option><option value="general">Ghi chú chung (không gắn bộ thẻ)</option><option value="current">Bộ thẻ đang chọn</option><option value="trash">Thùng rác</option><option value="archived">Bản lưu từ bộ sưu tập khác</option></select></div><div id="note-list" class="note-list" aria-label="Danh sách ghi chú"></div></section><section class="panel note-editor-panel"><div class="note-editor-meta"><span id="note-context" class="note-context-badge"></span><div class="note-editor-meta-right"><select id="note-deck" class="note-deck-select" aria-label="Gắn bộ thẻ tùy chọn"><option value="">Không gắn bộ thẻ (Ghi chú chung)</option></select><span id="note-dirty-badge" class="note-dirty-badge" hidden>Chưa lưu</span></div></div><p id="note-archive-banner" class="notice" hidden>Dữ liệu này thuộc bộ sưu tập khác. Chỉ xem bản lưu; không tự gắn ID vào bộ sưu tập hiện tại.</p><label class="note-field note-field-title"><span>Tiêu đề</span><input id="note-title" maxlength="160" placeholder="Đặt tiêu đề ngắn gọn dễ tìm…"></label><div class="note-field note-field-body"><div class="note-body-head"><label for="note-body">Nội dung</label><span id="note-word-count" class="note-word-count">0 từ · 0 ký tự</span></div><div class="note-format-bar" role="toolbar" aria-label="Công cụ chỉnh sửa văn bản mini"><button type="button" data-fmt="bold" title="In đậm (Ctrl+B)"><b>B</b></button><button type="button" data-fmt="italic" title="In nghiêng (Ctrl+I)"><i>I</i></button><button type="button" data-fmt="heading" title="Tiêu đề mục">H</button><button type="button" data-fmt="bullet" title="Gạch đầu dòng">•</button><button type="button" data-fmt="check" title="Danh sách việc làm (Checklist)">☑</button><button type="button" data-fmt="quote" title="Trích dẫn / điểm nhớ">“</button><button type="button" data-fmt="code" title="Mã / thuật ngữ">&lt;/&gt;</button><button type="button" data-fmt="hr" title="Đường ngăn cách">—</button><button type="button" data-fmt="time" title="Chèn ngày giờ hiện tại">🕒</button><span class="note-format-spacer"></span><button type="button" id="note-preview-toggle" class="note-preview-btn" aria-pressed="false" title="Xem trước định dạng">Xem trước</button></div><textarea id="note-body" rows="11" maxlength="20000" placeholder="Ghi lại ý nghĩa, cách phân biệt, checklist hoặc ví dụ… Hỗ trợ **đậm**, *nghiêng*, - [ ] checklist…"></textarea><div id="note-md-preview" class="note-md-preview" hidden></div></div><div class="actions note-editor-footer"><button type="button" class="primary" id="note-save" data-wait>Lưu ghi chú</button><button type="button" id="note-source" hidden>Mở note nguồn</button><span></span><button type="button" id="note-trash" class="danger" hidden>Chuyển vào thùng rác</button></div></section></div><div class="actions note-utility-bar"><span>Ghi chú lưu cục bộ theo hồ sơ · Không bắt buộc gắn bộ thẻ</span><button type="button" id="notebook-backup">Sao lưu dữ liệu AnkiNOS…</button></div>`;
      $('note-new').addEventListener('click',()=>{if(archived||trash){archived=trash=false;scope='all';$('note-scope').value='all';selected=null;setDirty(false);load();}else select(null);$('note-title').focus();});
      for(const id of ['note-title','note-body'])$(id).addEventListener('input',()=>{setDirty(true);updateWordCount();});
      $('note-deck')?.addEventListener('change',()=>{setDirty(true);});
      $('note-preview-toggle')?.addEventListener('click',()=>setPreview(!previewing));
      document.querySelector('.note-format-bar')?.addEventListener('click',event=>{
        const btn=event.target.closest('button[data-fmt]');
        if(btn)applyFormat(btn.dataset.fmt);
      });
      $('note-body').addEventListener('keydown',event=>{
        if((event.ctrlKey||event.metaKey)&&!event.shiftKey&&!event.altKey){
          const key=event.key.toLowerCase();
          if(key==='b'){event.preventDefault();applyFormat('bold');}
          else if(key==='i'){event.preventDefault();applyFormat('italic');}
          else if(key==='s'){event.preventDefault();$('note-save').click();}
        }
      });
      $('note-save').addEventListener('click',()=>{
        if(!$('note-body').value.trim()){T.notice('Nhập nội dung ghi chú trước khi lưu.',true);return;}
        T.busy(true);setDirty(false);
        T.send('save',{id:selected?.id,title:$('note-title').value,body:$('note-body').value,deck_id:$('note-deck')?.value||'',scope});
      });
      $('note-trash').addEventListener('click',()=>{setDirty(false);T.send('trash',{id:selected?.id,restore:trash,scope});selected=null;});
      $('note-source').addEventListener('click',()=>T.send('open_source',{id:selected?.id}));
      $('note-search').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(load,160);});
      $('note-scope').addEventListener('change',()=>{
        if(dirty&&!confirm(tr('Bỏ thay đổi chưa lưu để đổi phạm vi?'))) {$('note-scope').value=currentScope();return;}
        setDirty(false);selected=null;
        const val=$('note-scope').value;
        archived=val==='archived';trash=val==='trash';
        if(!archived&&!trash)scope=val;
        load();
      });
      $('notebook-backup').addEventListener('click',()=>T.send('backup'));
      renderDecks([]);
      select(null);
    },receive(event,data){
      if(event==='notebook')render(data);
      if(event==='note_focus')select(data);
      if(event==='note_context'){
        T.initial.note_id=data.note_id;
        if(data.deck_id!==undefined)T.initial.deck_id=data.deck_id;
        if(data.deck!==undefined){
          T.initial.deck=data.deck;
          if(data.deck)$('tool-context').setAttribute('data-i18n-skip','');
          else $('tool-context').removeAttribute('data-i18n-skip');
          $('tool-context').textContent=data.deck||'Ghi chú tự do · Bộ thẻ tùy chọn';
        }
        if(!selected&&!archived&&!trash){
          $('note-context').textContent=data.note_id?'Ghi chú mới sẽ gắn với note '+data.note_id:'Ghi chú chung · không bắt buộc gắn bộ thẻ';
        }
      }
    },failed(){setDirty(true);},preview(action,data){
      if(action==='boot'||action==='load')render({notes:[],decks:[{id:'101',name:'Ngoại ngữ :: Tiếng Anh'},{id:'102',name:'Lập trình'}],scope:data.scope||'all',archived:!!data.archived,trash:!!data.trash});
      else T.notice('Bản xem trước · ghi chú chỉ được lưu trong Anki.');
    }};
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
