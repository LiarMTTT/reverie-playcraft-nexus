(() => {
  'use strict';

  const STORE_KEY = 'mttt.portal.xingyue-floating.v1';
  const SAFE = 8;
  const DEFAULT_WIDTH = 430;
  const DEFAULT_HEIGHT = 640;
  const MIN_WIDTH = 280;
  const MIN_HEIGHT = 320;
  const RECOVERY_HEADER = 48;
  const MOBILE_QUERY = '(max-width: 768px), (pointer: coarse)';

  document.querySelectorAll('[data-xyf-root]').forEach(initFloatingDemo);

  function initFloatingDemo(root) {
    const surface = root.querySelector('[data-xyf-stage]');
    const panel = root.querySelector('[data-xyf-panel]');
    const dragHandle = root.querySelector('[data-xyf-drag]');
    const resizeHandle = root.querySelector('[data-xyf-resize]');
    const openButton = root.querySelector('[data-xyf-open]');
    const resetButton = root.querySelector('[data-xyf-reset]');
    const collapseButton = root.querySelector('[data-xyf-collapse]');
    const closeButton = root.querySelector('[data-xyf-close]');
    const tabBar = root.querySelector('[data-xyf-tabs]');
    const tabContent = root.querySelector('[data-xyf-tab-content]');
    const retryButton = root.querySelector('[data-xyf-retry]');
    const status = root.querySelector('[data-xyf-status]');
    const phaseButtons = [...root.querySelectorAll('[data-xyf-phase]')];
    const tabs = [...root.querySelectorAll('[data-xyf-tab]')];
    const panels = [...root.querySelectorAll('[data-xyf-tab-panel]')];
    const phaseLayers = [...root.querySelectorAll('[data-xyf-phase-layer]')];

    if (!surface || !panel || !dragHandle || !resizeHandle || !openButton || !resetButton
      || !collapseButton || !closeButton || !tabBar || !tabContent || !retryButton || !status) return;

    const mobileQuery = window.matchMedia(MOBILE_QUERY);
    let geometry = null;
    let pointerSession = null;
    let retryTimer = 0;
    let retryGeneration = 0;
    let initializedGeometry = false;
    let lastMessage = '';

    root.dataset.xyfReady = '1';
    root.dataset.shellState = panel.dataset.shellState || 'open';
    root.dataset.contentPhase = panel.dataset.contentPhase || 'ready';

    function announce(message) {
      if (!message || message === lastMessage) return;
      lastMessage = message;
      status.textContent = message;
    }

    function isPlayRoute() {
      return document.body.dataset.route === 'play' && !root.closest('[hidden]');
    }

    function isDesktopMode() {
      return !mobileQuery.matches;
    }

    function stageSize() {
      return {
        width: Math.max(0, surface.clientWidth),
        height: Math.max(0, surface.clientHeight),
      };
    }

    function sizeBounds(left = SAFE, top = SAFE) {
      const stage = stageSize();
      const maxWidth = Math.max(1, stage.width - left - SAFE);
      const maxHeight = Math.max(1, stage.height - top - SAFE);
      return {
        minWidth: Math.min(MIN_WIDTH, maxWidth),
        minHeight: Math.min(MIN_HEIGHT, maxHeight),
        maxWidth,
        maxHeight,
      };
    }

    function defaultGeometry() {
      const stage = stageSize();
      const initialBounds = sizeBounds(SAFE, SAFE);
      const width = Math.min(DEFAULT_WIDTH, initialBounds.maxWidth);
      const height = Math.min(DEFAULT_HEIGHT, initialBounds.maxHeight);
      return {
        x: Math.max(SAFE, Math.round((stage.width - width) / 2)),
        y: Math.max(SAFE, Math.round((stage.height - height) / 2)),
        width,
        height,
      };
    }

    function readStoredGeometry() {
      try {
        const value = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
        if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))) return null;
        return value;
      } catch {
        return null;
      }
    }

    function clampForRestore(input) {
      const stage = stageSize();
      const firstBounds = sizeBounds(SAFE, SAFE);
      const width = Math.min(Math.max(firstBounds.minWidth, Number(input.width)), firstBounds.maxWidth);
      const height = Math.min(Math.max(firstBounds.minHeight, Number(input.height)), firstBounds.maxHeight);
      return {
        x: Math.max(SAFE, Math.min(stage.width - width - SAFE, Number(input.x))),
        y: Math.max(SAFE, Math.min(stage.height - height - SAFE, Number(input.y))),
        width,
        height,
      };
    }

    function applyGeometry() {
      if (!geometry) return;
      panel.style.left = `${Math.round(geometry.x)}px`;
      panel.style.top = `${Math.round(geometry.y)}px`;
      panel.style.width = `${Math.round(geometry.width)}px`;
      panel.style.height = `${Math.round(geometry.height)}px`;
      panel.dataset.geometry = [geometry.x, geometry.y, geometry.width, geometry.height].map(Math.round).join(',');
    }

    function ensureGeometry(forceDefault = false) {
      const stage = stageSize();
      if (!stage.width || !stage.height) return false;
      if (!initializedGeometry || forceDefault) {
        geometry = clampForRestore(forceDefault ? defaultGeometry() : (readStoredGeometry() || defaultGeometry()));
        initializedGeometry = true;
      } else {
        geometry = clampForRestore(geometry);
      }
      applyGeometry();
      return true;
    }

    function saveGeometry() {
      if (!geometry) return false;
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          x: Math.round(geometry.x),
          y: Math.round(geometry.y),
          width: Math.round(geometry.width),
          height: Math.round(geometry.height),
        }));
        return true;
      } catch {
        announce('浏览器阻止了位置保存；本次调整仍然有效');
        return false;
      }
    }

    function setOpen(open, options = {}) {
      const { returnFocus = false, announceState = true } = options;
      const shouldOpen = Boolean(open) && isDesktopMode() && isPlayRoute();
      panel.dataset.shellState = shouldOpen ? 'open' : 'closed';
      panel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
      panel.inert = !shouldOpen;
      root.dataset.shellState = shouldOpen ? 'open' : 'closed';
      openButton.setAttribute('aria-pressed', shouldOpen ? 'true' : 'false');
      openButton.textContent = shouldOpen ? '收起浮窗' : '打开浮窗';
      if (shouldOpen) {
        requestAnimationFrame(() => {
          if (!ensureGeometry()) return;
          if (announceState) announce('桌面浮窗已打开；拖动标题区可移动，右下角可调整大小');
        });
      } else {
        cancelPointer();
        if (announceState) {
          announce(isDesktopMode() ? '桌面浮窗已收起' : '自动模式在窄屏或粗指针设备使用专题 01 的抽屉状态栏');
        }
        if (returnFocus && openButton.offsetParent !== null) openButton.focus({ preventScroll: true });
      }
    }

    function setCollapsed(collapsed) {
      const value = Boolean(collapsed);
      panel.dataset.collapsed = value ? 'true' : 'false';
      collapseButton.textContent = value ? 'OPEN' : 'CLOSE';
      collapseButton.setAttribute('aria-expanded', value ? 'false' : 'true');
      collapseButton.setAttribute('aria-label', value ? '展开状态栏正文' : '折叠状态栏正文');
      tabBar.inert = value || panel.dataset.contentPhase !== 'ready';
      tabContent.inert = value || panel.dataset.contentPhase !== 'ready';
      announce(value ? '正文已折叠；标题栏与关闭入口仍保留' : '正文已展开；原页签与窗口尺寸已恢复');
    }

    function setPhase(nextPhase, options = {}) {
      const phase = ['loading', 'ready', 'failed'].includes(nextPhase) ? nextPhase : 'ready';
      panel.dataset.contentPhase = phase;
      root.dataset.contentPhase = phase;
      const blocked = phase !== 'ready' || panel.dataset.collapsed === 'true';
      tabBar.inert = blocked;
      tabContent.inert = blocked;
      tabContent.setAttribute('aria-busy', phase === 'loading' ? 'true' : 'false');
      phaseButtons.forEach((button) => button.setAttribute('aria-pressed', button.dataset.xyfPhase === phase ? 'true' : 'false'));
      phaseLayers.forEach((layer) => layer.setAttribute('aria-hidden', layer.dataset.xyfPhaseLayer === phase ? 'false' : 'true'));
      if (options.silent) return;
      if (phase === 'loading') announce('正在演示状态栏加载中；门户保留头部动作，真实 3.4.9 此时真身头部尚未出现');
      if (phase === 'ready') announce('状态栏演示已就绪');
      if (phase === 'failed') announce('状态栏加载失败；真实 3.4.9 需要收起后再从入口打开以重试');
    }

    function setTab(id, focus = false) {
      const target = tabs.find((tab) => tab.dataset.xyfTab === id) || tabs[0];
      if (!target) return;
      tabs.forEach((tab) => {
        const selected = tab === target;
        tab.setAttribute('aria-selected', selected ? 'true' : 'false');
        tab.tabIndex = selected ? 0 : -1;
      });
      panels.forEach((tabPanel) => {
        const selected = tabPanel.dataset.xyfTabPanel === target.dataset.xyfTab;
        tabPanel.hidden = !selected;
      });
      if (focus) target.focus({ preventScroll: true });
      announce(`已切换到${target.textContent.trim()}页；演示只显示源码默认空状态`);
    }

    function cancelRetry() {
      retryGeneration += 1;
      window.clearTimeout(retryTimer);
      retryTimer = 0;
    }

    function retryDemo() {
      cancelRetry();
      const generation = retryGeneration;
      setPhase('loading');
      const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650;
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        if (generation !== retryGeneration || !isPlayRoute()) return;
        setPhase('ready');
        if (panel.dataset.shellState === 'open') {
          tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.focus({ preventScroll: true });
        }
      }, delay);
    }

    function startPointer(mode, event) {
      if (!isDesktopMode() || panel.dataset.shellState !== 'open') return;
      if (mode === 'resize' && panel.dataset.collapsed === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      ensureGeometry();
      pointerSession = {
        mode,
        pointerId: event.pointerId,
        target: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        base: { ...geometry },
      };
      panel.dataset.busy = 'true';
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
      announce(mode === 'move' ? '正在移动浮窗' : '正在调整浮窗大小');
    }

    function movePointer(event) {
      if (!pointerSession || event.pointerId !== pointerSession.pointerId) return;
      const stage = stageSize();
      const dx = event.clientX - pointerSession.startX;
      const dy = event.clientY - pointerSession.startY;
      if (pointerSession.mode === 'move') {
        const maxX = Math.max(SAFE, stage.width - pointerSession.base.width - SAFE);
        const maxY = Math.max(SAFE, stage.height - RECOVERY_HEADER);
        geometry.x = Math.max(SAFE, Math.min(maxX, pointerSession.base.x + dx));
        geometry.y = Math.max(SAFE, Math.min(maxY, pointerSession.base.y + dy));
      } else {
        const bounds = sizeBounds(pointerSession.base.x, pointerSession.base.y);
        geometry.width = Math.max(bounds.minWidth, Math.min(bounds.maxWidth, pointerSession.base.width + dx));
        geometry.height = Math.max(bounds.minHeight, Math.min(bounds.maxHeight, pointerSession.base.height + dy));
      }
      applyGeometry();
    }

    function finishPointer(event) {
      if (!pointerSession || (event && event.pointerId !== pointerSession.pointerId)) return;
      const finishedMode = pointerSession.mode;
      try {
        if (pointerSession.target.hasPointerCapture(pointerSession.pointerId)) {
          pointerSession.target.releasePointerCapture(pointerSession.pointerId);
        }
      } catch {}
      pointerSession = null;
      panel.dataset.busy = 'false';
      if (!geometry) return;
      const saved = saveGeometry();
      announce(finishedMode === 'move'
        ? `${saved ? '位置已保存' : '位置已调整但未持久化'}：x ${Math.round(geometry.x)}，y ${Math.round(geometry.y)}`
        : `${saved ? '尺寸已保存' : '尺寸已调整但未持久化'}：${Math.round(geometry.width)} × ${Math.round(geometry.height)}`);
    }

    function cancelPointer() {
      if (!pointerSession) {
        panel.dataset.busy = 'false';
        return;
      }
      try {
        if (pointerSession.target.hasPointerCapture(pointerSession.pointerId)) {
          pointerSession.target.releasePointerCapture(pointerSession.pointerId);
        }
      } catch {}
      pointerSession = null;
      panel.dataset.busy = 'false';
    }

    function keyboardMove(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (!ensureGeometry()) return;
      const step = event.shiftKey ? 24 : 8;
      const stage = stageSize();
      if (event.key === 'ArrowLeft') geometry.x -= step;
      if (event.key === 'ArrowRight') geometry.x += step;
      if (event.key === 'ArrowUp') geometry.y -= step;
      if (event.key === 'ArrowDown') geometry.y += step;
      geometry.x = Math.max(SAFE, Math.min(stage.width - geometry.width - SAFE, geometry.x));
      geometry.y = Math.max(SAFE, Math.min(stage.height - RECOVERY_HEADER, geometry.y));
      applyGeometry();
      const saved = saveGeometry();
      announce(`无障碍预览增强：浮窗位置 x ${Math.round(geometry.x)}，y ${Math.round(geometry.y)}${saved ? '' : '；本次未持久化'}`);
    }

    function keyboardResize(event) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (!ensureGeometry()) return;
      const step = event.shiftKey ? 24 : 8;
      const bounds = sizeBounds(geometry.x, geometry.y);
      if (event.key === 'ArrowLeft') geometry.width -= step;
      if (event.key === 'ArrowRight') geometry.width += step;
      if (event.key === 'ArrowUp') geometry.height -= step;
      if (event.key === 'ArrowDown') geometry.height += step;
      geometry.width = Math.max(bounds.minWidth, Math.min(bounds.maxWidth, geometry.width));
      geometry.height = Math.max(bounds.minHeight, Math.min(bounds.maxHeight, geometry.height));
      applyGeometry();
      const saved = saveGeometry();
      announce(`无障碍预览增强：浮窗尺寸 ${Math.round(geometry.width)} × ${Math.round(geometry.height)}${saved ? '' : '；本次未持久化'}`);
    }

    function resetDemo() {
      cancelPointer();
      cancelRetry();
      try { localStorage.removeItem(STORE_KEY); } catch {}
      initializedGeometry = false;
      setCollapsed(false);
      setPhase('ready', { silent: true });
      setTab('env');
      ensureGeometry(true);
      setOpen(true, { announceState: false });
      announce('样机已重置：430 × 640，居中，环境页，就绪状态');
    }

    openButton.addEventListener('click', () => {
      if (!isDesktopMode()) {
        setOpen(false);
        return;
      }
      const opening = panel.dataset.shellState !== 'open';
      setOpen(opening, { returnFocus: !opening });
      if (opening && panel.dataset.contentPhase === 'failed') retryDemo();
    });
    resetButton.addEventListener('click', resetDemo);
    closeButton.addEventListener('click', () => setOpen(false, { returnFocus: true }));
    collapseButton.addEventListener('click', () => setCollapsed(panel.dataset.collapsed !== 'true'));
    retryButton.addEventListener('click', retryDemo);

    phaseButtons.forEach((button) => {
      button.addEventListener('click', () => {
        cancelRetry();
        setPhase(button.dataset.xyfPhase);
      });
    });

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => setTab(tab.dataset.xyfTab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = tabs.length - 1;
        setTab(tabs[nextIndex].dataset.xyfTab, true);
      });
    });

    dragHandle.addEventListener('pointerdown', (event) => startPointer('move', event));
    dragHandle.addEventListener('pointermove', movePointer);
    dragHandle.addEventListener('pointerup', finishPointer);
    dragHandle.addEventListener('pointercancel', finishPointer);
    dragHandle.addEventListener('keydown', keyboardMove);

    resizeHandle.addEventListener('pointerdown', (event) => startPointer('resize', event));
    resizeHandle.addEventListener('pointermove', movePointer);
    resizeHandle.addEventListener('pointerup', finishPointer);
    resizeHandle.addEventListener('pointercancel', finishPointer);
    resizeHandle.addEventListener('keydown', keyboardResize);

    // Keep the demo robust when a browser automation layer or embedded preview
    // does not preserve pointer capture after the cursor leaves the small handle.
    window.addEventListener('pointermove', movePointer, true);
    window.addEventListener('pointerup', finishPointer, true);
    window.addEventListener('pointercancel', finishPointer, true);

    root.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.key !== 'Escape' || panel.dataset.shellState !== 'open') return;
      event.preventDefault();
      setOpen(false, { returnFocus: true });
      announce('无障碍预览增强：已用 Escape 收起浮窗；真实 3.4.9 不提供此快捷键');
    });

    window.addEventListener('portal:routechange', (event) => {
      cancelPointer();
      const retryWasPending = Boolean(retryTimer);
      cancelRetry();
      if (event.detail?.route !== 'play') {
        if (panel.dataset.contentPhase === 'loading') setPhase(retryWasPending ? 'failed' : 'ready', { silent: true });
        setOpen(false, { announceState: false });
        return;
      }
      requestAnimationFrame(() => {
        ensureGeometry();
        if (!isDesktopMode()) setOpen(false);
      });
    });

    const onModeChange = () => {
      cancelPointer();
      if (!isDesktopMode()) {
        const retryWasPending = Boolean(retryTimer);
        cancelRetry();
        if (panel.dataset.contentPhase === 'loading') setPhase(retryWasPending ? 'failed' : 'ready', { silent: true });
        setOpen(false);
      } else if (isPlayRoute()) {
        ensureGeometry();
        announce('桌面模式可用；可点击“打开浮窗”体验');
      }
    };
    try { mobileQuery.addEventListener('change', onModeChange); } catch { mobileQuery.addListener(onModeChange); }

    const observer = new ResizeObserver(() => {
      if (!isPlayRoute() || !isDesktopMode() || pointerSession) return;
      requestAnimationFrame(() => ensureGeometry());
    });
    observer.observe(surface);

    setTab(tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.dataset.xyfTab || 'env');
    setPhase(panel.dataset.contentPhase || 'ready', { silent: true });
    if (isPlayRoute() && isDesktopMode()) {
      requestAnimationFrame(() => {
        ensureGeometry();
        setOpen(panel.dataset.shellState !== 'closed', { announceState: false });
        announce('浮窗样机已就绪；真实状态数据未连接');
      });
    } else {
      setOpen(false, { announceState: false });
    }
  }
})();
