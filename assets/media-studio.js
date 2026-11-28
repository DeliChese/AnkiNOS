/* AnkiNOS Media Studio: local photo library and non-destructive framing. */
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
  const previewBox = $('studio-preview');
  const previewImage = $('studio-preview-image');
  const native = root.dataset.native === 'true';
  const ORIGINAL = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}\.(?:png|jpg|webp)$/;
  const PREVIEW = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}-thumb\.png$/;
  const WALL = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}-wall\.jpg$/;
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
  let frameDraft = null, framePaint = 0, frameCommitTimer = 0, dragState = null;
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
  const selectedPhoto = () => photos().find(image => image.id === selected);
  const create = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function status(message, error = false) {
    $('studio-status').textContent = message;
    $('studio-status').classList.toggle('is-error', error);
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
    const title = $('studio-gallery-title');
    title.toggleAttribute('data-i18n-skip', UUID.test(album));
    title.textContent = albumLabel();
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
  const isProfileFrame = () => activeFrame === 'avatar' || activeFrame === 'cover';
  const wallFit = () => getData()['image_fit_' + activeFrame] === 'contain' ? 'contain' : 'cover';
  const imageFit = () => isProfileFrame() ? 'cover' : wallFit();
  const wallDim = () => Number.isInteger(getData().wallpaper_dim) ? getData().wallpaper_dim : 28;
  const wallBlur = () => Number.isInteger(getData().wallpaper_blur) ? getData().wallpaper_blur : 0;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const clampInt = (v, lo, hi, d) => Number.isInteger(v) ? clamp(v, lo, hi) : d;
  const displayScale = zoom => zoom / 100 * (!isProfileFrame() && wallBlur() ? 1.06 : 1);
  function getFrame(surface = activeFrame) {
    if (frameDraft?.surface === surface) return frameDraft.frame;
    const raw = getData().image_frames?.[surface] || {};
    return {
      x: clampInt(raw.x, 0, 100, 50),
      y: clampInt(raw.y, 0, 100, 50),
      zoom: clampInt(raw.zoom, 100, 250, 100),
    };
  }
  function updateFrame(frame) {
    frameDraft = {surface: activeFrame, frame};
    if (!framePaint) framePaint = requestAnimationFrame(() => {
      framePaint = 0;
      paintFrame();
    });
  }
  function commitFrame() {
    clearTimeout(frameCommitTimer);
    if (!frameDraft) return;
    const {surface, frame} = frameDraft;
    frameDraft = null;
    const clean = {x: Math.round(frame.x), y: Math.round(frame.y), zoom: Math.round(frame.zoom)};
    const patch = {image_frames: {[surface]: clean}};
    saveDisplay(patch, {image_frames: {...getData().image_frames, ...patch.image_frames}});
  }
  function paintFrame() {
    const frame = getFrame();
    previewBox.style.setProperty('--wall-pos-x', frame.x + '%');
    previewBox.style.setProperty('--wall-pos-y', frame.y + '%');
    previewBox.style.setProperty('--wall-scale', displayScale(frame.zoom).toFixed(3));
    $('studio-zoom').value = String(frame.zoom);
    $('studio-zoom-out').textContent = frame.zoom + '%';
    $('studio-zoom-less').disabled = frame.zoom <= 100;
    $('studio-zoom-more').disabled = frame.zoom >= 250;
  }
  function showDisplayOptions() {
    const canEdit = Boolean(selected && !previewImage.hidden);
    previewBox.dataset.frameSlot = activeFrame;
    previewBox.dataset.grid = showGrid ? 'on' : 'off';
    previewBox.dataset.draggable = String(canEdit);
    previewBox.tabIndex = canEdit ? 0 : -1;
    previewBox.style.setProperty('--wall-fit', imageFit());
    previewBox.style.setProperty('--wall-dim', String(isProfileFrame() ? 0 : wallDim() / 100));
    previewBox.style.setProperty('--wall-blur', (isProfileFrame() ? 0 : wallBlur()) + 'px');
    $('studio-wallpaper-fields').hidden = isProfileFrame();
    paintFrame();
    for (const tab of $('studio-frame-tabs').querySelectorAll('[data-studio-frame]')) {
      const on = tab.dataset.studioFrame === activeFrame;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    $('studio-grid-toggle').setAttribute('aria-pressed', String(showGrid));
    $('studio-grid-toggle').classList.toggle('active', showGrid);
    for (const button of $('studio-fit').querySelectorAll('[data-studio-fit]'))
      button.setAttribute('aria-pressed', String(button.dataset.studioFit === wallFit()));
    if (document.activeElement !== $('studio-dim')) $('studio-dim').value = String(wallDim());
    if (document.activeElement !== $('studio-blur')) $('studio-blur').value = String(wallBlur());
    $('studio-dim-out').textContent = wallDim() + '%';
    $('studio-blur-out').textContent = wallBlur() + ' px';
  }
  function showInspector() {
    const image = selectedPhoto();
    $('studio-inspector-fields').hidden = !image;
    $('studio-frame-controls').hidden = !image;
    const placeholder = $('studio-preview-empty');
    if (!image) {
      delete dialog.dataset.framing;
      previewImage.hidden = true;
      previewImage.removeAttribute('src');
      placeholder.hidden = false;
      placeholder.textContent = 'Chọn một ảnh trong thư viện để xem trước.';
      $('studio-image-meta').textContent = 'Ảnh nguyên gốc được giữ nguyên vẹn, căn khung không làm mất chất lượng.';
      showDisplayOptions();
      return;
    }
    // Use the small derivative in the gallery and reserve the larger one for framing.
    const previewUrl = dialog.dataset.framing && WALL.test(image.wall_url || '') ? image.wall_url :
      PREVIEW.test(image.thumb_url || '') ? image.thumb_url : '';
    if (!previewUrl) {
      previewImage.removeAttribute('src');
      placeholder.textContent='Đang tải ảnh xem trước…';
    }
    if (previewUrl && previewImage.getAttribute('src') !== previewUrl) previewImage.src = previewUrl;
    previewImage.hidden = !previewUrl;
    $('studio-frame-controls').hidden = !previewUrl;
    const expanded = Boolean(dialog.dataset.framing);
    const expandButton = $('studio-expand-frame');
    expandButton.textContent = expanded ? 'Về thư viện ảnh' : 'Căn ảnh rộng';
    expandButton.setAttribute('aria-pressed', String(expanded));
    placeholder.hidden = !!previewUrl;
    const meta = [];
    if (image.width && image.height) meta.push(image.width + ' × ' + image.height + ' px');
    if (image.size) meta.push((image.size / 1024 / 1024).toFixed(2) + ' MB');
    meta.push(image.ext.toUpperCase().replace('.',''));
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
  function renderGallery() {
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
  }
  function render() {
    renderGallery();
    showInspector();
  }
  function open(opts = {}) {
    if (opts && typeof opts === 'object') {
      if (opts.slot && FRAME_SLOTS.includes(opts.slot)) activeFrame = opts.slot;
      const candidate = opts.photoId || getData()['image_' + activeFrame];
      if (photos().some(p => p.id === candidate)) selectImage(candidate);
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
    cancelDrag();
    commitFrame();
    if (searchFrame) { cancelAnimationFrame(searchFrame); searchFrame=0; }
    dialog.close();
    delete dialog.dataset.framing;
    stopEditing();
    const trigger = $('appearance-dialog')?.open ? $('appearance-media') : $('studio-launcher');
    trigger?.focus({preventScroll:true});
  }
  function sync() {
    requestPreviews();
    if (dialog.open) {render();return;}
    if (prepareTask) return;
    const prepare=()=>{
      prepareTask=0;
      renderGallery();
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
    commitFrame();
    selected = identifier;
    // Only flip two selection classes; keep thumbnail nodes and decoded images.
    for (const tile of $('studio-gallery').querySelectorAll('.nos-studio-tile')) {
      const active = tile.dataset.photoId === identifier;
      tile.classList.toggle('selected', active);
      tile.setAttribute('aria-pressed', String(active));
    }
    showInspector();
  }
  function toggleExpanded() {
    commitFrame();
    if (dialog.dataset.framing) delete dialog.dataset.framing;
    else dialog.dataset.framing = 'true';
    showInspector();
    $('studio-expand-frame').focus({preventScroll: true});
    $('studio-expand-frame').scrollIntoView({block: 'nearest'});
  }
  dialog.addEventListener('cancel', event => {event.preventDefault();close();});
  $('studio-frame-tabs').addEventListener('keydown', event => {
    const tab = event.target.closest('[data-studio-frame]');
    if (!tab) return;
    const keys = ['Home', 'End', 'ArrowLeft', 'ArrowRight'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from($('studio-frame-tabs').querySelectorAll('[data-studio-frame]'));
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) :
      tabs[(tabs.indexOf(tab) + direction + tabs.length) % tabs.length];
    next.click();
    next.focus();
  });
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
    if (button.dataset.photoId) {
      selectImage(button.dataset.photoId);
      if (matchMedia('(max-width: 740px)').matches) $('studio-inspector').scrollIntoView({block: 'start'});
      return;
    }
    if (button.id === 'studio-expand-frame') {toggleExpanded();return;}
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
      commitFrame();
      activeFrame = button.dataset.studioFrame;
      const assigned = getData()['image_' + activeFrame];
      if (assigned && assigned !== selected && photos().some(p => p.id === assigned)) selectImage(assigned);
      else showDisplayOptions();
      return;
    }
    if (button.id === 'studio-grid-toggle') {
      showGrid = !showGrid;
      showDisplayOptions();
      return;
    }
    if (button.id === 'studio-frame-reset') {
      updateFrame({x: 50, y: 50, zoom: 100});
      commitFrame();
      status('Đã đặt lại khung ảnh về giữa (100%).');
      return;
    }
    if (button.id === 'studio-zoom-less' || button.id === 'studio-zoom-more') {
      const direction = button.id === 'studio-zoom-more' ? 1 : -1;
      zoomTo(getFrame().zoom + direction * 10);
      commitFrame();
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
      commitFrame();
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
  function saveDisplay(patch, localPatch = patch) {
    window.AnkiNOS?.studioUpdate?.(localPatch);
    command('save_ui', {values: patch});
  }
  for (const [id, key] of [['studio-dim', 'wallpaper_dim'], ['studio-blur', 'wallpaper_blur']]) {
    $(id).addEventListener('input', event => {
      const value = event.target.value;
      if (key === 'wallpaper_dim') {
        previewBox.style.setProperty('--wall-dim', String(Number(value) / 100));
        $('studio-dim-out').textContent = value + '%';
      } else {
        previewBox.style.setProperty('--wall-blur', value + 'px');
        previewBox.style.setProperty('--wall-scale', (getFrame().zoom / 100 * (Number(value) ? 1.06 : 1)).toFixed(3));
        $('studio-blur-out').textContent = value + ' px';
      }
    });
    $(id).addEventListener('change', event => {
      const value = Number(event.target.value);
      if (Number.isInteger(value)) saveDisplay({[key]: value});
    });
  }
  function frameGeometry() {
    const photo = selectedPhoto();
    if (!photo || previewImage.hidden) return null;
    const rect = previewBox.getBoundingClientRect();
    const width = previewBox.clientWidth;
    const height = previewBox.clientHeight;
    const imageWidth = photo.width || previewImage.naturalWidth;
    const imageHeight = photo.height || previewImage.naturalHeight;
    if (!width || !height || !imageWidth || !imageHeight) return null;
    const fit = imageFit() === 'cover' ? Math.max : Math.min;
    const fitScale = fit(width / imageWidth, height / imageHeight);
    const renderedScale = rect.width / previewBox.offsetWidth;
    return {
      rect, width, height, fittedWidth: imageWidth * fitScale,
      fittedHeight: imageHeight * fitScale, renderedScale,
    };
  }
  // object-position and transform-origin share the same percentage. The
  // displayed offset is therefore (frame size - scaled photo size) * position.
  function axisTravel(size, fitted, zoom) {
    return size - fitted * displayScale(zoom);
  }
  function zoomTo(value, pointer = null) {
    const frame = getFrame();
    const zoom = clamp(value, 100, 250);
    if (zoom === frame.zoom) return;
    const size = frameGeometry();
    if (!size) {
      updateFrame({...frame, zoom});
      return;
    }
    const relativeScale = zoom / frame.zoom;
    const anchorX = pointer ? (pointer.clientX - size.rect.left) / size.renderedScale - previewBox.clientLeft : size.width / 2;
    const anchorY = pointer ? (pointer.clientY - size.rect.top) / size.renderedScale - previewBox.clientTop : size.height / 2;
    const anchored = (position, length, fitted, anchor) => {
      const nextTravel = axisTravel(length, fitted, zoom);
      if (Math.abs(nextTravel) < 1) return position;
      const initial = axisTravel(length, fitted, frame.zoom) * position / 100;
      const offset = anchor + (initial - anchor) * relativeScale;
      return clamp(offset / nextTravel * 100, 0, 100);
    };
    updateFrame({
      x: anchored(frame.x, size.width, size.fittedWidth, anchorX),
      y: anchored(frame.y, size.height, size.fittedHeight, anchorY),
      zoom,
    });
  }
  function panFrame(frame, size, dx, dy) {
    const move = (position, distance, travel) =>
      Math.abs(travel) < 1 ? position : clamp(position + distance / travel * 100, 0, 100);
    return {
      ...frame,
      x: move(frame.x, dx, axisTravel(size.width, size.fittedWidth, frame.zoom)),
      y: move(frame.y, dy, axisTravel(size.height, size.fittedHeight, frame.zoom)),
    };
  }
  $('studio-zoom').addEventListener('input', event => zoomTo(Number(event.target.value)));
  $('studio-zoom').addEventListener('change', event => {
    zoomTo(Number(event.target.value));
    commitFrame();
  });
  previewBox.addEventListener('wheel', event => {
    if (!(event.ctrlKey || event.metaKey) || previewImage.hidden || dragState || !event.deltaY) return;
    event.preventDefault();
    zoomTo(getFrame().zoom + Math.sign(-event.deltaY) * 5, event);
    clearTimeout(frameCommitTimer);
    frameCommitTimer = setTimeout(commitFrame, 180);
  }, {passive: false});
  const directions = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
  previewBox.addEventListener('keydown', event => {
    const direction = directions[event.key];
    const size = direction && frameGeometry();
    if (!size || dragState) return;
    event.preventDefault();
    const step = event.shiftKey ? 16 : 4;
    updateFrame(panFrame(getFrame(), size, direction[0] * step, direction[1] * step));
    clearTimeout(frameCommitTimer);
    frameCommitTimer = setTimeout(commitFrame, 180);
  });
  previewBox.addEventListener('pointerdown', event => {
    if (event.button !== 0 || dragState) return;
    const size = frameGeometry();
    if (!size) return;
    commitFrame();
    dragState = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, size, frame: getFrame()};
    previewBox.classList.add('is-dragging');
    previewBox.focus({preventScroll: true});
    previewBox.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  previewBox.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const {size, startX, startY, frame} = dragState;
    const dx = (event.clientX - startX) / size.renderedScale;
    const dy = (event.clientY - startY) / size.renderedScale;
    if (!frameDraft && Math.hypot(dx, dy) < 2) return;
    updateFrame(panFrame(frame, size, dx, dy));
  });
  function endDrag() {
    const {pointerId} = dragState;
    dragState = null;
    previewBox.classList.remove('is-dragging');
    if (previewBox.hasPointerCapture?.(pointerId)) previewBox.releasePointerCapture(pointerId);
  }
  function cancelDrag() {
    if (!dragState) return;
    endDrag();
    frameDraft = null;
    paintFrame();
  }
  previewBox.addEventListener('pointerup', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    endDrag();
    if (frameDraft) {
      commitFrame();
      status('Đã lưu góc căn khung ảnh.');
    }
  });
  for (const eventName of ['pointercancel', 'lostpointercapture']) {
    previewBox.addEventListener(eventName, event => {
      if (event.pointerId === dragState?.pointerId) cancelDrag();
    });
  }
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
