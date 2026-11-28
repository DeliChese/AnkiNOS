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
      light:['#f2eefb','#fffcff','#39334c','#665b7b','#8250bf']},
    gruvbox: {name:'Gruvbox', note:'Cổ điển · ấm áp hổ phách',
      dark:['#282828','#3c3836','#ebdbb2','#d5c4a1','#fabd2f'],
      light:['#fbf1c7','#f9f5d7','#3c3836','#665c54','#b57614']},
    everforest: {name:'Everforest', note:'Rừng rêu · dịu mắt đọc lâu',
      dark:['#272e33','#374145','#d3c6aa','#a7c080','#83c092'],
      light:['#f3ead3','#fdf6e3','#4f5b62','#6c7a82','#3a94c5']},
    kanagawa: {name:'Kanagawa', note:'Sóng mực · thanh tao Nhật Bản',
      dark:['#1f1f28','#2a2a37','#dcd7ba','#c8c093','#7e9cd8'],
      light:['#f2ecbc','#faf6de','#4a4a5a','#6b685c','#4d699b']},
    sakura: {name:'Sakura', note:'Anh đào · sáng nhẹ tinh tế',
      dark:['#231b24','#332735','#f7eaf0','#d6bcc8','#f29cb8'],
      light:['#fdf3f6','#ffffff','#432d39','#6e5260','#c44b74']},
    matcha: {name:'Matcha', note:'Trà xanh · thanh mát tập trung',
      dark:['#18221b','#233126','#edf5ea','#b6ccb0','#86d68e'],
      light:['#f2f7ee','#fcfef9','#253526','#4d634e','#3c8046']},
    synthwave: {name:'Synthwave', note:'Neon tím hồng · rực rỡ hiện đại',
      dark:['#1a102b','#261840','#f6ecff','#cbb4e8','#ff6ec7'],
      light:['#f7effc','#fffbff','#331d4f','#604580','#b83280']},
    espresso: {name:'Espresso', note:'Cà phê rang · trầm ấm tối giản',
      dark:['#1f1815','#2e241f','#f5ebe1','#cbb8a8','#e09f67'],
      light:['#f7f1ea','#fffcf8','#382920','#634f43','#9c5a27']},
    oceanic: {name:'Oceanic', note:'Biển sâu · xanh ngọc trong trẻo',
      dark:['#0f222d','#183342','#e8f6fb','#a8cad8','#38d3c9'],
      light:['#eaf5f8','#f9fdfe','#173442','#446575','#0e7c7b']}
  };
  // Offline curated font stacks: each primary face is genuinely installed on Windows/macOS/Linux
  // and visually distinct, with clean Vietnamese diacritics and CJK fallback.
  const fonts = {
    system:    {name:'Mặc định', note:'Chuẩn hệ điều hành · cân bằng', sample:'AaBb · Học tập 123', stack:"'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Noto Sans', 'Microsoft YaHei', sans-serif", tracking:'0px'},
    humanist:  {name:'Nhân văn', note:'Candara · nét mềm mại tinh tế', sample:'AaBb · Học tập 123', stack:"'Candara', 'Optima', 'Avenir Next', 'Noto Sans', 'Microsoft YaHei', sans-serif", tracking:'0.1px'},
    geometric: {name:'Hiện đại', note:'Bahnschrift · hình học gọn sắc', sample:'AaBb · Học tập 123', stack:"'Bahnschrift', 'DIN Alternate', 'Century Gothic', 'Avenir Next', 'Ubuntu', 'Noto Sans SC', sans-serif", tracking:'0.15px'},
    clean:     {name:'Tối giản', note:'Corbel · thoáng chữ, dễ đọc nhanh', sample:'AaBb · Học tập 123', stack:"'Corbel', 'Trebuchet MS', 'Gill Sans', 'Helvetica Neue', 'Noto Sans SC', sans-serif", tracking:'0.1px'},
    serif:     {name:'Cổ điển', note:'Georgia · phong cách sách báo', sample:'AaBb · Học tập 123', stack:"'Georgia', 'Cambria', 'Noto Serif', 'Noto Serif SC', 'Times New Roman', serif", tracking:'0.1px'},
    literary:  {name:'Học thuật', note:'Constantia · ấm áp, hợp đọc dài', sample:'AaBb · Học tập 123', stack:"'Constantia', 'Sitka Text', 'Palatino Linotype', 'Iowan Old Style', 'Noto Serif', 'Noto Serif SC', Georgia, serif", tracking:'0.15px'},
    rounded:   {name:'Thân thiện', note:'Calibri · bo nhẹ, dịu mắt khi ôn', sample:'AaBb · Học tập 123', stack:"'Calibri', 'SF Pro Rounded', 'Nunito', 'Quicksand', 'Trebuchet MS', 'Noto Sans SC', sans-serif", tracking:'0.1px'},
    mono:      {name:'Lập trình', note:'Consolas · đều nét, căn số chuẩn', sample:'AaBb · Học tập 123', stack:"'Cascadia Mono', 'Consolas', 'JetBrains Mono', 'SF Mono', 'Menlo', ui-monospace, monospace", tracking:'-0.2px'}
  };
  const accents = {blue:'#83b8ff',cyan:'#38bdf8',mint:'#34d399',purple:'#c084fc',amber:'#fbbf24',pink:'#f472b6'};
  const defaultRatings = {
    again: '#f26d85',
    hard: '#f0b85b',
    good: '#6ea8fe',
    easy: '#4fd19b',
  };
  const validHex = (value, fallback) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback);
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
    const customText = settings.text_color === 'custom' && /^#[0-9a-f]{6}$/i.test(settings.custom_text_color || '')
      ? settings.custom_text_color.toLowerCase()
      : null;
    const overrides = settings.theme_overrides || {};
    const panel = validHex(overrides.surface, null);
    if (panel) {
      surface = panel;
      bg = mix(panel, readable(panel) === '#ffffff' ? '#000000' : '#ffffff', .18);
    }
    fg = visible(customText || fg, surface);
    const edge=mix(surface,fg,light?.24:.25);
    let soft=mix(surface,accent,light?.12:.16);
    const link=visible(visible(accent,surface),soft);
    // A midtone panel and its hover tint can require opposite text colors.
    const linkOnPanel = visible(link, surface);
    if (contrast(linkOnPanel, soft) < 4.5) soft = surface;
    const primary=visible(validHex(overrides.primary, accent),surface,3);
    const success=visible(validHex(overrides.success, light?'#25754c':'#a2dfb0'),surface);
    const warning=visible(validHex(overrides.warning, light?'#895c13':'#f1cc87'),surface);
    const danger=visible(validHex(overrides.danger, light?'#b63e55':'#f2a2b0'),surface);
    const mutedFg = visible(customText ? mix(fg, surface, light ? .28 : .26) : muted, surface);
    const clampInt=(v,lo,hi,d)=>Number.isInteger(v)?Math.min(hi,Math.max(lo,v)):d;
    const blurOn=settings.blur!==false&&!settings.lite_mode;
    const glassBlur=blurOn?clampInt(settings.glass_blur,0,32,16):0;
    const glassAlpha=blurOn?clampInt(settings.glass_opacity,30,100,74):100;
    const glassCardAlpha=blurOn?Math.min(100,glassAlpha+8):100;
    const cardAlpha=clampInt(settings.reviewer_card_opacity,20,100,100);
    const customRatings = settings.rating_colors === 'custom';
    const r1 = customRatings ? validHex(settings.rating_color_again, defaultRatings.again) : danger;
    const r2 = customRatings ? validHex(settings.rating_color_hard, defaultRatings.hard) : warning;
    const r3 = customRatings ? validHex(settings.rating_color_good, defaultRatings.good) : linkOnPanel;
    const r4 = customRatings ? validHex(settings.rating_color_easy, defaultRatings.easy) : success;
    const fontId=Object.hasOwn(fonts,settings.font_family)?settings.font_family:'system';
    const tokens={
      '--nos-font':fonts[fontId].stack,
      '--nos-font-tracking':fonts[fontId].tracking||'0px',
      '--theme-bg':bg,'--surface':surface,'--text':fg,'--muted':mutedFg,
      '--faint':mutedFg,'--edge':edge,'--inner':mix(surface,fg,.055),'--hover':soft,
      '--glass':surface+(light?'f2':'e8'),'--glass-blur':glassBlur+'px','--glass-alpha':glassAlpha+'%','--glass-card-alpha':glassCardAlpha+'%',
      '--nos-card-alpha':cardAlpha+'%',
      '--blue':linkOnPanel,'--accent':accent,'--accent-soft':soft,
      '--primary':primary,'--on-primary':readable(primary),'--mint':success,'--success':success,
      '--warning':warning,'--danger':danger,'--focus':linkOnPanel,
      '--on-danger':readable(danger),'--on-warning':readable(warning),'--on-blue':readable(linkOnPanel),'--on-success':readable(success),
      '--rating-1':r1,'--on-rating-1':readable(r1),
      '--rating-2':r2,'--on-rating-2':readable(r2),
      '--rating-3':r3,'--on-rating-3':readable(r3),
      '--rating-4':r4,'--on-rating-4':readable(r4),
      '--panel-shadow':`0 14px 40px ${light?'#18203412':'#00000026'}`,
      '--nos-toolbar':surface,'--nos-fg':fg,'--nos-secondary':mutedFg,'--nos-edge':edge,
      '--heat-0':mix(surface,fg,.18), '--heat-1':mix(surface,accent,.38),
      '--heat-2':mix(surface,accent,.60),'--heat-3':mix(surface,accent,.80),'--heat-4':accent
    };
    const heatPalettes={green:['#bbf7d0','#86efac','#4ade80','#22c55e'],orange:['#fed7aa','#fdba74','#fb923c','#ea580c'],purple:['#f3e8ff','#d8b4fe','#c084fc','#9333ea']};
    if(Object.hasOwn(heatPalettes,settings.heatmap_palette))heatPalettes[settings.heatmap_palette].forEach((color,i)=>tokens['--heat-'+(i+1)]=color);
    for(let i=0;i<=4;i++)tokens['--heat-text-'+i]=readable(tokens['--heat-'+i]);
    return {id,mode,light,fontId,name:palette.name,tokens};
  }
  function apply(node,settings={},page=false) {
    if(!node)return;
    const result=resolve(settings);
    const scheme=result.light?'light':'dark';
    node.dataset.theme=result.mode==='system'?(result.light?'light':'night'):result.mode;
    node.dataset.colorTheme=result.id;
    node.dataset.colorMode=scheme;
    node.dataset.surfaceStyle=settings.surface_style==='liquid'&&settings.blur!==false&&!settings.lite_mode
      ? 'liquid' : 'frosted';
    if(node.id==='nos-review-shell') {
      // Strictly isolate flashcard content (#qa) from UI text color, --text, and
      // color-scheme overrides: apply full theme tokens only to sibling chrome.
      node.style.setProperty('--nos-card-alpha',result.tokens['--nos-card-alpha']);
      node.style.setProperty('--glass-blur',result.tokens['--glass-blur']);
      for(const chrome of node.querySelectorAll(':scope > .nos-review-wallpaper, :scope > #nos-review-header, :scope > #nos-focus-summary')) {
        for(const [key,value] of Object.entries(result.tokens))chrome.style.setProperty(key,value);
        chrome.style.colorScheme=scheme;
      }
      return result;
    }
    for(const [key,value] of Object.entries(result.tokens))node.style.setProperty(key,value);
    node.style.colorScheme=scheme;
    if(page) {
      const html=document.documentElement;
      html.dataset.nosTheme='true';html.style.colorScheme=scheme;
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
  function fontCards(container,onSelect) {
    if(!container||container.childElementCount)return;
    for(const [id,font] of Object.entries(fonts)) {
      const button=document.createElement('button');button.type='button';button.className='font-card';button.dataset.setFont=id;
      button.setAttribute('aria-pressed','false');
      const sample=document.createElement('span');sample.className='font-card-sample';sample.style.fontFamily=font.stack;sample.textContent=font.sample;sample.setAttribute('data-i18n-skip','');
      const title=document.createElement('strong');title.style.fontFamily=font.stack;title.textContent=font.name;
      const note=document.createElement('small');note.textContent=font.note;
      button.append(sample,title,note);button.addEventListener('click',()=>onSelect(id));container.append(button);
    }
  }
  function sync(settings) {
    const selected=resolve(settings);
    document.querySelectorAll('[data-set-palette]').forEach(button=>{
      const active=button.dataset.setPalette===selected.id;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('[data-set-font]').forEach(button=>{
      const active=button.dataset.setFont===selected.fontId;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
    });
    document.querySelectorAll('[data-set-theme],[data-set-accent]').forEach(button=>{
      const active=button.dataset.setTheme?button.dataset.setTheme===(settings.theme||'dusk'):button.dataset.setAccent===(settings.accent||'blue');
      button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
      if(button.dataset.setAccent==='auto')button.style.setProperty('--c',palettes[selected.id][selected.light?'light':'dark'][4]);
    });
    const input=document.getElementById('set-custom-accent');
    if(input)input.value=/^#[0-9a-f]{6}$/i.test(settings.custom_accent||'')?settings.custom_accent:'#83b8ff';
    const hex=document.getElementById('custom-accent-value');if(hex)hex.textContent=input?.value||'';
    const textMode = settings.text_color === 'custom' ? 'custom' : 'auto';
    const textVal = validHex(settings.custom_text_color, selected.tokens['--text']);
    document.querySelectorAll('[data-set-text-color]').forEach(button=>{
      const target = button.dataset.setTextColor;
      const active = target === 'auto'
        ? textMode === 'auto'
        : (textMode === 'custom' && target.toLowerCase() === textVal);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const textInput=document.getElementById('set-custom-text');
    if(textInput)textInput.value=textVal;
    const textHex=document.getElementById('custom-text-value');
    if(textHex)textHex.textContent=textMode==='auto'?'auto':textVal;
    for (const input of document.querySelectorAll('[data-theme-role]')) {
      const role = input.dataset.themeRole;
      const custom = validHex(settings.theme_overrides?.[role], null);
      input.value = custom || selected.tokens['--' + role];
      input.parentElement.querySelector('[data-reset-role]').disabled = !custom;
    }
    const ratingMode = settings.rating_colors === 'custom' ? 'custom' : 'auto';
    document.querySelectorAll('[data-set-rating-colors]').forEach(button=>{
      const active = button.dataset.setRatingColors === ratingMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const ratingPickers = [
      ['set-rating-again', 'rating-again-val', settings.rating_color_again, selected.tokens['--rating-1']],
      ['set-rating-hard', 'rating-hard-val', settings.rating_color_hard, selected.tokens['--rating-2']],
      ['set-rating-good', 'rating-good-val', settings.rating_color_good, selected.tokens['--rating-3']],
      ['set-rating-easy', 'rating-easy-val', settings.rating_color_easy, selected.tokens['--rating-4']],
    ];
    for (const [id, valId, rawVal, resolvedVal] of ratingPickers) {
      const el = document.getElementById(id);
      const col = ratingMode === 'custom' ? validHex(rawVal, resolvedVal) : resolvedVal;
      if (el) el.value = col;
      const code = document.getElementById(valId);
      if (code) code.textContent = col;
    }
    const cardAlpha = Number.isInteger(settings.reviewer_card_opacity) ? Math.min(100, Math.max(20, settings.reviewer_card_opacity)) : 100;
    const cardInput = document.getElementById('set-reviewer-card-opacity');
    if (cardInput) cardInput.value = String(cardAlpha);
    const cardVal = document.getElementById('reviewer-card-opacity-val');
    if (cardVal) cardVal.textContent = `${cardAlpha}%`;
    const revPreview = document.getElementById('reviewer-settings-preview');
    if (revPreview) {
      apply(revPreview, settings);
      revPreview.classList.toggle('no-blur', settings.blur === false || !!settings.lite_mode);
    }
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
        const gBlur=Number.isInteger(settings.glass_blur)?settings.glass_blur:16;
        const gAlpha=Number.isInteger(settings.glass_opacity)?settings.glass_opacity:74;
        const fx=settings.lite_mode?'Lite Mode':((settings.blur===false?'Nền đặc':`Kính mờ ${gBlur}px · ${gAlpha}%`)+' · '+(settings.animations===false?'Tắt hiệu ứng':'Hiệu ứng mượt'));
        meta.textContent=(modeNames[settings.theme||'dusk']||'Hoàng hôn')+' · '+(layoutNames[layoutId]||layoutId)+sideNote+' · '+fx;
      }
    }
    const title=document.getElementById('theme-preview-name');if(title)title.textContent=selected.name+' · '+(selected.light?'Sáng':'Tối');
  }
  window.NOSTheme={palettes,fonts,resolve,apply,watch,cards,fontCards,sync,contrast};
})();
