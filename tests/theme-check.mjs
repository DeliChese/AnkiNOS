// No npm dependencies. Run with Node 22+ and a local Chromium browser.
import {spawn} from 'node:child_process';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname,'..');
await mkdir(join(root,'tests','.tmp'), {recursive:true});
const profile = join(root,'tests','.tmp',`nos-themes-${randomUUID()}`);
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

  const shot=async name=>{const data=await cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(root,'previews',name),Buffer.from(data.data,'base64'));};
  async function navigate(file, ready) {
    const [rel, query] = file.split('?');
    await cdp('Page.navigate',{url:pathToFileURL(join(root,rel)).href+(query?'?'+query:'')});
    for(let i=0;i<100;i++){if(await evaluate(ready))return;await new Promise(r=>setTimeout(r,50));}
    assert.fail('Page not ready: '+file);
  }
  const matrix=await evaluate(`(()=>{
    const {palettes,resolve,contrast}=window.NOSTheme, results=[];
    for(const color_theme of Object.keys(palettes))for(const theme of ['dusk','night','oled','light','system'])for(const accent of ['auto','blue','cyan','mint','purple','amber','pink','custom'])for(const custom_accent of (accent==='custom'?['#ffffff','#000000','#ffff00','#102030']:['#83b8ff'])) {
      const t=resolve({color_theme,theme,accent,custom_accent}).tokens;
      for(const role of ['--text','--muted','--blue','--success','--warning','--danger'])if(contrast(t[role],t['--surface'])<4.5)throw Error(color_theme+' '+theme+' '+role+' contrast');
      if(contrast(t['--blue'],t['--accent-soft'])<4.5)throw Error('Selected control contrast');
      if(contrast(t['--primary'],t['--on-primary'])<4.5)throw Error('CTA contrast');
      results.push({color_theme,theme,accent});
    }
    return results.length;
  })()`);
  assert.equal(matrix,880);
  const original=await evaluate(`window.AnkiNOS.getSettings()`);
  await click('.rail-bottom [data-action="preferences"]');
  assert.equal(await evaluate(`document.querySelectorAll('[data-set-palette]').length`),16);
  assert.equal(await evaluate(`document.querySelectorAll('[data-set-font]').length`),8);
  await click('[data-set-font="serif"]');
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  assert.equal(await evaluate(`document.getElementById('theme-preview').style.getPropertyValue('--nos-font').includes('Georgia')`),true);
  await click('[data-set-font="system"]');
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await click('[data-set-palette="mononoke"]');
  await click('[data-set-theme="light"]');
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  assert.equal(await evaluate(`document.getElementById('theme-preview').dataset.colorTheme`),'mononoke');
  assert.equal(await evaluate(`document.getElementById('theme-preview').dataset.theme`),'light');
  assert.equal(await evaluate(`window.AnkiNOS.getSettings().color_theme`),original.color_theme);
  await shot('themes-settings.png');
  await click('#settings-close');
  await click('.rail-bottom [data-action="preferences"]');
  assert.equal(await evaluate(`document.querySelector('[data-set-palette="nos"]').getAttribute('aria-pressed')`),'true');
  await click('[data-set-palette="rosepine"]');
  await click('[data-set-theme="light"]');
  await evaluate(`(()=>{const input=document.getElementById('set-custom-accent');input.value='#000000';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#btn-apply-settings');
  assert.equal(await evaluate(`window.AnkiNOS.getSettings().custom_accent`),'#000000');
  assert.equal(await evaluate(`document.getElementById('nos-app').dataset.colorTheme`),'rosepine');
  await click('#settings-close');
  for(const color_theme of ['nos','tokyo','mononoke','catppuccin','rosepine','nord','solarized','dracula','gruvbox','everforest','kanagawa','sakura'])for(const theme of ['light','night','oled']) {
    await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),color_theme:${JSON.stringify(color_theme)},theme:${JSON.stringify(theme)},accent:'auto'}})`);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true);
    assert.equal(await evaluate(`document.querySelector('.study-launchpad').style.background`),'');
    if((color_theme==='rosepine'&&theme==='light')||(color_theme==='mononoke'&&theme==='night'))await shot('theme-'+color_theme+'-'+theme+'.png');
  }
  await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{...window.AnkiNOS.getSettings(),theme:'system',color_theme:'nord',accent:'auto'}})`);
  for(const value of ['dark','light']) {
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value}]});
    for(let i=0;i<30;i++){if(await evaluate(`document.getElementById('nos-app').dataset.colorMode===${JSON.stringify(value)}`))break;await new Promise(r=>setTimeout(r,30));}
    assert.equal(await evaluate(`document.getElementById('nos-app').dataset.colorMode`),value);
    assert.equal(await evaluate(`window.AnkiNOS.getSettings().theme`),'system');
  }
  await click('#stats-toggle');
  await shot('theme-stats-light.png');
  await cdp('Emulation.setEmulatedMedia',{media:'print'});
  assert.equal(await evaluate(`getComputedStyle(document.getElementById('nos-app')).getPropertyValue('--surface').trim()`),'#ffffff');
  await cdp('Emulation.setEmulatedMedia',{media:'screen',features:[{name:'prefers-color-scheme',value:'light'}]});
  await click('.rail-main [data-action="page"][data-value="home"]');
  // Verify launcher ("Chức năng") menu buttons/icons follow the active light palette instead of hardcoded blue/dark colors.
  await click('#launcher-toggle');
  const launcherColors = await evaluate(`({
    panelBg: getComputedStyle(document.getElementById('launcher')).backgroundColor,
    iconColor: getComputedStyle(document.querySelector('#launcher .launcher-grid .icon')).color,
    expectedBlue: getComputedStyle(document.getElementById('nos-app')).getPropertyValue('--blue').trim(),
  })`);
  assert.notEqual(launcherColors.iconColor, 'rgb(202, 224, 255)', 'Launcher icons must follow theme --blue, not hardcoded #cae0ff');
  await click('#launcher-toggle');
  await click('#library-toggle');
  await shot('theme-library-light.png');
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await evaluate(`window.NOSStudio.open()`);
  await shot('theme-studio-light.png');
  await evaluate(`window.NOSStudio.close()`);
  for(const width of [320,390,768]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});
    await click('.rail-bottom [data-action="preferences"]');
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.getElementById('settings-content').scrollWidth<=document.getElementById('settings-content').clientWidth`),'Theme picker fits '+width+'px');
    if(width===390)await shot('themes-settings-mobile.png');
    await click('#settings-close');
  }
  await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await navigate('ankios-overview.html',`!!window.AnkiNOS && !!document.getElementById('overview-name')?.textContent`);
  await evaluate(`window.AnkiNOS.receive({event:'settings',payload:{theme:'light',color_theme:'rosepine',accent:'auto'}})`);
  await shot('theme-overview-light.png');
  await navigate('ankios-review.html',`!!window.NOSReview`);
  const cardBefore=await evaluate(`({fg:getComputedStyle(document.getElementById('qa')).color,bg:getComputedStyle(document.getElementById('nos-review-card')).backgroundColor})`);
  await evaluate(`window.NOSTheme.apply(document.getElementById('nos-review-shell'),{theme:'light',color_theme:'rosepine',accent:'auto'},true)`);
  const cardAfter=await evaluate(`({fg:getComputedStyle(document.getElementById('qa')).color,bg:getComputedStyle(document.getElementById('nos-review-card')).backgroundColor})`);
  assert.deepEqual(cardAfter,cardBefore,'Card styles survive the theme change');
  await evaluate(`window.NOSTheme.apply(document.getElementById('nos-review-shell'),{theme:'night',color_theme:'matcha',accent:'auto',text_color:'custom',custom_text_color:'#ff2288'},true)`);
  const customTextCheck=await evaluate(`({
    headerFg: getComputedStyle(document.getElementById('nos-review-header')).color,
    qaFg: getComputedStyle(document.getElementById('qa')).color,
    qaTextVar: getComputedStyle(document.getElementById('qa')).getPropertyValue('--text').trim(),
  })`);
  assert.equal(customTextCheck.headerFg, 'rgb(255, 34, 136)', 'Custom UI text color applies to Reviewer header');
  assert.equal(customTextCheck.qaFg, cardBefore.fg, 'Custom UI text color must NEVER alter #qa flashcard text color');
  assert.equal(customTextCheck.qaTextVar, '', 'AnkiNOS --text variable must not leak into #qa');
  await evaluate(`window.NOSTheme.apply(document.getElementById('nos-review-shell'),{theme:'light',color_theme:'rosepine',accent:'auto'},true)`);
  await shot('theme-review-light.png');
  for (const [lang, expected] of [
    ['en', {back: 'Decks', side: 'Front', focus: 'Focus', note: 'Notes', opt: '25 min', progress: '8 reviews in this session'}],
    ['zh-cn', {back: '牌组', side: '正面', focus: '专注', note: '笔记', opt: '25 分钟', progress: '本次会话已复习 8 次'}],
  ]) {
    await navigate('ankios-review.html?lang='+lang, `!!window.NOSReview && document.documentElement.lang===${JSON.stringify(lang)}`);
    const revI18n = await evaluate(`({
      back: document.querySelector('#nos-review-header .nos-back-label')?.textContent?.trim(),
      side: document.getElementById('nos-review-side')?.textContent?.trim(),
      focus: document.getElementById('nos-focus-start')?.textContent?.trim(),
      note: document.querySelector('[data-nos-review="notebook"]')?.textContent?.trim(),
      opt: document.querySelector('#nos-focus-duration option[value="25"]')?.textContent?.trim(),
      progress: document.getElementById('nos-review-progress')?.textContent?.trim(),
      qa: document.getElementById('qa')?.textContent?.trim(),
    })`);
    assert.equal(revI18n.back, expected.back, `Reviewer back button (${lang})`);
    assert.equal(revI18n.side, expected.side, `Reviewer side pill (${lang})`);
    assert.equal(revI18n.focus, expected.focus, `Reviewer focus button (${lang})`);
    assert.equal(revI18n.note, expected.note, `Reviewer note button (${lang})`);
    assert.equal(revI18n.opt, expected.opt, `Reviewer focus option (${lang})`);
    assert.equal(revI18n.progress, expected.progress, `Reviewer progress (${lang})`);
    assert.ok(revI18n.qa.includes('Cụm từ này có nghĩa là gì?'), `#qa content must stay untouched (${lang})`);
  }
  await navigate('assets/reviewer-controls-preview.html',`document.documentElement.dataset.nosRatings==='true'`);
  await evaluate(`window.NOSTheme.apply(document.documentElement,{theme:'light',color_theme:'rosepine',accent:'auto'},true);showPreviewAnswer()`);
  assert.equal(await evaluate(`document.querySelectorAll('button[data-ease]').length`),4);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('button[data-ease]')).every(b => !!b.querySelector('.nos-btn-fill') && b.getBoundingClientRect().height <= 54)`), true, 'Rating buttons must stay compact and have radial fill element');
  assert.equal(await evaluate(`['--on-danger','--on-warning','--on-blue','--on-success'].every(v => !!getComputedStyle(document.documentElement).getPropertyValue(v).trim())`), true, 'Rating hover contrast tokens must be defined');
  await shot('theme-ratings-light.png');
  for (const [lang, expected] of [
    ['en', {edit: 'Edit', ans: 'Show Answer', more: 'More ⋯', ease: ['Again', 'Hard', 'Good', 'Easy'], due: ['<1m', '6m', '10m', '4d']}],
    ['zh-cn', {edit: '编辑', ans: '显示答案', more: '更多 ⋯', ease: ['重来', '困难', '良好', '简单'], due: ['<1 分钟', '6 分钟', '10 分钟', '4 天']}],
  ]) {
    await navigate('assets/reviewer-controls-preview.html?lang='+lang, `document.documentElement.dataset.nosRatings==='true' && document.documentElement.lang===${JSON.stringify(lang)}`);
    const qState = await evaluate(`({
      edit: document.querySelector('td.stat:first-child > button')?.textContent?.trim(),
      ans: Array.from(document.getElementById('ansbut').childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join(''),
      more: document.querySelector('td.stat:last-child > button')?.textContent?.trim(),
    })`);
    assert.equal(qState.edit, expected.edit, `Bottom edit (${lang})`);
    assert.equal(qState.ans, expected.ans, `Bottom show answer (${lang})`);
    assert.equal(qState.more, expected.more, `Bottom more (${lang})`);
    await evaluate(`showPreviewAnswer()`);
    const aState = await evaluate(`({
      ease: Array.from(document.querySelectorAll('button[data-ease]')).map(b=>Array.from(b.childNodes).filter(n=>n.nodeType===3).map(n=>n.nodeValue.trim()).join('')),
      due: Array.from(document.querySelectorAll('button[data-ease] .nobold')).map(s=>s.textContent.trim()),
    })`);
    assert.deepEqual(aState.ease, expected.ease, `Bottom ease labels (${lang})`);
    assert.deepEqual(aState.due, expected.due, `Bottom due intervals (${lang})`);
  }
  await navigate('ankios-tools.html',`!!window.NOSTool`);
  await evaluate(`window.NOSTheme.apply(document.getElementById('nos-tool'),{theme:'light',color_theme:'rosepine',accent:'auto'},true)`);
  await shot('theme-notebook-light.png');
  assert.deepEqual(errors,[],'No JavaScript errors');
  console.log('PASS: '+matrix+' contrast combinations, draft/apply/cancel, eight palettes, system changes, mobile picker, overview, reviewer card isolation, native ratings and notebook');
} finally {
  if(socket){try{socket.send(JSON.stringify({id:99999,method:'Browser.close'}));}catch{}socket.close();}
  child.kill();
}
