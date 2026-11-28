// Exercise tool UI contracts in Chromium. Grading is tested by Python/Anki.
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const profile=join(root,'tests','.tmp',`nos-tools-${randomUUID()}`);
await mkdir(profile,{recursive:true});
const args=['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'];
if(process.env.CI)args.unshift('--disable-dev-shm-usage','--no-sandbox');
const child=spawn(process.env.NOS_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
let log='',socket;child.stderr.on('data',data=>{log+=data;});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  let port;
  for(let i=0;i<300;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await delay(100);}}
  assert(port,log.slice(-2000));
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  const pending=new Map(),errors=[];let seq=0;
  socket.onmessage=({data})=>{const message=JSON.parse(data);
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
    if(message.id){const item=pending.get(message.id);pending.delete(message.id);message.error?item.reject(message.error):item.resolve(message.result);}
  };
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  async function evaluate(expression){const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const receive=(event,payload)=>evaluate(`NOSTool.receive(${JSON.stringify({event,payload})})`);
  async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(50);}throw Error('Timed out: '+expression);}
  async function size(width,height=1000){await cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');}
  async function screenshot(name){await evaluate('scrollTo(0,0)');const shot=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'previews',name+'.png'),Buffer.from(shot.data,'base64'));}
  async function fit(){assert(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'Horizontal overflow at '+await evaluate('innerWidth'));}
  async function open(kind){await size(1100);await cdp('Page.navigate',{url:pathToFileURL(join(root,'ankios-tools.html')).href+'?tool='+kind});await until(`!!window.NOSTool && document.getElementById('tool-content').children.length>0`);await delay(50);}
  async function capture(){await evaluate(`window.sent=[];window.confirm=()=>true;NOSTool.send=(action,data={})=>sent.push({action,...data})`);}
  const sent=()=>evaluate('sent');
  await cdp('Runtime.enable');await cdp('Page.enable');

  await open('palette');
  assert.equal(await evaluate('document.activeElement.id'),'command-query');
  await screenshot('commands');
  await evaluate(`(()=>{const input=document.getElementById('command-query');input.value='ngoai ngu';input.dispatchEvent(new Event('input'));})()`);
  await until(`document.querySelectorAll('.command-result').length===1`);
  assert((await evaluate(`document.getElementById('command-results').textContent`)).includes('Ngoại ngữ'));
  await receive('results',{seq:0,items:[{title:'stale'}]});
  assert(!(await evaluate(`document.getElementById('command-results').textContent`)).includes('stale'));
  await capture();
  await evaluate(`document.getElementById('command-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  assert.deepEqual((await sent())[0],{action:'execute',kind:'deck',id:'1',title:'Ngoại ngữ::Tiếng Anh',detail:'Bộ thẻ'});
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert((await evaluate(`document.getElementById('tool-status').textContent`)).includes('đóng tab'));
  const hostile='<img src=x onerror="window.injected=true">';
  await receive('results',{seq:100,items:[{kind:'note',id:'x',title:hostile,detail:'Ghi chú'}]});
  assert.equal(await evaluate(`!!document.querySelector('#command-results img') || window.injected===true`),false);
  for(const width of [320,390,768]){await size(width);await fit();}

  await open('workspace');await capture();
  const note={id:'note1',title:'Phân biệt nghĩa',body:'Ghi lại chỗ dễ nhầm và lý do chọn đáp án.\nÔn lại bằng cách tự giải thích.',deck_name:'Ngoại ngữ::Tiếng Anh',note_id:'123'};
  const notebook={notes:[note],resources:[{id:'r1',name:'Tài liệu bộ này.pdf',attached:true},{id:'r2',name:'Bài giảng',attached:false}],selected_note:'note1'};
  await receive('notebook',notebook);
  assert.equal(await evaluate(`document.getElementById('note-body').value`),note.body);
  await screenshot('notebook');
  await evaluate(`(()=>{const body=document.getElementById('note-body');body.value+=${JSON.stringify('\n'+hostile)};body.dispatchEvent(new Event('input'));})()`);
  await click('#note-save');
  assert((await sent()).at(-1).body.endsWith(hostile));
  await receive('notebook',notebook);
  assert.equal(await evaluate(`document.getElementById('tool-title').textContent`),'Sổ tay');
  assert.equal(await evaluate(`!!document.querySelector('[id^=resource-]')`),false);
  await click('#note-trash');assert.equal((await sent()).at(-1).restore,false);
  await receive('notebook',{...notebook,trash:true});await click('.note-item');await click('#note-trash');
  assert.equal((await sent()).at(-1).restore,true);
  await receive('notebook',{...notebook,archived:true});
  assert.equal(await evaluate(`document.getElementById('note-save').disabled && document.getElementById('note-body').readOnly && document.getElementById('note-rich-editor').contentEditable === 'false'`),true);
  await receive('notebook',notebook);
  await receive('note_context',{note_id:'456'});await click('#note-new');
  assert((await evaluate(`document.getElementById('note-context').textContent`)).includes('456'));
  await click('.note-item');
  // Test immediate WYSIWYG formatting (no raw ** / ~~ / == markers shown), active toolbar states, interactive checkboxes, source toggle, XSS safety, and corner pocket minimize/restore.
  await click('#note-new');
  await evaluate(`(()=>{
    const ed=document.getElementById('note-rich-editor');
    ed.focus();
    ed.innerHTML='<p>Tu khoa quan trong</p>';
    const tn=ed.firstChild.firstChild;
    const r=document.createRange();r.setStart(tn,0);r.setEnd(tn,tn.nodeValue.length);
    const s=window.getSelection();s.removeAllRanges();s.addRange(r);
  })()`);
  await click('.note-format-bar [data-fmt="bold"]');
  assert.equal(await evaluate(`!!document.querySelector('#note-rich-editor strong, #note-rich-editor b') && !document.getElementById('note-rich-editor').textContent.includes('**')`),true,'Bold must render immediately without showing ** syntax');
  assert.equal(await evaluate(`document.querySelector('.note-format-bar [data-fmt="bold"]').classList.contains('is-active') && document.querySelector('.note-format-bar [data-fmt="bold"]').getAttribute('aria-pressed')==='true'`),true,'Bold toolbar button must reflect active state');
  await click('.note-format-bar [data-fmt="italic"]');
  assert.equal(await evaluate(`!!document.querySelector('#note-rich-editor em, #note-rich-editor i') && document.querySelector('.note-format-bar [data-fmt="italic"]').classList.contains('is-active')`),true,'Italic must render immediately and activate button');
  await click('.note-format-bar [data-fmt="strike"]');
  assert.equal(await evaluate(`!!document.querySelector('#note-rich-editor del, #note-rich-editor s, #note-rich-editor strike') && !document.getElementById('note-rich-editor').textContent.includes('~~')`),true,'Strikethrough must render immediately without showing ~~ syntax');
  await click('.note-format-bar [data-fmt="highlight"]');
  assert.equal(await evaluate(`!!document.querySelector('#note-rich-editor mark') && !document.getElementById('note-rich-editor').textContent.includes('==') && document.querySelector('.note-format-bar [data-fmt="highlight"]').classList.contains('is-active')`),true,'Highlight must render immediately and activate button');
  await click('.note-format-bar [data-fmt="check"]');
  assert.equal(await evaluate(`!!document.querySelector('#note-rich-editor input.rich-check-box') && document.querySelector('.note-format-bar [data-fmt="check"]').classList.contains('is-active')`),true,'Checklist must render an interactive checkbox immediately');
  await evaluate(`(()=>{const cb=document.querySelector('#note-rich-editor input.rich-check-box');cb.checked=true;cb.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert((await evaluate(`document.getElementById('note-body').value`)).includes('- [x]'),'Checking interactive checkbox must sync - [x] to Markdown source');
  await click('#note-source-toggle');
  assert.equal(await evaluate(`!document.getElementById('note-body').hidden && document.getElementById('note-rich-editor').hidden`),true,'Markdown toggle must show raw source editor');
  assert.equal(await evaluate(`document.getElementById('note-body').value.includes('**') && document.getElementById('note-body').value.includes('==')`),true,'Serialized Markdown must retain formatting');
  await click('#note-source-toggle');
  assert.equal(await evaluate(`!document.getElementById('note-rich-editor').hidden && !!document.querySelector('#note-rich-editor mark') && !!document.querySelector('#note-rich-editor input.rich-check-box')`),true,'Switching back to rich mode must keep formatted DOM');
  assert.equal(await evaluate(`!!document.querySelector('#note-rich-editor img') || window.injected===true`),false,'Hostile HTML must never execute inside rich editor');
  await click('#note-pin');
  assert.equal(await evaluate(`document.getElementById('note-pin').getAttribute('aria-pressed')`),'true');
  await click('#note-color-dots [data-note-color="mint"]');
  assert.equal(await evaluate(`document.querySelector('#note-color-dots [data-note-color="mint"]').getAttribute('aria-pressed')`),'true');
  assert.equal(await evaluate(`document.getElementById('note-deck').value`),'', 'New general note should not force a deck');
  await click('#tool-minimize');
  assert.equal(await evaluate(`document.getElementById('nos-tool').classList.contains('is-minimized') && !document.getElementById('tool-mini-dock').hidden`),true,'Minimize button must collapse notebook into corner pocket dock');
  await click('#tool-mini-dock');
  assert.equal(await evaluate(`!document.getElementById('nos-tool').classList.contains('is-minimized') && document.getElementById('tool-mini-dock').hidden`),true,'Clicking corner pocket dock must restore notebook');
  for(const width of [320,390,768,1024]){await size(width);await fit();}
  await size(390);await screenshot('notebook-mobile');

  assert.deepEqual(errors,[]);
  const report={keyboard_palette:true,accent_insensitive_search:true,stale_search_ignored:true,plain_text_rendering:true,contextual_notes:true,trash_restore:true,archived_readonly:true,widths:[320,390,768,1024],horizontal_overflow:false};
  await writeFile(join(root,'previews/tools-ui-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: '+JSON.stringify(report));
  await cdp('Browser.close');
}finally{socket?.close();child.kill();}
