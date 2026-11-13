// Exercise large collections without opening the user's Anki profile.
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'), profile=join(root,'tests','.tmp',`perf-${randomUUID()}`);
await mkdir(profile,{recursive:true});
const child=spawn(process.env.NOS_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
let socket;
try {
  let port;
  for(let i=0;i<100;i++){try{port=Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert(port,'Chrome did not start');
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});
  let sequence=0;const pending=new Map();
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}};
  const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  async function evaluate(expression){const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
  await cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:pathToFileURL(join(root,'ankios-ui.html')).href});
  for(let i=0;i<100;i++){if(await evaluate('!!window.AnkiNOS'))break;await new Promise(r=>setTimeout(r,50));}
  const result=await evaluate(`(async()=>{
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const leaf=(id,name,parent='',children=[])=>({id,name,full_name:parent?parent+'::'+name:name,parent_id:'',total:10,new:1,learn:0,review:0,retention:90,children,filtered:false});
    const decks=Array.from({length:300},(_,i)=>leaf('p'+i,'Course '+i,'',Array.from({length:40},(_,j)=>leaf('c'+i+'-'+j,'Unit '+j,'Course '+i))));
    const payload={today:'2026-11-13',profile:'Performance',due:300,total_cards:120000,days:{},stats:{retention:null,pace:null,milliseconds:0,reviews:0,streak:0,tested:0},decks,settings:{goal:200,resources:[],favorites:[]}};
    let start=performance.now();window.AnkiNOS.receive({event:'snapshot',payload});
    const snapshot=performance.now()-start;
    const original=document.querySelector('#deck-list > .deck-group');
    const spark=document.querySelector('#spark-studied > *');
    start=performance.now();window.AnkiNOS.receive({event:'settings',payload:{...payload.settings,theme:'night'}});
    const settings=performance.now()-start;
    const retained=original===document.querySelector('#deck-list > .deck-group');
    const chartRetained=spark===document.querySelector('#spark-studied > *');
    const opens=[];
    for(let i=0;i<6;i++){
      start=performance.now();document.getElementById('library-toggle').click();await frame();opens.push(performance.now()-start);
      document.getElementById('library-close').click();await frame();
    }
    document.getElementById('library-toggle').click();await frame();
    const sibling=document.querySelector('[data-deck-id="p1"]');
    start=performance.now();document.querySelector('[data-action="expand"][data-id="p0"]').click();await frame();
    const expand=performance.now()-start;
    return {decks:12300,initial_js_ms:Math.round(snapshot),settings_js_ms:Math.round(settings),unchanged_rows_retained:retained,unchanged_chart_retained:chartRetained,first_popup_frame_ms:Math.round(opens[0]),reopen_median_ms:Math.round(opens.slice(1).sort((a,b)=>a-b)[2]),expand_frame_ms:Math.round(expand),sibling_retained:sibling===document.querySelector('[data-deck-id="p1"]'),child_buttons:document.querySelectorAll('#children-p0 .study-button').length};
  })()`);
  assert.equal(result.child_buttons,40);
  if(process.env.NOS_PERF_ASSERT){assert(result.unchanged_rows_retained);assert(result.unchanged_chart_retained);assert(result.sibling_retained);}
  const name=process.env.NOS_PERF_BASELINE?'performance-before.json':'performance-after.json';
  await writeFile(join(root,'previews',name),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {if(socket?.readyState===WebSocket.OPEN){socket.send(JSON.stringify({id:99999,method:'Browser.close'}));await new Promise(r=>setTimeout(r,500));socket.close();}child.kill();}
