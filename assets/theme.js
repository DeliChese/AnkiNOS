/* AnkiNOS palettes. Inspired by Onigiri's semantic light/dark theme model.
 * Independent implementation; see THEME-NOTES.md for references. Local/offline. */
(function () {
  'use strict';
  if (window.NOSTheme) return;
  // Each variant: canvas, surface, text, secondary text, suggested accent.
  const palettes = {
    nos: {name:'NOS Glass', note:'Kính dịu, giữ bản sắc AnkiNOS',
      dark:['#24334d','#304360','#f3f6ff','#c4d0e4','#83b8ff'],
      light:['#edf2fa','#ffffff','#24334b','#53627a','#3568bb']},
    tokyo: {name:'Tokyo', note:'Xanh chàm · thành phố về đêm',
      dark:['#191d32','#252b46','#dce4ff','#aebcdd','#8cafff'],
      light:['#edf1fc','#fafbff','#303b60','#596888','#4165c4']},
    mononoke: {name:'Mononoke', note:'Xanh rừng · yên tĩnh',
      dark:['#1b241e','#29382e','#e7efe5','#b3c4b1','#a0c594'],
      light:['#eef3e9','#fbfdf8','#34422f','#5b6d54','#507343']},
    catppuccin: {name:'Catppuccin', note:'Mocha / Latte · tím pastel',
      dark:['#1e1e2e','#303044','#cdd6f4','#bac2de','#b4befe'],
      light:['#eff1f5','#ffffff','#4c4f69','#5c5f77','#7287fd']},
    rosepine: {name:'Rosé Pine', note:'Hồng gỗ · ấm và mềm',
      dark:['#191724','#262338','#e0def4','#b7b3d1','#ebbcba'],
      light:['#faf4ed','#fffaf4','#575279','#6d668a','#b4637a']},
    nord: {name:'Nord', note:'Xanh băng · rõ ràng',
      dark:['#2e3440','#3b4252','#eceff4','#d0d7e3','#88c0d0'],
      light:['#eceff4','#ffffff','#2e3440','#526078','#39788a']},
    solarized: {name:'Solarized', note:'Vàng giấy · cân bằng',
      dark:['#002b36','#073642','#eee8d5','#a6b9b8','#2aa198'],
      light:['#fdf6e3','#fffbef','#394f55','#586e75','#087e79']},
    dracula: {name:'Dracula', note:'Tím đêm · điểm nhấn nổi bật',
      dark:['#282a36','#353746','#f8f8f2','#c5c6d7','#bd93f9'],
      light:['#f2eefb','#fffcff','#39334c','#665b7b','#8250bf']}
  };
  const accents = {blue:'#83b8ff',cyan:'#38bdf8',mint:'#34d399',purple:'#c084fc',amber:'#fbbf24',pink:'#f472b6'};
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  const watchers = new Map();
  const rgb = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  function mix(a,b,weight) {
    return '#' + rgb(a).map((v,i) => Math.round(v*(1-weight)+rgb(b)[i]*weight).toString(16).padStart(2,'0')).join('');
  }
  function luminance(hex) {
    return rgb(hex).map(v => {v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;})
      .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  }
  function contrast(a,b) {const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
  function readable(bg) {return contrast('#ffffff',bg)>contrast('#000000',bg)?'#ffffff':'#000000';}
  function visible(color,bg,minimum=4.5) {
    const target=readable(bg);
    for(let step=0;step<=100;step++) {const next=mix(color,target,step/100);if(contrast(next,bg)>=minimum)return next;}
    return target;
  }
  function resolve(settings={}) {
    const mode=['dusk','night','oled','light','system'].includes(settings.theme)?settings.theme:'dusk';
    const light=mode==='light'||(mode==='system'&&!system.matches);
    const id=Object.hasOwn(palettes,settings.color_theme)?settings.color_theme:'nos';
    const palette=palettes[id], variant=light?'light':'dark';
    let [bg,surface,fg,muted,accent]=palette[variant];
    if(mode==='dusk') {
      if(id==='nos') {bg='#384c6b';surface='#405675';}
      else {bg=mix(bg,fg,.075);surface=mix(surface,fg,.07);}
    }
    if(mode==='oled') {bg='#000000';surface=mix('#000000',surface,.24);}
    if(settings.accent==='custom'&&/^#[0-9a-f]{6}$/i.test(settings.custom_accent||''))accent=settings.custom_accent.toLowerCase();
    else if(Object.hasOwn(accents,settings.accent||'blue'))accent=accents[settings.accent||'blue'];
    const edge=mix(surface,fg,light?.24:.25), soft=mix(surface,accent,light?.12:.16);
    const link=visible(visible(accent,surface),soft), primary=visible(accent,surface,3);
    const success=visible(light?'#25754c':'#a2dfb0',surface);
    const warning=visible(light?'#895c13':'#f1cc87',surface);
    const danger=visible(light?'#b63e55':'#f2a2b0',surface);
    const tokens={
      '--theme-bg':bg,'--surface':surface,'--text':fg,'--muted':visible(muted,surface),
      '--faint':visible(muted,surface),'--edge':edge,'--inner':mix(surface,fg,.055),'--hover':soft,
      '--glass':surface+(light?'f2':'e8'),'--blue':link,'--accent':accent,'--accent-soft':soft,
      '--primary':primary,'--on-primary':readable(primary),'--mint':success,'--success':success,
      '--warning':warning,'--danger':danger,'--focus':link,
      '--on-danger':readable(danger),'--on-warning':readable(warning),'--on-blue':readable(link),'--on-success':readable(success),
      '--panel-shadow':`0 14px 40px ${light?'#18203412':'#00000026'}`,
      '--nos-toolbar':surface,'--nos-fg':fg,'--nos-secondary':visible(muted,surface),'--nos-edge':edge,
      '--heat-0':mix(surface,fg,.18), '--heat-1':mix(surface,accent,.38),
      '--heat-2':mix(surface,accent,.60),'--heat-3':mix(surface,accent,.80),'--heat-4':accent
    };
    const heatPalettes={green:['#bbf7d0','#86efac','#4ade80','#22c55e'],orange:['#fed7aa','#fdba74','#fb923c','#ea580c'],purple:['#f3e8ff','#d8b4fe','#c084fc','#9333ea']};
    if(Object.hasOwn(heatPalettes,settings.heatmap_palette))heatPalettes[settings.heatmap_palette].forEach((color,i)=>tokens['--heat-'+(i+1)]=color);
    for(let i=0;i<=4;i++)tokens['--heat-text-'+i]=readable(tokens['--heat-'+i]);
    return {id,mode,light,name:palette.name,tokens};
  }
  function apply(node,settings={},page=false) {
    if(!node)return;
    const result=resolve(settings);
    node.dataset.theme=result.mode==='system'?(result.light?'light':'night'):result.mode;
    node.dataset.colorTheme=result.id;
    node.dataset.colorMode=result.light?'light':'dark';
    for(const [key,value] of Object.entries(result.tokens))node.style.setProperty(key,value);
    node.style.colorScheme=result.light?'light':'dark';
    if(page) {
      const html=document.documentElement;
      html.dataset.nosTheme='true';html.style.colorScheme=node.style.colorScheme;
      // Page-level variables also theme the native reviewer bottom WebView.
      for(const [key,value] of Object.entries(result.tokens))html.style.setProperty(key,value);
    }
    return result;
  }
  function watch(node,getSettings,page=false,after) {
    watchers.set(node,()=>{const result=apply(node,getSettings(),page);after?.(result);});
    watchers.get(node)();
  }
  system.addEventListener('change',()=>{for(const [node,update] of watchers)if(node.isConnected)update();else watchers.delete(node);});
  function cards(container,onSelect) {
    if(!container||container.childElementCount)return;
    for(const [id,palette] of Object.entries(palettes)) {
      const button=document.createElement('button');button.type='button';button.className='palette-card';button.dataset.setPalette=id;
      button.setAttribute('aria-pressed','false');
      const colors=document.createElement('span');colors.className='palette-colors';colors.setAttribute('aria-hidden','true');
      for(const color of [palette.dark[0],palette.dark[1],palette.dark[4],palette.light[0]]) {
        const dot=document.createElement('i');dot.style.background=color;colors.append(dot);
      }
      const title=document.createElement('strong');title.textContent=palette.name;
      const note=document.createElement('small');note.textContent=palette.note;
      button.append(colors,title,note);button.addEventListener('click',()=>onSelect(id));container.append(button);
    }
  }
  function sync(settings) {
    const selected=resolve(settings);
    document.querySelectorAll('[data-set-palette]').forEach(button=>{
      const active=button.dataset.setPalette===selected.id;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('[data-set-theme],[data-set-accent]').forEach(button=>{
      const active=button.dataset.setTheme?button.dataset.setTheme===(settings.theme||'dusk'):button.dataset.setAccent===(settings.accent||'blue');
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      if(button.dataset.setAccent==='auto')button.style.setProperty('--c',palettes[selected.id][selected.light?'light':'dark'][4]);
    });
    const input=document.getElementById('set-custom-accent');
    if(input)input.value=/^#[0-9a-f]{6}$/i.test(settings.custom_accent||'')?settings.custom_accent:'#83b8ff';
    const hex=document.getElementById('custom-accent-value');if(hex)hex.textContent=input?.value||'';
    const preview=document.getElementById('theme-preview');
    apply(preview,settings);
    if(preview) {
      preview.classList.toggle('no-blur', settings.blur===false || !!settings.lite_mode);
      preview.classList.toggle('reduce-motion', settings.animations===false || !!settings.lite_mode);
      const meta=document.getElementById('theme-preview-meta');
      if(meta) {
        const modeNames={dusk:'Hoàng hôn',night:'Kính tối',oled:'OLED',light:'Sáng',system:'Hệ thống'};
        const layoutNames={aurora:'Cực quang',bento:'Bento',dock:'Dock nổi',sidebar:'Sidebar',zen:'Zen',edges:'4 Cạnh'};
        const layoutId=settings.layout||'aurora';
        const sideNote=(layoutId==='aurora'||layoutId==='sidebar')?(' · '+(settings.sidebar_side==='right'?'Phải':'Trái')):'';
        const fx=settings.lite_mode?'Lite Mode':((settings.blur===false?'Nền đặc':'Kính mờ')+' · '+(settings.animations===false?'Tắt hiệu ứng':'Hiệu ứng mượt'));
        meta.textContent=(modeNames[settings.theme||'dusk']||'Hoàng hôn')+' · '+(layoutNames[layoutId]||layoutId)+sideNote+' · '+fx;
      }
    }
    const title=document.getElementById('theme-preview-name');if(title)title.textContent=selected.name+' · '+(selected.light?'Sáng':'Tối');
  }
  window.NOSTheme={palettes,resolve,apply,watch,cards,sync,contrast};
})();
