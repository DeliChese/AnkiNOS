/* AnkiNOS Media Studio: one native library, automatic no-crop wallpaper, no Apply. */
(function initMediaStudio() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMediaStudio, {once: true});
    return;
  }
  const root = document.getElementById('nos-app');
  const dialog = document.getElementById('studio-dialog');
  if (!root || !dialog || window.NOSStudio) return;
  const $ = id => document.getElementById(id);
  const tr = s => window.NOSI18n ? window.NOSI18n.t(s) : s;
  const native = root.dataset.native === 'true';
  const ORIGINAL = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}\.(?:png|jpg|webp)$/;
  const PREVIEW = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}-thumb\.png$/;
  const UUID = /^[0-9a-f]{32}$/;
  const TARGETS = {
    image_dashboard: 'Dashboard',
    image_overview: 'Chuẩn bị học',
    image_review: 'Lúc ôn tập',
    image_cover: 'Ảnh bìa hồ sơ',
    image_avatar: 'Avatar'
  };
  const FRAME_SLOTS = ['dashboard', 'overview', 'review', 'cover', 'avatar'];
  let selected = null, album = 'all', editing = null, pendingAlbumName = '';
  let activeFrame = 'dashboard', showGrid = true;
  let searchText = '';
  let gallerySignature = '';
  let albumsSignature = '';
  let searchFrame = 0;
  let prepareTask = 0, prepareIdle = false, previewRequest = '';
  let photoSource, photoCache = [], albumSource, albumCache = [];
  const warmImages = new Map();
  const getData = () => window.AnkiNOS?.getSettings?.() || {};
  const photos = () => {
    const source=getData().images;
    if(source!==photoSource){photoSource=source;photoCache=(source||[]).filter(p=>p&&UUID.test(p.id)&&ORIGINAL.test(p.url||''));}
    return photoCache;
  };
  const albums = () => {
    const source=getData().image_albums;
    if(source!==albumSource){albumSource=source;albumCache=(source||[]).filter(a=>a&&UUID.test(a.id)&&typeof a.name==='string');}
    return albumCache;
  };
  const create = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function status(message, error = false) {
    $('studio-status').textContent = message;
    $('studio-status').style.color = error ? '#ffb3c1' : '#a6e5c7';
  }
  function command(action, payload = {}, previewUpdate = null) {
    if (native) {
      window.AnkiNOS?.studioCommand?.(action, payload);
    } else if (previewUpdate) {
      previewUpdate();
    } else if (action === 'image_add') {
      status('Bản xem trước: mở trong Anki để nhập ảnh thật.', true);
    }
  }
  function albumLabel() {
    if (album === 'all') return 'Tất cả ảnh';
    if (album === 'unfiled') return 'Chưa phân loại';
    return albums().find(a => a.id === album)?.name || 'Tất cả ảnh';
  }
  function showAlbums() {
    const nav = $('studio-albums');
    nav.replaceChildren();
    const all = photos();
    const items = [
      {id: 'all', name: 'Tất cả ảnh', count: all.length},
      {id: 'unfiled', name: 'Chưa phân loại', count: all.filter(x => !x.album_id).length},
      ...albums().map(a => ({id: a.id, name: a.name, count: all.filter(x => x.album_id === a.id).length}))
    ];
    if (!items.some(a => a.id === album)) album = 'all';
    for (const item of items) {
      const button = create('button', item.id === album ? 'active' : '');
      button.type = 'button';
      button.dataset.studioAlbum = item.id;
      const nameSpan = create('span','',item.name);
      if (UUID.test(item.id)) nameSpan.setAttribute('data-i18n-skip','');
      button.append(nameSpan,create('small','',String(item.count)));
      button.title = item.name;
      if (UUID.test(item.id)) button.setAttribute('data-i18n-skip','');
      nav.append(button);
    }
    $('studio-album-tools').hidden = !UUID.test(album);
  }
  function showGallery() {
    const gallery = $('studio-gallery');
    const matches = photos().filter(image =>
      (album === 'all' || (album === 'unfiled' ? !image.album_id : image.album_id === album)) &&
      image.name.toLocaleLowerCase().includes(searchText)
    );
    $('studio-gallery-title').textContent = albumLabel();
    $('studio-count').textContent = matches.length + ' ảnh · tổng ' + photos().length + ' / 100';
    gallery.replaceChildren();
    if (!matches.length) {
      gallery.append(create('div','nos-studio-gallery-empty',
        photos().length ? 'Album chưa có ảnh phù hợp. Chọn album khác hoặc nhập ảnh mới.' :
          'Chưa có ảnh. Nhấn “Nhập ảnh từ máy” để tạo thư viện.'));
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const photo of matches) {
      const tile = create('button','nos-studio-tile' + (photo.id === selected ? ' selected' : ''));
      tile.type = 'button';
      tile.dataset.photoId = photo.id;
      tile.setAttribute('aria-pressed',String(photo.id === selected));
      const img = create('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      // Legacy originals may be 24MP. Wait for a background preview instead
      // of decoding them all in the opening frame.
      if (PREVIEW.test(photo.thumb_url || '')) img.src = photo.thumb_url;
      else img.classList.add('preview-pending');
      const caption = create('span','nos-studio-tile-caption');
      const photoTitle = create('strong','',photo.name);
      photoTitle.setAttribute('data-i18n-skip','');
      caption.append(photoTitle);
      caption.append(create('small','',photo.width && photo.height ?
        photo.width + ' × ' + photo.height + ' px' : 'Ảnh gốc'));
      tile.append(img,caption);
      fragment.append(tile);
    }
    gallery.append(fragment);
  }
  const wallFit = () => getData().image_fit_dashboard === 'contain' ? 'contain' : 'cover';
  const wallDim = () => Number.isInteger(getData().wallpaper_dim) ? getData().wallpaper_dim : 28;
  const wallBlur = () => Number.isInteger(getData().wallpaper_blur) ? getData().wallpaper_blur : 0;
  const clampInt = (v, lo, hi, d) => Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d;
  function getFrame(surface = activeFrame) {
    const raw = getData().image_frames?.[surface] || {};
    return {
      x: clampInt(raw.x, 0, 100, 50),
      y: clampInt(raw.y, 0, 100, 50),
      zoom: clampInt(raw.zoom, 100, 250, 100),
    };
  }
  function updateFrameLive(surface, nextFrame, persist = false) {
    const clean = {
      x: Math.round(Math.min(100, Math.max(0, nextFrame.x))),
      y: Math.round(Math.min(100, Math.max(0, nextFrame.y))),
      zoom: Math.round(Math.min(250, Math.max(100, nextFrame.zoom))),
    };
    const merged = {...(getData().image_frames || {}), [surface]: clean};
    getData().image_frames = merged;
    showDisplayOptions();
    if (persist) {
      saveDisplay({image_frames: {[surface]: clean}});
    } else {
      window.AnkiNOS?.studioUpdate?.({image_frames: merged});
    }
  }
  function showDisplayOptions() {
    const isProfileMedia = activeFrame === 'avatar' || activeFrame === 'cover';
    const fit = isProfileMedia ? 'cover' : wallFit();
    const dim = isProfileMedia ? 0 : wallDim();
    const blur = isProfileMedia ? 0 : wallBlur();
    const frame = getFrame(activeFrame);
    const scale = (frame.zoom / 100) * (blur ? 1.06 : 1);
    const preview = $('studio-preview');
    preview.dataset.frameSlot = activeFrame;
    preview.dataset.grid = showGrid ? 'on' : 'off';
    preview.dataset.draggable = selected ? 'true' : 'false';
    preview.style.setProperty('--wall-fit', fit);
    preview.style.setProperty('--wall-dim', String(dim / 100));
    preview.style.setProperty('--wall-blur', blur + 'px');
    preview.style.setProperty('--wall-pos-x', frame.x + '%');
    preview.style.setProperty('--wall-pos-y', frame.y + '%');
    preview.style.setProperty('--wall-scale', scale.toFixed(3));
    for (const tab of $('studio-frame-tabs')?.querySelectorAll('[data-studio-frame]') || []) {
      const on = tab.dataset.studioFrame === activeFrame;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    if ($('studio-grid-toggle')) {
      $('studio-grid-toggle').setAttribute('aria-pressed', String(showGrid));
      $('studio-grid-toggle').classList.toggle('active', showGrid);
    }
    if ($('studio-frame-coords')) $('studio-frame-coords').textContent = `${frame.x}% · ${frame.y}%`;
    if ($('studio-zoom') && document.activeElement !== $('studio-zoom')) $('studio-zoom').value = String(frame.zoom);
    if ($('studio-zoom-out')) $('studio-zoom-out').textContent = frame.zoom + '%';
    if ($('studio-drag-hint')) $('studio-drag-hint').hidden = !selected;
    for (const button of $('studio-fit').querySelectorAll('[data-studio-fit]'))
      button.setAttribute('aria-pressed', String(button.dataset.studioFit === wallFit()));
    if (document.activeElement !== $('studio-dim')) $('studio-dim').value = String(wallDim());
    if (document.activeElement !== $('studio-blur')) $('studio-blur').value = String(wallBlur());
    $('studio-dim-out').textContent = wallDim() + '%';
    $('studio-blur-out').textContent = wallBlur() + ' px';
  }
  function showInspector() {
    const image = photos().find(p => p.id === selected);
    $('studio-inspector-fields').hidden = !image;
    const preview = $('studio-preview-image');
    const placeholder = $('studio-preview-empty');
    if (!image) {
      preview.hidden = true;
      preview.removeAttribute('src');
      placeholder.hidden = false;
      placeholder.textContent = 'Chọn một ảnh trong thư viện để xem trước.';
      $('studio-image-meta').textContent = 'Ảnh nguyên gốc luôn vừa khung, không bị cắt hoặc kéo giãn.';
      return;
    }
    // Reassigning src on every settings event decodes the full image again.
    // The Studio inspector is intentionally small: decode the 480px thumbnail,
    // never a 24MP wallpaper on each click. Originals remain used by pages.
    const previewUrl = PREVIEW.test(image.thumb_url || '') ? image.thumb_url : '';
    if (!previewUrl) {
      preview.removeAttribute('src');
      placeholder.textContent='Đang tải ảnh xem trước…';
    }
    if (previewUrl && preview.getAttribute('src') !== previewUrl) preview.src = previewUrl;
    preview.hidden = !previewUrl;
    placeholder.hidden = !!previewUrl;
    const meta = [];
    if (image.width && image.height) meta.push(image.width + ' × ' + image.height + ' px');
    if (image.size) meta.push((image.size / 1024 / 1024).toFixed(2) + ' MB');
    meta.push(image.ext.toUpperCase().replace('.',''));
    meta.push(wallFit() === 'cover' ? 'Lấp đầy khung' : 'Vừa khung, không cắt');
    $('studio-image-meta').textContent = meta.join(' · ');
    showDisplayOptions();
    if (document.activeElement !== $('studio-image-name'))
      $('studio-image-name').value = image.name;
    const select = $('studio-image-album');
    const optionsKey = JSON.stringify(albums());
    if (select.dataset.optionsKey !== optionsKey) {
      select.replaceChildren(new Option('Chưa phân loại',''));
      for(const a of albums()) { const opt = new Option(a.name,a.id); opt.setAttribute('data-i18n-skip',''); select.append(opt); }
      select.dataset.optionsKey = optionsKey;
    }
    if (select.value !== (image.album_id || '')) select.value = image.album_id || '';
    for (const button of $('studio-targets').querySelectorAll('[data-studio-slot]')) {
      const active = getData()[button.dataset.studioSlot] === image.id;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
      button.querySelector('span').textContent = active ? 'Đang dùng · bỏ gán' : 'Dùng ảnh này';
    }
  }
  function render() {
    if (pendingAlbumName) {
      const found = albums().find(a => a.name.toLocaleLowerCase() === pendingAlbumName.toLocaleLowerCase());
      if (found) {album = found.id;pendingAlbumName = '';}
    }
    if (selected && !photos().some(image => image.id === selected)) selected = null;
    const pictures = photos();
    const groupKey = JSON.stringify([album,albums(),pictures.map(p=>[p.id,p.album_id])]);
    if (albumsSignature !== groupKey) {
      showAlbums();
      albumsSignature = JSON.stringify([album,albums(),pictures.map(p=>[p.id,p.album_id])]);
    }
    const nextGallery = JSON.stringify([album,searchText,
      pictures.map(p=>[p.id,p.name,p.thumb_url,p.url,p.album_id,p.width,p.height])]);
    if (gallerySignature !== nextGallery) {
      showGallery();
      gallerySignature = nextGallery;
    }
    showInspector();
  }
  function open(opts = {}) {
    if (opts && typeof opts === 'object') {
      if (opts.slot && FRAME_SLOTS.includes(opts.slot)) activeFrame = opts.slot;
      if (opts.photoId && photos().some(p => p.id === opts.photoId)) selected = opts.photoId;
    }
    if (dialog.open) { render(); return; }
    cancelPreparation();
    // Prepare while hidden, avoiding a second layout immediately after showModal.
    render();
    $('studio-search').value = searchText;
    dialog.showModal();
    if(document.activeElement!==$('studio-close'))$('studio-close').focus({preventScroll:true});
    requestPreviews();
  }
  function close() {
    if (!dialog.open) return;
    if (searchFrame) { cancelAnimationFrame(searchFrame); searchFrame=0; }
    dialog.close();
    stopEditing();
    const trigger = $('studio-launcher');
    trigger?.focus({preventScroll:true});
  }
  function sync() {
    requestPreviews();
    if (dialog.open) {render();return;}
    if (prepareTask) return;
    const prepare=()=>{
      prepareTask=0;
      render();
      // Only small previews for the first visible row are warmed in idle time.
      const urls=photos().slice(0,6).map(p=>p.thumb_url).filter(url=>PREVIEW.test(url||''));
      for(const url of warmImages.keys())if(!urls.includes(url))warmImages.delete(url);
      for(const url of urls)if(!warmImages.has(url)){
        const img=new Image();img.decoding='async';img.fetchPriority='low';img.src=url;warmImages.set(url,img);
      }
    };
    prepareIdle=typeof requestIdleCallback==='function';
    prepareTask=prepareIdle?requestIdleCallback(prepare,{timeout:300}):setTimeout(prepare,0);
  }
  function cancelPreparation() {
    if(!prepareTask)return;
    if(prepareIdle)cancelIdleCallback(prepareTask);else clearTimeout(prepareTask);
    prepareTask=0;
  }
  function requestPreviews() {
    if(!native)return;
    const missing=photos().filter(p=>!PREVIEW.test(p.thumb_url||'')||p.wall_ready===false).map(p=>p.id).join(',');
    if(missing && missing!==previewRequest){previewRequest=missing;command('image_previews');}
    if(!missing)previewRequest='';
  }
  function stopEditing() {
    editing = null;
    $('studio-album-editor').hidden = true;
    $('studio-album-title').value = '';
  }
  function editAlbum(identifier = null) {
    editing = identifier || 'new';
    $('studio-album-title').value = identifier ?
      (albums().find(a => a.id === identifier)?.name || '') : '';
    $('studio-album-editor').hidden = false;
    $('studio-album-title').focus();
  }
  function changeLocal(patch) {
    window.AnkiNOS?.studioUpdate?.(patch);
    render();
  }
  function selectImage(identifier) {
    if (selected === identifier) return;
    selected = identifier;
    // Only flip two selection classes; keep thumbnail nodes and decoded images.
    for (const tile of $('studio-gallery').querySelectorAll('.nos-studio-tile')) {
      const active = tile.dataset.photoId === identifier;
      tile.classList.toggle('selected', active);
      tile.setAttribute('aria-pressed', String(active));
    }
    showInspector();
  }
  dialog.addEventListener('cancel',event => {event.preventDefault();close();});
  dialog.addEventListener('click',event => {
    if (event.target === dialog) {close();return;}
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'studio-close') {close();return;}
    if (button.id === 'studio-add') {
      command('image_add',{album_id:UUID.test(album)?album:''});
      return;
    }
    if (button.dataset.studioAlbum) {
      album = button.dataset.studioAlbum;
      searchText = '';
      $('studio-search').value = '';
      stopEditing();
      render();
      return;
    }
    if (button.dataset.photoId) {selectImage(button.dataset.photoId);return;}
    if (button.id === 'studio-album-new') {editAlbum();return;}
    if (button.id === 'studio-album-rename' && UUID.test(album)) {editAlbum(album);return;}
    if (button.id === 'studio-album-cancel') {stopEditing();return;}
    if (button.id === 'studio-album-confirm') {saveAlbum();return;}
    if (button.id === 'studio-album-delete' && UUID.test(album)) {
      if(!window.confirm(tr('Xóa album này? Ảnh sẽ chuyển sang Chưa phân loại và không bị xóa.')))return;
      const target=album;
      album='unfiled';
      stopEditing();
      command('album_delete',{id:target},()=>{
        const data=getData(),images=data.images.map(p=>p.album_id===target?{...p,album_id:undefined}:p);
        changeLocal({image_albums:albums().filter(a=>a.id!==target),images});
      });
      render();
      status('Đã xóa album; ảnh được giữ nguyên.');
      return;
    }
    if (button.dataset.studioFrame && FRAME_SLOTS.includes(button.dataset.studioFrame)) {
      activeFrame = button.dataset.studioFrame;
      showDisplayOptions();
      return;
    }
    if (button.id === 'studio-grid-toggle') {
      showGrid = !showGrid;
      showDisplayOptions();
      return;
    }
    if (button.id === 'studio-frame-reset') {
      updateFrameLive(activeFrame, {x: 50, y: 50, zoom: 100}, true);
      status('Đã đặt lại khung ảnh về giữa (100%).');
      return;
    }
    if (button.dataset.studioFit) {
      const fit = button.dataset.studioFit === 'contain' ? 'contain' : 'cover';
      saveDisplay({image_fit_dashboard: fit, image_fit_overview: fit, image_fit_review: fit});
      return;
    }
    if (button.id === 'studio-rename') {renamePhoto();return;}
    if (button.id === 'studio-remove-image') {deletePhoto();return;}
    const slot=button.dataset.studioSlot;
    if (slot && Object.hasOwn(TARGETS,slot) && selected) {
      const surface = slot.replace(/^image_/, '');
      if (FRAME_SLOTS.includes(surface)) activeFrame = surface;
      const value=getData()[slot] === selected ? null : selected;
      window.AnkiNOS?.studioUpdate?.({[slot]:value});
      command('image_assign',{slot,id:value});
      status(value ? 'Đã chọn ảnh cho '+TARGETS[slot]+'. Lưu tự động.' :
        'Đã trả '+TARGETS[slot]+' về nền mặc định.');
      render();
    }
  });
  function saveDisplay(patch) {
    window.AnkiNOS?.studioUpdate?.(patch);
    command('save_ui', {values: patch});
    render();
  }
  // Sliders update the live preview while dragging and persist once on release.
  let sliderFrame = 0;
  for (const [id, key] of [['studio-dim', 'wallpaper_dim'], ['studio-blur', 'wallpaper_blur']]) {
    $(id).addEventListener('input', event => {
      const value = Number(event.target.value);
      if (!Number.isInteger(value)) return;
      getData()[key] = value;
      if (sliderFrame) return;
      sliderFrame = requestAnimationFrame(() => {
        sliderFrame = 0;
        window.AnkiNOS?.studioUpdate?.({[key]: Number($(id).value)});
      });
    });
    $(id).addEventListener('change', event => {
      const value = Number(event.target.value);
      if (Number.isInteger(value)) saveDisplay({[key]: value});
    });
  }
  $('studio-zoom')?.addEventListener('input', event => {
    const value = Number(event.target.value);
    if (!Number.isInteger(value)) return;
    const frame = getFrame(activeFrame);
    updateFrameLive(activeFrame, {...frame, zoom: value}, false);
  });
  $('studio-zoom')?.addEventListener('change', event => {
    const value = Number(event.target.value);
    if (!Number.isInteger(value)) return;
    const frame = getFrame(activeFrame);
    updateFrameLive(activeFrame, {...frame, zoom: value}, true);
  });
  // Interactive drag-to-pan framing directly inside #studio-preview (non-destructive).
  let dragState = null;
  $('studio-preview')?.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !selected) return;
    const preview = $('studio-preview');
    const rect = preview.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const start = getFrame(activeFrame);
    dragState = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect, frame: start, moved: false};
    preview.classList.add('is-dragging');
    preview.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  $('studio-preview')?.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = ((event.clientX - dragState.startX) / dragState.rect.width) * 100;
    const dy = ((event.clientY - dragState.startY) / dragState.rect.height) * 100;
    dragState.moved = true;
    const next = {
      x: Math.round(Math.min(100, Math.max(0, dragState.frame.x - dx))),
      y: Math.round(Math.min(100, Math.max(0, dragState.frame.y - dy))),
      zoom: dragState.frame.zoom,
    };
    updateFrameLive(activeFrame, next, false);
  });
  const finishDrag = event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const preview = $('studio-preview');
    preview.classList.remove('is-dragging');
    preview.releasePointerCapture?.(event.pointerId);
    const shouldSave = dragState.moved;
    dragState = null;
    if (shouldSave) {
      updateFrameLive(activeFrame, getFrame(activeFrame), true);
      status('Đã lưu góc căn khung ảnh.');
    }
  };
  $('studio-preview')?.addEventListener('pointerup', finishDrag);
  $('studio-preview')?.addEventListener('pointercancel', finishDrag);
  function saveAlbum() {
    const name = $('studio-album-title').value.trim();
    if (!name || name.length > 80) {status('Tên album phải có từ 1 đến 80 ký tự.',true);return;}
    const current=editing;
    if (!current) return;
    if (albums().some(a=>a.name.toLocaleLowerCase()===name.toLocaleLowerCase()&&a.id!==current)) {
      status('Album đã có tên này.',true);return;
    }
    if(current==='new') {
      pendingAlbumName=name;
      command('album_create',{name},()=>{
        const id=crypto.randomUUID().replaceAll('-','');
        changeLocal({image_albums:[...albums(),{id,name}]});
      });
    } else {
      command('album_rename',{id:current,name},()=>{
        changeLocal({image_albums:albums().map(a=>a.id===current?{...a,name}:a)});
      });
    }
    stopEditing();
    status('Đã lưu tên album.');
  }
  function renamePhoto() {
    const photo=photos().find(p=>p.id===selected);
    const name=$('studio-image-name').value.trim();
    if (!photo || !name || name.length>80) {status('Tên ảnh phải có từ 1 đến 80 ký tự.',true);return;}
    if (name===photo.name) {status('Tên ảnh không đổi.');return;}
    command('image_rename',{id:photo.id,name},()=>{
      changeLocal({images:getData().images.map(p=>p.id===photo.id?{...p,name}:p)});
    });
    status('Đã lưu tên ảnh.');
  }
  function deletePhoto() {
    const photo=photos().find(p=>p.id===selected);
    if (!photo) return;
    // Real Anki also confirms in the native dialog. Preview checks here.
    if (!native && !window.confirm(tr('Xóa ảnh khỏi thư viện?'))) return;
    command('image_delete',{id:photo.id},()=>{
      const changed={images:photos().filter(p=>p.id!==photo.id)};
      for(const key of Object.keys(TARGETS))if(getData()[key]===photo.id)changed[key]=null;
      changeLocal(changed);
    });
    if (!native) selected=null;
    render();
    status(native ? 'Xác nhận xóa trong hộp thoại Anki.' : 'Đã xóa ảnh.');
  }
  $('studio-image-album').addEventListener('change',event=>{
    const photo=photos().find(p=>p.id===selected);
    if (!photo) return;
    const albumId=event.target.value;
    if(albumId && !albums().some(a=>a.id===albumId))return;
    command('image_move',{id:photo.id,album_id:albumId},()=>{
      changeLocal({images:getData().images.map(p=>p.id===photo.id?
        {...p,album_id:albumId||undefined}:p)});
    });
    if(album!=='all')album=albumId || 'unfiled';
    status('Đã chuyển ảnh sang album.');
  });
  $('studio-search').addEventListener('input',event=>{
    searchText=event.target.value.trim().toLocaleLowerCase();
    if (searchFrame) cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => {
      searchFrame=0;
      render();
    });
  });
  $('studio-image-name').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();renamePhoto();}
  });
  $('studio-album-title').addEventListener('keydown',event=>{
    if(event.key==='Enter'){event.preventDefault();saveAlbum();}
  });
  document.addEventListener('nos:language', () => {
    albumsSignature = '';
    gallerySignature = '';
    if ($('studio-image-album')) $('studio-image-album').dataset.optionsKey = '';
    if (dialog.open) render();
  });
  window.NOSStudio={open,close,sync,notice:message=>{if(dialog.open)status(message);}};
  $('studio-close').autofocus=true;
  sync();
})();
