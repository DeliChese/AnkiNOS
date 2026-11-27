/* AnkiNOS layouts: six structural UIs chosen by #nos-app[data-layout]. State lives in dashboard settings. */
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
    {id: 'edges', name: '4 Cạnh (Ảnh nền)', desc: '4 dock macOS ẩn ở 4 cạnh, khoe trọn ảnh nền'},
  ];
  const ids = LAYOUTS.map(layout => layout.id);
  const normalize = id => ids.includes(id) ? id : ids[0];
  const current = () => normalize(app.dataset.layout);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = matchMedia('(min-width: 721px)');
  const motionOff = () => app.classList.contains('reduce-motion') || app.classList.contains('lite-mode') ||
    (app.dataset.animations !== 'on' && reducedMotion.matches);
  const thumb = id => `<span class="nos-lthumb" data-l="${id}" aria-hidden="true"><b></b><b></b><b></b><b></b><b></b></span>`;

  const spotlight = app.querySelector('.nos-spotlight');
  const rail = app.querySelector('.rail');
  const railMain = rail.querySelector('.rail-main');
  const railBottom = rail.querySelector('.rail-bottom');
  const topbarActions = app.querySelector('.topbar-actions');
  const topbarDivider = topbarActions?.querySelector('.topbar-divider') || null;
  const elasticPath = rail.querySelector('.rail-elastic-path');
  const dockItems = Array.from(rail.querySelectorAll('.brand,.rail-button,.launcher-button'));

  // 4-Edge hidden macOS docks (active only in data-layout="edges" on desktop).
  const edgeDocks = {
    top: $('nos-edge-top'),
    bottom: rail,
    left: $('nos-edge-left'),
    right: $('nos-edge-right'),
  };
  const edgeHandles = {
    top: app.querySelector('.nos-edge-handle[data-edge="top"]'),
    bottom: app.querySelector('.nos-edge-handle[data-edge="bottom"]'),
    left: app.querySelector('.nos-edge-handle[data-edge="left"]'),
    right: app.querySelector('.nos-edge-handle[data-edge="right"]'),
  };
  const notebookBtn = $('study-notebook');
  const launcherBtn = $('launcher-toggle');
  const prefsBtn = railBottom?.querySelector('[data-action="preferences"]') || null;
  const layoutBtn = $('layout-toggle');
  const fullscreenBtn = $('fullscreen-toggle');
  const profileBtn = $('profile-toggle');
  let edgesMounted = false;
  let openEdge = null;
  let edgeCloseTimer = 0;

  function getEdgeItems(edge) {
    const dock = edgeDocks[edge];
    if (!dock) return [];
    if (edge === 'bottom') return Array.from(railMain.querySelectorAll(':scope > button'));
    return Array.from(dock.querySelectorAll(':scope > button'));
  }

  function closeEdgeDock(immediate = false) {
    if (edgeCloseTimer) { clearTimeout(edgeCloseTimer); edgeCloseTimer = 0; }
    if (!openEdge) return;
    const prev = openEdge;
    openEdge = null;
    edgeDocks[prev]?.classList.remove('is-open');
    edgeHandles[prev]?.classList.remove('is-active');
    if (immediate) clearEdgeMagnify(prev);
    else settleEdgeMagnify(prev);
  }

  function openEdgeDock(edge) {
    if (!edge || !edgeDocks[edge]) return;
    if (edgeCloseTimer) { clearTimeout(edgeCloseTimer); edgeCloseTimer = 0; }
    if (openEdge && openEdge !== edge) {
      edgeDocks[openEdge]?.classList.remove('is-open');
      edgeHandles[openEdge]?.classList.remove('is-active');
      clearEdgeMagnify(openEdge);
    }
    openEdge = edge;
    edgeDocks[edge].classList.add('is-open');
    edgeHandles[edge]?.classList.add('is-active');
  }

  function scheduleEdgeClose(edge) {
    if (edgeCloseTimer) clearTimeout(edgeCloseTimer);
    edgeCloseTimer = setTimeout(() => {
      edgeCloseTimer = 0;
      if (openEdge === edge && !isEdgePinned(edge)) closeEdgeDock(false);
    }, 150);
  }

  function isEdgePinned(edge) {
    const dock = edgeDocks[edge];
    if (dock && dock.contains(document.activeElement) && document.activeElement !== document.body) return true;
    if (edge === 'right' && (!$('layout-menu').hidden || !$('profile-panel').hidden)) return true;
    if (edge === 'left' && !$('launcher').hidden) return true;
    return false;
  }

  function syncEdgeDocks() {
    const shouldMount = current() === 'edges' && desktop.matches;
    for (const edge of ['top', 'left', 'right']) {
      if (edgeDocks[edge]) edgeDocks[edge].hidden = !shouldMount;
    }
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      if (edgeHandles[edge]) edgeHandles[edge].hidden = !shouldMount;
    }
    if (shouldMount && !edgesMounted) {
      // Distribute real controls cleanly across the 4 docks (strictly <= 4 per dock).
      if (fullscreenBtn && edgeDocks.top) {
        const peekBtn = $('edge-peek-toggle');
        edgeDocks.top.insertBefore(fullscreenBtn, peekBtn || null);
      }
      if (notebookBtn && edgeDocks.left) edgeDocks.left.prepend(notebookBtn);
      if (launcherBtn && edgeDocks.left) edgeDocks.left.append(launcherBtn);
      if (profileBtn && edgeDocks.right) edgeDocks.right.prepend(profileBtn);
      if (layoutBtn && edgeDocks.right) edgeDocks.right.insertBefore(layoutBtn, profileBtn?.nextSibling || null);
      if (prefsBtn && edgeDocks.right) edgeDocks.right.append(prefsBtn);
      edgesMounted = true;
      closeEdgeDock(true);
    } else if (!shouldMount && edgesMounted) {
      closeEdgeDock(true);
      if (notebookBtn && railMain) railMain.append(notebookBtn);
      if (prefsBtn && railBottom) railBottom.prepend(prefsBtn);
      if (launcherBtn && railBottom) railBottom.append(launcherBtn);
      if (topbarActions) {
        if (layoutBtn) topbarActions.insertBefore(layoutBtn, topbarDivider || null);
        if (fullscreenBtn) topbarActions.insertBefore(fullscreenBtn, topbarDivider || null);
        if (profileBtn) topbarActions.append(profileBtn);
      }
      delete app.dataset.edgesPeek;
      const peekBtn = $('edge-peek-toggle');
      if (peekBtn) peekBtn.setAttribute('aria-pressed', 'false');
      edgesMounted = false;
    }
  }

  const menu = $('layout-menu');
  const toggle = $('layout-toggle');
  const grid = $('layout-grid');
  menu.innerHTML = `<div class="nos-layout-menu-head" aria-hidden="true"><strong>Bố cục giao diện</strong><kbd>Alt + Shift + L</kbd></div>
    <div class="nos-layout-options" role="presentation">${LAYOUTS.map(layout => `<button type="button" class="nos-layout-option" role="menuitemradio" tabindex="-1" aria-checked="false" data-action="set_layout" data-layout-id="${layout.id}">${thumb(layout.id)}<span><strong>${layout.name}</strong><small>${layout.desc}</small></span><span class="nos-layout-check" aria-hidden="true"></span></button>`).join('')}</div>
    <div class="nos-layout-side-row"><span>Vị trí sidebar<small>Cực quang · Không gian làm việc</small></span><div class="sidebar-side-buttons" role="group" aria-label="Vị trí sidebar"><button type="button" class="side-btn" data-sidebar-side="left" aria-pressed="true">Trái</button><button type="button" class="side-btn" data-sidebar-side="right" aria-pressed="false">Phải</button></div></div>`;
  grid.innerHTML = LAYOUTS.map(layout => `<button type="button" class="nos-layout-card" aria-pressed="false" data-action="set_layout" data-layout-card="${layout.id}">${thumb(layout.id)}<strong>${layout.name}</strong><small>${layout.desc}</small></button>`).join('');
  const menuItems = Array.from(menu.querySelectorAll('[data-layout-id]'));
  const menuSideRow = menu.querySelector('.nos-layout-side-row');
  const menuSideButtons = Array.from(menu.querySelectorAll('[data-sidebar-side]'));
  const cards = grid.querySelectorAll('[data-layout-card]');

  function syncMenu() {
    const active = current();
    const side = app.dataset.sidebarSide === 'right' ? 'right' : 'left';
    menuItems.forEach(button => button.setAttribute('aria-checked', String(button.dataset.layoutId === active)));
    menuSideRow?.classList.toggle('is-inactive', active !== 'aurora' && active !== 'sidebar');
    menuSideButtons.forEach(button => {
      const selected = button.dataset.sidebarSide === side;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
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
    syncEdgeDocks();
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
    transition.ready.catch(() => {});
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
    const isRightVertical = (current() === 'zen' || current() === 'edges') && desktop.matches;
    const preferredLeft = isRightVertical ? (rect.left / zoom - width - 12) : (rect.right / zoom - width);
    const preferredTop = isRightVertical ? Math.max(12, rect.top / zoom - 24) : (rect.bottom / zoom + 10);
    const left = Math.max(12, Math.min(viewportWidth - width - 12, preferredLeft));
    const top = Math.max(12, Math.min(preferredTop, viewportHeight - menu.offsetHeight - 12));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function focusMenu() {
    if (current() === 'edges' && desktop.matches) openEdgeDock('right');
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

  // Elastic SVG edge wave for Aurora floating sidebar.
  let elasticFrame = 0;
  const smallElastic = t => {
    const ts = t * t, tc = ts * t;
    return 33 * tc * ts - 106 * ts * ts + 126 * tc - 67 * ts + 15 * t;
  };
  function resetElasticPath() {
    if (elasticFrame) { cancelAnimationFrame(elasticFrame); elasticFrame = 0; }
    if (elasticPath) elasticPath.setAttribute('d', 'M0,0 L0,500 Q0,250 0,0 Z');
  }
  function pulseElasticSidebar(opening) {
    if (!elasticPath || !desktop.matches || current() !== 'aurora' || motionOff()) {
      resetElasticPath();
      return;
    }
    if (elasticFrame) cancelAnimationFrame(elasticFrame);
    const duration = opening ? 540 : 420;
    const peak = opening ? 28 : 16;
    const start = performance.now();
    const step = now => {
      const p = Math.min(1, (now - start) / duration);
      const envelope = Math.sin(p * Math.PI);
      const spring = opening ? (1 - smallElastic(p) * 0.45) : (1 - p * 0.5);
      const bulge = Math.max(0, peak * envelope * spring);
      elasticPath.setAttribute('d', `M0,0 L0,500 Q${bulge.toFixed(2)},250 0,0 Z`);
      if (p < 1) elasticFrame = requestAnimationFrame(step);
      else {
        elasticFrame = 0;
        elasticPath.setAttribute('d', 'M0,0 L0,500 Q0,250 0,0 Z');
      }
    };
    elasticFrame = requestAnimationFrame(step);
  }

  // Spring magnification engine shared by Dock layout and all 4 hidden Edge Docks.
  let pointerX = 0, pointerY = 0, pointerTarget = null, pointerFrame = 0, tilted = null;
  const dockCur = dockItems.map(() => 1);
  const dockTarget = dockItems.map(() => 1);
  let dockFrame = 0, dockLastTs = 0, dockRestCenters = null;

  const edgeSpring = {edge: null, items: [], cur: [], target: [], centers: null, frame: 0, lastTs: 0};

  function clearEdgeMagnify(edge) {
    if (edgeSpring.frame) { cancelAnimationFrame(edgeSpring.frame); edgeSpring.frame = 0; }
    const items = edge ? getEdgeItems(edge) : edgeSpring.items;
    for (const node of items) node.style.removeProperty('--mag');
    if (!edge || edgeSpring.edge === edge) {
      edgeSpring.edge = null;
      edgeSpring.items = [];
      edgeSpring.cur = [];
      edgeSpring.target = [];
      edgeSpring.centers = null;
      edgeSpring.lastTs = 0;
    }
  }

  function settleEdgeMagnify(edge) {
    if (motionOff() || edgeSpring.edge !== edge) { clearEdgeMagnify(edge); return; }
    let anyActive = false;
    for (let i = 0; i < edgeSpring.target.length; i++) {
      edgeSpring.target[i] = 1;
      if (edgeSpring.cur[i] > 1.002) anyActive = true;
    }
    if (anyActive) ensureEdgeSpring();
    else clearEdgeMagnify(edge);
  }

  function edgeSpringStep(ts) {
    edgeSpring.frame = 0;
    if (motionOff() || !desktop.matches || current() !== 'edges' || !edgeSpring.items.length) {
      clearEdgeMagnify();
      return;
    }
    const dt = Math.min(0.05, edgeSpring.lastTs ? (ts - edgeSpring.lastTs) / 1000 : 1 / 60);
    edgeSpring.lastTs = ts;
    const alpha = 1 - Math.exp(-16 * dt);
    let moving = false;
    let allRest = true;
    for (let i = 0; i < edgeSpring.items.length; i++) {
      const diff = edgeSpring.target[i] - edgeSpring.cur[i];
      if (Math.abs(diff) > 0.002) {
        edgeSpring.cur[i] += diff * alpha;
        moving = true;
      } else {
        edgeSpring.cur[i] = edgeSpring.target[i];
      }
      if (edgeSpring.cur[i] > 1.002) {
        allRest = false;
        edgeSpring.items[i].style.setProperty('--mag', edgeSpring.cur[i].toFixed(3));
      } else {
        edgeSpring.items[i].style.removeProperty('--mag');
      }
    }
    if (moving) edgeSpring.frame = requestAnimationFrame(edgeSpringStep);
    else {
      edgeSpring.lastTs = 0;
      if (allRest) edgeSpring.centers = null;
    }
  }

  function ensureEdgeSpring() {
    if (!edgeSpring.frame) {
      edgeSpring.lastTs = 0;
      edgeSpring.frame = requestAnimationFrame(edgeSpringStep);
    }
  }

  function updateEdgeMagnify(edge) {
    if (motionOff() || !edge || current() !== 'edges' || !desktop.matches) return;
    const dock = edgeDocks[edge];
    if (!dock || !dock.classList.contains('is-open')) return;
    const vertical = edge === 'left' || edge === 'right';
    const box = dock.getBoundingClientRect();
    const near = pointerX >= box.left - 44 && pointerX <= box.right + 44 &&
      pointerY >= box.top - 44 && pointerY <= box.bottom + 44;
    if (!near) {
      settleEdgeMagnify(edge);
      return;
    }
    const items = getEdgeItems(edge);
    if (edgeSpring.edge !== edge || edgeSpring.items.length !== items.length) {
      clearEdgeMagnify(edgeSpring.edge);
      edgeSpring.edge = edge;
      edgeSpring.items = items;
      edgeSpring.cur = items.map(() => 1);
      edgeSpring.target = items.map(() => 1);
      edgeSpring.centers = null;
    }
    if (!edgeSpring.centers) {
      edgeSpring.centers = items.map(node => {
        const rect = node.getBoundingClientRect();
        return vertical ? (rect.top + rect.height / 2) : (rect.left + rect.width / 2);
      });
    }
    const zoom = Number(app.style.zoom) || 1;
    const radius = 136 * zoom;
    const axis = vertical ? pointerY : pointerX;
    for (let i = 0; i < items.length; i++) {
      const dist = Math.min(radius, Math.abs(axis - edgeSpring.centers[i]));
      const cosineWave = (1 + Math.cos(Math.PI * dist / radius)) * 0.5;
      edgeSpring.target[i] = 1 + cosineWave * 0.46;
    }
    ensureEdgeSpring();
  }

  function clearDockImmediately() {
    if (dockFrame) { cancelAnimationFrame(dockFrame); dockFrame = 0; }
    dockLastTs = 0;
    dockRestCenters = null;
    for (let i = 0; i < dockItems.length; i++) {
      dockCur[i] = 1;
      dockTarget[i] = 1;
      dockItems[i].style.removeProperty('--mag');
    }
  }

  function settleDockSmoothly() {
    if (motionOff()) { clearDockImmediately(); return; }
    let anyActive = false;
    for (let i = 0; i < dockItems.length; i++) {
      dockTarget[i] = 1;
      if (dockCur[i] > 1.002) anyActive = true;
    }
    if (anyActive) ensureDockSpring();
    else clearDockImmediately();
  }

  function dockSpringStep(ts) {
    dockFrame = 0;
    if (motionOff() || !desktop.matches || current() !== 'dock') {
      clearDockImmediately();
      return;
    }
    const dt = Math.min(0.05, dockLastTs ? (ts - dockLastTs) / 1000 : 1 / 60);
    dockLastTs = ts;
    const alpha = 1 - Math.exp(-15 * dt);
    let moving = false;
    let allRest = true;
    for (let i = 0; i < dockItems.length; i++) {
      const diff = dockTarget[i] - dockCur[i];
      if (Math.abs(diff) > 0.002) {
        dockCur[i] += diff * alpha;
        moving = true;
      } else {
        dockCur[i] = dockTarget[i];
      }
      if (dockCur[i] > 1.002) {
        allRest = false;
        dockItems[i].style.setProperty('--mag', dockCur[i].toFixed(3));
      } else {
        dockItems[i].style.removeProperty('--mag');
      }
    }
    if (moving) {
      dockFrame = requestAnimationFrame(dockSpringStep);
    } else {
      dockLastTs = 0;
      if (allRest) dockRestCenters = null;
    }
  }

  function ensureDockSpring() {
    if (!dockFrame) {
      dockLastTs = 0;
      dockFrame = requestAnimationFrame(dockSpringStep);
    }
  }

  function resetPointerEffects() {
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    pointerTarget = null;
    app.classList.remove('nos-spot-on');
    clearDockImmediately();
    clearEdgeMagnify();
    resetElasticPath();
    if (tilted) tilted.style.removeProperty('transform');
    tilted = null;
  }

  function detectEdgeHover() {
    if (current() !== 'edges' || !desktop.matches) return;
    const edgePad = 30;
    const cornerPad = 36;
    // Keep currently open edge alive while cursor stays over its dock + comfortable halo.
    if (openEdge) {
      const dock = edgeDocks[openEdge];
      const box = dock?.getBoundingClientRect();
      const insideOpen = box &&
        pointerX >= box.left - 44 && pointerX <= box.right + 44 &&
        pointerY >= box.top - 44 && pointerY <= box.bottom + 44;
      if (insideOpen) {
        if (edgeCloseTimer) { clearTimeout(edgeCloseTimer); edgeCloseTimer = 0; }
        updateEdgeMagnify(openEdge);
        return;
      }
    }
    // Check if cursor entered one of the 4 edge trigger strips.
    let targetEdge = null;
    if (pointerY <= edgePad && pointerX > cornerPad && pointerX < innerWidth - cornerPad) targetEdge = 'top';
    else if (pointerY >= innerHeight - edgePad && pointerX > cornerPad && pointerX < innerWidth - cornerPad) targetEdge = 'bottom';
    else if (pointerX <= edgePad && pointerY > cornerPad && pointerY < innerHeight - cornerPad) targetEdge = 'left';
    else if (pointerX >= innerWidth - edgePad && pointerY > cornerPad && pointerY < innerHeight - cornerPad) targetEdge = 'right';
    if (targetEdge) {
      openEdgeDock(targetEdge);
      updateEdgeMagnify(targetEdge);
    } else if (openEdge && !isEdgePinned(openEdge)) {
      scheduleEdgeClose(openEdge);
      settleEdgeMagnify(openEdge);
    }
  }

  function pointerFrameTick() {
    pointerFrame = 0;
    const layout = current();
    if (layout === 'edges' && desktop.matches) {
      detectEdgeHover();
    }
    if (motionOff()) return;
    if (desktop.matches && layout === 'dock') {
      const box = rail.getBoundingClientRect();
      const near = pointerY > box.top - 76 && pointerY <= box.bottom + 24 && pointerX > box.left - 88 && pointerX < box.right + 88;
      if (near) {
        if (!dockRestCenters) {
          dockRestCenters = dockItems.map(node => {
            const rect = node.getBoundingClientRect();
            return rect.left + rect.width / 2;
          });
        }
        const zoom = Number(app.style.zoom) || 1;
        const radius = 152 * zoom;
        for (let i = 0; i < dockItems.length; i++) {
          const dist = Math.min(radius, Math.abs(pointerX - dockRestCenters[i]));
          const cosineWave = (1 + Math.cos(Math.PI * dist / radius)) * 0.5;
          dockTarget[i] = 1 + cosineWave * 0.56;
        }
        ensureDockSpring();
      } else {
        settleDockSmoothly();
      }
    }
    if (layout !== 'zen' && layout !== 'edges' && app.dataset.theme !== 'oled' && app.dataset.customBackground !== 'true') {
      const zoom = Number(app.style.zoom) || 1;
      spotlight.style.transform = `translate3d(${pointerX / zoom}px,${pointerY / zoom}px,0)`;
      app.classList.add('nos-spot-on');
    }
    const tiltNode = (layout === 'sidebar' || layout === 'edges') ? null : pointerTarget?.closest('.daily-goal,#nos-app[data-layout="bento"] .greeting > div');
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
    if (event.pointerType !== 'mouse') return;
    if (event.target.closest('dialog, #layout-menu')) {
      resetPointerEffects();
      return;
    }
    if (motionOff() && current() !== 'edges') return;
    pointerX = event.clientX; pointerY = event.clientY; pointerTarget = event.target;
    if (!pointerFrame) pointerFrame = requestAnimationFrame(pointerFrameTick);
  }, {passive: true});
  app.addEventListener('pointerleave', () => {
    if (pointerFrame) { cancelAnimationFrame(pointerFrame); pointerFrame = 0; }
    pointerTarget = null;
    app.classList.remove('nos-spot-on');
    settleDockSmoothly();
    if (openEdge && !isEdgePinned(openEdge)) scheduleEdgeClose(openEdge);
    if (tilted) { tilted.style.removeProperty('transform'); tilted = null; }
  });
  // Clicking/touching an edge handle opens its dock immediately (helpful for trackpad/touch users).
  for (const [edge, handle] of Object.entries(edgeHandles)) {
    handle?.addEventListener('pointerenter', () => { if (current() === 'edges' && desktop.matches) openEdgeDock(edge); });
    handle?.addEventListener('click', () => { if (current() === 'edges' && desktop.matches) openEdgeDock(edge); });
  }
  for (const [edge, dock] of Object.entries(edgeDocks)) {
    dock?.addEventListener('focusin', () => { if (current() === 'edges' && desktop.matches) openEdgeDock(edge); });
    dock?.addEventListener('focusout', event => {
      if (current() === 'edges' && desktop.matches && !dock.contains(event.relatedTarget) && !isEdgePinned(edge)) {
        scheduleEdgeClose(edge);
      }
    });
  }
  document.addEventListener('keyup', event => {
    if (event.key === 'Tab') rail.classList.toggle('nos-rail-kb', rail.contains(document.activeElement));
  });
  rail.addEventListener('focusout', event => {
    if (!rail.contains(event.relatedTarget)) rail.classList.remove('nos-rail-kb');
  });
  rail.addEventListener('pointerenter', () => pulseElasticSidebar(true));
  rail.addEventListener('pointerdown', () => rail.classList.remove('nos-rail-kb'));
  rail.addEventListener('pointerleave', () => {
    rail.classList.remove('nos-rail-kb');
    pulseElasticSidebar(false);
    if (current() === 'dock') settleDockSmoothly();
  });
  reducedMotion.addEventListener('change', changed);
  desktop.addEventListener('change', changed);
  addEventListener('resize', () => {
    syncEdgeDocks();
    resetPointerEffects();
    if (!menu.hidden) positionMenu();
  }, {passive: true});

  app.addEventListener('pointerdown', event => {
    if (event.button !== 0 || motionOff()) return;
    if ((current() === 'dock' || current() === 'edges') && desktop.matches) {
      const dockBtn = event.target.closest('.rail :is(.brand,.rail-button,.launcher-button), .nos-edge-dock > button');
      if (dockBtn && !dockBtn.disabled) {
        dockBtn.classList.remove('nos-dock-bouncing');
        void dockBtn.offsetWidth;
        dockBtn.classList.add('nos-dock-bouncing');
        setTimeout(() => dockBtn.classList.remove('nos-dock-bouncing'), 450);
        return;
      }
    }
    const button = event.target.closest('.primary-button,.subtle-button,.nos-layout-option,.nos-layout-card,.rail-button,.settings-nav-btn');
    if (!button || button.disabled) return;
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

  syncEdgeDocks();
  syncMenu();
  window.NOSLayout = {LAYOUTS, normalize, current, choose, cycle, sync, changed, enter, focusMenu, positionMenu, openEdgeDock, closeEdgeDock};
})();
