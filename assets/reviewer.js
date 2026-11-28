(function initializeNOSReview() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNOSReview, {once: true});
    return;
  }
  const shell = document.getElementById('nos-review-shell');
  if (!shell || window.NOSReview) return;
  document.documentElement.classList.add('nos-review-page');
  const $ = id => document.getElementById(id);
  const tr = text => (window.NOSI18n ? window.NOSI18n.t(text) : text);
  const initial = JSON.parse($('nos-review-bootstrap')?.textContent || '{}');
  const initLang = initial.language || (typeof window.pycmd !== 'function' ? new URLSearchParams(location.search).get('lang') : '') || 'vi';
  const background = typeof initial.background === 'string' &&
    /^\/_addons\/[A-Za-z0-9_-]+\/user_files\/[0-9a-f]{20}\/[0-9a-f]{32}(?:-wall)?\.(?:png|jpg|webp)$/.test(initial.background) ? initial.background : '';
  shell.dataset.customBackground = background ? 'true' : 'false';
  {
    const int = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const blur = int(initial.wallpaper_blur, 0, 24, 0);
    const frame = initial.background_frame || {};
    const fx = int(frame.x, 0, 100, 50);
    const fy = int(frame.y, 0, 100, 50);
    const fz = int(frame.zoom, 100, 250, 100);
    const scale = (fz / 100) * (blur ? 1.06 : 1);
    shell.style.setProperty('--wall-fit', initial.background_fit === 'contain' ? 'contain' : 'cover');
    shell.style.setProperty('--wall-dim', String(int(initial.wallpaper_dim, 0, 80, 28) / 100));
    shell.style.setProperty('--wall-blur', blur + 'px');
    shell.style.setProperty('--wall-pos-x', fx + '%');
    shell.style.setProperty('--wall-pos-y', fy + '%');
    shell.style.setProperty('--wall-scale', scale.toFixed(3));
  }
  const wallpaperImage = shell.querySelector('.nos-review-wallpaper-image');
  if (wallpaperImage) {
    if (background) wallpaperImage.src = background;
    wallpaperImage.hidden = !background;
  }
  shell.dataset.side = 'question';
  shell.style.zoom = String(([85, 90, 100, 110, 120].includes(initial.ui_scale) ? initial.ui_scale : 100) / 100);
  shell.classList.toggle('lite-mode', !!initial.lite_mode);
  shell.classList.toggle('no-blur', initial.blur === false);
  const motionDisabled = initial.animations === false || !!initial.lite_mode;
  shell.classList.toggle('no-motion', motionDisabled);
  shell.dataset.animations = motionDisabled ? 'off' : 'on';

  $('nos-review-header').innerHTML = `<button data-nos-review="back" aria-label="Về danh sách bộ thẻ"><svg viewBox="0 0 24 24"><path d="m14 5-7 7 7 7M7 12h14"/></svg><span class="nos-back-label">Bộ thẻ</span></button><div id="nos-review-heading"><span id="nos-review-deck" data-i18n-skip></span><span id="nos-review-progress" data-i18n-skip></span></div><div id="nos-review-tools"><span id="nos-review-side" data-i18n-skip>Mặt trước</span><button data-nos-review="more" aria-label="Tùy chọn thẻ" title="Tùy chọn thẻ (M)">⋯</button></div>`;
  const notebookButton = document.createElement('button');
  notebookButton.type = 'button';
  notebookButton.textContent = 'Ghi chú';
  notebookButton.dataset.nosReview = 'notebook';
  notebookButton.title = 'Ghi chú cho note đang học';
  $('nos-review-tools').append(notebookButton);

  // Apply theme AFTER creating sibling chrome so tokens bind to header and wallpaper
  // without leaking --text or color-scheme into #nos-review-card / #qa.
  window.NOSTheme.watch(shell, () => initial, true);
  window.NOSI18n?.set(initLang);

  function renderDeckTitle() {
    const label = initial.deck || tr('Phiên ôn tập');
    $('nos-review-deck').textContent = label;
    $('nos-review-deck').title = label;
  }
  renderDeckTitle();

  const format = () => (window.NOSI18n ? window.NOSI18n.numberFormat() : new Intl.NumberFormat('vi-VN'));
  const card = $('nos-review-card');
  const cardAlpha = Number.isInteger(initial.reviewer_card_opacity) ? Math.min(100, Math.max(20, initial.reviewer_card_opacity)) : 100;
  if (card) card.dataset.translucent = cardAlpha < 100 ? 'true' : 'false';
  let lastState = {side: 'question', answered: initial.answered || 0};
  let frame = 0, lastBackground = '', lastImage = '';

  // Use Anki's own no-fade path, also used by its software renderer.
  window.qFade = 0;

  function syncCardStyleNow() {
    const style = getComputedStyle(document.body);
    const bg = style.backgroundColor === 'rgba(0, 0, 0, 0)' ? '' : style.backgroundColor;
    if (bg !== lastBackground) {
      if (bg) card.style.setProperty('--nos-card-base-bg', bg);
      else card.style.removeProperty('--nos-card-base-bg');
      lastBackground = bg;
    }
    if (style.backgroundImage !== lastImage) {
      card.style.backgroundImage = style.backgroundImage;
      lastImage = style.backgroundImage;
    }
  }

  function preserveCardStyle() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncCardStyleNow();
    });
  }

  let sideTimer = 0;
  function setState(value) {
    lastState = value;
    const changed = shell.dataset.side !== value.side;
    shell.dataset.side = value.side;
    const sidePill = $('nos-review-side');
    sidePill.textContent = tr(value.side === 'answer' ? 'Đáp án' : 'Mặt trước');
    if (changed && !shell.classList.contains('no-motion')) {
      sidePill.classList.remove('nos-side-pulse');
      void sidePill.offsetWidth;
      sidePill.classList.add('nos-side-pulse');
      clearTimeout(sideTimer);
      sideTimer = setTimeout(() => sidePill.classList.remove('nos-side-pulse'), 360);
    }
    const progress = tr(`Đã ôn ${format().format(value.answered || 0)} lượt trong phiên này`);
    if ($('nos-review-progress').textContent !== progress) $('nos-review-progress').textContent = progress;
    preserveCardStyle();
  }

  function setLanguage(lang) {
    window.NOSI18n?.set(lang);
  }

  window.NOSReview = {setState, setLanguage};
  syncCardStyleNow();
  setState({side: 'question', answered: initial.answered || 0});
  document.addEventListener('nos:language', () => {
    renderDeckTitle();
    setState(lastState);
  });

  // Watch only card replacements / body theme changes. MathJax, typing and
  // template scripts can mutate thousands of descendants without NOS work.
  const observer = new MutationObserver(preserveCardStyle);
  observer.observe($('qa'), {childList: true});
  observer.observe(document.body, {attributes: true, attributeFilter: ['class', 'style']});

  $('nos-review-header').addEventListener('click', event => {
    const action = event.target.closest('[data-nos-review]')?.dataset.nosReview;
    if (action && typeof window.pycmd === 'function') window.pycmd('nos-review:' + action);
  });
})();
