(() => {
  'use strict';

  const ORB_SIZE = 56;
  const DOCK_SNAP_PX = 24;
  const DOCK_PEEKS = Object.freeze({ half: 28, hidden: 10 });
  const STORAGE_KEY = 'mttt-xingyue-orb-preview-v1';
  const ACTION_DETAILS = Object.freeze({
    hud: {
      title: '状态栏',
      copy: '真实入口会按设备分流：窄屏或触屏打开抽屉，桌面打开悬浮 HUD。上方专题 01 展示的是移动抽屉分支。',
    },
    npc: {
      title: 'TA 的视角',
      copy: '真实功能读取当前楼的角色档案，再生成指定角色对本楼的视角；结果只缓存，不写入上下文。本页不生成虚构角色或内心文本。',
    },
    control: {
      title: '控制中心',
      copy: '真实入口会打开星月控制中心。本专题只确认入口职责，不在这里复制或杜撰控制中心设置。',
    },
    avatar: {
      title: '气泡头像',
      copy: '真实功能按当前聊天里的说话者名字绑定、换绑或清除气泡头像，并立即刷新聊天气泡；它不是角色卡头像管理器。',
    },
    map: {
      title: '地图 · 建设中',
      copy: '地图系统建设中，敬请期待。源码目前只有这条提示，本页不会伪造地图、地点、路线或完成进度。',
    },
  });
  const BUBBLE_TEXTS = Object.freeze({
    morning: '早安，今天也要元气满满哦。',
    noon: '中午了，记得好好吃饭呀。',
    afternoon: '下午的阳光正好，要不要歇口气？',
    evening: '天色暗下来了，今天过得还顺利吗？',
    night: '夜深了，别熬太晚，早点休息。',
  });

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function timeBucket() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour <= 10) return 'morning';
    if (hour >= 11 && hour <= 13) return 'noon';
    if (hour >= 14 && hour <= 17) return 'afternoon';
    if (hour >= 18 && hour <= 22) return 'evening';
    return 'night';
  }

  function createOrbRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const center = canvas.width / 2;
    const radius = 56;
    const particles = Array.from({ length: 46 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * radius;
      return {
        x: center + Math.cos(angle) * distance,
        y: center + Math.sin(angle) * distance,
        vx: (Math.random() * 2 - 1) * 0.3,
        vy: (Math.random() * 2 - 1) * 0.3,
        highlight: Math.random() < 0.2,
        phase: Math.random() * Math.PI * 2,
        tail: Math.random() < 0.35,
        lag: 0.32 + Math.random() * 0.58,
        sx: 0,
        sy: 0,
        svx: 0,
        svy: 0,
      };
    });
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let running = false;
    let last = 0;
    let dragEnergy = 0;
    let dragActive = false;

    function update(delta) {
      const step = Math.min(3, Math.max(0.25, delta / 16));
      dragEnergy *= Math.pow(dragActive ? 0.94 : 0.9, step);
      particles.forEach((particle) => {
        particle.phase += 0.025 * step;
        particle.x += particle.vx * step * (dragActive ? 2.2 : 1);
        particle.y += particle.vy * step * (dragActive ? 2.2 : 1);
        const dx = particle.x - center;
        const dy = particle.y - center;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance > radius - 1) {
          const nx = dx / distance;
          const ny = dy / distance;
          const dot = particle.vx * nx + particle.vy * ny;
          particle.vx -= 2 * dot * nx;
          particle.vy -= 2 * dot * ny;
          particle.x = center + nx * (radius - 1.5);
          particle.y = center + ny * (radius - 1.5);
        }
        if (particle.tail && (particle.sx || particle.sy || particle.svx || particle.svy)) {
          const spring = dragActive ? 0.028 : 0.072;
          const damping = dragActive ? 0.93 : 0.86;
          particle.svx = (particle.svx - spring * particle.sx * step) * damping;
          particle.svy = (particle.svy - spring * particle.sy * step) * damping;
          particle.sx += particle.svx * step;
          particle.sy += particle.svy * step;
          if (Math.abs(particle.sx) < 0.05 && Math.abs(particle.svx) < 0.05) {
            particle.sx = 0;
            particle.svx = 0;
          }
          if (Math.abs(particle.sy) < 0.05 && Math.abs(particle.svy) < 0.05) {
            particle.sy = 0;
            particle.svy = 0;
          }
        }
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const glow = ctx.createRadialGradient(center, center, 8, center, center, radius);
      glow.addColorStop(0, `rgba(75,228,255,${0.12 + dragEnergy * 0.08})`);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();

      const rendered = particles.map((particle) => ({
        ...particle,
        rx: particle.x + particle.sx,
        ry: particle.y + particle.sy,
      }));
      for (let i = 0; i < rendered.length; i += 1) {
        for (let j = i + 1; j < rendered.length; j += 1) {
          const distance = Math.hypot(rendered[i].rx - rendered[j].rx, rendered[i].ry - rendered[j].ry);
          if (distance > 33) continue;
          ctx.strokeStyle = `rgba(107,199,242,${((1 - distance / 33) * 0.58).toFixed(3)})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(rendered[i].rx, rendered[i].ry);
          ctx.lineTo(rendered[j].rx, rendered[j].ry);
          ctx.stroke();
        }
      }
      rendered.forEach((particle) => {
        const alpha = 0.58 + Math.sin(particle.phase) * 0.2;
        const size = particle.highlight ? 2.4 : 1.6;
        if (particle.highlight) {
          const pointGlow = ctx.createRadialGradient(particle.rx, particle.ry, 0, particle.rx, particle.ry, 9);
          pointGlow.addColorStop(0, `rgba(75,228,255,${Math.max(0.3, alpha)})`);
          pointGlow.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = pointGlow;
          ctx.beginPath();
          ctx.arc(particle.rx, particle.ry, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = particle.highlight ? `rgba(205,243,255,${alpha})` : `rgba(107,199,242,${alpha})`;
        ctx.beginPath();
        ctx.arc(particle.rx, particle.ry, size, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    function loop(now) {
      if (!running) return;
      update(last ? now - last : 16);
      last = now;
      draw();
      frame = window.requestAnimationFrame(loop);
    }

    function start() {
      if (motionQuery.matches) {
        stop();
        draw();
        return;
      }
      if (running) return;
      running = true;
      last = 0;
      frame = window.requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    }

    function nudge(dx, dy) {
      if (motionQuery.matches) return;
      dragEnergy = clamp(dragEnergy + Math.hypot(dx, dy) / 30, 0, 1);
      particles.forEach((particle) => {
        if (!particle.tail) return;
        particle.sx = clamp(particle.sx - dx * 2 * particle.lag * 0.9, -134, 134);
        particle.sy = clamp(particle.sy - dy * 2 * particle.lag * 0.9, -134, 134);
        particle.svx -= dx * 0.026 * particle.lag;
        particle.svy -= dy * 0.026 * particle.lag;
      });
    }

    function handleMotionChange() {
      if (motionQuery.matches) {
        dragActive = false;
        stop();
        draw();
      } else {
        start();
      }
    }
    motionQuery.addEventListener?.('change', handleMotionChange);
    draw();

    return {
      start,
      stop,
      nudge,
      setDragging(value) {
        dragActive = !!value && !motionQuery.matches;
      },
      destroy() {
        stop();
        motionQuery.removeEventListener?.('change', handleMotionChange);
      },
    };
  }

  function initOrb(root) {
    if (root.dataset.xyoReady === '1') return;
    const surface = root.querySelector('[data-xyo-surface]');
    const orb = root.querySelector('[data-xyo-orb]');
    const canvas = orb?.querySelector('canvas');
    const menu = root.querySelector('[data-xyo-menu]');
    const menuButtons = [...root.querySelectorAll('[data-xyo-action]')];
    const status = root.querySelector('[data-xyo-status]');
    const detailTitle = root.querySelector('[data-xyo-detail-title]');
    const detailCopy = root.querySelector('[data-xyo-detail-copy]');
    const bubble = root.querySelector('[data-xyo-bubble-panel]');
    const bubbleText = root.querySelector('[data-xyo-bubble-text]');
    if (!surface || !orb || !canvas || !menu || !status || !detailTitle || !detailCopy || !bubble || !bubbleText) return;

    root.dataset.xyoReady = '1';
    const renderer = createOrbRenderer(canvas);
    const controller = new AbortController();
    const listen = { signal: controller.signal };
    let drag = null;
    let holdTimer = 0;
    let bubbleTimer = 0;
    let suppressClick = false;
    let menuIndex = 0;
    let dockPeeked = false;

    function defaultState() {
      return { fx: 0.5, fy: 0.42, docked: false, side: 'right', depth: 'half', open: false };
    }

    function loadState() {
      const fallback = defaultState();
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        return {
          fx: Number.isFinite(saved.fx) ? clamp(saved.fx, 0, 1) : fallback.fx,
          fy: Number.isFinite(saved.fy) ? clamp(saved.fy, 0, 1) : fallback.fy,
          docked: typeof saved.docked === 'boolean' ? saved.docked : fallback.docked,
          side: saved.side === 'left' || saved.side === 'right' ? saved.side : fallback.side,
          depth: saved.depth === 'hidden' || saved.depth === 'half' ? saved.depth : fallback.depth,
          open: false,
        };
      } catch (_) {
        return fallback;
      }
    }

    let state = loadState();

    function saveState() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          fx: state.fx,
          fy: state.fy,
          docked: state.docked,
          side: state.side,
          depth: state.depth,
        }));
      } catch (_) {}
    }

    function setStatus(message) {
      if (status.textContent !== message) status.textContent = message;
    }

    function surfaceSize() {
      return { width: surface.clientWidth, height: surface.clientHeight };
    }

    function currentBox() {
      return {
        left: Number.parseFloat(orb.style.left) || 0,
        top: Number.parseFloat(orb.style.top) || 0,
      };
    }

    function isVisible() {
      return !root.closest('[hidden]') && document.visibilityState !== 'hidden';
    }

    function shouldPeekOut() {
      return state.docked && (
        state.open
        || dockPeeked
        || orb.dataset.engaged === 'true'
      );
    }

    function positionBubble() {
      if (bubble.hidden) return;
      const { width, height } = surfaceSize();
      if (width < 1 || height < 1) return;
      const orbBox = currentBox();
      const bubbleWidth = bubble.offsetWidth || 220;
      const bubbleHeight = bubble.offsetHeight || 64;
      let left = orbBox.left + ORB_SIZE / 2 - bubbleWidth / 2;
      let top = orbBox.top - bubbleHeight - 14;
      if (state.docked) {
        left = state.side === 'left' ? ORB_SIZE + 10 : width - ORB_SIZE - 10 - bubbleWidth;
        top = orbBox.top - 4;
      }
      bubble.style.left = clamp(left, 8, Math.max(8, width - bubbleWidth - 8)) + 'px';
      bubble.style.top = clamp(top, 8, Math.max(8, height - bubbleHeight - 8)) + 'px';
    }

    function renderPosition() {
      const { width, height } = surfaceSize();
      if (width < ORB_SIZE || height < ORB_SIZE) return;
      const maxTop = Math.max(4, height - ORB_SIZE - 4);
      const top = clamp(state.fy * height - ORB_SIZE / 2, 4, maxTop);
      let left;
      let visualShift = 0;
      if (state.docked) {
        const peek = shouldPeekOut() ? ORB_SIZE : (DOCK_PEEKS[state.depth] || DOCK_PEEKS.half);
        visualShift = (state.side === 'left' ? -1 : 1) * (ORB_SIZE - peek);
        left = state.side === 'left' ? 0 : width - ORB_SIZE;
      } else {
        left = clamp(state.fx * width - ORB_SIZE / 2, 4, Math.max(4, width - ORB_SIZE - 4));
      }
      orb.style.left = left + 'px';
      orb.style.top = top + 'px';
      orb.style.setProperty('--xyo-visual-shift', visualShift + 'px');
      orb.dataset.docked = String(state.docked);
      orb.dataset.side = state.side;
      orb.dataset.depth = state.depth;
      orb.setAttribute('aria-expanded', String(state.open));
      if (state.open) layoutMenu();
      positionBubble();
    }

    function radialPositions(center, width, height) {
      const count = menuButtons.length;
      const horizontalSign = center.x < width / 2 ? 1 : -1;
      const verticalSign = center.y < height / 2 ? 1 : -1;
      const arcRadius = 122;
      const cornerRadius = 168;
      const needsHorizontal = arcRadius + 84;
      const needsVertical = arcRadius + 28;
      const tightLeft = center.x < needsHorizontal;
      const tightRight = width - center.x < needsHorizontal;
      const tightTop = center.y < needsVertical;
      const tightBottom = height - center.y < needsVertical;
      const inwardX = tightLeft && !tightRight ? 1 : (tightRight && !tightLeft ? -1 : horizontalSign);
      const inwardY = tightTop && !tightBottom ? 1 : (tightBottom && !tightTop ? -1 : verticalSign);
      let start;
      let end;
      let radius = arcRadius;
      if ((tightLeft || tightRight) && (tightTop || tightBottom)) {
        radius = cornerRadius;
        if (inwardX === 1) {
          start = 0;
          end = inwardY === 1 ? -90 : 90;
        } else {
          start = 180;
          end = inwardY === 1 ? 270 : 90;
        }
      } else if (tightTop || tightBottom) {
        if (inwardY === 1) {
          start = -15;
          end = -165;
        } else {
          start = 15;
          end = 165;
        }
      } else if (inwardX === 1) {
        start = 75;
        end = -75;
      } else {
        start = 105;
        end = 255;
      }
      return menuButtons.map((button, index) => {
        const ratio = count > 1 ? index / (count - 1) : 0;
        const angle = (start + ratio * (end - start)) * Math.PI / 180;
        return { button, x: center.x + radius * Math.cos(angle), y: center.y - radius * Math.sin(angle) };
      });
    }

    function layoutCompactCornerMenu(center, width, height) {
      if (width > 430 || menuButtons.length === 0) return false;
      const cornerBand = 152;
      const nearHorizontalEdge = center.x < cornerBand || width - center.x < cornerBand;
      const nearVerticalEdge = center.y < cornerBand || height - center.y < cornerBand;
      if (!nearHorizontalEdge || !nearVerticalEdge) return false;

      const inwardX = center.x < width / 2 ? 1 : -1;
      const inwardY = center.y < height / 2 ? 1 : -1;
      const count = menuButtons.length;
      const maxButtonHeight = Math.max(...menuButtons.map((button) => button.offsetHeight || 44));
      const verticalStep = Math.max(
        maxButtonHeight + 8,
        Math.min(58, (height - maxButtonHeight - 16) / Math.max(1, count - 1)),
      );

      menuButtons.forEach((button, index) => {
        const ratio = count > 1 ? index / (count - 1) : 0;
        const curve = ratio * ratio;
        const buttonWidth = button.offsetWidth || 112;
        const buttonHeight = button.offsetHeight || 44;
        const nearLeft = inwardX === 1 ? 6 : width - buttonWidth - 6;
        const farLeft = inwardX === 1 ? width - buttonWidth - 6 : 6;
        const startTop = inwardY === 1 ? 8 : height - buttonHeight - 8;
        const top = startTop + (inwardY === 1 ? 1 : -1) * verticalStep * index;
        button.style.left = clamp(farLeft + (nearLeft - farLeft) * curve, 6, Math.max(6, width - buttonWidth - 6)) + 'px';
        button.style.top = clamp(top, 8, Math.max(8, height - buttonHeight - 8)) + 'px';
      });
      return true;
    }

    function layoutCompactVerticalEdgeMenu(center, width, height) {
      if (width > 430 || menuButtons.length === 0) return false;
      const edgeBand = 152;
      const nearTop = center.y < edgeBand;
      const nearBottom = height - center.y < edgeBand;
      if (!nearTop && !nearBottom) return false;

      const count = menuButtons.length;
      const maxButtonWidth = Math.max(...menuButtons.map((button) => button.offsetWidth || 112));
      const maxButtonHeight = Math.max(...menuButtons.map((button) => button.offsetHeight || 44));
      const radiusX = Math.max(0, Math.min(118, (width - maxButtonWidth - 12) / 2));
      const baseOffset = 44;
      const direction = nearTop ? 1 : -1;
      const availableDepth = nearTop
        ? height - 8 - maxButtonHeight / 2 - center.y - baseOffset
        : center.y - baseOffset - maxButtonHeight / 2 - 8;
      const arcDepth = Math.max(0, Math.min(164, availableDepth));

      menuButtons.forEach((button, index) => {
        const ratio = count > 1 ? index / (count - 1) : 0;
        const angle = Math.PI * ratio;
        const buttonWidth = button.offsetWidth || 112;
        const buttonHeight = button.offsetHeight || 44;
        const x = width / 2 - radiusX * Math.cos(angle);
        const y = center.y + direction * (baseOffset + arcDepth * Math.sin(angle));
        button.style.left = clamp(x - buttonWidth / 2, 6, Math.max(6, width - buttonWidth - 6)) + 'px';
        button.style.top = clamp(y - buttonHeight / 2, 8, Math.max(8, height - buttonHeight - 8)) + 'px';
      });
      return true;
    }

    function layoutMenu() {
      if (menu.hidden) return;
      const { width, height } = surfaceSize();
      const orbBox = currentBox();
      const center = { x: orbBox.left + ORB_SIZE / 2, y: orbBox.top + ORB_SIZE / 2 };
      if (layoutCompactCornerMenu(center, width, height)) return;
      if (layoutCompactVerticalEdgeMenu(center, width, height)) return;
      radialPositions(center, width, height).forEach(({ button, x, y }) => {
        const buttonWidth = button.offsetWidth || 112;
        const buttonHeight = button.offsetHeight || 44;
        const deltaX = x - center.x;
        let left = x - buttonWidth / 2;
        if (deltaX > 12) left = x;
        else if (deltaX < -12) left = x - buttonWidth;
        button.style.left = clamp(left, 6, Math.max(6, width - buttonWidth - 6)) + 'px';
        button.style.top = clamp(y - buttonHeight / 2, 8, Math.max(8, height - buttonHeight - 8)) + 'px';
      });
    }

    function closeMenu(options = {}) {
      if (!state.open && menu.hidden) return;
      state.open = false;
      menu.dataset.open = 'false';
      menu.hidden = true;
      menu.toggleAttribute('inert', true);
      orb.setAttribute('aria-expanded', 'false');
      renderPosition();
      if (options.focusOrb) orb.focus({ preventScroll: true });
      if (options.announce !== false) setStatus('功能轮盘已收起');
    }

    function openMenu(focusFirst) {
      if (!isVisible()) return;
      state.open = true;
      menu.hidden = false;
      menu.toggleAttribute('inert', false);
      menu.dataset.open = 'false';
      orb.setAttribute('aria-expanded', 'true');
      renderPosition();
      window.requestAnimationFrame(() => {
        layoutMenu();
        menu.dataset.open = 'true';
        if (focusFirst) {
          menuIndex = 0;
          menuButtons.forEach((button, index) => { button.tabIndex = index === menuIndex ? 0 : -1; });
          menuButtons[0]?.focus({ preventScroll: true });
        }
      });
      setStatus('功能轮盘已展开，共 5 个入口');
    }

    function toggleMenu(focusFirst) {
      if (state.open) closeMenu({ focusOrb: !!focusFirst });
      else openMenu(!!focusFirst);
    }

    function showDetail(action) {
      const detail = ACTION_DETAILS[action];
      if (!detail) return;
      detailTitle.textContent = detail.title;
      detailCopy.textContent = detail.copy;
      setStatus(action === 'map' ? '地图系统建设中，敬请期待' : `已选择：${detail.title}`);
    }

    function hideBubble() {
      window.clearTimeout(bubbleTimer);
      bubbleTimer = 0;
      bubble.hidden = true;
    }

    function showBubble() {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setStatus('系统已减少动态效果：自动时段气泡不会弹出');
        return;
      }
      bubbleText.textContent = BUBBLE_TEXTS[timeBucket()];
      bubble.hidden = false;
      positionBubble();
      window.clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(hideBubble, 7000);
      setStatus('已显示当前时段的桌宠问候预览');
    }

    function cancelHold() {
      window.clearTimeout(holdTimer);
      holdTimer = 0;
    }

    function settleDrag() {
      const { width, height } = surfaceSize();
      const box = currentBox();
      const centerX = box.left + ORB_SIZE / 2;
      const centerY = box.top + ORB_SIZE / 2;
      const edgeDistance = Math.min(centerX - ORB_SIZE / 2, width - centerX - ORB_SIZE / 2);
      dockPeeked = false;
      state.fy = clamp(centerY / height, 0, 1);
      if (edgeDistance < DOCK_SNAP_PX) {
        state.docked = true;
        state.side = centerX < width / 2 ? 'left' : 'right';
        setStatus(`已吸附到${state.side === 'left' ? '左' : '右'}侧，当前为${state.depth === 'half' ? '半隐' : '收纳'}档`);
      } else {
        state.docked = false;
        state.fx = clamp(centerX / width, 0, 1);
        setStatus('已停在浮空位置');
      }
      saveState();
      renderPosition();
    }

    orb.addEventListener('pointerenter', () => {
      if (!state.docked || drag) return;
      dockPeeked = true;
      renderPosition();
    }, listen);

    orb.addEventListener('pointerleave', () => {
      if (!state.docked) return;
      dockPeeked = false;
      if (!state.open && !drag) renderPosition();
    }, listen);

    orb.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0) || !isVisible()) return;
      cancelHold();
      orb.dataset.engaged = 'true';
      renderPosition();
      const box = currentBox();
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startLeft: box.left,
        startTop: box.top,
        lastLeft: box.left,
        lastTop: box.top,
        moved: false,
        holdFired: false,
        before: { ...state },
      };
      try { orb.setPointerCapture(event.pointerId); } catch (_) {}
      if (state.docked) {
        holdTimer = window.setTimeout(() => {
          if (!drag || drag.moved) return;
          drag.holdFired = true;
          suppressClick = true;
          state.depth = state.depth === 'half' ? 'hidden' : 'half';
          saveState();
          renderPosition();
          setStatus(state.depth === 'hidden' ? '已切换为收纳档，只露出 10px' : '已切换为半隐档，露出 28px');
        }, 600);
      }
    }, listen);

    orb.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4)) {
        drag.moved = true;
        cancelHold();
        closeMenu({ announce: false });
        hideBubble();
        state.docked = false;
        orb.dataset.dragging = 'true';
        renderer.setDragging(true);
      }
      if (!drag.moved) return;
      const { width, height } = surfaceSize();
      const left = clamp(drag.startLeft + deltaX, 0, Math.max(0, width - ORB_SIZE));
      const top = clamp(drag.startTop + deltaY, 0, Math.max(0, height - ORB_SIZE));
      orb.style.left = left + 'px';
      orb.style.top = top + 'px';
      renderer.nudge(left - drag.lastLeft, top - drag.lastTop);
      drag.lastLeft = left;
      drag.lastTop = top;
      event.preventDefault();
    }, listen);

    orb.addEventListener('pointerup', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const finished = drag;
      drag = null;
      cancelHold();
      try { orb.releasePointerCapture(event.pointerId); } catch (_) {}
      orb.dataset.engaged = 'false';
      orb.dataset.dragging = 'false';
      renderer.setDragging(false);
      if (finished.moved) {
        suppressClick = true;
        settleDrag();
      } else if (finished.holdFired) {
        suppressClick = true;
        renderPosition();
      } else {
        renderPosition();
      }
    }, listen);

    orb.addEventListener('pointercancel', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const before = drag.before;
      drag = null;
      cancelHold();
      try { orb.releasePointerCapture(event.pointerId); } catch (_) {}
      orb.dataset.engaged = 'false';
      orb.dataset.dragging = 'false';
      renderer.setDragging(false);
      state = { ...before, open: false };
      dockPeeked = false;
      closeMenu({ announce: false });
      renderPosition();
      setStatus('拖动已取消，悬浮球回到原位');
    }, listen);

    orb.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      toggleMenu(false);
    }, listen);

    orb.addEventListener('mouseenter', renderPosition, listen);
    orb.addEventListener('mouseleave', () => { if (!state.open) renderPosition(); }, listen);
    orb.addEventListener('focus', renderPosition, listen);
    orb.addEventListener('blur', () => { if (!state.open) renderPosition(); }, listen);
    orb.addEventListener('contextmenu', (event) => event.preventDefault(), listen);

    orb.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.open) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ focusOrb: true });
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleMenu(true);
        return;
      }
      const { width, height } = surfaceSize();
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        closeMenu({ announce: false });
        dockPeeked = false;
        state.docked = true;
        state.side = event.key === 'Home' ? 'left' : 'right';
        saveState();
        renderPosition();
        setStatus(`已用键盘吸附到${state.side === 'left' ? '左' : '右'}侧`);
        return;
      }
      if ((event.key === 'd' || event.key === 'D') && state.docked) {
        event.preventDefault();
        state.depth = state.depth === 'half' ? 'hidden' : 'half';
        saveState();
        renderPosition();
        setStatus(state.depth === 'hidden' ? '已切换为收纳档，只露出 10px' : '已切换为半隐档，露出 28px');
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      closeMenu({ announce: false });
      const box = currentBox();
      let centerX = box.left + ORB_SIZE / 2;
      let centerY = box.top + ORB_SIZE / 2;
      if (event.key === 'ArrowLeft') centerX -= 16;
      if (event.key === 'ArrowRight') centerX += 16;
      if (event.key === 'ArrowUp') centerY -= 16;
      if (event.key === 'ArrowDown') centerY += 16;
      dockPeeked = false;
      state.docked = false;
      state.fx = clamp(centerX / width, 0, 1);
      state.fy = clamp(centerY / height, 0, 1);
      saveState();
      renderPosition();
      setStatus('已用方向键移动悬浮球');
    }, listen);

    menu.addEventListener('click', (event) => {
      const button = event.target.closest('[data-xyo-action]');
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      const action = button.dataset.xyoAction;
      showDetail(action);
      closeMenu({ focusOrb: true, announce: false });
    }, listen);

    menu.addEventListener('keydown', (event) => {
      const current = event.target.closest('[data-xyo-action]');
      if (!current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ focusOrb: true });
        return;
      }
      const currentIndex = menuButtons.indexOf(current);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % menuButtons.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + menuButtons.length) % menuButtons.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = menuButtons.length - 1;
      else return;
      event.preventDefault();
      menuIndex = nextIndex;
      menuButtons.forEach((button, index) => { button.tabIndex = index === menuIndex ? 0 : -1; });
      menuButtons[menuIndex].focus({ preventScroll: true });
    }, listen);

    root.addEventListener('click', (event) => {
      const reset = event.target.closest('[data-xyo-reset]');
      if (reset) {
        try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        state = defaultState();
        dockPeeked = false;
        closeMenu({ announce: false });
        hideBubble();
        detailTitle.textContent = '功能入口';
        detailCopy.textContent = '点击悬浮球打开 5 键轮盘；选择入口后，这里只说明真实职责与边界。';
        renderPosition();
        setStatus('演示已重置：悬浮球回到视口中心');
        orb.focus({ preventScroll: true });
        return;
      }
      if (event.target.closest('[data-xyo-bubble]')) {
        showBubble();
        return;
      }
      if (event.target.closest('[data-xyo-bubble-close]')) {
        hideBubble();
        setStatus('时段问候已关闭；真实功能支持静音 24 小时');
      }
    }, listen);

    document.addEventListener('pointerdown', (event) => {
      if (!state.open || !isVisible()) return;
      if (event.target.closest('[data-xyo-orb], [data-xyo-menu]')) return;
      closeMenu({ announce: true });
    }, { capture: true, signal: controller.signal });

    const resizeObserver = new ResizeObserver(() => {
      if (!isVisible()) return;
      renderPosition();
    });
    resizeObserver.observe(surface);

    function syncRoute(event) {
      const route = event?.detail?.route || location.hash.replace(/^#/, '').split(/[?&/]/)[0];
      if (route !== 'play' || !isVisible()) {
        cancelHold();
        drag = null;
        dockPeeked = false;
        orb.dataset.engaged = 'false';
        orb.dataset.dragging = 'false';
        renderer.setDragging(false);
        closeMenu({ announce: false });
        hideBubble();
        renderer.stop();
        return;
      }
      window.requestAnimationFrame(() => {
        renderPosition();
        renderer.start();
      });
    }

    window.addEventListener('portal:routechange', syncRoute, listen);
    document.addEventListener('visibilitychange', syncRoute, listen);
    window.addEventListener('resize', renderPosition, { passive: true, signal: controller.signal });
    syncRoute({ detail: { route: location.hash.replace(/^#/, '').split(/[?&/]/)[0] || 'guide' } });
  }

  document.querySelectorAll('[data-xyo-root]').forEach(initOrb);
})();
