import workshopPackageContract from '../shared/workshop-package-contract.js';

const root = document.querySelector('[data-wsp-root]');

if (root) {
  const gatewayBase = new URL(root.dataset.gatewayBase || document.baseURI);
  const tokenStorageKey = 'xingyue-workshop-token';
  const requestTimeoutMs = 15000;
  const supportedTypes = new Set([
    'character',
    'user_identity',
    'world_factor',
    'shop_item',
    'blueprint',
    'recipe',
    'skill',
    'function',
  ]);
  const supportedScopes = new Set(['xingyue', 'shared', 'xingyue-opening-v1']);
  const supportedRatings = new Set(['general', 'mature', 'restricted']);
  const baseTags = ['身份', '角色', '世界因子', '商店', '蓝图', '配方', '技能', '功能', '开局'];

  const typeLabels = Object.freeze({
    character: '角色范本',
    user_identity: '玩家身份',
    world_factor: '世界因子',
    shop_item: '商店物品',
    blueprint: '制造蓝图',
    recipe: '配方',
    skill: '技能',
    function: '功能',
  });
  const scopeLabels = Object.freeze({
    xingyue: '星月',
    shared: '通用',
    'xingyue-opening-v1': '星月开局',
  });
  const ratingLabels = Object.freeze({
    general: '全年龄',
    mature: '成熟',
    restricted: '受限',
  });
  const exampleLabels = Object.freeze({
    './examples/character.example.json': '角色范本',
    './examples/user_identity.example.json': '玩家身份',
    './examples/world_factor.example.json': '世界因子',
  });
  const reviewLabels = Object.freeze({
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    withdrawn: '已撤回',
  });

  const query = (selector, scope = root) => scope.querySelector(selector);
  const queryAll = (selector, scope = root) => [...scope.querySelectorAll(selector)];
  const dom = {
    viewLinks: queryAll('[data-wsp-view-link]'),
    views: queryAll('[data-wsp-view]'),
    discoverView: query('[data-wsp-view="discover"]'),
    mineView: query('[data-wsp-view="mine"]'),
    authStatus: query('[data-wsp-auth-status]'),
    authError: query('[data-wsp-auth-error]'),
    login: query('[data-wsp-login]'),
    logout: query('[data-wsp-logout]'),
    filters: query('[data-wsp-filters]'),
    filterFields: queryAll('[data-wsp-filter]'),
    filterReset: query('[data-wsp-filter-reset]'),
    cloudState: query('[data-wsp-cloud-state]'),
    count: query('[data-wsp-count]'),
    list: query('[data-wsp-list]'),
    loading: query('[data-wsp-loading]'),
    empty: query('[data-wsp-empty]'),
    emptyTitle: query('[data-wsp-empty-title]'),
    emptyText: query('[data-wsp-empty-text]'),
    error: query('[data-wsp-error]'),
    errorText: query('[data-wsp-error-text]'),
    retry: query('[data-wsp-retry]'),
    clearEmpty: query('[data-wsp-clear-empty]'),
    goLocal: queryAll('[data-wsp-go-local]'),
    tagFilter: query('[data-wsp-filter="tag"]'),
    fileInput: query('[data-wsp-file]'),
    dropzone: query('[data-wsp-drop]'),
    examples: queryAll('[data-wsp-example]'),
    localStatus: query('[data-wsp-local-status]'),
    localEmpty: query('[data-wsp-local-empty]'),
    localResult: query('[data-wsp-local-result]'),
    localTitle: query('[data-wsp-local-title]'),
    localSummary: query('[data-wsp-local-summary]'),
    localType: query('[data-wsp-local-type]'),
    localScope: query('[data-wsp-local-scope]'),
    localRating: query('[data-wsp-local-rating]'),
    localVersion: query('[data-wsp-local-version]'),
    localAuthor: query('[data-wsp-local-author]'),
    localLanguage: query('[data-wsp-local-language]'),
    localTags: query('[data-wsp-local-tags]'),
    localImpact: query('[data-wsp-local-impact]'),
    localJson: query('[data-wsp-local-json]'),
    localDownload: query('[data-wsp-local-download]'),
    localPublish: query('[data-wsp-local-publish]'),
    publishStatus: query('[data-wsp-publish-status]'),
    localClear: query('[data-wsp-local-clear]'),
    mineRetry: query('[data-wsp-mine-retry]'),
    mineLoggedOut: query('[data-wsp-mine-logged-out]'),
    mineLoading: query('[data-wsp-mine-loading]'),
    mineList: query('[data-wsp-mine-list]'),
    mineEmpty: query('[data-wsp-mine-empty]'),
    mineError: query('[data-wsp-mine-error]'),
    mineErrorText: query('[data-wsp-mine-error-text]'),
    detail: query('[data-wsp-detail]'),
    detailClose: queryAll('[data-wsp-detail-close]'),
    detailTitle: query('[data-wsp-detail-title]'),
    detailSummary: query('[data-wsp-detail-summary]'),
    detailType: query('[data-wsp-detail-type]'),
    detailScope: query('[data-wsp-detail-scope]'),
    detailRating: query('[data-wsp-detail-rating]'),
    detailVersion: query('[data-wsp-detail-version]'),
    detailAuthor: query('[data-wsp-detail-author]'),
    detailLanguage: query('[data-wsp-detail-language]'),
    detailUpdated: query('[data-wsp-detail-updated]'),
    detailTags: query('[data-wsp-detail-tags]'),
    detailImpact: query('[data-wsp-detail-impact]'),
    detailContent: query('[data-wsp-detail-content]'),
    detailError: query('[data-wsp-detail-error]'),
    detailState: query('[data-wsp-detail-state]'),
    detailDownload: query('[data-wsp-detail-download]'),
    detailOpenLocal: query('[data-wsp-detail-open-local]'),
    detailUseRemix: query('[data-wsp-detail-use-remix]'),
  };

  const state = {
    requestSequence: 0,
    requestController: null,
    cloudStatus: 'idle',
    packages: [],
    auth: { checked: false, loggedIn: false },
    authBusy: false,
    loginAttempt: null,
    logoutBusy: false,
    tokenMemory: null,
    authEpoch: 0,
    mineStatus: 'idle',
    minePackages: [],
    mineBusy: false,
    publishBusy: false,
    withdrawingIds: new Set(),
    detailPackage: null,
    detailSource: null,
    detailRequestSequence: 0,
    detailController: null,
    localPackage: null,
    publishPackage: null,
    publishValidationError: '',
    lastDialogTrigger: null,
    restoreDialogFocus: true,
    pendingViewFocus: null,
    searchTimer: 0,
  };

  function setHidden(element, hidden) {
    if (element) element.hidden = hidden;
  }

  function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== '') element.textContent = text;
    return element;
  }

  function cleanMetaString(value, maxLength, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const text = value.trim();
    return text.length <= maxLength ? text : fallback;
  }

  function normalizePublisherProfile(value, fallbackName = 'anonymous') {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const publisherId = cleanMetaString(source.publisherId, 120);
    const displayName = cleanMetaString(source.displayName, 64, fallbackName);
    let avatarUrl = '';
    const candidateUrl = cleanMetaString(source.avatarUrl, 2048);
    if (candidateUrl) {
      try {
        const url = new URL(candidateUrl);
        if (url.protocol === 'https:') avatarUrl = url.toString();
      } catch { /* Invalid public avatar URLs are ignored. */ }
    }
    const revision = Number(source.revision);
    return publisherId ? {
      publisherId,
      displayName,
      avatarUrl,
      revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
      updatedAt: cleanMetaString(source.updatedAt, 80),
    } : null;
  }

  function publisherSignature(pkg) {
    const profile = pkg.publisherProfile;
    if (!profile) return pkg.authorName;
    return `${profile.displayName} · ${profile.publisherId}`;
  }

  function normalizeListItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = cleanMetaString(raw.id, 120);
    const type = cleanMetaString(raw.type, 40);
    const cardScope = cleanMetaString(raw.cardScope, 80);
    const rating = cleanMetaString(raw.rating, 20);
    const title = cleanMetaString(raw.title, 120);
    const language = cleanMetaString(raw.language, 24, 'zh-CN');
    const packageVersion = cleanMetaString(raw.packageVersion || raw.version, 40, '1.0.0');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(id)) return null;
    if (!supportedTypes.has(type) || !supportedScopes.has(cardScope) || !supportedRatings.has(rating)) return null;
    if (!title || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(packageVersion)) return null;
    if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{2,8}){0,2}$/.test(language)) return null;
    if (raw.reviewStatus !== 'approved' || raw.withdrawnAt) return null;

    const tags = Array.isArray(raw.tags)
      ? raw.tags
        .map((tag) => cleanMetaString(tag, 40))
        .filter(Boolean)
        .slice(0, 12)
      : [];
    const authorName = cleanMetaString(raw.authorName, 80, 'anonymous');
    return {
      id,
      type,
      cardScope,
      title,
      summary: cleanMetaString(raw.summary, 600, '未提供简介。'),
      authorName,
      publisherProfile: normalizePublisherProfile(raw.publisherProfile, authorName),
      rating,
      language,
      packageVersion,
      tags: [...new Set(tags)],
      updatedAt: cleanMetaString(raw.updatedAt, 80),
    };
  }

  function formatDate(value) {
    if (!value) return '未提供';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '未提供';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  function currentStudioView() {
    const [route, subview, nestedView] = location.hash.replace(/^#/, '').split(/[/?&]/);
    if (route !== 'studio') return null;
    if (subview === 'remix') {
      return nestedView === 'local' || nestedView === 'mine' ? nestedView : 'discover';
    }
    return subview === 'discover' || subview === 'local' || subview === 'mine' ? subview : null;
  }

  function renderView() {
    const activeView = currentStudioView();
    if (!activeView) closeDetail({ restoreFocus: false });
    dom.views.forEach((view) => {
      view.hidden = view.dataset.wspView !== activeView;
    });
    dom.viewLinks.forEach((link) => {
      if (link.dataset.wspViewLink === activeView) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (state.pendingViewFocus === activeView) {
      state.pendingViewFocus = null;
      const target = activeView === 'local'
        ? query('#wsp-local-title')
        : activeView === 'mine' ? query('#wsp-mine-title') : query('#wsp-discover-title');
      window.requestAnimationFrame(() => target?.focus({ preventScroll: false }));
    }
    if (activeView) {
      maybeLoadCloud();
      maybeLoadMine();
    }
  }

  function navigateStudioView(view) {
    state.pendingViewFocus = view;
    const nextHash = `#studio/remix/${view}`;
    if (location.hash === nextHash) renderView();
    else location.hash = nextHash;
  }

  function filterValues() {
    const values = {};
    dom.filterFields.forEach((field) => {
      const value = field.value.trim();
      if (value) values[field.dataset.wspFilter] = value;
    });
    return values;
  }

  function hasFilters() {
    return Object.keys(filterValues()).length > 0;
  }

  function listUrl() {
    const url = new URL('/api/workshop/packages', gatewayBase);
    Object.entries(filterValues()).forEach(([key, value]) => url.searchParams.set(key, value));
    return url;
  }

  function setCloudState(text, kind = '') {
    dom.cloudState.textContent = text;
    dom.cloudState.dataset.kind = kind;
  }

  function showCloudPanel(panel) {
    const panels = [dom.loading, dom.empty, dom.error, dom.list];
    panels.forEach((item) => setHidden(item, item !== panel));
  }

  function updateTagOptions(packages) {
    const selected = dom.tagFilter.value;
    const tags = new Set(baseTags);
    packages.forEach((pkg) => pkg.tags.forEach((tag) => tags.add(tag)));
    if (selected) tags.add(selected);
    dom.tagFilter.replaceChildren();
    const anyOption = createElement('option', '', '全部标签');
    anyOption.value = '';
    dom.tagFilter.append(anyOption);
    [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN')).forEach((tag) => {
      const option = createElement('option', '', tag);
      option.value = tag;
      dom.tagFilter.append(option);
    });
    dom.tagFilter.value = selected;
  }

  function appendDefinition(list, label, value) {
    const row = createElement('div');
    row.append(createElement('dt', '', label), createElement('dd', '', value));
    list.append(row);
  }

  function createTagList(tags, className = 'wsp-tag-list') {
    const list = createElement('ul', className);
    if (!tags.length) {
      list.append(createElement('li', '', '无标签'));
      return list;
    }
    tags.forEach((tag) => list.append(createElement('li', '', tag)));
    return list;
  }

  function createPackageCard(pkg) {
    const listItem = createElement('li');
    const article = createElement('article', 'wsp-package-card');
    const badges = createElement('div', 'wsp-card-badges');
    const typeBadge = createElement('span', 'wsp-type-badge', typeLabels[pkg.type]);
    const ratingBadge = createElement('span', 'wsp-rating-badge', ratingLabels[pkg.rating]);
    ratingBadge.dataset.rating = pkg.rating;
    badges.append(typeBadge, ratingBadge);

    const title = createElement('h3', '', pkg.title);
    const summary = createElement('p', 'wsp-card-summary', pkg.summary);
    const metadata = createElement('dl', 'wsp-card-meta');
    appendDefinition(metadata, '发布者', publisherSignature(pkg));
    appendDefinition(metadata, '适用', scopeLabels[pkg.cardScope]);
    appendDefinition(metadata, '更新', formatDate(pkg.updatedAt));

    const actions = createElement('div', 'wsp-card-actions');
    const detailButton = createElement('button', 'wsp-button', '查看详情');
    detailButton.type = 'button';
    detailButton.setAttribute('aria-haspopup', 'dialog');
    detailButton.setAttribute('aria-controls', 'wsp-detail-dialog');
    detailButton.addEventListener('click', () => openPackageDetail(pkg, detailButton));
    actions.append(detailButton);
    article.append(badges, title, summary, createTagList(pkg.tags), metadata, actions);
    listItem.append(article);
    return listItem;
  }

  function renderPackages(packages) {
    dom.list.replaceChildren(...packages.map(createPackageCard));
    dom.count.textContent = `共 ${packages.length} 个已审核作品`;
    if (packages.length) {
      showCloudPanel(dom.list);
      return;
    }

    if (hasFilters()) {
      dom.emptyTitle.textContent = '没有符合当前条件的作品';
      dom.emptyText.textContent = '可以减少筛选条件，或清空筛选后查看全部已审核作品。';
      dom.clearEmpty.hidden = false;
    } else {
      dom.emptyTitle.textContent = '当前还没有公开作品';
      dom.emptyText.textContent = '云端已正常连接，但尚无已审核通过的内容。本地包校验仍可使用。';
      dom.clearEmpty.hidden = true;
    }
    showCloudPanel(dom.empty);
  }

  function cloudErrorMessage(error) {
    if (error?.status === 429) return '请求过于频繁，请稍后再试。';
    if (error?.status >= 500) return '星月资源服务暂时不可用，本地包校验不受影响。';
    if (error?.status === 404) return '请求的公开资源已下架或不存在。';
    if (error?.name === 'TypeError') return '暂时无法连接星月资源服务，请检查网络后重试。本地包校验仍可使用。';
    return '读取公开作品失败，请稍后重试。本地包校验仍可使用。';
  }

  function workshopToken() {
    if (state.tokenMemory !== null) return state.tokenMemory;
    try {
      return localStorage.getItem(tokenStorageKey) || '';
    } catch (_) {
      return '';
    }
  }

  function storeWorkshopToken(token) {
    const value = String(token || '');
    state.tokenMemory = value;
    state.authEpoch += 1;
    let persisted = true;
    try {
      if (value) localStorage.setItem(tokenStorageKey, value);
      else localStorage.removeItem(tokenStorageKey);
    } catch (_) {
      persisted = false;
      // 内存副本仍可维持当前页面的登录态；不把其他身份数据写入浏览器。
    }
    return persisted;
  }

  function setAuthError(message = '') {
    dom.authError.textContent = message;
    dom.authError.hidden = !message;
  }

  function setPublishStatus(message, kind = '') {
    dom.publishStatus.textContent = message;
    dom.publishStatus.dataset.kind = kind;
  }

  function renderAuth() {
    const loggedIn = state.auth.loggedIn;
    if (state.loginAttempt) dom.authStatus.textContent = '等待 Discord 登录完成…';
    else if (state.authBusy && !state.auth.checked) dom.authStatus.textContent = '正在检查登录状态…';
    else if (loggedIn) dom.authStatus.textContent = '已登录，可以发布和管理你的作品。';
    else dom.authStatus.textContent = '未登录；公开发现和本地校验不受影响。';
    dom.login.hidden = loggedIn;
    dom.logout.hidden = !loggedIn;
    dom.login.disabled = Boolean(state.loginAttempt) || state.authBusy;
    dom.logout.disabled = state.logoutBusy;
    updatePublishAction();
  }

  function invalidateAuth(requestToken = workshopToken(), requestEpoch = state.authEpoch) {
    if (requestToken !== workshopToken() || requestEpoch !== state.authEpoch) return false;
    storeWorkshopToken('');
    state.auth = { checked: true, loggedIn: false };
    state.mineStatus = 'idle';
    state.minePackages = [];
    renderAuth();
    renderMinePackages();
    return true;
  }

  function requestFailure(response, body, action, requestContext = null) {
    const error = new Error(`${action}失败`);
    error.status = response.status;
    error.code = cleanMetaString(body?.error, 120, `http-${response.status}`);
    if (response.status === 401 && requestContext) {
      invalidateAuth(requestContext.requestToken, requestContext.authEpoch);
    }
    return error;
  }

  function requestErrorMessage(error, action = '操作') {
    if (error?.code === 'request-timeout') return `${action}超时，请稍后重试。`;
    if (error?.status === 401) return '登录已失效，请重新登录。';
    if (error?.status === 403 && error?.code === 'discord guild membership required') {
      return '当前 Discord 账户尚未通过服务器成员确认，请加入对应服务器后重试。';
    }
    if (error?.status === 403) return '当前账户没有执行此操作的权限。';
    if (error?.status === 409 && error?.code === 'package-conflict') {
      return '作品已在其他位置更新，请刷新“我的发布”后重试。';
    }
    if (error?.status === 409 && error?.code === 'package-exists') {
      return '这个作品 ID 已被占用，请更换 ID 后重新发布。';
    }
    if (error?.status === 409) return '当前状态已变化，请刷新后重试。';
    if (error?.status === 428) return '缺少有效的修订号，请刷新“我的发布”后重试。';
    if (error?.status === 429) return '请求过于频繁，请稍后再试。';
    if (error?.status >= 500) return '星月资源服务暂时不可用，请稍后重试。';
    if (error?.name === 'TypeError') return '暂时无法连接星月资源服务，请检查网络后重试。';
    return `${action}失败，请稍后重试。`;
  }

  async function workshopRequest(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || requestTimeoutMs);
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const token = options.auth === false ? '' : workshopToken();
    const authEpoch = state.authEpoch;
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    try {
      const response = await fetch(new URL(path, gatewayBase), {
        method: options.method || 'GET',
        credentials: 'omit',
        headers,
        body,
        signal: controller.signal,
      });
      return {
        response,
        body: await response.json().catch(() => ({})),
        requestToken: token,
        authEpoch,
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeoutError = new Error('request-timeout');
        timeoutError.code = 'request-timeout';
        throw timeoutError;
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function refreshAuth() {
    if (state.authBusy) return state.auth;
    state.authBusy = true;
    renderAuth();
    try {
      const result = await workshopRequest('/api/workshop/me');
      const { response, body } = result;
      if (result.authEpoch !== state.authEpoch || result.requestToken !== workshopToken()) return state.auth;
      if (response.status === 401) {
        invalidateAuth(result.requestToken, result.authEpoch);
        setAuthError('');
        return state.auth;
      }
      if (!response.ok) throw requestFailure(response, body, '确认登录状态', result);
      state.auth = { checked: true, loggedIn: Boolean(body.loggedIn) };
      setAuthError('');
      if (state.auth.loggedIn && currentStudioView() === 'mine') void loadMyPackages();
      return state.auth;
    } catch (error) {
      state.auth = { checked: true, loggedIn: false };
      setAuthError(requestErrorMessage(error, '确认登录状态'));
      return state.auth;
    } finally {
      state.authBusy = false;
      renderAuth();
      renderMinePackages();
    }
  }

  function randomHex(byteLength) {
    if (typeof crypto?.getRandomValues !== 'function') throw new Error('secure-random-unavailable');
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function handoffChallenge(secret) {
    if (typeof crypto?.subtle?.digest !== 'function' || typeof TextEncoder !== 'function') {
      throw new Error('secure-digest-unavailable');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function beginLogin() {
    if (state.loginAttempt || state.auth.loggedIn) return;
    setAuthError('');
    const popup = window.open('about:blank', 'rpn-workshop-login', 'width=520,height=720');
    if (!popup) {
      setAuthError('浏览器阻止了登录窗口，请允许弹窗后重试。');
      return;
    }
    try {
      popup.document.title = '正在连接星月二创资源库…';
      popup.document.body.textContent = '正在准备 Discord 登录，请稍候…';
    } catch (_) {
      // 弹窗已创建即可继续，跨域导航后不再读取其内容。
    }

    const attempt = { popup, handoffId: '' };
    state.loginAttempt = attempt;
    renderAuth();
    let completed = false;
    try {
      attempt.handoffId = `xyh_${randomHex(24)}`;
      const secret = randomHex(32);
      const challenge = await handoffChallenge(secret);
      const started = await workshopRequest('/api/workshop/login-handoff/start', {
        method: 'POST',
        auth: false,
        body: { handoffId: attempt.handoffId, challenge },
      });
      if (!started.response.ok) throw requestFailure(started.response, started.body, '启动登录', started);
      const expiresInMs = Number(started.body.expiresInMs);
      if (!Number.isFinite(expiresInMs) || expiresInMs < 1000 || expiresInMs > 10 * 60 * 1000) {
        throw new Error('invalid-login-deadline');
      }

      const loginUrl = new URL('/auth/discord/login', gatewayBase);
      loginUrl.searchParams.set('handoff', attempt.handoffId);
      popup.location.replace(loginUrl.toString());
      const deadline = Date.now() + expiresInMs;
      await wait(500);

      while (state.loginAttempt === attempt && Date.now() <= deadline) {
        const claimed = await workshopRequest('/api/workshop/login-handoff', {
          method: 'POST',
          auth: false,
          body: { handoffId: attempt.handoffId, secret },
        });
        if (claimed.response.ok && claimed.body.status === 'ready' && claimed.body.token) {
          const persisted = storeWorkshopToken(claimed.body.token);
          state.auth = { checked: false, loggedIn: false };
          await refreshAuth();
          if (!state.auth.loggedIn) throw new Error('invalid-login-token');
          completed = true;
          state.mineStatus = 'idle';
          setAuthError(persisted ? '' : '浏览器本地存储不可用；本次登录只在当前页面有效。');
          break;
        }
        if (claimed.response.status !== 202) {
          throw requestFailure(claimed.response, claimed.body, '完成登录', claimed);
        }
        if (popup.closed) throw new Error('login-popup-closed');
        await wait(800);
      }
      if (!completed) throw new Error('login-timeout');
    } catch (error) {
      storeWorkshopToken('');
      state.auth = { checked: true, loggedIn: false };
      if (error?.message === 'login-popup-closed') setAuthError('登录窗口已关闭，请重新尝试。');
      else if (error?.message === 'login-timeout') {
        setAuthError('登录等待已超时；请确认已完成 Discord 授权并通过服务器成员确认。');
      } else if (error?.message === 'secure-random-unavailable' || error?.message === 'secure-digest-unavailable') {
        setAuthError('当前浏览器缺少安全登录能力，请改用支持 HTTPS 与 Web Crypto 的浏览器。');
      } else setAuthError(requestErrorMessage(error, 'Discord 登录'));
    } finally {
      if (state.loginAttempt === attempt) state.loginAttempt = null;
      try { popup.close(); } catch (_) {}
      renderAuth();
      renderMinePackages();
    }
  }

  async function logoutWorkshop() {
    if (state.logoutBusy) return;
    state.logoutBusy = true;
    renderAuth();
    let remoteFailed = false;
    try {
      const { response } = await workshopRequest('/api/workshop/logout', { method: 'POST' });
      remoteFailed = !response.ok;
    } catch (_) {
      remoteFailed = true;
    } finally {
      storeWorkshopToken('');
      state.auth = { checked: true, loggedIn: false };
      state.mineStatus = 'idle';
      state.minePackages = [];
      state.logoutBusy = false;
      setAuthError(remoteFailed ? '已在当前浏览器退出；星月资源服务暂未响应。' : '');
      renderAuth();
      renderMinePackages();
    }
  }

  async function fetchJson(url, signal) {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) {
      const error = new Error(`http-${response.status}`);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  async function loadPackages() {
    const sequence = state.requestSequence + 1;
    state.requestSequence = sequence;
    state.requestController?.abort();
    state.requestController = new AbortController();
    state.cloudStatus = 'loading';
    dom.discoverView.setAttribute('aria-busy', 'true');
    setCloudState('正在连接星月公开资源库…');
    dom.count.textContent = '正在读取';
    showCloudPanel(dom.loading);

    try {
      const response = await fetchJson(listUrl(), state.requestController.signal);
      if (sequence !== state.requestSequence) return;
      const source = Array.isArray(response?.packages) ? response.packages : [];
      const deduplicated = new Map();
      source.map(normalizeListItem).filter(Boolean).forEach((pkg) => {
        deduplicated.set(`${pkg.type}:${pkg.id}`, pkg);
      });
      state.packages = [...deduplicated.values()];
      state.cloudStatus = 'ready';
      dom.discoverView.setAttribute('aria-busy', 'false');
      updateTagOptions(state.packages);
      setCloudState('已连接 · 仅显示审核通过的作品', 'ok');
      renderPackages(state.packages);
    } catch (error) {
      if (error?.name === 'AbortError' || sequence !== state.requestSequence) return;
      state.packages = [];
      state.cloudStatus = 'error';
      dom.discoverView.setAttribute('aria-busy', 'false');
      dom.count.textContent = '云端暂不可用';
      dom.errorText.textContent = cloudErrorMessage(error);
      setCloudState('连接失败 · 本地包仍可使用', 'error');
      showCloudPanel(dom.error);
    }
  }

  function maybeLoadCloud() {
    const route = location.hash.replace(/^#/, '').split(/[/?&]/)[0] || 'guide';
    if (route === 'studio' && currentStudioView() === 'discover' && state.cloudStatus === 'idle') {
      loadPackages();
    }
  }

  function showMinePanel(panel) {
    [dom.mineLoggedOut, dom.mineLoading, dom.mineList, dom.mineEmpty, dom.mineError]
      .forEach((item) => setHidden(item, item !== panel));
  }

  function normalizeOwnedPackage(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const id = cleanMetaString(raw.id, 120);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}$/.test(id)) return null;
    const revision = Number(raw.revision);
    const reviewStatus = raw.withdrawnAt
      ? 'withdrawn'
      : cleanMetaString(raw.reviewStatus, 20, 'pending');
    if (!Object.hasOwn(reviewLabels, reviewStatus)) return null;
    return {
      id,
      title: cleanMetaString(raw.title, 120, id),
      summary: cleanMetaString(raw.summary, 600, '未提供简介。'),
      type: cleanMetaString(raw.type, 40),
      revision: Number.isSafeInteger(revision) && revision >= 1 ? revision : null,
      reviewStatus,
      rejectionReason: cleanMetaString(raw.rejectionReason, 600),
      updatedAt: cleanMetaString(raw.updatedAt, 80),
    };
  }

  function createOwnedPackageCard(pkg) {
    const item = createElement('li');
    const article = createElement('article', 'wsp-own-package-card');
    const head = createElement('div', 'wsp-own-package-head');
    const title = createElement('h3', '', pkg.title);
    const badge = createElement('span', 'wsp-review-badge', reviewLabels[pkg.reviewStatus]);
    badge.dataset.status = pkg.reviewStatus;
    head.append(title, badge);
    article.append(head, createElement('p', '', pkg.summary));

    const meta = createElement('div', 'wsp-own-package-meta');
    meta.append(
      createElement('span', '', typeLabels[pkg.type] || '作品包'),
      createElement('span', '', `revision ${pkg.revision ?? '未知'}`),
      createElement('span', '', `更新 ${formatDate(pkg.updatedAt)}`),
    );
    article.append(meta);
    if (pkg.reviewStatus === 'rejected' && pkg.rejectionReason) {
      article.append(createElement('p', 'wsp-rejection-reason', `拒绝原因：${pkg.rejectionReason}`));
    }

    const actions = createElement('div', 'wsp-own-package-actions');
    const actionStatus = createElement('p', 'wsp-action-status');
    actionStatus.setAttribute('role', 'status');
    actionStatus.setAttribute('aria-live', 'polite');
    if (pkg.reviewStatus !== 'withdrawn') {
      const withdraw = createElement('button', 'wsp-button', '撤回');
      withdraw.type = 'button';
      withdraw.disabled = state.withdrawingIds.has(pkg.id) || pkg.revision === null;
      withdraw.addEventListener('click', () => withdrawOwnedPackage(pkg, withdraw, actionStatus));
      actions.append(withdraw);
    }
    if (actions.childElementCount) article.append(actions);
    article.append(actionStatus);
    item.append(article);
    return item;
  }

  function renderMinePackages() {
    dom.mineView.setAttribute('aria-busy', state.mineBusy ? 'true' : 'false');
    dom.mineRetry.disabled = state.mineBusy || !state.auth.loggedIn;
    if (!state.auth.loggedIn) {
      showMinePanel(dom.mineLoggedOut);
      return;
    }
    if (state.mineBusy || state.mineStatus === 'loading') {
      showMinePanel(dom.mineLoading);
      return;
    }
    if (state.mineStatus === 'error') {
      showMinePanel(dom.mineError);
      return;
    }
    if (state.mineStatus === 'ready' && state.minePackages.length) {
      dom.mineList.replaceChildren(...state.minePackages.map(createOwnedPackageCard));
      showMinePanel(dom.mineList);
      return;
    }
    if (state.mineStatus === 'ready') {
      showMinePanel(dom.mineEmpty);
      return;
    }
    showMinePanel(dom.mineLoading);
  }

  async function fetchOwnedPackages() {
    const result = await workshopRequest('/api/workshop/me/packages');
    const { response, body } = result;
    if (result.authEpoch !== state.authEpoch || result.requestToken !== workshopToken() || !state.auth.loggedIn) {
      const error = new Error('stale-auth-request');
      error.code = 'stale-auth-request';
      throw error;
    }
    if (!response.ok) throw requestFailure(response, body, '读取我的发布', result);
    const packages = Array.isArray(body?.packages)
      ? body.packages.map(normalizeOwnedPackage).filter(Boolean)
      : [];
    state.minePackages = packages;
    state.mineStatus = 'ready';
    return packages;
  }

  async function loadMyPackages() {
    if (!state.auth.loggedIn || state.mineBusy) {
      renderMinePackages();
      return state.minePackages;
    }
    state.mineBusy = true;
    state.mineStatus = 'loading';
    renderMinePackages();
    let retryForCurrentAuth = false;
    try {
      return await fetchOwnedPackages();
    } catch (error) {
      if (error?.code === 'stale-auth-request') {
        state.mineStatus = 'idle';
        retryForCurrentAuth = true;
      } else if (error?.status !== 401) {
        state.mineStatus = 'error';
        dom.mineErrorText.textContent = requestErrorMessage(error, '读取我的发布');
      }
      return [];
    } finally {
      state.mineBusy = false;
      renderMinePackages();
      if (retryForCurrentAuth && state.auth.loggedIn && currentStudioView() === 'mine') {
        void loadMyPackages();
      }
    }
  }

  function maybeLoadMine() {
    if (currentStudioView() !== 'mine') return;
    if (state.auth.loggedIn && state.mineStatus === 'idle') void loadMyPackages();
    else renderMinePackages();
  }

  function portablePackage(pkg) {
    const portable = JSON.parse(JSON.stringify(pkg));
    ['revision', 'contentHash', 'reviewStatus', 'rejectionReason', 'withdrawnAt', 'publisherId', 'publisherProfile'].forEach((key) => delete portable[key]);
    return portable;
  }

  function normalizePublishPackage(pkg) {
    return workshopPackageContract.normalizePackage(portablePackage(pkg), {
      allowLegacyFactors: false,
      allowLegacyExtensions: false,
      allowLegacyCharacterAliases: false,
      portableMediaOnly: true,
    });
  }

  function publishValidationMessage(error) {
    const code = error?.code || '';
    if (code === 'embedded-character-image-data' || /^invalid-character-(?:avatar|portrait)/.test(code)) {
      return '角色图片需使用可公开访问的 HTTP(S) URL；当前阶段不上传本地或内嵌媒体。';
    }
    return `当前内容不符合云端发布要求${code ? `：${code}` : '。'}`;
  }

  function updatePublishAction() {
    const ready = state.auth.loggedIn && Boolean(state.publishPackage) && !state.publishBusy;
    dom.localPublish.disabled = !ready;
    dom.localPublish.textContent = state.publishBusy ? '正在提交…' : '发布到星月二创资源库';
  }

  async function publishLocalPackage() {
    if (state.publishBusy) return;
    const candidate = state.publishPackage;
    if (!candidate) {
      setPublishStatus(
        state.localPackage ? state.publishValidationError : '请先选择并校验一个作品包。',
        'error',
      );
      return;
    }
    if (!state.auth.loggedIn) {
      setPublishStatus('请先使用 Discord 登录。', 'error');
      return;
    }

    state.publishBusy = true;
    setPublishStatus(`正在确认“${candidate.title}”的作品状态…`);
    updatePublishAction();
    try {
      const owned = await fetchOwnedPackages();
      const existing = owned.find((pkg) => pkg.id === candidate.id);
      const updating = Boolean(existing);
      if (updating && existing.revision === null) {
        const error = new Error('revision-required');
        error.status = 428;
        error.code = 'revision-required';
        throw error;
      }
      const confirmation = updating
        ? `已存在同 ID 的“${existing.title}”（revision ${existing.revision}）。确认用当前本地包更新它吗？`
        : `确认把“${candidate.title}”提交到星月二创资源库审核吗？`;
      if (!window.confirm(confirmation)) {
        setPublishStatus(updating ? '已取消更新。' : '已取消发布。');
        return;
      }
      const path = updating
        ? `/api/workshop/packages/${encodeURIComponent(candidate.id)}`
        : '/api/workshop/packages';
      const headers = updating ? { 'X-Package-Revision': String(existing.revision) } : {};
      const result = await workshopRequest(path, {
        method: updating ? 'PUT' : 'POST',
        headers,
        body: portablePackage(candidate),
      });
      if (!result.response.ok) {
        throw requestFailure(result.response, result.body, updating ? '更新作品' : '发布作品', result);
      }
      const revision = Number(result.body?.revision);
      setPublishStatus(
        `${updating ? '更新' : '发布'}已提交${Number.isSafeInteger(revision) ? ` · revision ${revision}` : ''}，请在“我的发布”查看审核状态。`,
        'ok',
      );
      state.cloudStatus = 'idle';
      try { await fetchOwnedPackages(); } catch (_) { state.mineStatus = 'idle'; }
      if (currentStudioView() === 'mine') renderMinePackages();
    } catch (error) {
      setPublishStatus(requestErrorMessage(error, '提交作品'), 'error');
    } finally {
      state.publishBusy = false;
      updatePublishAction();
    }
  }

  async function withdrawOwnedPackage(pkg, button, status) {
    if (state.withdrawingIds.has(pkg.id)) return;
    if (pkg.revision === null) {
      status.textContent = '缺少有效的修订号，请刷新后重试。';
      status.dataset.kind = 'error';
      return;
    }
    if (!window.confirm(`确认撤回“${pkg.title}”吗？撤回后将不再出现在公开作品中。`)) return;
    state.withdrawingIds.add(pkg.id);
    button.disabled = true;
    button.textContent = '正在撤回…';
    status.textContent = '';
    status.dataset.kind = '';
    try {
      const result = await workshopRequest(`/api/workshop/packages/${encodeURIComponent(pkg.id)}`, {
        method: 'DELETE',
        headers: { 'X-Package-Revision': String(pkg.revision) },
      });
      if (!result.response.ok) throw requestFailure(result.response, result.body, '撤回作品', result);
      state.cloudStatus = 'idle';
      state.mineStatus = 'idle';
      await loadMyPackages();
    } catch (error) {
      status.textContent = requestErrorMessage(error, '撤回作品');
      status.dataset.kind = 'error';
      button.disabled = false;
      button.textContent = '撤回';
    } finally {
      state.withdrawingIds.delete(pkg.id);
    }
  }

  function downloadPackage(pkg) {
    const portable = portablePackage(pkg);
    const blob = new Blob([`${JSON.stringify(portable, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${portable.id}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  function impactItems(pkg) {
    const typeImpact = {
      character: '导入角色卡后，角色资料会进入对应的世界书内容。',
      user_identity: '导入角色卡后，玩家身份资料会进入对应的世界书内容。',
      world_factor: '导入角色卡后，世界因子会进入对应的世界书内容。',
      shop_item: '导入角色卡后，商店物品条目会进入对应的世界书扩展。',
      blueprint: '导入角色卡后，制造蓝图条目会进入对应的世界书扩展。',
      recipe: '导入角色卡后，配方条目会进入对应的世界书扩展。',
      skill: '导入角色卡后，技能条目会进入对应的世界书扩展。',
      function: '导入角色卡后，功能条目会进入对应的世界书扩展。',
    }[pkg.type];
    const scopeImpact = {
      xingyue: '适用目标是星月角色卡。',
      shared: '这是通用包，后续导入时仍需选择兼容的目标角色卡。',
      'xingyue-opening-v1': '适用目标是星月开局世界书通道。',
    }[pkg.cardScope];
    return [
      typeImpact,
      scopeImpact,
      '当前页面不会安装作品，也不会写入世界书、MVU、消息楼层或草稿；只有主动点击发布时才会上传当前内容包。',
    ].filter(Boolean);
  }

  function renderImpact(list, pkg) {
    list.replaceChildren(...impactItems(pkg).map((item) => createElement('li', '', item)));
  }

  function setDetailLoading(meta) {
    state.detailPackage = null;
    state.detailSource = meta;
    dom.detail.setAttribute('aria-describedby', 'wsp-detail-state');
    dom.detailTitle.textContent = meta.title;
    dom.detailSummary.textContent = '正在读取并校验完整包…';
    dom.detailState.textContent = '读取中';
    dom.detailContent.hidden = true;
    dom.detailError.hidden = true;
    dom.detailDownload.disabled = true;
    dom.detailOpenLocal.disabled = true;
    dom.detailUseRemix.disabled = true;
  }

  function renderDetail(pkg) {
    state.detailPackage = pkg;
    dom.detail.setAttribute('aria-describedby', 'wsp-detail-summary');
    dom.detailTitle.textContent = pkg.title;
    dom.detailSummary.textContent = pkg.summary || '未提供简介。';
    dom.detailType.textContent = typeLabels[pkg.type];
    dom.detailScope.textContent = scopeLabels[pkg.cardScope];
    dom.detailRating.textContent = ratingLabels[pkg.rating];
    dom.detailVersion.textContent = pkg.packageVersion;
    dom.detailAuthor.textContent = publisherSignature(pkg);
    dom.detailLanguage.textContent = pkg.language;
    dom.detailUpdated.textContent = formatDate(pkg.updatedAt);
    dom.detailTags.replaceChildren(...createTagList(pkg.tags, 'wsp-detail-tags').children);
    renderImpact(dom.detailImpact, pkg);
    dom.detailContent.hidden = false;
    dom.detailError.hidden = true;
    dom.detailState.textContent = '共享契约校验通过';
    dom.detailDownload.disabled = false;
    dom.detailOpenLocal.disabled = false;
    dom.detailUseRemix.disabled = false;
  }

  function renderDetailError(error) {
    state.detailPackage = null;
    dom.detail.setAttribute('aria-describedby', 'wsp-detail-error');
    dom.detailContent.hidden = true;
    dom.detailError.hidden = false;
    dom.detailError.textContent = error?.status === 404
      ? '这个作品已下架或不再公开。'
      : cloudErrorMessage(error);
    dom.detailState.textContent = '读取失败';
    dom.detailDownload.disabled = true;
    dom.detailOpenLocal.disabled = true;
    dom.detailUseRemix.disabled = true;
  }

  async function openPackageDetail(meta, trigger) {
    const sequence = state.detailRequestSequence + 1;
    state.detailRequestSequence = sequence;
    state.detailController?.abort();
    state.detailController = new AbortController();
    state.lastDialogTrigger = trigger;
    state.restoreDialogFocus = true;
    setDetailLoading(meta);
    if (!dom.detail.open) dom.detail.showModal();
    dom.detailTitle.focus({ preventScroll: true });
    try {
      const url = new URL(`/api/workshop/packages/${encodeURIComponent(meta.id)}`, gatewayBase);
      const raw = await fetchJson(url, state.detailController.signal);
      if (sequence !== state.detailRequestSequence) return;
      const normalized = workshopPackageContract.normalizePackage(raw, { allowLegacyFactors: true });
      const pkg = {
        ...normalized,
        publisherProfile: normalizePublisherProfile(raw.publisherProfile, normalized.authorName),
      };
      if (pkg.id !== meta.id || pkg.type !== meta.type || pkg.reviewStatus !== 'approved' || pkg.withdrawnAt) {
        throw new Error('detail-mismatch');
      }
      renderDetail(pkg);
    } catch (error) {
      if (error?.name === 'AbortError' || sequence !== state.detailRequestSequence) return;
      renderDetailError(error);
    }
  }

  function closeDetail({ restoreFocus = true } = {}) {
    state.detailController?.abort();
    state.restoreDialogFocus = restoreFocus;
    if (dom.detail.open) dom.detail.close();
  }

  function localErrorMessage(error) {
    const code = error?.code || '';
    if (code === 'blocked-package-type') return '这个包类型当前被禁止：开局包、提示补丁和界面主题不属于可导入作品。';
    if (code === 'unsupported-package-type') return '当前只支持角色、玩家身份、世界因子、商店物品、蓝图、配方、技能和功能。';
    if (code === 'package-too-large' || code === 'file-too-large') return '文件超过 256 KiB，请精简后再校验。';
    if (code === 'package-not-object') return 'JSON 顶层必须是一个作品对象。';
    if (code === 'package-payload-required') return '作品缺少 payload 内容。';
    if (error instanceof SyntaxError) return '文件不是有效的 JSON。';
    if (error?.status === 404) return '示例文件不存在或已移动。';
    if (error?.name === 'TypeError') return '示例暂时无法读取，请改为选择本地 JSON 文件。';
    return `作品未通过共享契约校验${code ? `：${code}` : '。'}`;
  }

  function setLocalStatus(text, kind = '') {
    dom.localStatus.textContent = text;
    dom.localStatus.dataset.kind = kind;
  }

  function clearLocalPackage({ keepStatus = false } = {}) {
    state.localPackage = null;
    state.publishPackage = null;
    state.publishValidationError = '';
    dom.fileInput.value = '';
    dom.localEmpty.hidden = false;
    dom.localResult.hidden = true;
    dom.localJson.textContent = '';
    dom.localImpact.replaceChildren();
    if (!keepStatus) setLocalStatus('尚未选择文件。');
    setPublishStatus('登录并通过校验后可发布。');
    updatePublishAction();
  }

  function setLocalFailure(error) {
    clearLocalPackage({ keepStatus: true });
    setLocalStatus(localErrorMessage(error), 'error');
    setPublishStatus('作品未通过校验，不能发布。', 'error');
  }

  function setLocalPackage(pkg, sourceLabel) {
    state.localPackage = pkg;
    try {
      state.publishPackage = normalizePublishPackage(pkg);
      state.publishValidationError = '';
    } catch (error) {
      state.publishPackage = null;
      state.publishValidationError = publishValidationMessage(error);
    }
    dom.localTitle.textContent = pkg.title;
    dom.localSummary.textContent = pkg.summary || '未提供简介。';
    dom.localType.textContent = typeLabels[pkg.type];
    dom.localScope.textContent = scopeLabels[pkg.cardScope];
    dom.localRating.textContent = ratingLabels[pkg.rating];
    dom.localVersion.textContent = pkg.packageVersion;
    dom.localAuthor.textContent = publisherSignature(pkg);
    dom.localLanguage.textContent = pkg.language;
    dom.localTags.textContent = pkg.tags.length ? pkg.tags.join('、') : '无';
    renderImpact(dom.localImpact, pkg);
    dom.localJson.textContent = `${JSON.stringify(portablePackage(pkg), null, 2)}\n`;
    dom.localEmpty.hidden = true;
    dom.localResult.hidden = false;
    setLocalStatus(`${sourceLabel} · 已兼容读取并规范化`, 'ok');
    if (state.publishPackage) {
      setPublishStatus(state.auth.loggedIn ? '发布校验通过，可以发布。' : '发布校验通过；登录后可以发布。');
    } else {
      setPublishStatus(state.publishValidationError, 'error');
    }
    updatePublishAction();
  }

  function validateLocalText(text, sourceLabel) {
    if (new TextEncoder().encode(text).byteLength > 256 * 1024) {
      const error = new Error('file-too-large');
      error.code = 'file-too-large';
      throw error;
    }
    const raw = JSON.parse(text);
    const pkg = workshopPackageContract.normalizePackage(raw, { allowLegacyFactors: true });
    setLocalPackage(pkg, sourceLabel);
  }

  async function loadLocalFile(file) {
    if (!file) return;
    try {
      if (file.size > 256 * 1024) {
        const error = new Error('file-too-large');
        error.code = 'file-too-large';
        throw error;
      }
      validateLocalText(await file.text(), file.name || '本地文件');
    } catch (error) {
      setLocalFailure(error);
    }
  }

  async function loadExample(relativePath, button) {
    const label = exampleLabels[relativePath] || '示例包';
    const previousText = button.textContent;
    const restoreFocus = document.activeElement === button;
    button.disabled = true;
    button.textContent = '读取中…';
    try {
      const response = await fetch(new URL(relativePath, document.baseURI), {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        const error = new Error(`http-${response.status}`);
        error.status = response.status;
        throw error;
      }
      validateLocalText(await response.text(), `${label}示例`);
    } catch (error) {
      setLocalFailure(error);
    } finally {
      button.disabled = false;
      button.textContent = previousText;
      if (restoreFocus) button.focus({ preventScroll: true });
    }
  }

  function resetFilters() {
    dom.filters.reset();
    updateTagOptions(state.packages);
    loadPackages();
  }

  function bindEvents() {
    window.addEventListener('hashchange', renderView);
    window.addEventListener('portal:routechange', (event) => {
      renderView();
      if (!currentStudioView()) closeDetail({ restoreFocus: false });
    });

    dom.filters.addEventListener('submit', (event) => {
      event.preventDefault();
      loadPackages();
    });
    dom.filterFields.forEach((field) => {
      if (field.dataset.wspFilter === 'q') {
        field.addEventListener('input', () => {
          window.clearTimeout(state.searchTimer);
          state.searchTimer = window.setTimeout(loadPackages, 320);
        });
      } else {
        field.addEventListener('change', loadPackages);
      }
    });
    dom.filterReset.addEventListener('click', resetFilters);
    dom.clearEmpty.addEventListener('click', resetFilters);
    dom.retry.addEventListener('click', loadPackages);
    dom.goLocal.forEach((button) => button.addEventListener('click', () => navigateStudioView('local')));
    dom.login.addEventListener('click', () => void beginLogin());
    dom.logout.addEventListener('click', () => void logoutWorkshop());
    dom.mineRetry.addEventListener('click', () => void loadMyPackages());

    dom.fileInput.addEventListener('change', () => loadLocalFile(dom.fileInput.files?.[0]));
    dom.dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        dom.fileInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach((eventName) => dom.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.dropzone.dataset.dragActive = 'true';
    }));
    ['dragleave', 'drop'].forEach((eventName) => dom.dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dom.dropzone.dataset.dragActive = 'false';
    }));
    dom.dropzone.addEventListener('drop', (event) => loadLocalFile(event.dataTransfer?.files?.[0]));
    dom.examples.forEach((button) => button.addEventListener('click', () => loadExample(button.dataset.wspExample, button)));
    dom.localDownload.addEventListener('click', () => state.localPackage && downloadPackage(state.localPackage));
    dom.localPublish.addEventListener('click', () => void publishLocalPackage());
    dom.localClear.addEventListener('click', () => {
      clearLocalPackage();
      dom.dropzone.focus({ preventScroll: true });
    });

    dom.detailClose.forEach((button) => button.addEventListener('click', closeDetail));
    dom.detail.addEventListener('click', (event) => {
      if (event.target === dom.detail) closeDetail();
    });
    dom.detail.addEventListener('cancel', () => state.detailController?.abort());
    dom.detail.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab') return;
      const focusable = queryAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])', dom.detail)
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dom.detail.addEventListener('close', () => {
      if (state.restoreDialogFocus) state.lastDialogTrigger?.focus({ preventScroll: true });
      state.lastDialogTrigger = null;
      state.restoreDialogFocus = true;
    });
    dom.detailDownload.addEventListener('click', () => state.detailPackage && downloadPackage(state.detailPackage));
    dom.detailOpenLocal.addEventListener('click', () => {
      if (!state.detailPackage) return;
      setLocalPackage(state.detailPackage, `云端作品 ${state.detailPackage.id}`);
      closeDetail({ restoreFocus: false });
      navigateStudioView('local');
    });
    dom.detailUseRemix.addEventListener('click', () => {
      if (!state.detailPackage) return;
      window.dispatchEvent(new CustomEvent('rpn:remix-use', {
        detail: { package: structuredClone(state.detailPackage) },
      }));
      closeDetail({ restoreFocus: false });
    });
  }

  function init() {
    renderView();
    updateTagOptions([]);
    clearLocalPackage();
    bindEvents();
    renderAuth();
    renderMinePackages();
    void refreshAuth();
    maybeLoadCloud();
  }

  init();
}
