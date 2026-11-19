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
  assert.equal(await evaluate(`document.getElementById('note-save').disabled && document.getElementById('note-body').readOnly`),true);
  await receive('notebook',notebook);
  await receive('note_context',{note_id:'456'});await click('#note-new');
  assert((await evaluate(`document.getElementById('note-context').textContent`)).includes('456'));
  await click('.note-item');
  for(const width of [320,390,768,1024]){await size(width);await fit();}
  await size(390);await screenshot('notebook-mobile');

  assert.deepEqual(errors,[]);
  const report={keyboard_palette:true,accent_insensitive_search:true,stale_search_ignored:true,plain_text_rendering:true,contextual_notes:true,trash_restore:true,archived_readonly:true,widths:[320,390,768,1024],horizontal_overflow:false};
  await writeFile(join(root,'previews/tools-ui-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: '+JSON.stringify(report));
  await cdp('Browser.close');
}finally{socket?.close();child.kill();}
