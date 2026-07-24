(() => {
  'use strict';

  const STORAGE_KEY = 'rolecard-portal-v0.3';
  const validRoutes = new Set(['guide', 'play', 'studio', 'workshop']);
  const startPages = new Set(['last', 'guide', 'studio', 'play', 'workshop']);
  const uiScales = new Set([0.9, 1, 1.1]);
  const routeTitles = {
    guide: '制卡指南 · Reverie Playcraft Nexus',
    play: '前端组件预览 · Reverie Playcraft Nexus',
    studio: '制卡工作台 · Reverie Playcraft Nexus',
    workshop: '创意工坊 · Reverie Playcraft Nexus',
  };
  const platformLabels = {
    claude: 'Claude Code',
    codex: 'Codex',
  };

  const capabilityProfiles = {
    novice: {
      label: '只会描述想法',
      userRole: '说清想要的体验，回答玩法选择，确认方案，并在最后判断实际游玩是否符合预期。',
      aiRole: '解释术语，查 skill 与 DB，提出可选方案，承担技术实现和验证，不把技术选择丢给用户猜。',
      communication: '所有术语先用人话解释；每次只问少量问题，不默认我会写代码。',
    },
    player: {
      label: '会使用酒馆',
      userRole: '提供角色卡和问题，在 SillyTavern 中导入、试玩并反馈剧情、界面和操作体验。',
      aiRole: '审计卡片结构，定位问题，设计和修改部件，并给出明确的重导、重载与复测说明。',
      communication: '技术内容先说明它会影响什么，再给我需要执行的酒馆操作。',
    },
    operator: {
      label: '会看文件与日志',
      userRole: '提供文件路径、版本和日志，运行明确的命令，并完成本机或真实酒馆复测。',
      aiRole: '判断技术路线，完成代码与配置修改，运行自动化检查，整理回归清单和剩余真机步骤。',
      communication: '可以给出命令和证据位置，但关键取舍仍需先让我确认。',
    },
    builder: {
      label: '能参与开发',
      userRole: '参与技术选择、审查改动范围和差异，并负责最终真实环境体验验收。',
      aiRole: '承担资料查证、实现、测试、风险审计和交接，主动指出冲突与更小的改动方案。',
      communication: '可以直接给技术证据和实现差异，但不要跳过目标、边界与验收确认。',
    },
  };

  const modeContent = {
    new: {
      label: '从零开始',
      primaryLabel: '一句话描述你想做的卡',
      primaryPlaceholder: '例如：一张现代校园群像卡，重点是人物关系和日常事件',
      goalLabel: '第一版想先做到什么',
      goalPlaceholder: '例如：先跑通稳定对话、开局和基础状态',
      boundaryLabel: '哪些内容暂时不做或不能碰',
      boundaryPlaceholder: '例如：第一版不做战斗，不替我决定 NSFW 边界',
      journeyTitle: '从想法走到可确认的制作方案',
      journey: [
        ['讲出想法', '先说题材、角色和想要的体验，不用先懂技术。'],
        ['AI 分轮提问', '每轮只问少量关键问题，再判断纯文字卡或 MVU 卡。'],
        ['确认结构', 'AI 复述核心玩法、结构草图、部件和验收方式。'],
        ['分阶段制作', '你确认后才写文件，一块一块制作并验证。'],
      ],
    },
    takeover: {
      label: '接手已有角色卡',
      primaryLabel: '卡片文件或源码目录在哪里',
      primaryPlaceholder: '粘贴文件或目录位置；也可以先写“稍后提供”',
      goalLabel: '这次想修复、补充或理解什么',
      goalPlaceholder: '例如：变量经常丢失，希望先查清原因，不重做现有前端',
      boundaryLabel: '哪些原有内容必须保留',
      boundaryPlaceholder: '例如：保留原人设、文风、开场和现有可用功能',
      journeyTitle: '先看懂现状，再批准最小改动',
      journey: [
        ['提供现卡', '给出文件或源码目录，并说明当前目标。'],
        ['只读审计', 'AI 先识别版本、真相源、卡片类型和部件关系。'],
        ['最小改动方案', '列出证据、风险、影响范围和回归检查项。'],
        ['确认后修改', '你批准范围后才动文件，并按原功能做回归验证。'],
      ],
    },
  };

  const DB_REQUEST = [
    '涉及 ST、酒馆助手、MVU、EJS、API 或前端机制时，请先查询 ST开发指南DB。',
    '只读取与当前任务直接相关的指南，并报告文档版本、最后更新时间、适用范围和可靠度。',
    '版本敏感或证据不足的内容不要凭记忆补全，请明确列为待源码或真实酒馆验证。',
  ].join('\n');

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let toastTimer;
  let activeRoute = null;
  let state = loadState();
  let desktopState = null;
  let desktopBusyCommand = '';
  const drafts = {
    new: emptyDraft(),
    takeover: emptyDraft(),
  };

  function emptyDraft() {
    return { primary: '', goal: '', boundary: '', acceptance: '' };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      return {
        platform: ['claude', 'codex'].includes(saved.platform) ? saved.platform : 'claude',
        mode: ['new', 'takeover'].includes(saved.mode) ? saved.mode : 'new',
        capability: Object.hasOwn(capabilityProfiles, saved.capability) ? saved.capability : 'novice',
        startPage: startPages.has(saved.startPage) ? saved.startPage : 'last',
        lastRoute: validRoutes.has(saved.lastRoute) ? saved.lastRoute : 'guide',
        uiScale: uiScales.has(Number(saved.uiScale)) ? Number(saved.uiScale) : 1,
        reduceMotion: Boolean(saved.reduceMotion),
      };
    } catch {
      return {
        platform: 'claude',
        mode: 'new',
        capability: 'novice',
        startPage: 'last',
        lastRoute: 'guide',
        uiScale: 1,
        reduceMotion: false,
      };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      showToast('浏览器阻止了偏好保存，本次选择只在当前页面有效。');
    }
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3600);
  }

  function setPreferenceStatus(message) {
    const status = $('[data-rpn-preferences-status]');
    if (status) status.textContent = message;
  }

  function applyPreferences() {
    document.documentElement.style.setProperty('--rpn-ui-scale', String(state.uiScale));
    document.documentElement.dataset.rpnReduceMotion = String(state.reduceMotion);
    const startPage = $('[data-rpn-start-page]');
    const uiScale = $('[data-rpn-ui-scale]');
    const reduceMotion = $('[data-rpn-reduce-motion]');
    if (startPage) startPage.value = state.startPage;
    if (uiScale) uiScale.value = String(state.uiScale);
    if (reduceMotion) reduceMotion.checked = state.reduceMotion;
  }

  function requestUnifiedSettings(tab = 'general', trigger = document.activeElement) {
    window.dispatchEvent(new CustomEvent('rpn:open-settings', { detail: { tab, trigger } }));
  }

  function desktopInvoke(command, args) {
    const invoke = window.__TAURI__?.core?.invoke;
    if (typeof invoke !== 'function') throw new Error('当前页面不在 RPN 桌面程序中。');
    return invoke(command, args);
  }

  function normalizedDesktopState(value) {
    const source = value?.state && typeof value.state === 'object' ? value.state : value;
    const next = source && typeof source === 'object' ? source : {};
    const previous = desktopState || { update: {} };
    const update = next.update && typeof next.update === 'object' ? next.update : {};
    const text = (object, key, fallback = '') => Object.hasOwn(object, key)
      ? String(object[key] || '')
      : fallback;
    return {
      desktop: next.desktop !== false,
      appVersion: text(next, 'appVersion', previous.appVersion || ''),
      stUrl: text(next, 'stUrl', previous.stUrl || ''),
      dataRoot: text(next, 'dataRoot', previous.dataRoot || ''),
      update: {
        enabled: update.enabled ?? previous.update.enabled ?? false,
        phase: text(update, 'phase', previous.update.phase || 'idle'),
        currentVersion: text(update, 'currentVersion', previous.update.currentVersion || next.appVersion || previous.appVersion || ''),
        version: text(update, 'version', previous.update.version || ''),
        notes: text(update, 'notes', previous.update.notes || ''),
        downloaded: update.downloaded ?? previous.update.downloaded ?? false,
        message: text(update, 'message', previous.update.message || ''),
      },
    };
  }

  function desktopPhaseMessage(update) {
    if (update.message) return update.message;
    return {
      idle: '由你手动检查、下载并确认安装。',
      checking: '正在检查可用版本…',
      available: `发现新版本 ${update.version || ''}，可由你确认下载。`,
      downloading: '正在下载并校验更新包…',
      downloaded: '更新包已下载并通过校验，可以安装并重启。',
      ready: '更新包已下载并通过校验，可以安装并重启。',
      preparing: '正在等待工作区连续性保存完成…',
      installing: '正在启动安装程序，RPN 即将重启…',
      'up-to-date': '当前已经是最新版本。',
      up_to_date: '当前已经是最新版本。',
      upToDate: '当前已经是最新版本。',
      error: '更新操作未完成，请查看提示后重试。',
    }[update.phase] || '由你手动检查、下载并确认安装。';
  }

  function renderDesktopState() {
    if (!desktopState) return;
    const update = desktopState.update;
    const installing = ['preparing', 'installing'].includes(update.phase);
    const busy = Boolean(desktopBusyCommand) || ['checking', 'downloading', 'preparing', 'installing'].includes(update.phase);
    const downloaded = Boolean(update.downloaded) || ['downloaded', 'ready'].includes(update.phase);
    const available = update.phase === 'available' || Boolean(update.version && update.version !== update.currentVersion);
    const controls = $('[data-desktop-controls]');
    controls.hidden = false;
    controls.querySelectorAll('button').forEach((button) => { button.disabled = installing; });
    $$('[data-desktop-only]').forEach((element) => { element.hidden = false; });

    const stUrl = $('[data-desktop-st-url]');
    if (document.activeElement !== stUrl) stUrl.value = desktopState.stUrl;
    stUrl.disabled = installing;
    $('[data-desktop-st-state]').textContent = desktopState.stUrl ? '已配置' : '尚未配置';
    $('[data-desktop-current-version]').textContent = update.currentVersion || desktopState.appVersion || '—';
    $('[data-desktop-installed-version]').textContent = update.currentVersion || desktopState.appVersion || '—';
    $('[data-desktop-data-root]').textContent = desktopState.dataRoot || '应用永久数据区';
    $('[data-desktop-available-version]').textContent = update.version || (['up-to-date', 'up_to_date', 'upToDate'].includes(update.phase) ? '已是最新' : '尚未检查');
    $('[data-desktop-update-version]').textContent = update.version ? `v${update.version}` : '当前版本';
    const notes = $('[data-desktop-update-notes]');
    notes.textContent = update.notes;
    notes.hidden = !update.notes;
    const progress = $('[data-desktop-update-progress]');
    progress.hidden = update.phase !== 'downloading';
    if (!progress.hidden) progress.removeAttribute('value');
    $('[data-desktop-update-status]').textContent = update.enabled
      ? desktopPhaseMessage(update)
      : (update.message || '此构建未启用在线更新。');

    $('[data-desktop-save-st-url]').disabled = installing || desktopBusyCommand === 'desktop_set_st_url';
    $('[data-desktop-dialog-open-st]').disabled = installing || desktopBusyCommand === 'desktop_open_st';
    $('[data-desktop-open-rpn]').disabled = installing || desktopBusyCommand === 'desktop_open_rpn';
    $('[data-desktop-check-update]').disabled = busy || !update.enabled;
    $('[data-desktop-download-update]').disabled = busy || !update.enabled || !available || downloaded;
    $('[data-desktop-install-update]').disabled = busy || !update.enabled || !downloaded;

    document.documentElement.dataset.desktopUpdating = String(installing);
    if (installing) document.body.setAttribute('aria-busy', 'true');
    else document.body.removeAttribute('aria-busy');
  }

  function applyDesktopState(value) {
    desktopState = normalizedDesktopState(value);
    renderDesktopState();
  }

  async function runDesktopCommand(command, args, statusSelector) {
    if (desktopBusyCommand) return { ok: false, result: null };
    desktopBusyCommand = command;
    renderDesktopState();
    try {
      const result = await desktopInvoke(command, args);
      if (result && typeof result === 'object') applyDesktopState(result);
      return { ok: true, result };
    } catch (error) {
      const message = error?.message || String(error);
      if (['desktop_check_update', 'desktop_download_update', 'desktop_install_update'].includes(command)) {
        desktopState.update = { ...desktopState.update, phase: 'error', message };
      }
      const status = statusSelector ? $(statusSelector) : null;
      if (status) status.textContent = message;
      showToast(message);
      return { ok: false, result: null };
    } finally {
      desktopBusyCommand = '';
      renderDesktopState();
    }
  }

  function openDesktopDialog() {
    renderDesktopState();
    requestUnifiedSettings('desktop');
  }

  async function saveDesktopStUrl() {
    const input = $('[data-desktop-st-url]');
    if (!input.reportValidity()) return false;
    const url = input.value.trim();
    const outcome = await runDesktopCommand('desktop_set_st_url', { url }, '[data-desktop-st-status]');
    if (outcome.ok) $('[data-desktop-st-status]').textContent = '本机 ST 地址已保存。';
    return outcome.ok;
  }

  async function openDesktopStFromDialog() {
    const inputUrl = $('[data-desktop-st-url]').value.trim();
    if (inputUrl !== desktopState.stUrl && !(await saveDesktopStUrl())) return;
    await runDesktopCommand('desktop_open_st', undefined, '[data-desktop-st-status]');
  }

  function bindDesktopBridge() {
    if (typeof window.__TAURI__?.core?.invoke !== 'function') return;
    document.body.dataset.desktop = 'true';
    desktopState = normalizedDesktopState({ desktop: true });
    renderDesktopState();
    window.addEventListener('rpn:desktop-state', (event) => applyDesktopState(event.detail));
    window.addEventListener('rpn:desktop-open-settings', openDesktopDialog);
    $('[data-desktop-open-st]').addEventListener('click', () => {
      runDesktopCommand('desktop_open_st', undefined, '[data-desktop-st-status]');
    });
    $('[data-desktop-save-st-url]').addEventListener('click', () => { saveDesktopStUrl(); });
    $('[data-desktop-dialog-open-st]').addEventListener('click', () => { openDesktopStFromDialog(); });
    $('[data-desktop-open-rpn]').addEventListener('click', () => {
      runDesktopCommand('desktop_open_rpn', undefined, '[data-desktop-st-status]');
    });
    $('[data-desktop-check-update]').addEventListener('click', () => {
      runDesktopCommand('desktop_check_update', undefined, '[data-desktop-update-status]');
    });
    $('[data-desktop-download-update]').addEventListener('click', () => {
      runDesktopCommand('desktop_download_update', undefined, '[data-desktop-update-status]');
    });
    $('[data-desktop-install-update]').addEventListener('click', () => {
      runDesktopCommand('desktop_install_update', undefined, '[data-desktop-update-status]');
    });
    runDesktopCommand('desktop_get_state', undefined, '[data-desktop-update-status]');
  }

  function getRoute() {
    const route = location.hash.replace(/^#/, '').split(/[?&/]/)[0];
    if (route === 'vibe') {
      history.replaceState(null, '', '#studio/tutorial');
      return 'studio';
    }
    if (validRoutes.has(route)) return route;
    return state.startPage === 'last' ? state.lastRoute : state.startPage;
  }

  function renderRoute() {
    const route = getRoute();
    const routeChanged = activeRoute !== null && activeRoute !== route;
    activeRoute = route;
    if (state.lastRoute !== route) {
      state.lastRoute = route;
      saveState();
    }

    $$('[data-page]').forEach((page) => {
      page.hidden = page.dataset.page !== route;
    });
    $$('[data-route-link]').forEach((link) => {
      if (link.dataset.routeLink === route) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });

    document.title = routeTitles[route];
    document.body.dataset.route = route;
    if (routeChanged) {
      window.scrollTo(0, 0);
      $(`[data-page="${route}"] h1`)?.focus({ preventScroll: true });
    }

    window.dispatchEvent(new CustomEvent('portal:routechange', { detail: { route } }));
  }

  function readDraft() {
    return {
      primary: $('#input-primary').value.trim(),
      goal: $('#input-goal').value.trim(),
      boundary: $('#input-boundary').value.trim(),
      acceptance: $('#input-acceptance').value.trim(),
    };
  }

  function readSync() {
    return {
      known: $('#input-known').value.trim(),
      unknown: $('#input-unknown').value.trim(),
    };
  }

  function writeDraft(draft) {
    $('#input-primary').value = draft.primary;
    $('#input-goal').value = draft.goal;
    $('#input-boundary').value = draft.boundary;
    $('#input-acceptance').value = draft.acceptance;
  }

  function setPlatform(platform, persist = true) {
    if (!platformLabels[platform]) return;
    state.platform = platform;
    $$('[data-platform-choice]').forEach((button) => {
      const active = button.dataset.platformChoice === platform;
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    if (persist) saveState();
    renderPrompt();
  }

  function setCapability(capability, persist = true) {
    if (!capabilityProfiles[capability]) return;
    state.capability = capability;
    $$('[data-capability-choice]').forEach((button) => {
      const active = button.dataset.capabilityChoice === capability;
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const profile = capabilityProfiles[capability];
    $('#user-role-output').textContent = profile.userRole;
    $('#ai-role-output').textContent = profile.aiRole;
    if (persist) saveState();
    renderPrompt();
  }

  function setMode(mode, persist = true) {
    if (!modeContent[mode]) return;
    if ($('#input-primary')) drafts[state.mode] = readDraft();
    state.mode = mode;
    $$('[data-mode-choice]').forEach((button) => {
      const active = button.dataset.modeChoice === mode;
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });

    const content = modeContent[mode];
    $('#primary-label').textContent = content.primaryLabel;
    $('#input-primary').placeholder = content.primaryPlaceholder;
    $('#goal-label').textContent = content.goalLabel;
    $('#input-goal').placeholder = content.goalPlaceholder;
    $('#boundary-label').textContent = content.boundaryLabel;
    $('#input-boundary').placeholder = content.boundaryPlaceholder;
    writeDraft(drafts[mode]);
    renderJourney();
    if (persist) saveState();
    renderPrompt();
  }

  function promptValue(value, fallback) {
    return value || `【${fallback}】`;
  }

  function collaborationBlock(sync) {
    const profile = capabilityProfiles[state.capability];
    return [
      '【开工同步】',
      `我的当前能力：${profile.label}`,
      `我能负责：${profile.userRole}`,
      `请你负责：${profile.aiRole}`,
      `我已经懂或已经决定：${promptValue(sync.known, '暂未补充，请在提问中确认')}`,
      `我不懂或希望先解释：${promptValue(sync.unknown, '请根据任务主动识别')}`,
      `沟通方式：${profile.communication}`,
    ];
  }

  function buildNewPrompt(draft, sync) {
    const invocation = state.platform === 'claude'
      ? '/tavernweave-agent-skills:tavern-card-builder'
      : '请使用 $tavern-card-builder。';

    return [
      invocation,
      '',
      ...collaborationBlock(sync),
      '',
      '我要从零制作一张 SillyTavern 角色卡。',
      '',
      `当前想法：${promptValue(draft.primary, '请先向我提问')}`,
      `第一版目标：${promptValue(draft.goal, '访谈后一起确认')}`,
      `明确边界：${promptValue(draft.boundary, '请在访谈中确认')}`,
      `验收方式：${promptValue(draft.acceptance, '请提出可验证的验收方案')}`,
      '',
      '先不要创建或修改文件。请每轮只问 2–4 个关键问题，完成需求访谈，并帮我判断更适合纯文字卡还是 MVU 卡，不要替我决定玩法取舍。',
      '',
      '访谈结束后，请用简单中文复述：',
      '1. 卡片类型与核心体验',
      '2. 结构草图和部件清单',
      '3. 制作顺序与本轮不做的内容',
      '4. 用户与 AI 的分工',
      '5. 验收方式',
      '',
      '等我确认后再动工。',
      DB_REQUEST,
    ].join('\n');
  }

  function buildTakeoverPrompt(draft, sync) {
    const invocation = state.platform === 'claude'
      ? '/tavernweave-agent-skills:tavern-card-builder'
      : '请使用 $tavern-card-builder。';

    return [
      invocation,
      '',
      ...collaborationBlock(sync),
      '',
      '请接手这张已有的 SillyTavern 角色卡。',
      '',
      `文件或源码位置：${promptValue(draft.primary, '请粘贴位置或稍后提供文件')}`,
      `本次目标：${promptValue(draft.goal, '请先帮我梳理现状')}`,
      `必须保留：${promptValue(draft.boundary, '原卡的人设、文风、玩法和既有约定')}`,
      `验收方式：${promptValue(draft.acceptance, '请根据现状提出回归与真机验收方案')}`,
      '',
      '先不要修改、重组或打包任何文件，只进行只读审计。请识别：',
      '1. 卡片格式、当前版本和源码真相源',
      '2. 它是纯文字卡、MVU 卡，还是使用其他变量方案',
      '3. 如果使用 MVU，它采用哪种变量更新方言',
      '4. 世界书、变量规则、脚本、正则和前端怎样配合',
      '5. 已有功能、已知故障、风险和缺失证据',
      '',
      '请保留原卡的人设、文风、玩法和项目约定。除非我明确要求，不要擅自改变技术路线，也不要生成完整卡覆盖原文件。',
      '',
      '最后给出结构摘要、证据位置、最小改动方案、影响范围、用户与 AI 的分工、回归检查项和验收方式。等我确认后再动工。',
      DB_REQUEST,
    ].join('\n');
  }

  function renderPrompt() {
    const draft = readDraft();
    const sync = readSync();
    drafts[state.mode] = draft;
    const prompt = state.mode === 'new'
      ? buildNewPrompt(draft, sync)
      : buildTakeoverPrompt(draft, sync);
    $('#prompt-output').textContent = prompt;
    $('#prompt-context').textContent = `${platformLabels[state.platform]} · ${modeContent[state.mode].label}`;
  }

  function renderJourney() {
    const content = modeContent[state.mode];
    $('#journey-title').textContent = content.journeyTitle;
    content.journey.forEach(([title, text], index) => {
      $(`#journey-step-${index + 1}-title`).textContent = title;
      $(`#journey-step-${index + 1}-text`).textContent = text;
    });
  }

  async function copyText(text, successMessage = '已复制') {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const temporary = document.createElement('textarea');
      temporary.value = text;
      temporary.setAttribute('readonly', '');
      temporary.style.position = 'fixed';
      temporary.style.opacity = '0';
      document.body.appendChild(temporary);
      temporary.select();
      document.execCommand('copy');
      temporary.remove();
    }
    showToast(successMessage);
  }

  function bindRadioGroup(selector, onSelect) {
    const buttons = $$(selector);
    buttons.forEach((button) => {
      button.addEventListener('click', () => onSelect(button));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = buttons.indexOf(button);
        let nextIndex = current;
        if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = buttons.length - 1;
        else {
          const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
          nextIndex = (current + delta + buttons.length) % buttons.length;
        }
        const next = buttons[nextIndex];
        next.focus();
        onSelect(next);
      });
    });
  }

  function bindEvents() {
    window.addEventListener('hashchange', renderRoute);
    $$('[data-app-settings-open]').forEach((button) => button.addEventListener('click', () => {
      requestUnifiedSettings(button.dataset.appSettingsOpen || 'general', button);
    }));

    $('[data-rpn-start-page]')?.addEventListener('change', (event) => {
      state.startPage = startPages.has(event.currentTarget.value) ? event.currentTarget.value : 'last';
      saveState();
      setPreferenceStatus('启动页面偏好已保存。');
    });
    $('[data-rpn-ui-scale]')?.addEventListener('change', (event) => {
      const next = Number(event.currentTarget.value);
      state.uiScale = uiScales.has(next) ? next : 1;
      saveState();
      applyPreferences();
      setPreferenceStatus(`界面缩放已设为 ${Math.round(state.uiScale * 100)}%。`);
    });
    $('[data-rpn-reduce-motion]')?.addEventListener('change', (event) => {
      state.reduceMotion = event.currentTarget.checked;
      saveState();
      applyPreferences();
      setPreferenceStatus(state.reduceMotion ? '已减少非必要动画。' : '已恢复标准动画。');
    });
    $('[data-rpn-preferences-reset]')?.addEventListener('click', () => {
      state = { ...state, startPage: 'last', uiScale: 1, reduceMotion: false };
      saveState();
      applyPreferences();
      setPreferenceStatus('通用偏好已恢复默认。');
    });

    $('.skip-link')?.addEventListener('click', (event) => {
      event.preventDefault();
      $('#page-content')?.scrollIntoView({ block: 'start' });
      $(`[data-page="${getRoute()}"] h1`)?.focus({ preventScroll: true });
    });

    bindRadioGroup('[data-capability-choice]', (button) => setCapability(button.dataset.capabilityChoice));
    bindRadioGroup('[data-platform-choice]', (button) => setPlatform(button.dataset.platformChoice));
    bindRadioGroup('[data-mode-choice]', (button) => setMode(button.dataset.modeChoice));

    $$('#input-known, #input-unknown, #input-primary, #input-goal, #input-boundary, #input-acceptance').forEach((field) => {
      field.addEventListener('input', renderPrompt);
    });
    $('#intake-form').addEventListener('submit', (event) => event.preventDefault());

    $$('[data-mode-jump]').forEach((button) => {
      button.addEventListener('click', () => {
        setMode(button.dataset.modeJump);
        $('#starter').scrollIntoView({
          behavior: state.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'start',
        });
      });
    });

    $('#copy-prompt').addEventListener('click', () => {
      copyText($('#prompt-output').textContent, '开工指令已复制');
    });
    $('#copy-db-request').addEventListener('click', () => {
      copyText(DB_REQUEST, 'DB 查证要求已复制');
    });
  }

  function init() {
    applyPreferences();
    setCapability(state.capability, false);
    setPlatform(state.platform, false);
    setMode(state.mode, false);
    bindEvents();
    bindDesktopBridge();
    void renderRoute();
  }

  init();
})();
