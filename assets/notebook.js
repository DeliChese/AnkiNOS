(function initNotebook(){
  'use strict';
  const setup=()=>{
    const T=window.NOSTool;if(!T||T.kind!=='workspace')return;
    const {$,element:el}=T;
    const tr=s=>window.NOSI18n?window.NOSI18n.t(s):s;
    const COLORS=[
      {id:'',label:'Mặc định'},
      {id:'blue',label:'Xanh dương'},
      {id:'mint',label:'Bạc hà'},
      {id:'amber',label:'Hổ phách'},
      {id:'pink',label:'Hồng'},
      {id:'purple',label:'Tím'}
    ];
    const TEMPLATES={
      compare:'## So sánh dễ nhầm\n- **Khái niệm A**: ...\n- **Khái niệm B**: ...\n\n> Điểm phân biệt cốt lõi: ...\n\n### Ví dụ ngắn\n1. ...\n2. ...',
      summary:'## Tóm tắt trọng tâm\n- Ý chính 1: ==điểm cần nhớ==\n- Ý chính 2: ...\n\n### Câu hỏi tự kiểm tra\n- [ ] Giải thích lại bằng lời của mình\n- [ ] Tạo ví dụ thực tế',
      checklist:'## Kế hoạch ôn tập\n- [ ] Ôn lại nhóm thẻ hay quên\n- [ ] Đọc lại ghi chú & ví dụ\n- [ ] Tự kiểm tra không nhìn đáp án\n\n---\nGhi chú thêm: '
    };
    const PLACEHOLDER_SRC='Nhập ghi chú trực tiếp… Chọn chữ rồi nhấn B, I, Tô sáng, Gạch ngang hoặc Hộp kiểm để định dạng ngay.';
    const GENERAL_LABEL='Ghi chú chung';
    let rows=[],decks=[],selected=null,dirty=false,archived=false,trash=false,scope=T.initial.default_scope||'all';
    let filterColor='',pinnedOnly=false,sortBy='recent',viewMode='rich',draftPinned=false,draftColor='',timer;
    const currentScope=()=>archived?'archived':trash?'trash':scope;
    const isReadOnly=()=>archived||trash;
    const load=()=>T.send('load',{query:$('note-search').value,trash,archived,scope,color:filterColor,pinned_only:pinnedOnly,sort:sortBy});
    const setDirty=next=>{dirty=next;const badge=$('note-dirty-badge');if(badge)badge.hidden=!dirty;};

    function formatUpdated(isoStr){
      if(!isoStr)return '';
      const d=new Date(isoStr);
      if(Number.isNaN(d.getTime()))return '';
      const fmt=window.NOSI18n?window.NOSI18n.dateFormat({day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      return fmt.format(d);
    }

    function stripMarkdown(raw){
      return String(raw||'')
        .replace(/^#{1,6}\s+/gm,'')
        .replace(/^[-*]\s+\[[ xX]\]\s*/gm,'☑ ')
        .replace(/^>\s?/gm,'')
        .replace(/(\*\*|__|~~|==|`)/g,'')
        .replace(/\*([^*\n]+)\*/g,'$1')
        .replace(/\s+/g,' ')
        .trim();
    }

    function updateWordCount(){
      const elCount=$('note-word-count');
      if(!elCount)return;
      const raw=$('note-body')?.value||'';
      const plain=stripMarkdown(raw);
      const words=plain?plain.split(/\s+/).length:0;
      const checks=raw.match(/^[-*]\s+\[[ xX]\]/gm)||[];
      const done=(raw.match(/^[-*]\s+\[[xX]\]/gm)||[]).length;
      const suffix=checks.length?` · ${done}/${checks.length} việc`:'';
      elCount.textContent=`${words} từ · ${raw.length} ký tự${suffix}`;
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

    // Safe inline Markdown -> DOM nodes (escapes all HTML via createTextNode; zero XSS).
    function formatInline(raw, depth=0){
      const frag=document.createDocumentFragment();
      if(depth>5){frag.append(document.createTextNode(raw));return frag;}
      const pattern=/(\*\*\*[^*\n]+\*\*\*|\*\*(?:[^*\n]|\*(?!\*))+\*\*|\*[^*\n]+\*|`[^`\n]+`|==[^=\n]+==|~~[^~\n]+~~)/g;
      let last=0,match;
      while((match=pattern.exec(raw))!==null){
        if(match.index>last)frag.append(document.createTextNode(raw.slice(last,match.index)));
        const token=match[0];
        if(token.startsWith('`')){frag.append(el('code',token.slice(1,-1)));}
        else if(token.startsWith('***')){const s=el('strong'),e=el('em');e.append(formatInline(token.slice(3,-3),depth+1));s.append(e);frag.append(s);}
        else if(token.startsWith('**')){const n=el('strong');n.append(formatInline(token.slice(2,-2),depth+1));frag.append(n);}
        else if(token.startsWith('*')){const n=el('em');n.append(formatInline(token.slice(1,-1),depth+1));frag.append(n);}
        else if(token.startsWith('==')){const n=el('mark');n.append(formatInline(token.slice(2,-2),depth+1));frag.append(n);}
        else if(token.startsWith('~~')){const n=el('del');n.append(formatInline(token.slice(2,-2),depth+1));frag.append(n);}
        last=match.index+token.length;
      }
      if(last<raw.length)frag.append(document.createTextNode(raw.slice(last)));
      return frag;
    }

    function createCheckItem(content, checked=false){
      const li=el('li',undefined,'rich-check-item');
      li.dataset.checked=checked?'true':'false';
      const cb=document.createElement('input');
      cb.type='checkbox';
      cb.className='rich-check-box';
      cb.checked=!!checked;
      cb.disabled=isReadOnly();
      cb.setAttribute('contenteditable','false');
      const span=el('span',undefined,'rich-check-text');
      if(checked)span.classList.add('is-done');
      if(typeof content==='string'){
        if(content)span.append(formatInline(content));
        else span.append(document.createElement('br'));
      }else if(content instanceof Node){
        span.append(content);
      }else{
        span.append(document.createElement('br'));
      }
      li.append(cb,span);
      return li;
    }

    function markdownToRichDOM(raw){
      const frag=document.createDocumentFragment();
      const source=String(raw||'').replace(/\r\n?/g,'\n');
      if(!source.trim()&&!source.includes('\n'))return frag;
      const lines=source.split('\n');
      let list=null,listType='';
      const flushList=()=>{if(list){frag.append(list);list=null;listType='';}};
      lines.forEach(line=>{
        if(/^\s*---+\s*$/.test(line)){flushList();frag.append(document.createElement('hr'));return;}
        const heading=line.match(/^(#{1,3})\s+(.*)$/);
        if(heading){
          flushList();
          const h=el('h'+Math.min(4,heading[1].length+1));
          if(heading[2])h.append(formatInline(heading[2]));else h.append(document.createElement('br'));
          frag.append(h);return;
        }
        const quote=line.match(/^>\s?(.*)$/);
        if(quote){
          flushList();
          const q=el('blockquote');
          if(quote[1])q.append(formatInline(quote[1]));else q.append(document.createElement('br'));
          frag.append(q);return;
        }
        const check=line.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
        if(check){
          if(listType!=='check'){flushList();list=el('ul',undefined,'md-checklist');listType='check';}
          list.append(createCheckItem(check[2],check[1].toLowerCase()==='x'));
          return;
        }
        const ordered=line.match(/^\d+\.\s+(.*)$/);
        if(ordered){
          if(listType!=='ol'){flushList();list=el('ol');listType='ol';}
          const li=el('li');
          if(ordered[1])li.append(formatInline(ordered[1]));else li.append(document.createElement('br'));
          list.append(li);return;
        }
        const bullet=line.match(/^[-*•]\s+(.*)$/);
        if(bullet){
          if(listType!=='ul'){flushList();list=el('ul');listType='ul';}
          const li=el('li');
          if(bullet[1])li.append(formatInline(bullet[1]));else li.append(document.createElement('br'));
          list.append(li);return;
        }
        flushList();
        const p=el('p');
        if(line===''){p.append(document.createElement('br'));}
        else p.append(formatInline(line));
        frag.append(p);
      });
      flushList();
      return frag;
    }

    function serializeInline(node){
      if(node.nodeType===3)return node.nodeValue.replace(/\u200B/g,'');
      if(node.nodeType!==1)return '';
      const tag=node.tagName.toLowerCase();
      if(tag==='input')return '';
      if(tag==='br')return '\n';
      let inner='';
      for(const child of node.childNodes)inner+=serializeInline(child);
      if(!inner)return '';
      if(tag==='strong'||tag==='b')return `**${inner}**`;
      if(tag==='em'||tag==='i')return `*${inner}*`;
      if(tag==='del'||tag==='s'||tag==='strike')return `~~${inner}~~`;
      if(tag==='mark')return `==${inner}==`;
      if(tag==='code')return '`'+inner+'`';
      if(tag==='span'){
        const st=node.style;
        if(st){
          let out=inner;
          if(st.textDecoration&&st.textDecoration.includes('line-through'))out=`~~${out}~~`;
          if(st.fontStyle==='italic')out=`*${out}*`;
          if(st.fontWeight==='bold'||Number(st.fontWeight)>=600)out=`**${out}**`;
          return out;
        }
      }
      return inner;
    }

    function cleanBlockText(node){
      return serializeInline(node).replace(/\n+$/,'');
    }

    function richDOMToMarkdown(editor){
      if(!editor)return '';
      const lines=[];
      const emitBlock=node=>{
        if(node.nodeType===3){
          const txt=node.nodeValue.replace(/\u200B/g,'');
          if(txt)lines.push(txt);
          return;
        }
        if(node.nodeType!==1)return;
        const tag=node.tagName.toLowerCase();
        if(tag==='hr'){lines.push('---');return;}
        if(tag==='br'){lines.push('');return;}
        if(tag==='h1'||tag==='h2'){lines.push('## '+cleanBlockText(node));return;}
        if(tag==='h3'){lines.push('### '+cleanBlockText(node));return;}
        if(tag==='h4'||tag==='h5'||tag==='h6'){lines.push('#### '+cleanBlockText(node));return;}
        if(tag==='blockquote'){
          const text=cleanBlockText(node);
          text.split('\n').forEach(l=>lines.push('> '+l));
          return;
        }
        if(tag==='ul'){
          const isCheck=node.classList.contains('md-checklist');
          Array.from(node.children).forEach(li=>{
            if(isCheck||li.classList.contains('rich-check-item')){
              const cb=li.querySelector('input[type="checkbox"]');
              const span=li.querySelector('.rich-check-text')||li;
              lines.push(`- [${cb?.checked?'x':' '}] ${cleanBlockText(span)}`);
            }else{
              lines.push('- '+cleanBlockText(li));
            }
          });
          return;
        }
        if(tag==='ol'){
          Array.from(node.children).forEach((li,idx)=>{
            lines.push(`${idx+1}. ${cleanBlockText(li)}`);
          });
          return;
        }
        if(node.classList.contains('rich-check-item')){
          const cb=node.querySelector('input[type="checkbox"]');
          const span=node.querySelector('.rich-check-text')||node;
          lines.push(`- [${cb?.checked?'x':' '}] ${cleanBlockText(span)}`);
          return;
        }
        if(tag==='p'||tag==='div'){
          const hasChildBlocks=Array.from(node.children).some(ch=>/^(P|DIV|UL|OL|BLOCKQUOTE|H[1-6]|HR)$/.test(ch.tagName));
          if(hasChildBlocks){
            for(const ch of node.childNodes)emitBlock(ch);
            return;
          }
          lines.push(cleanBlockText(node));
          return;
        }
        lines.push(cleanBlockText(node));
      };
      for(const child of editor.childNodes)emitBlock(child);
      // Trim trailing pure-empty lines caused by browser trailing <br>
      while(lines.length&&lines[lines.length-1]==='')lines.pop();
      return lines.join('\n');
    }

    function renderRichFromTextarea(){
      const editor=$('note-rich-editor');
      const area=$('note-body');
      if(!editor||!area)return;
      editor.replaceChildren(markdownToRichDOM(area.value));
      syncEditorEmpty();
      syncFormatToolbar();
    }

    function syncEditorEmpty(){
      const editor=$('note-rich-editor');
      if(!editor)return;
      const text=(editor.textContent||'').replace(/\u200B/g,'').trim();
      const hasContent=!!text||!!editor.querySelector('hr,input[type="checkbox"]');
      editor.classList.toggle('is-empty',!hasContent);
    }

    function syncFromRich(markDirty=true){
      const editor=$('note-rich-editor');
      const area=$('note-body');
      if(!editor||!area)return;
      const md=richDOMToMarkdown(editor);
      if(area.value!==md)area.value=md;
      syncEditorEmpty();
      if(markDirty)setDirty(true);
      updateWordCount();
    }

    function setViewMode(next){
      const target=next==='source'?'source':'rich';
      if(target===viewMode)return;
      if(viewMode==='rich')syncFromRich(false);
      viewMode=target;
      const editor=$('note-rich-editor'), area=$('note-body'), btn=$('note-source-toggle');
      if(!editor||!area)return;
      const isSource=viewMode==='source';
      editor.hidden=isSource;
      area.hidden=!isSource;
      if(!isSource)renderRichFromTextarea();
      if(btn){
        btn.setAttribute('aria-pressed',String(isSource));
        btn.classList.toggle('is-active',isSource);
      }
      syncFormatToolbar();
      (isSource?area:editor).focus();
    }

    function syncPinAndColor(){
      const pinBtn=$('note-pin');
      if(pinBtn){
        pinBtn.classList.toggle('is-active',!!draftPinned);
        pinBtn.setAttribute('aria-pressed',String(!!draftPinned));
        pinBtn.disabled=isReadOnly();
        pinBtn.title=draftPinned?'Bỏ ghim ghi chú':'Ghim ghi chú lên đầu';
      }
      document.querySelectorAll('#note-color-dots button[data-note-color]').forEach(btn=>{
        const active=btn.dataset.noteColor===draftColor;
        btn.classList.toggle('is-active',active);
        btn.setAttribute('aria-pressed',String(active));
        btn.disabled=isReadOnly();
      });
    }

    function closestInEditor(node, selector){
      const editor=$('note-rich-editor');
      if(!editor||!node)return null;
      let cur=node.nodeType===1?node:node.parentElement;
      while(cur&&cur!==editor){
        if(cur.matches?.(selector))return cur;
        cur=cur.parentElement;
      }
      return null;
    }

    function selectionInEditor(){
      const editor=$('note-rich-editor');
      const sel=window.getSelection();
      if(!editor||!sel||!sel.rangeCount)return null;
      const range=sel.getRangeAt(0);
      if(!editor.contains(range.commonAncestorContainer))return null;
      return {sel,range,editor};
    }

    function ensureEditorSelection(){
      const editor=$('note-rich-editor');
      if(!editor)return null;
      let info=selectionInEditor();
      if(info)return info;
      editor.focus();
      const sel=window.getSelection();
      const range=document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      return {sel,range,editor};
    }

    function placeCaret(node, toStart=false){
      const sel=window.getSelection();
      const range=document.createRange();
      if(node.nodeType===3){
        const pos=toStart?0:node.nodeValue.length;
        range.setStart(node,pos);
        range.setEnd(node,pos);
      }else{
        range.selectNodeContents(node);
        range.collapse(toStart);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }

    function unwrapElement(elem){
      const parent=elem.parentNode;
      if(!parent)return;
      const frag=document.createDocumentFragment();
      const first=elem.firstChild;
      const last=elem.lastChild;
      while(elem.firstChild)frag.append(elem.firstChild);
      parent.replaceChild(frag,elem);
      return {first,last};
    }

    function toggleInlineElement(tagName){
      const info=ensureEditorSelection();
      if(!info)return;
      const {sel,range,editor}=info;
      const existing=closestInEditor(range.startContainer,tagName)||closestInEditor(range.endContainer,tagName);
      if(existing){
        if(range.collapsed){
          // Move caret cleanly outside the inline tag so subsequent typing is normal.
          const after=document.createTextNode('\u200B');
          if(existing.nextSibling)existing.parentNode.insertBefore(after,existing.nextSibling);
          else existing.parentNode.append(after);
          placeCaret(after,false);
        }else{
          // Unwrap the inline formatting and keep text highlighted.
          const selectedStr=range.toString();
          const fullStr=existing.textContent||'';
          if(selectedStr===fullStr||!fullStr.includes(selectedStr)){
            const bounds=unwrapElement(existing);
            if(bounds?.first&&bounds?.last){
              const r=document.createRange();
              r.setStartBefore(bounds.first);
              r.setEndAfter(bounds.last);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }else{
            // Partial unformat inside an existing inline element: split into [before][plain][after].
            const beforeRange=document.createRange();
            beforeRange.setStart(existing,0);
            beforeRange.setEnd(range.startContainer,range.startOffset);
            const afterRange=document.createRange();
            afterRange.setStart(range.endContainer,range.endOffset);
            afterRange.setEnd(existing,existing.childNodes.length);
            const beforeFrag=beforeRange.cloneContents();
            const midFrag=range.cloneContents();
            const afterFrag=afterRange.cloneContents();
            const parent=existing.parentNode;
            const firstMid=midFrag.firstChild;
            const lastMid=midFrag.lastChild;
            const frag=document.createDocumentFragment();
            if(beforeFrag.textContent){const bEl=document.createElement(tagName);bEl.append(beforeFrag);frag.append(bEl);}
            frag.append(midFrag);
            if(afterFrag.textContent){const aEl=document.createElement(tagName);aEl.append(afterFrag);frag.append(aEl);}
            parent.replaceChild(frag,existing);
            if(firstMid&&lastMid){
              const r=document.createRange();
              r.setStartBefore(firstMid);
              r.setEndAfter(lastMid);
              sel.removeAllRanges();
              sel.addRange(r);
            }
          }
        }
        return;
      }
      if(range.collapsed){
        const wrapper=document.createElement(tagName);
        const zwsp=document.createTextNode('\u200B');
        wrapper.append(zwsp);
        if(!editor.firstChild){
          const p=el('p');p.append(wrapper);editor.append(p);
        }else{
          range.insertNode(wrapper);
        }
        placeCaret(zwsp,false);
      }else{
        const wrapper=document.createElement(tagName);
        const contents=range.extractContents();
        // Flatten any nested duplicate tags of the same kind.
        wrapper.append(contents);
        wrapper.querySelectorAll(tagName).forEach(dup=>unwrapElement(dup));
        range.insertNode(wrapper);
        const r=document.createRange();
        r.selectNodeContents(wrapper);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }

    function currentTopBlock(editor, node){
      let cur=node?.nodeType===1?node:node?.parentElement;
      while(cur&&cur.parentElement&&cur.parentElement!==editor)cur=cur.parentElement;
      return cur&&cur!==editor?cur:null;
    }

    function toggleBlockTag(targetTag){
      const info=ensureEditorSelection();
      if(!info)return;
      const {range,editor}=info;
      const existing=closestInEditor(range.startContainer,targetTag==='h2'?'h1,h2,h3,h4':targetTag);
      if(existing){
        const p=el('p');
        while(existing.firstChild)p.append(existing.firstChild);
        if(!p.childNodes.length)p.append(document.createElement('br'));
        existing.parentNode.replaceChild(p,existing);
        placeCaret(p,false);
        return;
      }
      const block=currentTopBlock(editor,range.startContainer);
      const next=el(targetTag);
      if(block&&/^(P|DIV|H[1-6]|BLOCKQUOTE)$/.test(block.tagName)){
        while(block.firstChild)next.append(block.firstChild);
        if(!next.childNodes.length)next.append(document.createElement('br'));
        block.parentNode.replaceChild(next,block);
      }else if(!range.collapsed){
        next.append(range.extractContents());
        range.insertNode(next);
      }else{
        next.append(document.createElement('br'));
        editor.append(next);
      }
      placeCaret(next,false);
    }

    function toggleChecklist(){
      const info=ensureEditorSelection();
      if(!info)return;
      const {range,editor}=info;
      const checkItem=closestInEditor(range.startContainer,'.rich-check-item');
      if(checkItem){
        const span=checkItem.querySelector('.rich-check-text')||checkItem;
        const p=el('p');
        while(span.firstChild)p.append(span.firstChild);
        if(!p.childNodes.length)p.append(document.createElement('br'));
        const ul=checkItem.parentElement;
        if(ul&&ul.tagName==='UL'&&ul.children.length===1){
          ul.parentNode.replaceChild(p,ul);
        }else if(ul){
          ul.parentNode.insertBefore(p,ul.nextSibling);
          checkItem.remove();
        }
        placeCaret(p,false);
        return;
      }
      const ul=el('ul',undefined,'md-checklist');
      const block=currentTopBlock(editor,range.startContainer);
      const isSingleBlock=block&&/^(P|DIV)$/.test(block.tagName)&&block.contains(range.endContainer);
      if(!range.collapsed&&!isSingleBlock){
        const text=range.toString();
        const lines=text.split('\n').filter((l,i,arr)=>l.trim()||arr.length===1);
        range.deleteContents();
        lines.forEach(l=>ul.append(createCheckItem(l,false)));
        if(block&&!block.textContent.trim()){
          block.parentNode.replaceChild(ul,block);
        }else if(block){
          block.parentNode.insertBefore(ul,block.nextSibling);
        }else{
          editor.append(ul);
        }
      }else if(isSingleBlock){
        const frag=document.createDocumentFragment();
        while(block.firstChild)frag.append(block.firstChild);
        ul.append(createCheckItem(frag,false));
        block.parentNode.replaceChild(ul,block);
      }else if(!range.collapsed){
        const frag=range.extractContents();
        ul.append(createCheckItem(frag,false));
        if(block)block.parentNode.insertBefore(ul,block.nextSibling);
        else editor.append(ul);
      }else{
        ul.append(createCheckItem('',false));
        if(block)block.parentNode.insertBefore(ul,block.nextSibling);
        else editor.append(ul);
      }
      const lastText=ul.lastElementChild?.querySelector('.rich-check-text');
      if(lastText)placeCaret(lastText,false);
    }

    function syncFormatToolbar(){
      const bar=document.querySelector('.note-format-bar');
      if(!bar)return;
      const ro=isReadOnly();
      const inRich=viewMode==='rich';
      const info=inRich?selectionInEditor():null;
      const anchor=info?info.range.startContainer:null;
      const queryState=name=>{
        if(!info)return false;
        try{return !!document.queryCommandState(name);}catch{return false;}
      };
      const isCheck=!!closestInEditor(anchor,'.rich-check-item');
      const states={
        bold:inRich&&(queryState('bold')||!!closestInEditor(anchor,'strong,b')),
        italic:inRich&&(queryState('italic')||!!closestInEditor(anchor,'em,i')),
        strike:inRich&&(queryState('strikeThrough')||!!closestInEditor(anchor,'del,s,strike')),
        highlight:inRich&&!!closestInEditor(anchor,'mark'),
        code:inRich&&!!closestInEditor(anchor,'code'),
        heading:inRich&&!!closestInEditor(anchor,'h1,h2,h3,h4'),
        check:inRich&&isCheck,
        bullet:inRich&&!isCheck&&(queryState('insertUnorderedList')||!!closestInEditor(anchor,'ul:not(.md-checklist)')),
        ordered:inRich&&(queryState('insertOrderedList')||!!closestInEditor(anchor,'ol')),
        quote:inRich&&!!closestInEditor(anchor,'blockquote'),
      };
      bar.querySelectorAll('button[data-fmt]').forEach(btn=>{
        btn.disabled=ro;
        const cmd=btn.dataset.fmt;
        if(Object.hasOwn(states,cmd)){
          const active=!!states[cmd];
          btn.classList.toggle('is-active',active);
          btn.setAttribute('aria-pressed',String(active));
        }
      });
    }

    function applySourceFormat(cmd){
      const area=$('note-body');
      if(!area||area.readOnly)return;
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
      else if(cmd==='highlight'){const t=selectedText||tr('điểm nổi bật');insert(`==${t}==`,2,2+t.length);}
      else if(cmd==='strike'){const t=selectedText||tr('gạch ngang');insert(`~~${t}~~`,2,2+t.length);}
      else if(cmd==='code'){const t=selectedText||tr('thuật ngữ');insert('`'+t+'`',1,1+t.length);}
      else if(cmd==='heading'){
        const prefix=(start>0&&val[start-1]!=='\n')?'\n## ':'## ';
        const t=selectedText||tr('Tiêu đề mục');
        insert(prefix+t,prefix.length,prefix.length+t.length);
      }else if(cmd==='bullet'||cmd==='ordered'||cmd==='check'||cmd==='quote'){
        const mark={bullet:'- ',ordered:'1. ',check:'- [ ] ',quote:'> '}[cmd];
        const block=selectedText?selectedText.split('\n').map((l,i)=>(cmd==='ordered'?`${i+1}. `:mark)+l).join('\n'):mark;
        const lead=(start>0&&val[start-1]!=='\n')?'\n':'';
        insert(lead+block,lead.length+block.length,lead.length+block.length);
      }else if(cmd==='hr'){
        const lead=(start>0&&val[start-1]!=='\n')?'\n\n':'\n';
        const rep=lead+'---\n';
        insert(rep,rep.length,rep.length);
      }else if(cmd==='time'){
        const d=new Date(), pad=n=>String(n).padStart(2,'0');
        const stamp=`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        insert(stamp,stamp.length,stamp.length);
      }
    }

    function applyFormat(cmd){
      if(isReadOnly())return;
      if(viewMode==='source'){applySourceFormat(cmd);return;}
      const info=ensureEditorSelection();
      if(!info)return;
      try{document.execCommand('styleWithCSS',false,false);}catch{}
      if(cmd==='bold')document.execCommand('bold',false);
      else if(cmd==='italic')document.execCommand('italic',false);
      else if(cmd==='strike')document.execCommand('strikeThrough',false);
      else if(cmd==='highlight')toggleInlineElement('mark');
      else if(cmd==='code')toggleInlineElement('code');
      else if(cmd==='heading')toggleBlockTag('h2');
      else if(cmd==='quote')toggleBlockTag('blockquote');
      else if(cmd==='check')toggleChecklist();
      else if(cmd==='bullet'||cmd==='ordered'){
        const checkItem=closestInEditor(info.range.startContainer,'.rich-check-item');
        if(checkItem)toggleChecklist();
        document.execCommand(cmd==='bullet'?'insertUnorderedList':'insertOrderedList',false);
      }else if(cmd==='hr'){
        const block=currentTopBlock(info.editor,info.range.startContainer);
        const hr=document.createElement('hr');
        const p=el('p');p.append(document.createElement('br'));
        if(block){block.after(hr,p);}
        else{info.editor.append(hr,p);}
        placeCaret(p,true);
      }else if(cmd==='time'){
        const d=new Date(), pad=n=>String(n).padStart(2,'0');
        const stamp=`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        document.execCommand('insertText',false,stamp);
      }
      syncFromRich(true);
      syncFormatToolbar();
    }

    function exportMarkdown(){
      if(viewMode==='rich')syncFromRich(false);
      const title=($('note-title')?.value||'').trim()||'ghi-chu-ankinos';
      const body=$('note-body')?.value||'';
      if(!body.trim()){T.notice('Chưa có nội dung để xuất tệp Markdown.',true);return;}
      const tags=($('note-tags')?.value||'').trim();
      const header=`# ${title}\n${tags?`> Nhãn: ${tags}\n`:''}\n`;
      const safeName=title.toLowerCase().replace(/[^a-z0-9\u00C0-\u1EF9\u4E00-\u9FFF]+/gi,'-').replace(/^-|-$/g,'').slice(0,48)||'note';
      const blob=new Blob([header+body],{type:'text/markdown;charset=utf-8'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=safeName+'.md';
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      T.notice('Đã xuất tệp Markdown (.md).');
    }

    function copyMarkdown(){
      if(viewMode==='rich')syncFromRich(false);
      const title=($('note-title')?.value||'').trim();
      const body=$('note-body')?.value||'';
      if(!body.trim()){T.notice('Chưa có nội dung để sao chép.',true);return;}
      const text=title?`# ${title}\n\n${body}`:body;
      if(navigator.clipboard?.writeText){
        navigator.clipboard.writeText(text).then(()=>T.notice('Đã sao chép nội dung ghi chú.'),()=>T.notice('Không thể truy cập bộ nhớ tạm.',true));
      }else{
        T.notice('Không thể truy cập bộ nhớ tạm.',true);
      }
    }

    function select(note){
      if(dirty&&!confirm(tr('Bỏ các thay đổi ghi chú chưa lưu?')))return;
      selected=note||null;setDirty(false);
      $('note-title').value=note?.title||'';
      $('note-body').value=note?.body||'';
      if($('note-tags'))$('note-tags').value=note?.tags||'';
      draftPinned=!!note?.pinned;
      draftColor=note?.color||'';
      syncPinAndColor();
      const defaultDeckId=scope==='current'?(T.initial.deck_id||''):'';
      const noteDeckId=note?String(note.deck_id||''):defaultDeckId;
      if($('note-deck')){
        if(noteDeckId&&!Array.from($('note-deck').options).some(o=>o.value===noteDeckId)){
          const opt=document.createElement('option');opt.value=noteDeckId;opt.textContent=note?.deck_name||T.initial.deck||('Deck '+noteDeckId);
          $('note-deck').append(opt);
        }
        $('note-deck').value=noteDeckId;
        $('note-deck').disabled=isReadOnly();
      }
      $('note-save').disabled=isReadOnly();
      $('note-trash').hidden=!note||archived;
      $('note-trash').textContent=trash?'Khôi phục ghi chú':'Chuyển vào thùng rác';
      $('note-source').hidden=!note?.note_id||isReadOnly();
      if($('note-duplicate'))$('note-duplicate').hidden=!note||isReadOnly();
      if($('note-updated')){
        const stamp=formatUpdated(note?.updated_at);
        $('note-updated').textContent=stamp?`Cập nhật: ${stamp}`:'';
      }
      const deckLabel=note?(note.deck_name||GENERAL_LABEL):(noteDeckId?(T.initial.deck||GENERAL_LABEL):GENERAL_LABEL);
      $('note-context').textContent=archived?'Bản lưu từ bộ sưu tập khác · chỉ xem, không tự liên kết note.':
        note?.note_id?'Gắn với note Anki '+note.note_id:
        T.initial.note_id?'Ghi chú mới sẽ gắn với note '+T.initial.note_id:
        noteDeckId?('Bộ thẻ: '+deckLabel):'Ghi chú chung · không bắt buộc gắn bộ thẻ';
      $('note-title').readOnly=$('note-body').readOnly=isReadOnly();
      if($('note-tags'))$('note-tags').readOnly=isReadOnly();
      if($('note-template'))$('note-template').disabled=isReadOnly();
      const editor=$('note-rich-editor');
      if(editor){
        editor.contentEditable=String(!isReadOnly());
        editor.classList.toggle('is-readonly',isReadOnly());
      }
      if(viewMode==='source'){
        viewMode='rich';
        if(editor)editor.hidden=false;
        $('note-body').hidden=true;
        if($('note-source-toggle')){
          $('note-source-toggle').setAttribute('aria-pressed','false');
          $('note-source-toggle').classList.remove('is-active');
        }
      }
      renderRichFromTextarea();
      $('note-list').querySelectorAll('button.note-item').forEach(button=>button.setAttribute('aria-current',String(button.dataset.id===note?.id)));
      updateWordCount();
    }

    function render(data){
      rows=data.notes||[];archived=!!data.archived;trash=!!data.trash;
      if(data.scope&&['all','general','current'].includes(data.scope))scope=data.scope;
      if(typeof data.color==='string')filterColor=data.color;
      if(typeof data.pinned_only==='boolean')pinnedOnly=data.pinned_only;
      if(data.sort==='title'||data.sort==='recent')sortBy=data.sort;
      renderDecks(data.decks);
      $('note-scope').value=currentScope();
      if($('note-sort'))$('note-sort').value=sortBy;
      if($('note-filter-pinned')){
        $('note-filter-pinned').classList.toggle('is-active',pinnedOnly);
        $('note-filter-pinned').setAttribute('aria-pressed',String(pinnedOnly));
      }
      document.querySelectorAll('#note-filter-colors button[data-filter-color]').forEach(btn=>{
        const active=btn.dataset.filterColor===filterColor;
        btn.classList.toggle('is-active',active);
        btn.setAttribute('aria-pressed',String(active));
      });
      if($('note-count'))$('note-count').textContent=String(rows.length);
      if($('tool-mini-count'))$('tool-mini-count').textContent=`${rows.length} ghi chú · Nhấn để mở`;
      $('note-list').replaceChildren(...rows.map(note=>{
        const button=el('button',undefined,'note-item');button.type='button';button.dataset.id=note.id;
        if(note.color)button.dataset.color=note.color;
        if(note.pinned)button.classList.add('is-pinned');
        const head=el('div',undefined,'note-item-head');
        const cleanBody=stripMarkdown(note.body);
        const titleEl=el('strong',note.title||cleanBody.slice(0,60));
        titleEl.setAttribute('data-i18n-skip','');
        head.append(titleEl);
        if(note.pinned){
          const pinMark=el('span','★','note-item-pin');
          pinMark.title=tr('Đã ghim');
          head.append(pinMark);
        }
        const deckTag=note.deck_name||GENERAL_LABEL;
        const sub=el('small');
        const tagSpan=el('span',deckTag);
        if(note.deck_name&&note.deck_name!==GENERAL_LABEL)tagSpan.setAttribute('data-i18n-skip','');
        const bodySpan=el('span',' · '+cleanBody.slice(0,90));
        bodySpan.setAttribute('data-i18n-skip','');
        sub.append(tagSpan,bodySpan);
        button.append(head,sub);
        const tagList=(note.tags||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,3);
        if(tagList.length){
          const chips=el('div',undefined,'note-item-tags');
          chips.setAttribute('data-i18n-skip','');
          tagList.forEach(t=>chips.append(el('span','#'+t,'note-tag-chip')));
          button.append(chips);
        }
        button.addEventListener('click',()=>select(note));return button;
      }));
      if(!rows.length){
        const empty=el('div',undefined,'note-empty');
        empty.append(el('strong',trash?'Thùng rác đang trống':(pinnedOnly||filterColor?'Không có ghi chú khớp bộ lọc':'Chưa có ghi chú nào')),
          el('p',trash?'Ghi chú đã xóa sẽ hiện ở đây để bạn khôi phục.':'Nhấn “+ Ghi chú mới” để ghi chú tự do hoặc gắn tùy chọn vào một bộ thẻ.'));
        $('note-list').append(empty);
      }
      const desired=rows.find(n=>n.id===(selected?.id||data.selected_note));
      if(!dirty)select(desired||null);
      $('note-archive-banner').hidden=!archived;
      T.notice('Tối đa 100 ghi chú mỗi lần tìm · ghi chú không tự hết hạn.');
    }

    function syncPlaceholder(){
      const editor=$('note-rich-editor');
      if(editor)editor.setAttribute('data-placeholder',tr(PLACEHOLDER_SRC));
    }

    window.NOSNotebook={init(){
      const colorFilterBtns=COLORS.map(c=>`<button type="button" class="note-color-chip" data-filter-color="${c.id}" data-swatch="${c.id||'none'}" aria-pressed="${c.id===''?'true':'false'}" title="${c.label}" aria-label="${c.label}"></button>`).join('');
      const colorPickBtns=COLORS.map(c=>`<button type="button" class="note-color-dot" data-note-color="${c.id}" data-swatch="${c.id||'none'}" aria-pressed="${c.id===''?'true':'false'}" title="${c.label}" aria-label="${c.label}"></button>`).join('');
      $('tool-content').innerHTML=`<div class="notebook-layout"><section class="panel note-sidebar"><div class="note-sidebar-head"><div class="note-sidebar-title"><span>Danh sách ghi chú</span><span id="note-count" class="note-count-pill">0</span></div><button type="button" id="note-new" class="note-new-btn">+ Ghi chú mới</button></div><div class="note-toolbar"><div class="note-search-wrap"><svg class="note-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></svg><input id="note-search" type="search" placeholder="Tìm ghi chú, nhãn không cần dấu…" aria-label="Tìm ghi chú"></div><div class="note-filter-row"><select id="note-scope" aria-label="Phạm vi ghi chú"><option value="all">Tất cả ghi chú</option><option value="general">Ghi chú chung (không gắn bộ thẻ)</option><option value="current">Bộ thẻ đang chọn</option><option value="trash">Thùng rác</option><option value="archived">Bản lưu từ bộ sưu tập khác</option></select><select id="note-sort" aria-label="Sắp xếp ghi chú"><option value="recent">Mới nhất</option><option value="title">Tiêu đề A–Z</option></select></div><div class="note-quick-filters"><button type="button" id="note-filter-pinned" class="note-pin-filter" aria-pressed="false" title="Chỉ hiện ghi chú đã ghim">★ Đã ghim</button><div id="note-filter-colors" class="note-color-filter" role="group" aria-label="Lọc theo màu ghi chú">${colorFilterBtns}</div></div></div><div id="note-list" class="note-list" aria-label="Danh sách ghi chú"></div></section><section class="panel note-editor-panel"><div class="note-editor-meta"><span id="note-context" class="note-context-badge"></span><div class="note-editor-meta-right"><button type="button" id="note-pin" class="note-pin-btn" aria-pressed="false" title="Ghim ghi chú lên đầu">★ Ghim</button><div id="note-color-dots" class="note-color-dots" role="group" aria-label="Màu phân loại ghi chú">${colorPickBtns}</div><select id="note-deck" class="note-deck-select" aria-label="Gắn bộ thẻ tùy chọn"><option value="">Không gắn bộ thẻ (Ghi chú chung)</option></select><span id="note-dirty-badge" class="note-dirty-badge" hidden>Chưa lưu</span></div></div><p id="note-archive-banner" class="notice" hidden>Dữ liệu này thuộc bộ sưu tập khác. Chỉ xem bản lưu; không tự gắn ID vào bộ sưu tập hiện tại.</p><div class="note-header-inputs"><label class="note-field note-field-title"><span>Tiêu đề</span><input id="note-title" maxlength="160" placeholder="Đặt tiêu đề ngắn gọn dễ tìm…"></label><label class="note-field note-field-tags"><span>Nhãn (phân cách dấu phẩy)</span><input id="note-tags" maxlength="120" placeholder="ngữ pháp, dễ nhầm, ôn thi…"></label></div><div class="note-field note-field-body"><div class="note-body-head"><label for="note-rich-editor">Nội dung</label><div class="note-body-stats"><span id="note-updated" class="note-updated"></span><span id="note-word-count" class="note-word-count">0 từ · 0 ký tự</span></div></div><div class="note-format-bar" role="toolbar" aria-label="Công cụ chỉnh sửa văn bản mini"><button type="button" data-fmt="bold" aria-pressed="false" title="In đậm (Ctrl+B)"><b>B</b></button><button type="button" data-fmt="italic" aria-pressed="false" title="In nghiêng (Ctrl+I)"><i>I</i></button><button type="button" data-fmt="highlight" aria-pressed="false" title="Tô sáng">HL</button><button type="button" data-fmt="strike" aria-pressed="false" title="Gạch ngang"><s>S</s></button><button type="button" data-fmt="heading" aria-pressed="false" title="Tiêu đề mục">H</button><button type="button" data-fmt="bullet" aria-pressed="false" title="Gạch đầu dòng">•</button><button type="button" data-fmt="ordered" aria-pressed="false" title="Danh sách đánh số">1.</button><button type="button" data-fmt="check" aria-pressed="false" title="Danh sách việc làm (Checklist)">☑</button><button type="button" data-fmt="quote" aria-pressed="false" title="Trích dẫn / điểm nhớ">“</button><button type="button" data-fmt="code" aria-pressed="false" title="Mã / thuật ngữ">&lt;/&gt;</button><button type="button" data-fmt="hr" title="Đường ngăn cách">—</button><button type="button" data-fmt="time" title="Chèn ngày giờ hiện tại">🕒</button><select id="note-template" class="note-template-select" aria-label="Chèn mẫu ghi chú nhanh"><option value="">+ Mẫu nhanh</option><option value="compare">So sánh dễ nhầm</option><option value="summary">Tóm tắt trọng tâm</option><option value="checklist">Kế hoạch ôn tập</option></select><span class="note-format-spacer"></span><button type="button" id="note-source-toggle" class="note-preview-btn" aria-pressed="false" title="Chuyển sang chế độ mã nguồn Markdown">Markdown</button></div><div id="note-body-workspace" class="note-body-workspace"><div id="note-rich-editor" class="note-rich-editor is-empty" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Nội dung" data-i18n-skip></div><textarea id="note-body" class="note-md-source" rows="11" maxlength="20000" hidden placeholder="Mã nguồn Markdown…"></textarea></div></div><div class="actions note-editor-footer"><button type="button" class="primary" id="note-save" data-wait>Lưu ghi chú</button><button type="button" id="note-copy" title="Sao chép Markdown">Sao chép</button><button type="button" id="note-export" title="Xuất tệp Markdown (.md)">Xuất .md</button><button type="button" id="note-duplicate" hidden>Nhân bản</button><button type="button" id="note-source" hidden>Mở note nguồn</button><span></span><button type="button" id="note-trash" class="danger" hidden>Chuyển vào thùng rác</button></div></section></div><div class="actions note-utility-bar"><span>Ghi chú lưu cục bộ theo hồ sơ · Định dạng trực quan, ghim, nhãn và màu sắc</span><button type="button" id="notebook-backup">Sao lưu dữ liệu AnkiNOS…</button></div>`;
      syncPlaceholder();
      $('note-new').addEventListener('click',()=>{if(archived||trash){archived=trash=false;scope='all';$('note-scope').value='all';selected=null;setDirty(false);load();}else select(null);$('note-title').focus();});
      for(const id of ['note-title','note-tags'])$(id)?.addEventListener('input',()=>{setDirty(true);});
      $('note-body')?.addEventListener('input',()=>{
        setDirty(true);updateWordCount();
        if(viewMode==='rich')renderRichFromTextarea();
      });
      const rich=$('note-rich-editor');
      rich.addEventListener('input',()=>{syncFromRich(true);syncFormatToolbar();});
      rich.addEventListener('keyup',syncFormatToolbar);
      rich.addEventListener('mouseup',syncFormatToolbar);
      rich.addEventListener('focus',syncFormatToolbar);
      document.addEventListener('selectionchange',()=>{if(selectionInEditor())syncFormatToolbar();});
      rich.addEventListener('change',event=>{
        const cb=event.target.closest('input.rich-check-box');
        if(!cb)return;
        const item=cb.closest('.rich-check-item');
        if(item){
          item.dataset.checked=cb.checked?'true':'false';
          item.querySelector('.rich-check-text')?.classList.toggle('is-done',cb.checked);
        }
        syncFromRich(true);
      });
      rich.addEventListener('paste',event=>{
        if(isReadOnly())return;
        event.preventDefault();
        const text=event.clipboardData?.getData('text/plain')||'';
        if(!text)return;
        document.execCommand('insertText',false,text);
        syncFromRich(true);
      });
      rich.addEventListener('keydown',event=>{
        if(isReadOnly())return;
        if((event.ctrlKey||event.metaKey)&&!event.altKey){
          const key=event.key.toLowerCase();
          if(!event.shiftKey&&key==='b'){event.preventDefault();applyFormat('bold');return;}
          if(!event.shiftKey&&key==='i'){event.preventDefault();applyFormat('italic');return;}
          if(!event.shiftKey&&key==='e'){event.preventDefault();applyFormat('code');return;}
          if(!event.shiftKey&&key==='s'){event.preventDefault();$('note-save').click();return;}
          if(event.shiftKey&&key==='x'){event.preventDefault();applyFormat('strike');return;}
          if(event.shiftKey&&key==='h'){event.preventDefault();applyFormat('highlight');return;}
        }
        if(event.key==='Enter'&&!event.shiftKey){
          const info=selectionInEditor();
          const checkItem=info&&closestInEditor(info.range.startContainer,'.rich-check-item');
          if(checkItem){
            event.preventDefault();
            const span=checkItem.querySelector('.rich-check-text');
            const currentText=(span?.textContent||'').replace(/\u200B/g,'').trim();
            if(!currentText){
              toggleChecklist();
              syncFromRich(true);syncFormatToolbar();
              return;
            }
            const nextItem=createCheckItem('',false);
            checkItem.after(nextItem);
            const nextSpan=nextItem.querySelector('.rich-check-text');
            if(nextSpan)placeCaret(nextSpan,true);
            syncFromRich(true);syncFormatToolbar();
            return;
          }
        }
        if(event.key==='Backspace'){
          const info=selectionInEditor();
          const checkItem=info&&info.range.collapsed&&closestInEditor(info.range.startContainer,'.rich-check-item');
          if(checkItem){
            const span=checkItem.querySelector('.rich-check-text');
            const atStart=info.range.startOffset===0&&(info.range.startContainer===span||info.range.startContainer===span?.firstChild);
            if(atStart){
              event.preventDefault();
              toggleChecklist();
              syncFromRich(true);syncFormatToolbar();
            }
          }
        }
      });
      $('note-deck')?.addEventListener('change',()=>{setDirty(true);});
      $('note-pin')?.addEventListener('click',()=>{
        if(selected&&!dirty&&!isReadOnly()){
          T.send('pin',{id:selected.id,scope,filter_color:filterColor,pinned_only:pinnedOnly,sort:sortBy});
          return;
        }
        draftPinned=!draftPinned;setDirty(true);syncPinAndColor();
      });
      $('note-color-dots')?.addEventListener('click',event=>{
        const btn=event.target.closest('button[data-note-color]');
        if(!btn||btn.disabled)return;
        draftColor=btn.dataset.noteColor||'';setDirty(true);syncPinAndColor();
      });
      $('note-filter-pinned')?.addEventListener('click',()=>{pinnedOnly=!pinnedOnly;load();});
      $('note-filter-colors')?.addEventListener('click',event=>{
        const btn=event.target.closest('button[data-filter-color]');
        if(!btn)return;
        const next=btn.dataset.filterColor||'';
        filterColor=(filterColor===next)?'':next;
        load();
      });
      $('note-sort')?.addEventListener('change',()=>{sortBy=$('note-sort').value;load();});
      $('note-source-toggle')?.addEventListener('click',()=>setViewMode(viewMode==='source'?'rich':'source'));
      $('note-template')?.addEventListener('change',()=>{
        const key=$('note-template').value;
        if(!key||!TEMPLATES[key]||isReadOnly()){$('note-template').value='';return;}
        const area=$('note-body');
        if(viewMode==='rich')syncFromRich(false);
        const prefix=area.value.trim()?'\n\n':'';
        area.value+=prefix+TEMPLATES[key];
        setDirty(true);updateWordCount();
        if(viewMode==='rich'){
          renderRichFromTextarea();
          rich.focus();
        }else{
          area.focus();
        }
        $('note-template').value='';
      });
      // Prevent toolbar buttons from stealing focus/selection from the rich editor.
      document.querySelector('.note-format-bar')?.addEventListener('mousedown',event=>{
        if(event.target.closest('button[data-fmt]'))event.preventDefault();
      });
      document.querySelector('.note-format-bar')?.addEventListener('click',event=>{
        const btn=event.target.closest('button[data-fmt]');
        if(btn&&!btn.disabled)applyFormat(btn.dataset.fmt);
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
        if(viewMode==='rich')syncFromRich(false);
        if(!$('note-body').value.trim()){T.notice('Nhập nội dung ghi chú trước khi lưu.',true);return;}
        T.busy(true);setDirty(false);
        T.send('save',{id:selected?.id,title:$('note-title').value,body:$('note-body').value,deck_id:$('note-deck')?.value||'',pinned:draftPinned,color:draftColor,tags:$('note-tags')?.value||'',scope,filter_color:filterColor,pinned_only:pinnedOnly,sort:sortBy});
      });
      $('note-copy')?.addEventListener('click',copyMarkdown);
      $('note-export')?.addEventListener('click',exportMarkdown);
      $('note-duplicate')?.addEventListener('click',()=>{if(selected)T.send('duplicate',{id:selected.id,scope,filter_color:filterColor,pinned_only:pinnedOnly,sort:sortBy});});
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
      document.addEventListener('nos:language',syncPlaceholder);
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
      if(action==='boot'||action==='load')render({notes:[],decks:[{id:'101',name:'Ngoại ngữ :: Tiếng Anh'},{id:'102',name:'Lập trình'}],scope:data.scope||'all',archived:!!data.archived,trash:!!data.trash,color:data.color||'',pinned_only:!!data.pinned_only,sort:data.sort||'recent'});
      else T.notice('Bản xem trước · ghi chú chỉ được lưu trong Anki.');
    }};
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})();
