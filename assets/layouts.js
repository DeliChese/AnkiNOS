/* AnkiNOS layouts: switcher, layout morphs and ambient effects. State lives in dashboard settings. */
(function initializeNOSLayouts() {
  'use strict';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeNOSLayouts, {once: true});
    return;
  }
  const app = document.getElementById('nos-app');
  if (!app || window.NOSLayout) return;
  const $ = id => document.getElementById(id);
  const LAYOUTS = [
    {id: 'aurora', name: 'Cực quang', desc: 'Thanh dọc kính mờ, nền cực quang trôi chậm'},
    {id: 'bento', name: 'Bento', desc: 'Thanh điều hướng trên cùng, lưới ô module'},
    {id: 'dock', name: 'Dock nổi', desc: 'Sân khấu căn giữa, dock phóng to ở đáy'},
    {id: 'sidebar', name: 'Không gian làm việc', desc: 'Sidebar có nhãn, mục tiêu và bảng phụ'},
    {id: 'zen', name: 'Zen', desc: 'Tối giản, chữ lớn, tập trung vào phiên học'},
  ];
  const ids = LAYOUTS.map(layout => layout.id);
  const normalize = id => ids.includes(id) ? id : ids[0];
  const current = () => normalize(app.dataset.layout);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 721px)');
  const motionOff = () => app.classList.contains('reduce-motion') || app.classList.contains('lite-mode') ||
    reducedMotion.matches;
  const thumb = id => `<span class="nos-lthumb" data-l="${id}" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></span>`;

  const spotlight = app.querySelector('.nos-spotlight');
  const rail = app.querySelector('.rail');
  const dockItems = Array.from(rail.querySelectorAll('.brand,.rail-button,.launcher-button'));

  const menu = $('layout-menu');
  const toggle = $('layout-toggle');
  const grid = $('layout-grid');
  menu.innerHTML = `<div class="nos-layout-menu-head" aria-hidden="true"><strong>Bố cục giao diện</strong><kbd>Alt + Shift + L</kbd></div>
    <div class="nos-layout-options" role="presentation">${LAYOUTS.map(layout => `<button type="button" class="nos-layout-option" role="menuitemradio" tabindex="-1" aria-checked="false" data-action="set_layout" data-layout-id="${layout.id}">${thumb(layout.id)}<span><strong>${layout.name}</strong><small>${layout.desc}</small></span><span class="nos-layout-check" aria-hidden="true"></span></button>`).join('')}</div>`;
  grid.innerHTML = LAYOUTS.map(layout => `<button type="button" class="nos-layout-card" aria-pressed="false" data-action="set_layout" data-layout-card="${layout.id}">${thumb(layout.id)}<strong>${layout.name}</strong><small>${layout.desc}</small></button>`).join('');
  const menuItems = Array.from(menu.querySelectorAll('[data-layout-id]'));
  const cards = grid.querySelectorAll('[data-layout-card]');

  function syncMenu() {
    const active = current();
    menuItems.forEach(button => button.setAttribute('aria-checked', String(button.dataset.layoutId === active)));
  }

  function sync(settings) {
    const selected = normalize(settings?.layout);
    cards.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.layoutCard === selected)));
  }

  let enterTimer;
  function enter() {
    if (motionOff()) return;
    const targets = [rail, app.querySelector('.topbar'), app.querySelector('.greeting > div'), app.querySelector('.daily-goal'),
      $('study-launchpad'), $('activity-panel'), app.querySelector('.workspace-footer')].filter(Boolean);
    targets.forEach((node, index) => { node.style.setProperty('--i', String(index)); node.setAttribute('data-enter', ''); });
    if (app.classList.contains('nos-entering')) {
      app.classList.remove('nos-entering');
      void app.offsetWidth;
    }
    app.classList.add('nos-entering');
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => app.classList.remove('nos-entering'), 1600);
  }

  function changed() {
    syncMenu();
    resetPointerEffects();
    if (!menu.hidden) positionMenu();
    if (motionOff()) transition?.skipTransition();
  }

  let transition = null;
  let pendingLayout = null;

  function choose(id, commit) {
    const next = LAYOUTS.find(layout => layout.id === id);
    if (!next || id === (pendingLayout?.id ?? current())) return;
    if (transition) {
      // Apply the latest choice even if an older transition has yet to run its callback.
      pendingLayout = null;
      transition.skipTransition();
      commit(next);
      return;
    }
    if (motionOff() || typeof document.startViewTransition !== 'function') {
      commit(next);
      enter();
      return;
    }
    resetPointerEffects();
    pendingLayout = next;
    app.classList.add('nos-vt');
    transition = document.startViewTransition(() => {
      if (pendingLayout !== next) return;
      pendingLayout = null;
      commit(next);
    });
    const finish = () => {
      transition = pendingLayout = null;
      app.classList.remove('nos-vt');
    };
    transition.ready.catch(() => {}); // A newer choice may skip the transition.
    transition.finished.then(finish, finish);
  }

  function cycle(commit) {
    const index = ids.indexOf(pendingLayout?.id ?? current());
    choose(ids[(index + 1) % ids.length], commit);
  }

  function positionMenu() {
    const zoom = Number(app.style.zoom) || 1;
    const viewportWidth = innerWidth / zoom;
    const viewportHeight = innerHeight / zoom;
    const rect = toggle.getBoundingClientRect();
    const width = Math.min(340, viewportWidth - 24);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${viewportHeight - 24}px`;
    const left = Math.max(12, Math.min(viewportWidth - width - 12, rect.right / zoom - width));
    const top = Math.max(12, Math.min(rect.bottom / zoom + 10, viewportHeight - menu.offsetHeight - 12));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function focusMenu() {
    positionMenu();
    menuItems[ids.indexOf(current())].focus();
  }

  menu.addEventListener('keydown', event => {
    const index = menuItems.indexOf(document.activeElement);
    const count = menuItems.length;
    const next = {ArrowDown: (index + 1) % count, ArrowUp: (index - 1 + count) % count, Home: 0, End: count - 1}[event.key];
    if (typeof next !== 'number') return;
    event.preventDefault();
    menuItems[next].focus();
  });

  // Pointer effects share one rAF: cursor glow, dock magnification, 3D tilt.
  let pointerX = 0, pointerY = 0, pointerTarget = null, pointerFrame = 0, tilted = null, dockMagnified = false;
  function resetDock() {
    if (!dockMagnified) return;
    dockItems.forEach(node => node.style.removeProperty('--mag'));
    dockMagnified = false;
  }

  function resetPointerEffects() {
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    pointerTarget = null;
    app.classList.remove('nos-spot-on');
    resetDock();
    if (tilted) tilted.style.removeProperty('transform');
    tilted = null;
  }

  function pointerFrameTick() {
    pointerFrame = 0;
    if (motionOff()) return;
    const layout = current();
    if (desktop.matches && layout === 'dock') {
      const box = rail.getBoundingClientRect();
      const near = pointerY > box.top - 70 && pointerX > box.left - 80 && pointerX < box.right + 80;
      if (near) {
        // Measure the dock before writing any styles for this frame.
        const distance = dockItems.map(node => {
          const rect = node.getBoundingClientRect();
          return Math.abs(pointerX - (rect.left + rect.width / 2));
        });
        dockItems.forEach((node, index) => node.style.setProperty('--mag', (1 + Math.max(0, 1 - distance[index] / 160) * .42).toFixed(3)));
        dockMagnified = true;
      } else resetDock();
    }
    if (layout !== 'zen' && app.dataset.theme !== 'oled' && app.dataset.customBackground !== 'true') {
      const zoom = Number(app.style.zoom) || 1;
      spotlight.style.transform = `translate3d(${pointerX / zoom}px,${pointerY / zoom}px,0)`;
      app.classList.add('nos-spot-on');
    }
    const tiltNode = layout === 'sidebar' ? null : pointerTarget?.closest('.daily-goal,#nos-app[data-layout="bento"] .greeting > div');
    if (tilted && tilted !== tiltNode) { tilted.style.removeProperty('transform'); tilted = null; }
    if (tiltNode) {
      const box = tiltNode.getBoundingClientRect();
      const rx = ((pointerY - box.top) / box.height - .5) * -7;
      const ry = ((pointerX - box.left) / box.width - .5) * 9;
      tiltNode.style.transform = `perspective(800px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-2px)`;
      tilted = tiltNode;
    }
  }
  app.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || motionOff()) return;
    if (event.target.closest('dialog, #layout-menu')) {
      resetPointerEffects();
      return;
    }
    pointerX = event.clientX; pointerY = event.clientY; pointerTarget = event.target;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(pointerFrameTick);
  }, {passive: true});
  app.addEventListener('pointerleave', resetPointerEffects);
  reducedMotion.addEventListener('change', changed);
  addEventListener('resize', () => {
    resetPointerEffects();
    if (!menu.hidden) positionMenu();
  }, {passive: true});

  app.addEventListener('pointerdown', event => {
    const button = event.target.closest('.primary-button,.subtle-button,.nos-layout-option,.nos-layout-card');
    if (!button || button.disabled || event.button !== 0 || motionOff()) return;
    const box = button.getBoundingClientRect();
    const zoom = Number(app.style.zoom) || 1;
    const size = Math.max(box.width, box.height) * 2.4 / zoom;
    const ripple = document.createElement('span');
    ripple.className = 'nos-ripple';
    ripple.setAttribute('aria-hidden', 'true');
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${(event.clientX - box.left) / zoom}px;top:${(event.clientY - box.top) / zoom}px`;
    button.appendChild(ripple);
    setTimeout(() => ripple.remove(), 700);
  });

  window.NOSLayout = {normalize, sync, changed, choose, cycle, focusMenu};
  syncMenu();
})();
