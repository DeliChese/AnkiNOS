// No npm dependencies. Run with Node 22+ and a local Chromium browser.
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname,'..');
await mkdir(join(root,'tests','.tmp'), {recursive:true});
const profile = join(root,'tests','.tmp',`nos-browser-${randomUUID()}`);
await mkdir(profile);
const chrome = process.env.NOS_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chromeArgs = ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'];
// Hosted Linux runners have constrained shared memory and no desktop session.
if (process.env.CI) chromeArgs.unshift('--disable-dev-shm-usage','--no-sandbox');
const child = spawn(chrome, chromeArgs, {windowsHide:true,stdio:['ignore','ignore','pipe']});
let browserLog = '';
child.stderr.on('data', data => { browserLog += data.toString(); });
let socket;
try {
  let port;
  for (let tries=0; tries<300; tries++) {
    try { port = Number((await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); break; }
    catch { await new Promise(r => setTimeout(r,100)); }
  }
  assert(port,`Chromium did not start: ${browserLog.slice(-2000)}`);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r,j) => {socket.onopen=r;socket.onerror=j;});
  let seq=0;
  const pending = new Map(), errors=[];
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.id) {const item=pending.get(message.id);pending.delete(message.id);message.error ? item.reject(message.error) : item.resolve(message.result);}
  };
  function cdp(method,params={}) {return new Promise((resolve,reject) => {const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});}
  async function evaluate(expression) {const result=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await cdp('Runtime.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1080,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:pathToFileURL(join(root,'ankios-ui.html')).href});
  for(let i=0;i<100;i++){if(await evaluate(`!!document.getElementById('nos-app') && !!window.AnkiNOS && document.getElementById('connection').textContent.includes('Bản xem trước')`))break;await new Promise(r=>setTimeout(r,100));}
  assert(await evaluate(`document.querySelectorAll('#deck-list > .deck-group').length`) === 4);
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),false);
  // Updating hidden library preferences must not recreate all deck rows.
  await evaluate(`(()=>{window.__nosOldDeck=document.querySelector('#deck-list > .deck-group');
    window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),view:'grid'}});
  })()`);
  assert.equal(await evaluate(`window.__nosOldDeck === document.querySelector('#deck-list > .deck-group')`),true,
    'Do not rebuild hidden library on settings updates');
  await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),view:'list'}})`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.activity-panel')).backdropFilter`),'none',
    'Offscreen glass panels should not trigger expensive blur repaints');
  assert.equal(await evaluate(`document.querySelectorAll('.workspace #library-panel').length`),0,'Library is not duplicated on the home page');
  assert.equal(await evaluate(`document.querySelectorAll('#library-panel').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('[data-action="collapse_library"],[data-value="activity"]').length`),0);
  assert.equal(await evaluate(`document.querySelectorAll('#children-101 .deck-group').length`),0,'Collapsed children should not build hidden DOM');
  assert.equal(await evaluate(`document.querySelectorAll('#deck-list > .deck-group [data-action="delete_deck"]').length`),4);
  assert.equal(await evaluate(`document.getElementById('profile-panel').hidden`),true);
  assert.equal(await evaluate(`document.querySelectorAll('#profile-panel [data-action="preferences"]').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('[data-action="preferences"]').length`),2);
  assert.equal(await evaluate(`document.querySelectorAll('.rail-main [data-action="browse"],.rail-main [data-action="add_cards"],.rail-main [data-action="addons"]').length`),0);
  assert.equal(await evaluate(`document.getElementById('nos-app').clientHeight === innerHeight`),true,'Dashboard must fill the viewport');
  assert(await evaluate(`document.querySelectorAll('#heatmap .heat-cell').length >= 365`),'Heatmap must remain on the dashboard');
  assert(await evaluate(`(()=>{const r=document.querySelector('#heatmap .heat-cell:not(.blank)').getBoundingClientRect();return Math.abs(r.width-r.height)<.1 && r.width===12})()`),
    'Annual heatmap cells must stay square instead of stretching across the dashboard');
  assert(await evaluate(`document.getElementById('activity-panel').getBoundingClientRect().width <= 880`),
    'Dashboard activity panel must remain compact on wide screens');
  assert(await evaluate(`(()=>{const a=document.getElementById('activity-panel').getBoundingClientRect(),b=document.getElementById('study-launchpad').getBoundingClientRect();return a.top<=b.top+1 && b.left>=a.right && b.width<=430})()`),
    'Heatmap leads and the compact study card sits on its right on wide screens');
  assert.equal(await evaluate(`document.getElementById('study-brief').textContent.length>0`),true,'Compact study card keeps a one-line summary');
  assert.equal(await evaluate(`document.querySelectorAll('#launcher [data-action="library"]').length`),0,
    'Deck library must leave the six-dot menu');
  assert.equal(await evaluate(`document.getElementById('heatmap').getAttribute('aria-busy')`),'false');
  assert(await evaluate(`document.getElementById('trend-retention').textContent.includes('%')`));
  assert.equal(await evaluate(`document.getElementById('spark-retention').dataset.direction`),'up');
  assert.equal(await evaluate(`document.getElementById('spark-pace').dataset.direction`),'down');
  assert.equal(await evaluate(`document.querySelector('.workspace > .stats-grid')`),null,'Dashboard home must not show KPI cards');
  assert.equal(await evaluate(`document.querySelectorAll('#launcher [data-action="stats"]').length`),0,'Statistics must leave the function menu');
  await click('#stats-toggle');
  assert.equal(await evaluate(`document.getElementById('stats-page').hidden`),false);
  assert.equal(await evaluate(`document.getElementById('nos-app').dataset.page`),'stats');
  assert(await evaluate(`document.querySelectorAll('#stats-report .stats-native-card').length`) >= 13,
    'All native Anki graph sections must be available inline');
  assert.equal(await evaluate(`document.querySelectorAll('#stats-report .stats-native-card h3').length >= 13`),true);
  assert.equal(await evaluate(`document.getElementById('stats-loading').hidden`),true);
  await evaluate(`window.__nosStatsNode = document.querySelector('#stats-report .stats-native-card')`);
  await evaluate(`document.getElementById('spark-studied').dispatchEvent(new PointerEvent('pointermove',{clientX:document.getElementById('spark-studied').getBoundingClientRect().right,bubbles:true}))`);
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  assert.equal(await evaluate(`document.getElementById('chart-tooltip').hidden`),false);
  assert(await evaluate(`document.getElementById('chart-tooltip').textContent.includes('186')`));
  await evaluate(`document.getElementById('spark-studied').dispatchEvent(new Event('pointerleave'))`);
  await click('.rail-main [data-action="page"][data-value="home"]');
  assert.equal(await evaluate(`document.getElementById('stats-page').hidden`),true);
  const statsSwitchMs = await evaluate(`(()=>{
    const start=performance.now();
    for(let i=0;i<12;i++){
      document.getElementById('stats-toggle').click();
      document.querySelector('.rail-main [data-action="page"][data-value="home"]').click();
    }
    return Math.round(performance.now()-start);
  })()`);
  console.log('Performance: 12 cached Stats round trips:',statsSwitchMs,'ms');
  await click('#stats-toggle');
  assert.equal(await evaluate(`window.__nosStatsNode === document.querySelector('#stats-report .stats-native-card')`),true,
    'Cached Stats should keep the same SVG DOM nodes on reopen');
  await click('.rail-main [data-action="page"][data-value="home"]');
  await mkdir(join(root,'previews'),{recursive:true});
  async function shot(name) {const result=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,'previews',name),Buffer.from(result.data,'base64'));}
  // Exercise the new study actions without letting preview fixtures impersonate Anki.
  assert.equal(await evaluate(`document.getElementById('study-now').disabled`),false);
  assert(await evaluate(`document.getElementById('study-estimate-source').textContent.includes('250')`));
  await evaluate(`window.__studyCommands=[];window.__realStudyCommand=window.AnkiNOS.studioCommand;window.AnkiNOS.studioCommand=(action,args)=>window.__studyCommands.push({action,...args})`);
  await evaluate(`(()=>{const budget=document.getElementById('study-budget');budget.value='15';budget.dispatchEvent(new Event('change'));document.getElementById('study-focus').click();document.getElementById('study-now').click()})()`);
  assert.deepEqual(await evaluate(`window.__studyCommands.filter(x=>x.action==='quick_study')`),
    [{action:'quick_study',id:'101',minutes:15},{action:'quick_study',id:'101'}]);
  await evaluate(`window.NOSStudy.receive({timing:{all:{samples:4,median_ms:null}},decks:{}})`);
  assert(await evaluate(`document.getElementById('study-estimate').textContent.includes('Chưa đủ 20')`));
  assert.equal(await evaluate(`document.getElementById('study-focus').disabled`),false,'Sparse data must not prevent a study session');
  await evaluate(`window.NOSStudy.receive({timing:{all:{samples:30,median_ms:20000,low_ms:10000,high_ms:30000}},decks:{'101':{name:'<img src=x onerror=alert(1)>',samples:30,previous_samples:40,retention:70,previous_retention:90,change_points:-20,repeated_lapses:1}}})`);
  assert.equal(await evaluate(`document.querySelectorAll('#study-insights-list img').length`),0);
  await click('#study-insights-list button');
  assert.deepEqual(await evaluate(`window.__studyCommands.at(-1)`),{action:'insight_browse',id:'101',kind:'retention_drop'});
  await evaluate(`window.AnkiNOS.studioCommand=window.__realStudyCommand;window.NOSStudy.refresh(true);const budget=document.getElementById('study-budget');budget.value='30';budget.dispatchEvent(new Event('change'))`);
  for(const width of [1024,768,600,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.getElementById('nos-app').scrollWidth<=innerWidth`),`Study home must fit ${width}px`);
    await click('#stats-toggle');
    assert(await evaluate(`document.getElementById('stats-page').scrollWidth<=innerWidth`),`Insights must fit ${width}px`);
    await click('.rail-main [data-action="page"][data-value="home"]');
  }
  for(const scale of [85,100,120]){
    await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),ui_scale:${scale}}})`);
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),`Home must fit at ${scale}% scale`);
  }
  await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),ui_scale:100}})`);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1080,deviceScaleFactor:1,mobile:false});
  await shot('dashboard.png');
  await click('#profile-toggle');
  assert.equal(await evaluate(`document.getElementById('profile-panel').hidden`),false);
  await shot('profile.png');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('profile-panel').hidden`),true);
  await click('.rail-bottom [data-action="preferences"]');
  assert.equal(await evaluate(`document.getElementById('settings-dialog').open`),true);
  assert.equal(await evaluate(`document.querySelectorAll('#launcher [data-action="preferences"]').length`),0,'Launcher must not duplicate Settings');
  assert.equal(await evaluate(`document.querySelectorAll('#settings-sidebar [data-settings-tab="images"]').length`),0,
    'Image Studio must be separate from Settings');
  assert.equal(await evaluate(`document.querySelector('[data-image-fit],[data-image-position]') === null`),true,
    'No image crop or alignment controls');
  assert.equal(await evaluate(`document.getElementById('btn-apply-settings').disabled`),true);

  await click('[data-set-theme="night"]');
  assert.equal(await evaluate(`document.getElementById('btn-apply-settings').disabled`),false);
  assert.equal(await evaluate(`document.getElementById('nos-app').dataset.theme`),'dusk','Draft must not repaint the dashboard until Apply');
  await click('#btn-apply-settings');
  assert.equal(await evaluate(`document.getElementById('nos-app').dataset.theme`),'night');
  assert.equal(await evaluate(`document.getElementById('btn-apply-settings').disabled`),true);
  const closePoint=await evaluate(`(()=>{const r=document.getElementById('settings-close').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...closePoint,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...closePoint,button:'left',clickCount:1});
  assert.equal(await evaluate(`document.getElementById('settings-dialog').open`),false);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-dialog')).display`),'none','Closed settings dialog must not remain visible');
  await click('.rail-bottom [data-action="preferences"]');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('settings-dialog').open`),false);
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('settings-dialog')).display`),'none');
  await click('.rail-bottom [data-action="preferences"]');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:4,y:4,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:4,y:4,button:'left',clickCount:1});
  assert.equal(await evaluate(`document.getElementById('settings-dialog').open`),false);
  // Media Studio belongs in the six-dot launcher, not Settings.
  assert.equal(await evaluate(`document.querySelectorAll('#launcher [data-action="studio"]').length`),1);
  await click('#launcher-toggle');
  await click('#studio-launcher');
  assert.equal(await evaluate(`document.getElementById('studio-dialog').open`),true);
  assert.equal(await evaluate(`document.getElementById('studio-gallery').textContent.includes('Chưa có ảnh')`),true);
  assert.equal(await evaluate(`document.querySelectorAll('#studio-targets [data-studio-slot]').length`),4);
  assert.equal(await evaluate(`document.querySelectorAll('#studio-dialog [data-image-fit],#studio-dialog [data-image-position]').length`),0);
  await shot('media-studio-empty.png');
  const photoId='a'.repeat(32), profileId='b'.repeat(20);
  await evaluate(`(()=>{const data=window.AnkiNOS.getSettings();window.AnkiNOS.receive({
    event:'settings',payload:{...data,
    image_albums:[],images:[{id:'${photoId}',name:'Phong cảnh.png',ext:'.png',width:1400,height:900,
    url:'/_addons/NOS/user_files/${profileId}/${photoId}.png',
    wall_url:'/_addons/NOS/user_files/${profileId}/${photoId}-wall.jpg',wall_ready:true,
    thumb_url:'/_addons/NOS/user_files/${profileId}/${photoId}-thumb.png'}]}
  })})()`);
  assert.equal(await evaluate(`document.querySelectorAll('#studio-gallery .nos-studio-tile').length`),1);
  await evaluate(`window.__nosThumb = document.querySelector('#studio-gallery .nos-studio-tile')`);
  await click(`[data-photo-id="${photoId}"]`);
  assert.equal(await evaluate(`window.__nosThumb === document.querySelector('#studio-gallery .nos-studio-tile')`),true,
    'Selecting a photo must keep existing thumbnail DOM and decoded image');
  assert.equal(await evaluate(`document.getElementById('studio-preview-image').hidden`),false,
    'Selecting a picture previews immediately without Apply');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('studio-preview-image')).objectFit`),'cover',
    'Wallpaper preview fills the frame by default');
  await click('[data-studio-slot="image_dashboard"]');
  assert.equal(await evaluate(`window.__nosThumb === document.querySelector('#studio-gallery .nos-studio-tile')`),true,
    'Assigning a wallpaper must not rebuild the entire photo gallery');
  assert.equal(await evaluate(`window.AnkiNOS.getSettings().image_dashboard`),photoId);
  assert.equal(await evaluate(`document.querySelector('.nos-wallpaper-image').hidden`),false);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.nos-wallpaper-image')).objectFit`),'cover',
    'Wallpapers fill the screen by default instead of floating inside letterbox bars');
  assert.equal(await evaluate(`document.querySelector('.nos-wallpaper-image').getAttribute('src').endsWith('-wall.jpg')`),true,
    'Pages must load the screen-sized copy, never the 24-megapixel original');
  await click('[data-studio-fit="contain"]');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.nos-wallpaper-image')).objectFit`),'contain','Fit-to-frame stays available');
  assert.equal(await evaluate(`window.AnkiNOS.getSettings().image_fit_review`),'contain');
  await click('[data-studio-fit="cover"]');
  await evaluate(`(()=>{const r=document.getElementById('studio-dim');r.value='50';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));return new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))})()`);
  assert.equal(await evaluate(`window.AnkiNOS.getSettings().wallpaper_dim`),50);
  assert.equal(await evaluate(`document.getElementById('nos-app').style.getPropertyValue('--wall-dim')`),'0.5');
  assert.equal(await evaluate(`document.getElementById('studio-dim-out').textContent`),'50%');
  await evaluate(`(()=>{const r=document.getElementById('studio-blur');r.value='8';r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));return new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))})()`);
  assert.equal(await evaluate(`document.getElementById('nos-app').style.getPropertyValue('--wall-blur')`),'8px');
  await click('[data-studio-slot="image_dashboard"]');
  assert.equal(await evaluate(`window.AnkiNOS.getSettings().image_dashboard`),null);
  await evaluate(`document.getElementById('studio-image-name').value='Xe 350Z'`);
  await click('#studio-rename');
  assert.equal(await evaluate(`document.querySelector('.nos-studio-tile strong').textContent`),'Xe 350Z');
  await click('#studio-album-new');
  await evaluate(`document.getElementById('studio-album-title').value='Phong cảnh'`);
  await click('#studio-album-confirm');
  assert.equal(await evaluate(`document.getElementById('studio-gallery-title').textContent`),'Phong cảnh');
  const newAlbumId=await evaluate(`window.AnkiNOS.getSettings().image_albums[0].id`);
  await click('[data-studio-album="all"]');
  await click(`[data-photo-id="${photoId}"]`);
  await evaluate(`(()=>{const s=document.getElementById('studio-image-album');s.value='${newAlbumId}';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click(`[data-studio-album="${newAlbumId}"]`);
  assert.equal(await evaluate(`document.querySelectorAll('#studio-gallery .nos-studio-tile').length`),1,
    'Moved photo must appear in chosen album');
  await click('#studio-close');
  assert.equal(await evaluate(`document.getElementById('studio-dialog').open`),false);
  await click('[data-action="collapse_activity"]');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('activity-body')).display`),'none');
  await click('[data-action="collapse_activity"]');
  await click('#library-toggle');
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),true);
  assert.equal(await evaluate(`document.getElementById('nos-app').dataset.page`),'home','Opening the library must not navigate away');
  assert(await evaluate(`document.getElementById('library-dialog').getBoundingClientRect().left > document.getElementById('library-toggle').getBoundingClientRect().right`));
  assert(await evaluate(`getComputedStyle(document.getElementById('library-dialog'),'::before').clipPath.includes('polygon')`));
  await shot('library-popup.png');
  await click('#library-close');
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),false);
  assert.equal(await evaluate(`document.activeElement.id`),'library-toggle');
  await click('#library-toggle');
  await click('[data-action="show_children"][data-id="101"]');
  assert.equal(await evaluate(`document.getElementById('children-101').hidden`),false);
  assert.equal(await evaluate(`document.querySelector('#children-101 .study-button[data-id="111"]').dataset.id`),'111');
  await click('[data-action="view"][data-value="grid"]');
  assert.equal(await evaluate(`document.getElementById('deck-list').classList.contains('grid-view')`),true);
  await shot('library-grid.png');
  await click('[data-action="view"][data-value="list"]');
  await evaluate(`document.getElementById('library-search').value='Tieng Nhat';document.getElementById('library-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  assert.equal(await evaluate(`document.querySelectorAll('#deck-list > .deck-group').length`),1);
  await evaluate(`document.getElementById('library-search').value='does not exist';document.getElementById('library-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  assert.equal(await evaluate(`document.getElementById('empty-state').hidden`),false);
  await click('[data-action="reset_filter"]');
  await click('[data-action="filter"][data-value="resources"]');
  assert.equal(await evaluate(`document.getElementById('deck-section').hidden`),true);
  assert.equal(await evaluate(`document.querySelectorAll('.resource-card').length`),3);
  await click('[data-action="filter"][data-value="all"]');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),false);
  await click('#stats-toggle');
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),false);
  assert.equal(await evaluate(`document.getElementById('stats-page').hidden`),false);
  assert.equal(await evaluate(`document.getElementById('stats-scope').value`),'deck');
  await evaluate(`(()=>{const s=document.getElementById('stats-scope');s.value='collection';s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  assert.equal(await evaluate(`document.getElementById('stats-metric-scope').textContent.includes('toàn bộ bộ sưu tập')`),true);
  await evaluate(`(()=>{const p=document.getElementById('stats-period');p.value='0';p.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  assert.equal(await evaluate(`document.getElementById('stats-metric-scope').textContent.includes('toàn bộ lịch sử')`),true);
  assert(await evaluate(`document.querySelectorAll('#stats-report .stats-native-card').length`) >= 13);
  await shot('statistics.png');
  await click('.rail-main [data-action="page"][data-value="home"]');
  assert.equal(await evaluate(`document.getElementById('stats-page').hidden`),true);
  await click('[data-action="period"][data-value="month"]');
  assert(await evaluate(`document.querySelectorAll('.month-map .heat-cell').length`) >= 28);
  assert(await evaluate(`(()=>{const r=document.querySelector('.month-map .heat-cell:not(.blank)').getBoundingClientRect();return Math.abs(r.width-r.height)<.1})()`),
    'Monthly heatmap cells must also be square');
  await click('[data-action="period"][data-value="week"]');
  assert.equal(await evaluate(`document.querySelectorAll('.week-bar').length`),7);
  await click('[data-action="period"][data-value="year"]');
  await click('.rail-main [data-action="page"][data-value="home"]');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await click('#stats-toggle');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Stats must fit the mobile viewport');
  await click('.rail-main [data-action="page"][data-value="home"]');
  await shot('mobile.png');
  await click('#library-toggle');
  await shot('library-popup-mobile.png');
  assert.equal(await evaluate(`document.getElementById('library-dialog').getBoundingClientRect().right <= innerWidth && document.getElementById('library-dialog').getBoundingClientRect().left >= 0`),true,'Popup must stay on the mobile viewport');
  assert.equal(await evaluate(`document.getElementById('library-dialog').dataset.side`),'bottom');
  await click('[data-action="view"][data-value="grid"]');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#children-101 .study-button[data-id="111"]')).display === 'none'`),false,'Keep the child study button visible in the mobile grid');
  await click('[data-action="view"][data-value="list"]');
  await evaluate(`document.getElementById('refresh-button').focus()`);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.equal(await evaluate(`document.getElementById('library-dialog').contains(document.activeElement)`),true,'Keyboard focus stays inside the popup');
  await click('#library-close');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Page overflows on mobile');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1000,height:750,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`),true,'Page overflows in Anki-sized window');
  await evaluate(`window.AnkiNOS.receive({event:'snapshot',payload:{today:'2026-11-13',profile:'Test',days:{},due:0,total_cards:1,stats:{retention:null,pace:null,milliseconds:0,reviews:0,streak:0,tested:0},decks:[{id:'1',name:'Địa lý <img src=x onerror="window.nosInjected=true">',full_name:'Địa lý',total:1,new:0,learn:0,review:0,retention:null,children:[],filtered:false}],settings:{goal:200,resources:[],favorites:[]}}})`);
  await evaluate(`document.getElementById('library-search').value='dia ly';document.getElementById('library-search').dispatchEvent(new Event('input',{bubbles:true}))`);
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  assert.equal(await evaluate(`document.querySelectorAll('#deck-list > .deck-group').length`),4,
    'New snapshot should not redraw the hidden library before the user opens it');
  await click('#library-toggle');
  assert.equal(await evaluate(`document.querySelectorAll('#deck-list > .deck-group').length`),1,'Search should normalize uppercase Đ');
  assert.equal(await evaluate(`document.querySelectorAll('#deck-list img').length`),0,'Deck names must be rendered as text');
  assert.equal(await evaluate(`!!window.nosInjected`),false);
  assert.equal(await evaluate(`document.getElementById('trend-retention').textContent.includes('%')`),false,'No invented percent without a baseline');
  assert.equal(await evaluate(`document.getElementById('spark-retention').textContent.includes('Chưa có dữ liệu')`),true,'Missing samples must not be mislabeled as zero');
  await click('#library-close');
  await evaluate(`(()=>{const day={reviews:1,milliseconds:1000,tested:1,passed:0};window.AnkiNOS.receive({event:'snapshot',payload:{today:'2026-11-13',profile:'Zero',days:{'2026-11-13':day},due:0,total_cards:0,stats:{retention:0,pace:3600,milliseconds:1000,reviews:1,streak:1,tested:1},trends:{},decks:[],settings:{goal:200}}})})()`);
  assert.equal(await evaluate(`document.getElementById('stat-retention').textContent`),'0%');
  assert.equal(await evaluate(`document.querySelector('#spark-retention .spark-zero-bar') !== null`),true,'Measured zero must have a visible bar');
  await evaluate(`(()=>{const leaf=(id,name,parent,children=[])=>({id,name,full_name:parent?parent+'::'+name:name,total:1,new:1,learn:0,review:0,retention:null,children,filtered:false});const w2=leaf('w2','Words','Course::Unit 2');const w10=leaf('w10','Words','Course::Unit 10');window.AnkiNOS.receive({event:'snapshot',payload:{today:'2026-11-13',profile:'Test',days:{},due:3,total_cards:3,stats:{retention:null,pace:null,milliseconds:0,reviews:0,streak:0,tested:0},decks:[leaf('p','Course','',[leaf('u10','Unit 10','Course',[w10]),leaf('u2','Unit 2','Course',[w2])]),leaf('o','Other','',[leaf('ow','Words','Other')])],settings:{goal:200,resources:[],favorites:[]}}});document.getElementById('library-search').value='';document.getElementById('library-search').dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#library-toggle');
  await click('[data-action="expand"][data-id="p"]');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('#children-p > .deck-group > .deck-row .deck-name')).map(x=>x.textContent)`),['Unit 2','Unit 10']);
  await click('[data-action="expand"][data-id="u2"]');
  assert.equal(await evaluate(`document.querySelectorAll('#children-u2 > [data-deck-id="w2"]').length`),1);
  assert.equal(await evaluate(`document.querySelectorAll('#children-u2 [data-deck-id="ow"]').length`),0);
  await click('#library-close');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,shiftKey:true,bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),true);
  assert.equal(await evaluate(`document.activeElement.id`),'library-search');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});
  assert.equal(await evaluate(`document.getElementById('library-dialog').open`),false,'Clicking backdrop closes the anchored popup');
  await evaluate(`window.AnkiNOS.receive({event:'snapshot',payload:{today:'2026-11-13',profile:'Archive',days:{},history_start_year:2023,history_loaded_years:[2026],due:0,total_cards:0,stats:{retention:null,pace:null,milliseconds:0,reviews:0,streak:0,tested:0},decks:[],settings:{goal:200,resources:[],favorites:[]}}})`);
  await click('[data-action="year"][data-value="-1"]');
  assert.equal(await evaluate(`document.getElementById('heatmap').getAttribute('aria-busy')`),'true');
  await evaluate(`window.AnkiNOS.receive({event:'history_year',payload:{year:2025,days:{'2025-01-10':{reviews:42,milliseconds:420000,tested:42,passed:40}}}})`);
  assert.equal(await evaluate(`document.getElementById('heatmap').getAttribute('aria-busy')`),'false');
  assert.equal(await evaluate(`document.querySelectorAll('#heatmap .heat-cell[data-tooltip*="42 lượt ôn"]').length`),1,'Loaded archive data must color the heatmap');
  // Gregorian calendar references checked with Python calendar.monthrange().
  // Only years since Anki's first release (2006) are selectable.
  const references=[[2006,1,2,28],[2008,1,4,29],[2013,1,4,28],[2024,1,3,29],[2025,1,5,28],[2026,1,6,28],[2026,10,6,30]];
  const selectCalendar = (id,value) => evaluate(`(()=>{const s=document.getElementById(${JSON.stringify(id)});s.value=${JSON.stringify(String(value))};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await evaluate(`window.AnkiNOS.receive({event:'snapshot',payload:{today:'2026-11-13',profile:'Calendar',days:{'2024-02-29':{reviews:7},'2025-12-31':{reviews:3},'2026-01-01':{reviews:5}},history_start_year:2006,history_loaded_years:[2006,2008,2013,2024,2025,2026],due:0,total_cards:0,stats:{retention:null,pace:null,milliseconds:0,reviews:0,streak:0,tested:0},decks:[],settings:{goal:200,heatmap_day:'monday'}}})`);
  assert.equal(await evaluate(`Math.min(...Array.from(document.getElementById('heatmap-year-select').options,o=>Number(o.value)))`),2006);
  await click('[data-action="period"][data-value="month"]');
  for(const firstDay of ['monday','sunday']){
    await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),heatmap_day:${JSON.stringify(firstDay)}}})`);
    for(const [year,month,weekday,count] of references){
      await selectCalendar('heatmap-year-select',year);
      await selectCalendar('heatmap-month-select',month);
      const cells=await evaluate(`Array.from(document.querySelectorAll('.month-map .heat-cell')).map(node=>node.dataset.date||null)`);
      const offset=firstDay==='sunday'?(weekday+1)%7:weekday;
      const expected=Array.from({length:count},(_,i)=>`${year}-${String(month+1).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`);
      assert.deepEqual(cells.slice(offset,offset+count),expected,`Calendar dates/weekday must match ${year}-${month+1} (${firstDay})`);
      assert.equal(cells.filter(Boolean).length,count);
    }
  }
  await selectCalendar('heatmap-year-select',2006);
  await selectCalendar('heatmap-month-select',0);
  assert.equal(await evaluate(`document.querySelector('[data-action="year"][data-value="-1"]').disabled`),true,
    'Month navigation must stop at January 2006');
  await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),heatmap_day:'monday'}})`);
  await selectCalendar('heatmap-year-select',2024);
  await selectCalendar('heatmap-month-select',1);
  assert(await evaluate(`document.getElementById('activity-summary').textContent.startsWith('7 ')`),'Monthly totals must use the selected month');
  await click('[data-action="period"][data-value="year"]');
  assert.equal(await evaluate(`document.querySelectorAll('#heatmap [data-date]').length`),366);
  assert.equal(await evaluate(`document.querySelector('.heat-month[data-month="0"]').style.gridColumnStart`),'2');
  await click('[data-action="heatmap_month"][data-month="1"]');
  assert.equal(await evaluate(`document.querySelectorAll('.month-map .heat-cell[data-date]').length`),29,'Clicking a month in the annual calendar opens that month');
  await selectCalendar('heatmap-year-select',2025);
  await selectCalendar('heatmap-month-select',11);
  await click('[data-action="year"][data-value="1"]');
  assert.deepEqual(await evaluate(`[document.getElementById('heatmap-year-select').value,document.getElementById('heatmap-month-select').value]`),['2026','0'],'Next month must cross into the next year');
  await click('[data-action="year"][data-value="-1"]');
  assert.equal(await evaluate(`document.getElementById('heatmap-month-select').value`),'11');
  await selectCalendar('heatmap-year-select',2026);
  await selectCalendar('heatmap-month-select',0);
  await click('[data-action="period"][data-value="week"]');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.week-day')).map(node=>node.dataset.date)`),
    ['2025-12-29','2025-12-30','2025-12-31','2026-01-01','2026-01-02','2026-01-03','2026-01-04']);
  assert(await evaluate(`document.getElementById('activity-summary').textContent.startsWith('8 ')`),'A week spanning two years must include both years');
  await evaluate(`window.AnkiNOS.receive({event:'snapshot',payload:{today:'2026-11-13',profile:'Calendar archive',days:{'2026-01-01':{reviews:5}},history_start_year:2025,history_loaded_years:[2026],due:0,total_cards:0,stats:{retention:null,pace:null,milliseconds:0,reviews:0,streak:0,tested:0},decks:[],settings:{goal:200,heatmap_day:'monday'}}})`);
  assert.equal(await evaluate(`document.getElementById('heatmap').getAttribute('aria-busy')`),'true',
    'A January week must fetch the previous year when its December days are not loaded');
  await click('[data-action="period"][data-value="year"]');
  assert.equal(await evaluate(`document.getElementById('heatmap').getAttribute('aria-busy')`),'false');
  await evaluate(`window.AnkiNOS.receive({event:'history_year',payload:{year:2025,days:{'2025-12-31':{reviews:3}}}})`);
  assert.equal(await evaluate(`document.querySelector('.month-map,.week-map')`),null,
    'An archive response must not switch away from the currently selected view');
  await click('[data-action="period"][data-value="week"]');
  assert(await evaluate(`document.getElementById('activity-summary').textContent.startsWith('8 ')`));
  await click('[data-action="year"][data-value="1"]');
  assert.equal(await evaluate(`document.querySelector('.week-day').dataset.date`),'2026-01-05');
  await click('[data-action="calendar_today"]');
  await click('[data-action="period"][data-value="year"]');
  assert.equal(await evaluate(`document.querySelector('#heatmap [aria-current="date"]').dataset.date`),'2026-11-13');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await click('[data-action="period"][data-value="month"]');
  assert(await evaluate(`document.querySelector('.activity-controls').getBoundingClientRect().right <= innerWidth`),
    'Month/year controls must fit a narrow viewport');
  assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
  await shot('heatmap-calendar-mobile.png');
  await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:pathToFileURL(join(root,'ankios-overview.html')).href});
  for(let i=0;i<100;i++){if(await evaluate(`document.getElementById('overview-name')?.textContent === 'Chinese Vocabulary in Chunks'`))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(await evaluate(`document.getElementById('overview-new').textContent`),'20');
  assert.equal(await evaluate(`document.getElementById('overview-learn').textContent`),'4');
  assert.equal(await evaluate(`document.getElementById('overview-review').textContent`),'0');
  assert.equal(await evaluate(`document.querySelectorAll('#heatmap,.heatmap,#legacy-overview-heatmap').length`),0);
  assert.equal(await evaluate(`document.getElementById('overview-menu').hidden`),true);
  assert.equal(await evaluate(`document.getElementById('study').disabled`),false);
  await shot('overview.png');
  await click('#overview-menu-toggle');
  assert.equal(await evaluate(`document.getElementById('overview-menu').hidden`),false);
  await shot('overview-menu.png');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(`document.getElementById('overview-menu').hidden`),true);
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await shot('overview-mobile.png');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth && document.getElementById('nos-app').scrollWidth <= innerWidth`),true,'Overview overflows on mobile');
  await evaluate(`window.AnkiNOS.receive({event:'overview_snapshot',payload:{id:'1',name:'<img src=x onerror="window.nosInjected=true">',full_name:'Test',description:'<script>test</script>',filtered:true,new:0,learn:0,review:0,available:0,total:0,children:0,has_buried:false,today_reviews:0,today_milliseconds:0,retention:null,settings:{}}})`);
  assert.equal(await evaluate(`document.getElementById('study').disabled`),true,'Do not invent a study session for an empty queue');
  assert.equal(await evaluate(`document.querySelectorAll('#overview-name img').length`),0);
  assert.equal(await evaluate(`document.getElementById('overview-custom-study').hidden`),true);
  assert.equal(await evaluate(`document.getElementById('overview-rebuild').hidden`),false);
  await cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:pathToFileURL(join(root,'ankios-review.html')).href});
  for(let i=0;i<100;i++){if(await evaluate(`!!window.NOSReview && !!document.getElementById('preview-ratings')`))break;await new Promise(r=>setTimeout(r,100));}
  await new Promise(r=>setTimeout(r,150));
  assert.equal(await evaluate(`document.getElementById('nos-review-side').textContent`),'Mặt trước');
  await shot('review-question.png');
  await evaluate(`document.getElementById('preview-ratings').contentWindow.postMessage({nosPreview:'show-answer'},'*')`);
  for(let i=0;i<50;i++){if(await evaluate(`document.getElementById('nos-review-side').textContent === 'Đáp án'`))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(await evaluate(`document.getElementById('nos-review-side').textContent`),'Đáp án');
  assert.equal(await evaluate(`window.qFade`),0,'No native card fade delay');
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('nos-review-card')).opacity`),'1','Answer must never be hidden by a NOS transition');
  assert.equal(await evaluate(`document.getElementById('nos-review-shell').hasAttribute('data-side-transition')`),false);
  assert.equal(await evaluate(`document.getElementById('nos-review-card').getAnimations().length`),0,'No full-card compositing animation on a flip');
  assert.equal(await evaluate(`(async()=>{
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const nested=document.createElement('div');document.getElementById('qa').append(nested);await frame();
    const original=window.getComputedStyle;let reads=0;
    window.getComputedStyle=(...args)=>{reads++;return original(...args);};
    for(let i=0;i<1000;i++)nested.append(document.createElement('span'));
    await frame();window.getComputedStyle=original;nested.remove();return reads;
  })()`),0,'Nested template mutations must not schedule NOS computed-style reads');
  await shot('review-answer.png');
  await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  await shot('review-mobile.png');
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,'Review overflows on mobile');
  await evaluate(`window.NOSReview.setFocus({active:false,paused:false,seconds:0,target_seconds:1800,cards:0,last_session:{seconds:1800,target_seconds:1800,cards:42,status:'completed'}})`);
  assert.equal(await evaluate(`document.getElementById('nos-focus-summary').hidden`),false);
  assert.equal(await evaluate(`document.getElementById('nos-focus-duration').value`),'30');
  assert(await evaluate(`document.getElementById('nos-focus-summary-text').textContent.includes('42 lượt trả lời')`));
  for(const width of [768,600,390,320]){
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),`Review summary must fit ${width}px`);
    assert(await evaluate(`parseFloat(getComputedStyle(document.getElementById('nos-review-progress')).fontSize)>=12`));
    assert(await evaluate(`getComputedStyle(document.getElementById('nos-review-header')).backgroundColor!=='rgba(0, 0, 0, 0)'`));
  }
  for(const scale of [85,100,120]){
    await evaluate(`document.getElementById('nos-review-shell').style.zoom='${scale/100}'`);
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),`Reviewer must fit at ${scale}% scale`);
  }
  assert.deepEqual(errors,[],'JavaScript errors');
  console.log('PASS: profile, collapse, nested decks, grid, Vietnamese search, filters, chart periods, mobile layout, escaped deck names; screenshots in previews/');
} finally {
  if (socket) {try {socket.send(JSON.stringify({id:99999,method:'Browser.close'}));}catch{}socket.close();}
  child.kill();
}
