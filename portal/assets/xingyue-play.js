(function () {
  'use strict';

  const TUNE = Object.freeze({
    closeThreshold: 32,
    settleMs: 200,
    friction: 0.94,
    maxOvershoot: 40,
    rubberBand: 0.32,
    reboundMs: 260,
  });
  const HANDLE_MIN = 0.06;
  const HANDLE_MAX = 0.94;
  const HANDLE_EDGES = [0.12, 0.88];
  const HANDLE_SNAP_PULL = 0.12;
  const DRAG_THRESHOLD = 4;
  const AXIS_THRESHOLD = 6;
  const RETRY_DELAY_MS = 650;
  const VALID_PLACEMENTS = new Set(['top', 'bottom']);
  const VALID_PHASES = new Set(['ready', 'loading', 'failed']);
  const VALID_MOTIONS = new Set(['idle', 'dragging', 'flinging', 'settling', 'spring']);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
      return false;
    }
  }

  function initialDataValue(root, stage, drawer, key, allowed, fallback) {
    const nodes = [stage, drawer, root];
    for (const node of nodes) {
      const value = node && node.getAttribute('data-' + key);
      if (allowed.has(value)) return value;
    }
    return fallback;
  }

  function init() {
    const root = document.querySelector('[data-xyp-root]');
    if (!root || root.getAttribute('data-xyp-ready') === '1') return;

    const stage = root.querySelector('[data-xyp-stage]');
    const drawer = root.querySelector('[data-xyp-drawer]');
    const clip = root.querySelector('[data-xyp-drawer-clip]');
    const panel = root.querySelector('[data-xyp-drawer-panel]');
    const handle = root.querySelector('[data-xyp-drawer-handle]');
    if (!stage || !drawer || !clip || !panel || !handle) return;

    root.setAttribute('data-xyp-ready', '1');
    handle.style.touchAction = 'none';

    const placementControls = new Set(
      Array.from(root.querySelectorAll('[data-xyp-placement]')).filter((node) => node !== root && node !== stage && node !== drawer),
    );
    const phaseControls = new Set(
      Array.from(root.querySelectorAll('[data-xyp-phase]')).filter((node) => node !== root && node !== stage && node !== drawer),
    );
    const retryControls = new Set(root.querySelectorAll('[data-xyp-retry]'));
    const resetControls = new Set(root.querySelectorAll('[data-xyp-reset]'));
    const tabControls = new Set(root.querySelectorAll('[data-xyp-tab]'));
    const orderedTabs = Array.from(tabControls);
    const hudCollapseControls = new Set(root.querySelectorAll('[data-xyp-hud-collapse]'));
    const hudInteractionLayers = Array.from(root.querySelectorAll('.xyp-hud-tabs, .xyp-hud-content'));
    const tabPanels = Array.from(root.querySelectorAll('[data-xyp-panel]'));
    const stateLabels = Array.from(root.querySelectorAll('[data-xyp-state]'));
    const loadingLayers = Array.from(root.querySelectorAll('.xyp-phase-loading'));
    const failedLayers = Array.from(root.querySelectorAll('.xyp-phase-failed'));
    const controller = new AbortController();
    const listen = { signal: controller.signal };

    const state = {
      placement: initialDataValue(root, stage, drawer, 'placement', VALID_PLACEMENTS, 'top'),
      phase: initialDataValue(root, stage, drawer, 'phase', VALID_PHASES, 'ready'),
      motion: 'idle',
      openPx: 0,
      handleX: 0.5,
      collapsed: false,
      activeTab: 'env',
    };

    let animationFrame = 0;
    let retryTimer = 0;
    let drag = null;
    let suppressNextClick = false;
    let lastPanelHeight = 1;

    function panelHeight() {
      const rectHeight = Number(panel.getBoundingClientRect().height) || 0;
      const layoutHeight = Number(panel.offsetHeight) || 0;
      const viewportFallback = Math.min(Math.max(window.innerHeight * 0.76, 320), 680);
      const measuredBoxHeight = Math.max(rectHeight, layoutHeight);
      if (measuredBoxHeight > 1) return measuredBoxHeight;
      const contentFallback = Number(panel.scrollHeight) || 0;
      return Math.max(1, contentFallback > 1 ? contentFallback : viewportFallback);
    }

    function cancelMotion(resetState) {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      if (resetState !== false && state.motion !== 'idle') {
        state.motion = 'idle';
        render();
      }
    }

    function cancelRetry() {
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = 0;
    }

    function labelKey(maxOpen) {
      if (state.phase === 'loading') return 'loading';
      if (state.phase === 'failed') return 'failed';
      if (state.openPx <= 2) return 'closed';
      if (state.openPx >= maxOpen - 2) return 'open';
      return 'partial';
    }

    function syncTabs() {
      let hasRequestedTab = false;
      tabControls.forEach((tab) => {
        if (tab.getAttribute('data-xyp-tab') === state.activeTab) hasRequestedTab = true;
      });
      if (!hasRequestedTab && tabControls.size) {
        const firstTab = tabControls.values().next().value;
        state.activeTab = firstTab.getAttribute('data-xyp-tab') || 'env';
      }

      tabControls.forEach((tab) => {
        const active = tab.getAttribute('data-xyp-tab') === state.activeTab;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
      });
      tabPanels.forEach((tabPanel) => {
        const active = tabPanel.getAttribute('data-xyp-panel') === state.activeTab;
        tabPanel.classList.toggle('is-active', active);
        tabPanel.hidden = !active;
        tabPanel.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
    }

    function syncControls() {
      placementControls.forEach((control) => {
        const active = control.getAttribute('data-xyp-placement') === state.placement;
        control.classList.toggle('is-active', active);
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      phaseControls.forEach((control) => {
        const active = control.getAttribute('data-xyp-phase') === state.phase;
        control.classList.toggle('is-active', active);
        control.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      retryControls.forEach((control) => {
        if ('disabled' in control) control.disabled = state.phase !== 'failed';
        control.setAttribute('aria-disabled', state.phase === 'failed' ? 'false' : 'true');
      });
      hudCollapseControls.forEach((control) => {
        control.setAttribute('aria-expanded', state.collapsed ? 'false' : 'true');
        control.setAttribute('aria-label', state.collapsed ? '展开 HUD 内容' : '收起 HUD 内容');
        control.textContent = state.collapsed ? 'OPEN' : 'CLOSE';
      });
      hudInteractionLayers.forEach((layer) => layer.toggleAttribute('inert', state.phase !== 'ready'));
      loadingLayers.forEach((layer) => layer.setAttribute('aria-hidden', state.phase === 'loading' ? 'false' : 'true'));
      failedLayers.forEach((layer) => layer.setAttribute('aria-hidden', state.phase === 'failed' ? 'false' : 'true'));
    }

    function render() {
      stage.setAttribute('data-collapsed', state.collapsed ? 'true' : 'false');
      const maxOpen = panelHeight();
      lastPanelHeight = maxOpen;
      state.openPx = clamp(state.openPx, 0, maxOpen + TUNE.maxOvershoot);
      state.handleX = clamp(state.handleX, HANDLE_MIN, HANDLE_MAX);
      const isOpen = state.openPx > 2;

      stage.style.setProperty('--xyp-open-h', state.openPx.toFixed(2) + 'px');
      stage.style.setProperty('--xyp-handle-x', (state.handleX * 100).toFixed(2) + '%');
      stage.setAttribute('data-placement', state.placement);
      stage.setAttribute('data-phase', state.phase);
      stage.setAttribute('data-motion', VALID_MOTIONS.has(state.motion) ? state.motion : 'idle');
      stage.setAttribute('data-open', isOpen ? '1' : '0');
      handle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (!isOpen && panel.contains(document.activeElement)) {
        handle.focus({ preventScroll: true });
      }
      panel.toggleAttribute('inert', !isOpen);
      panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

      const key = labelKey(maxOpen);
      stateLabels.forEach((label) => {
        const nextText = label.getAttribute('data-label-' + key) || '';
        if (label.textContent !== nextText) label.textContent = nextText;
      });
      syncControls();
      syncTabs();
    }

    function setOpenPx(value, allowOvershoot) {
      const maxOpen = panelHeight();
      const high = allowOvershoot ? maxOpen + TUNE.maxOvershoot : maxOpen;
      state.openPx = clamp(value, 0, high);
      render();
    }

    function animateOpen(target, duration, easing, done, motion) {
      cancelMotion(false);
      state.motion = VALID_MOTIONS.has(motion) ? motion : 'settling';
      render();
      const maxOpen = panelHeight();
      const to = clamp(target, 0, maxOpen + TUNE.maxOvershoot);
      if (prefersReducedMotion() || duration <= 0 || Math.abs(to - state.openPx) < 0.5) {
        setOpenPx(to, to > maxOpen);
        state.motion = 'idle';
        render();
        if (typeof done === 'function') done();
        return;
      }

      const from = state.openPx;
      const start = performance.now();
      const ease = typeof easing === 'function' ? easing : (value) => value;
      const step = (now) => {
        const progress = clamp((now - start) / duration, 0, 1);
        const next = from + (to - from) * ease(progress);
        setOpenPx(next, to > maxOpen || next > maxOpen);
        if (progress < 1) {
          animationFrame = window.requestAnimationFrame(step);
          return;
        }
        animationFrame = 0;
        setOpenPx(to, to > maxOpen);
        state.motion = 'idle';
        render();
        if (typeof done === 'function') done();
      };
      animationFrame = window.requestAnimationFrame(step);
    }

    function settleOpen(target, duration) {
      animateOpen(target, duration, (value) => 1 - Math.pow(1 - value, 3), null, 'settling');
    }

    function reboundTo(target) {
      animateOpen(target, TUNE.reboundMs, (value) => {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
      }, null, 'spring');
    }

    function flingOpen(initialVelocity) {
      cancelMotion(false);
      state.motion = 'flinging';
      render();
      const maxOpen = panelHeight();

      if (prefersReducedMotion()) {
        const projected = state.openPx + initialVelocity * 160;
        const target = projected < TUNE.closeThreshold
          ? 0
          : (projected > maxOpen ? maxOpen : clamp(projected, 0, maxOpen));
        setOpenPx(target, false);
        state.motion = 'idle';
        render();
        return;
      }

      let velocity = initialVelocity;
      let height = state.openPx;
      let lastTime = performance.now();
      const step = (now) => {
        const elapsed = Math.min(34, now - lastTime);
        lastTime = now;
        velocity *= Math.pow(TUNE.friction, elapsed / 16.67);
        height += velocity * elapsed;

        if (height > maxOpen + 0.5) {
          const overshoot = maxOpen + Math.min(TUNE.maxOvershoot, (height - maxOpen) * TUNE.rubberBand);
          setOpenPx(overshoot, true);
          animationFrame = 0;
          reboundTo(maxOpen);
          return;
        }
        if (height <= 0) {
          animationFrame = 0;
          reboundTo(0);
          return;
        }

        setOpenPx(height, false);
        if (Math.abs(velocity) < 0.015) {
          animationFrame = 0;
          settleOpen(height < TUNE.closeThreshold ? 0 : Math.min(height, maxOpen), TUNE.settleMs);
          return;
        }
        animationFrame = window.requestAnimationFrame(step);
      };
      animationFrame = window.requestAnimationFrame(step);
    }

    function toggleDrawer() {
      const maxOpen = panelHeight();
      settleOpen(state.openPx > 2 ? 0 : maxOpen, TUNE.settleMs);
    }

    function snapHandle() {
      let target = state.handleX;
      for (const edge of HANDLE_EDGES) {
        if (Math.abs(edge - state.handleX) <= HANDLE_SNAP_PULL) {
          target = edge;
          break;
        }
      }
      state.handleX = clamp(target, HANDLE_MIN, HANDLE_MAX);
      state.motion = 'idle';
      render();
    }

    function setPhase(phase) {
      if (!VALID_PHASES.has(phase)) return;
      cancelMotion();
      cancelRetry();
      state.phase = phase;
      state.motion = 'idle';
      render();
    }

    function retryFailedPhase() {
      if (state.phase !== 'failed') return;
      cancelMotion();
      cancelRetry();
      if (document.activeElement && retryControls.has(document.activeElement)) {
        handle.focus({ preventScroll: true });
      }
      state.phase = 'loading';
      state.motion = 'idle';
      render();
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        state.phase = 'ready';
        state.motion = 'idle';
        render();
      }, RETRY_DELAY_MS);
    }

    function resetDemo() {
      cancelMotion();
      cancelRetry();
      state.placement = 'top';
      state.phase = 'ready';
      state.motion = 'idle';
      state.openPx = 0;
      state.handleX = 0.5;
      state.collapsed = false;
      state.activeTab = 'env';
      render();
    }

    function controlFromEvent(event, selector, controls) {
      const target = event.target instanceof Element ? event.target.closest(selector) : null;
      return target && controls.has(target) ? target : null;
    }

    root.addEventListener('click', (event) => {
      const placementControl = controlFromEvent(event, '[data-xyp-placement]', placementControls);
      if (placementControl) {
        const placement = placementControl.getAttribute('data-xyp-placement');
        if (VALID_PLACEMENTS.has(placement)) {
          cancelMotion();
          state.placement = placement;
          state.motion = 'idle';
          render();
        }
        return;
      }

      const phaseControl = controlFromEvent(event, '[data-xyp-phase]', phaseControls);
      if (phaseControl) {
        setPhase(phaseControl.getAttribute('data-xyp-phase'));
        return;
      }

      const retryControl = controlFromEvent(event, '[data-xyp-retry]', retryControls);
      if (retryControl) {
        retryFailedPhase();
        return;
      }

      const resetControl = controlFromEvent(event, '[data-xyp-reset]', resetControls);
      if (resetControl) {
        resetDemo();
        return;
      }

      const tabControl = controlFromEvent(event, '[data-xyp-tab]', tabControls);
      if (tabControl) {
        state.activeTab = tabControl.getAttribute('data-xyp-tab') || 'env';
        syncTabs();
        return;
      }

      const collapseControl = controlFromEvent(event, '[data-xyp-hud-collapse]', hudCollapseControls);
      if (collapseControl) {
        const wasOpen = state.openPx > 2;
        state.collapsed = !state.collapsed;
        stage.setAttribute('data-collapsed', state.collapsed ? 'true' : 'false');
        if (wasOpen) state.openPx = panelHeight();
        render();
      }
    }, listen);

    root.addEventListener('keydown', (event) => {
      const current = controlFromEvent(event, '[data-xyp-tab]', tabControls);
      if (!current || orderedTabs.length === 0) return;

      const currentIndex = orderedTabs.indexOf(current);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
      else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % orderedTabs.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = orderedTabs.length - 1;
      else return;

      event.preventDefault();
      const next = orderedTabs[nextIndex];
      state.activeTab = next.getAttribute('data-xyp-tab') || 'env';
      syncTabs();
      next.focus();
    }, listen);

    handle.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
      cancelMotion();
      suppressNextClick = false;
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startOpen: state.openPx,
        startHandleX: state.handleX,
        stageWidth: Math.max(1, stage.getBoundingClientRect().width),
        axis: null,
        moved: false,
        samples: [{ open: state.openPx, time: performance.now() }],
      };
      try {
        handle.setPointerCapture(event.pointerId);
      } catch (_) {}
    }, listen);

    handle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const rawDeltaY = event.clientY - drag.startY;
      if (Math.abs(deltaX) > DRAG_THRESHOLD || Math.abs(rawDeltaY) > DRAG_THRESHOLD) drag.moved = true;
      if (!drag.axis && (Math.abs(deltaX) > AXIS_THRESHOLD || Math.abs(rawDeltaY) > AXIS_THRESHOLD)) {
        drag.axis = Math.abs(rawDeltaY) >= Math.abs(deltaX) ? 'y' : 'x';
        state.motion = 'dragging';
        render();
      }

      if (drag.axis === 'y') {
        const direction = state.placement === 'bottom' ? -1 : 1;
        const maxOpen = panelHeight();
        let next = drag.startOpen + rawDeltaY * direction;
        if (next > maxOpen) next = maxOpen + Math.min(TUNE.maxOvershoot, (next - maxOpen) * TUNE.rubberBand);
        setOpenPx(next, true);
        drag.samples.push({ open: state.openPx, time: performance.now() });
        if (drag.samples.length > 6) drag.samples.shift();
        event.preventDefault();
      } else if (drag.axis === 'x') {
        state.handleX = clamp(drag.startHandleX + deltaX / drag.stageWidth, HANDLE_MIN, HANDLE_MAX);
        render();
        event.preventDefault();
      }
    }, listen);

    handle.addEventListener('pointerup', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const finished = drag;
      drag = null;
      try {
        handle.releasePointerCapture(event.pointerId);
      } catch (_) {}

      suppressNextClick = finished.moved;
      if (finished.axis === 'y') {
        let velocity = 0;
        if (finished.samples.length >= 2) {
          const first = finished.samples[0];
          const last = finished.samples[finished.samples.length - 1];
          const elapsed = last.time - first.time;
          if (elapsed > 4) velocity = (last.open - first.open) / elapsed;
        }
        flingOpen(velocity);
      } else if (finished.axis === 'x') {
        snapHandle();
      } else {
        state.motion = 'idle';
        render();
      }
    }, listen);

    handle.addEventListener('pointercancel', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const cancelled = drag;
      drag = null;
      suppressNextClick = true;
      state.handleX = cancelled.startHandleX;
      settleOpen(cancelled.startOpen, TUNE.settleMs);
    }, listen);

    handle.addEventListener('click', (event) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleDrawer();
    }, listen);

    handle.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();

      const maxOpen = panelHeight();
      const openStep = Math.max(48, maxOpen * 0.16);
      if (event.key === 'Home') {
        settleOpen(0, TUNE.settleMs);
        return;
      }
      if (event.key === 'End') {
        settleOpen(maxOpen, TUNE.settleMs);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        cancelMotion();
        state.handleX = clamp(
          state.handleX + (event.key === 'ArrowLeft' ? -0.08 : 0.08),
          HANDLE_MIN,
          HANDLE_MAX,
        );
        snapHandle();
        return;
      }

      const opening =
        (state.placement === 'top' && event.key === 'ArrowDown') ||
        (state.placement === 'bottom' && event.key === 'ArrowUp');
      settleOpen(clamp(state.openPx + (opening ? openStep : -openStep), 0, maxOpen), TUNE.settleMs);
    }, listen);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || state.openPx <= 2 || root.closest('[hidden]')) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      settleOpen(0, TUNE.settleMs);
    }, listen);

    window.addEventListener('resize', () => {
      cancelMotion();
      const nextHeight = panelHeight();
      const wasFullyOpen = state.openPx >= lastPanelHeight - 2;
      state.openPx = wasFullyOpen ? nextHeight : clamp(state.openPx, 0, nextHeight);
      state.handleX = clamp(state.handleX, HANDLE_MIN, HANDLE_MAX);
      lastPanelHeight = nextHeight;
      render();
    }, { passive: true, signal: controller.signal });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
