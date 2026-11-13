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
  const native = root.dataset.native === 'true';
  const ORIGINAL = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}\.(?:png|jpg|webp)$/;
  const PREVIEW = /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}-thumb\.png$/;
  const UUID = /^[0-9a-f]{32}$/;
  const TARGETS = {
    image_dashboard: 'Dashboard',
    image_overview: 'Chuẩn bị học',
    image_review: 'Lúc ôn tập',
    image_avatar: 'Avatar'
  };
  let selected = null, album = 'all', editing = null, pendingAlbumName = '';
  let searchText = '';
  let gallerySignature = '';
  let albumsSignature = '';
  let searchFrame = 0;
  const getData = () => window.AnkiNOS?.getSettings?.() || {};
  const photos = () => (getData().images || []).filter(p => p && UUID.test(p.id) && ORIGINAL.test(p.url || ''));
  const albums = () => (getData().image_albums || []).filter(a => a && UUID.test(a.id) && typeof a.name === 'string');
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
      button.append(create('span','',item.name),create('small','',String(item.count)));
      button.title = item.name;
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
      img.src = PREVIEW.test(photo.thumb_url || '') ? photo.thumb_url : photo.url;
      const caption = create('span','nos-studio-tile-caption');
      caption.append(create('strong','',photo.name));
      caption.append(create('small','',photo.width && photo.height ?
        photo.width + ' × ' + photo.height + ' px' : 'Ảnh gốc'));
      tile.append(img,caption);
      fragment.append(tile);
    }
    gallery.append(fragment);
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
      $('studio-image-meta').textContent = 'Ảnh nguyên gốc luôn vừa khung, không bị cắt hoặc kéo giãn.';
      return;
    }
    // Reassigning src on every settings event decodes the full image again.
    // The Studio inspector is intentionally small: decode the 480px thumbnail,
    // never a 24MP wallpaper on each click. Originals remain used by pages.
    const previewUrl = PREVIEW.test(image.thumb_url || '') ? image.thumb_url : image.url;
    if (preview.getAttribute('src') !== previewUrl) preview.src = previewUrl;
    preview.hidden = false;
    placeholder.hidden = true;
    const meta = [];
    if (image.width && image.height) meta.push(image.width + ' × ' + image.height + ' px');
    if (image.size) meta.push((image.size / 1024 / 1024).toFixed(2) + ' MB');
    meta.push(image.ext.toUpperCase().replace('.',''));
    $('studio-image-meta').textContent = meta.join(' · ') + ' · Không cắt';
    if (document.activeElement !== $('studio-image-name'))
      $('studio-image-name').value = image.name;
    const select = $('studio-image-album');
    const optionsKey = JSON.stringify(albums());
    if (select.dataset.optionsKey !== optionsKey) {
      select.replaceChildren(new Option('Chưa phân loại',''));
      for(const a of albums()) select.append(new Option(a.name,a.id));
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
  function open() {
    if (dialog.open) return;
    dialog.showModal();
    render();
    $('studio-search').value = searchText;
    $('studio-close').focus({preventScroll:true});
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
    if (dialog.open) render();
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
      if(!window.confirm('Xóa album này? Ảnh sẽ chuyển sang Chưa phân loại và không bị xóa.'))return;
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
    if (button.id === 'studio-rename') {renamePhoto();return;}
    if (button.id === 'studio-remove-image') {deletePhoto();return;}
    const slot=button.dataset.studioSlot;
    if (slot && Object.hasOwn(TARGETS,slot) && selected) {
      const value=getData()[slot] === selected ? null : selected;
      window.AnkiNOS?.studioUpdate?.({[slot]:value});
      command('image_assign',{slot,id:value});
      status(value ? 'Đã chọn ảnh cho '+TARGETS[slot]+'. Lưu tự động.' :
        'Đã trả '+TARGETS[slot]+' về nền mặc định.');
      render();
    }
  });
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
    if (!native && !window.confirm('Xóa ảnh khỏi thư viện?')) return;
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
  window.NOSStudio={open,close,sync,notice:message=>{if(dialog.open)status(message);}};
})();
