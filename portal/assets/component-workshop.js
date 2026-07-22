import componentPackageContract from '../shared/component-workshop-contract.js';

const tokenStorageKey = 'xingyue-workshop-token';
const requestTimeoutMs = 15000;
const componentPackageFields = componentPackageContract.packageFields;
const componentResponseMetadataFields = new Set([
  'contentHash',
  'createdAt',
  'manifestUrl',
  'publisherId',
  'publisherProfile',
  'rejectionReason',
  'reviewStatus',
  'revision',
  'updatedAt',
  'withdrawnAt',
]);
const reviewLabels = Object.freeze({
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  withdrawn: '已撤回',
});
const stageLabels = Object.freeze({
  variable_core: '变量核心',
  component_assembly: '组件装配',
  release: '发布组件',
});

const componentWorkshopRoots = [...document.querySelectorAll('[data-cws-root]')];

function activateComponentWorkshop() {
  componentWorkshopRoots.forEach((root) => {
    if (root.dataset.cwsInitialized === 'true') return;
    root.dataset.cwsInitialized = 'true';
    initComponentWorkshop(root);
  });
}

window.addEventListener('portal:routechange', (event) => {
  if (event.detail?.route === 'workshop') activateComponentWorkshop();
});

if (document.body.dataset.route === 'workshop' || location.hash.replace(/^#/, '').split(/[/?&]/)[0] === 'workshop') {
  activateComponentWorkshop();
}

function initComponentWorkshop(root) {
  const gatewayBase = new URL(root.dataset.gatewayBase || document.baseURI);
  root.innerHTML = `
    <div class="cws-shell" data-cws-shell data-cws-active-view="discover">
      <header class="cws-header">
        <div>
          <span class="cws-kicker">RPN Creative Workshop</span>
          <h2>创意工坊</h2>
          <p>发现与发布社区组件；组件包只做格式、安全与静态预览检查，不执行脚本，也不连接 SillyTavern 命令能力。</p>
        </div>
        <div class="cws-header-side">
          <a class="cws-remix-link" href="#studio/remix">
            <span>星月二创资源库</span>
            <small>访问既有星月内容包与二创入口</small>
          </a>
          <div class="cws-auth">
            <span data-cws-auth-status>正在检查登录状态…</span>
            <button type="button" data-cws-login>使用 Discord 登录</button>
            <button type="button" data-cws-profile-open hidden>公开署名</button>
            <button type="button" data-cws-logout hidden>退出</button>
          </div>
        </div>
      </header>
      <p class="cws-message cws-message-error" data-cws-auth-error hidden></p>

      <section class="cws-profile-panel" data-cws-profile-panel hidden aria-labelledby="cws-profile-title">
        <header>
          <div>
            <span class="cws-kicker">Public Publisher Profile</span>
            <h3 id="cws-profile-title">公开署名</h3>
            <p>公开资料与登录会话分离；退出后，其他用户仍能在已发布组件上看到署名。</p>
          </div>
          <button type="button" data-cws-profile-close>关闭</button>
        </header>
        <div class="cws-profile-grid">
          <div class="cws-profile-preview">
            <img data-cws-profile-avatar alt="" referrerpolicy="no-referrer" hidden>
            <span data-cws-profile-avatar-fallback>?</span>
            <strong data-cws-profile-preview-name>尚未设置</strong>
            <small data-cws-profile-id></small>
          </div>
          <div class="cws-profile-fields">
            <label><span>公开显示名</span><input data-cws-profile-name maxlength="64" autocomplete="off"></label>
            <label><span>头像（PNG / JPEG / WebP，最大 256 KiB）</span><input type="file" accept="image/png,image/jpeg,image/webp" data-cws-profile-avatar-file></label>
            <div class="cws-actions">
              <button type="button" data-cws-profile-clear-avatar>移除头像</button>
              <button type="button" data-cws-profile-save>保存公开署名</button>
              <button type="button" data-cws-profile-delete hidden>删除公开资料</button>
            </div>
            <p class="cws-message" data-cws-profile-status></p>
          </div>
        </div>
      </section>

      <nav class="cws-tabs" aria-label="创意工坊页面">
        <button type="button" data-cws-view-link="discover" aria-current="page">社区发现</button>
        <button type="button" data-cws-view-link="local">格式与安全检查</button>
        <button type="button" data-cws-view-link="mine">我的发布</button>
      </nav>

      <section class="cws-view" data-cws-view="discover">
        <div class="cws-toolbar">
          <label>
            <span>搜索</span>
            <input type="search" data-cws-search placeholder="组件 ID、名称、简介或标签">
          </label>
          <button type="button" data-cws-discover-retry>刷新</button>
        </div>
        <p class="cws-message" data-cws-discover-status role="status" aria-live="polite" aria-atomic="true">正在读取社区组件…</p>
        <div class="cws-discover-layout">
          <div class="cws-card-list" data-cws-discover-list aria-live="polite"></div>
          <aside class="cws-detail" data-cws-detail hidden>
            <button class="cws-detail-close" type="button" data-cws-detail-close aria-label="关闭详情">×</button>
            <div data-cws-detail-body></div>
          </aside>
        </div>
      </section>

      <section class="cws-view" data-cws-view="local" hidden>
        <div class="cws-local-grid">
          <section class="cws-panel">
            <h3>组件包格式与安全检查</h3>
            <p>检查包体结构、路径、文件类型、哈希与依赖字段，并提供不执行脚本的静态预览；检查通过不代表官方背书或审核通过。支持 JSON 文件或粘贴文本，单包最多 48 个文本文件、总正文不超过 1 MiB。</p>
            <label class="cws-file-picker">
              <span>选择 JSON 文件</span>
              <input type="file" accept="application/json,.json" data-cws-file>
            </label>
            <label>
              <span>组件包 JSON</span>
              <textarea rows="16" spellcheck="false" data-cws-local-text></textarea>
            </label>
            <div class="cws-actions">
              <button type="button" data-cws-local-validate>检查并预览</button>
              <button type="button" data-cws-local-clear>清空</button>
            </div>
            <p class="cws-message" data-cws-local-status>尚未导入组件包。</p>
          </section>

          <section class="cws-panel" data-cws-local-result hidden>
            <div class="cws-package-heading">
              <div>
                <span data-cws-local-id></span>
                <h3 data-cws-local-title></h3>
              </div>
              <span class="cws-badge" data-cws-local-stage></span>
            </div>
            <p data-cws-local-summary></p>
            <dl class="cws-meta" data-cws-local-meta></dl>
            <label>
              <span>文件（仅文本读取）</span>
              <select data-cws-file-select></select>
            </label>
            <div class="cws-preview" data-cws-preview aria-live="polite"></div>
            <div class="cws-actions">
              <button type="button" data-cws-local-download>下载规范化 JSON</button>
              <button type="button" data-cws-local-publish disabled>登录后发布</button>
            </div>
            <p class="cws-message" data-cws-publish-status></p>
          </section>
        </div>
      </section>

      <section class="cws-view" data-cws-view="mine" hidden>
        <div class="cws-section-heading">
          <div>
            <h3>我的组件发布</h3>
            <p>发布默认进入审核；更新和撤回只作用于创意工坊的社区组件，不会影响星月二创资源库。</p>
          </div>
          <button type="button" data-cws-mine-retry>刷新</button>
        </div>
        <p class="cws-message" data-cws-mine-status>登录后可查看。</p>
        <div class="cws-card-list" data-cws-mine-list></div>
      </section>
    </div>
  `;

  const query = (selector, scope = root) => scope.querySelector(selector);
  const queryAll = (selector, scope = root) => [...scope.querySelectorAll(selector)];
  const dom = {
    shell: query('[data-cws-shell]'),
    views: queryAll('[data-cws-view]'),
    viewLinks: queryAll('[data-cws-view-link]'),
    authStatus: query('[data-cws-auth-status]'),
    authError: query('[data-cws-auth-error]'),
    login: query('[data-cws-login]'),
    profileOpen: query('[data-cws-profile-open]'),
    logout: query('[data-cws-logout]'),
    profilePanel: query('[data-cws-profile-panel]'),
    profileClose: query('[data-cws-profile-close]'),
    profileAvatar: query('[data-cws-profile-avatar]'),
    profileAvatarFallback: query('[data-cws-profile-avatar-fallback]'),
    profilePreviewName: query('[data-cws-profile-preview-name]'),
    profileId: query('[data-cws-profile-id]'),
    profileName: query('[data-cws-profile-name]'),
    profileAvatarFile: query('[data-cws-profile-avatar-file]'),
    profileClearAvatar: query('[data-cws-profile-clear-avatar]'),
    profileSave: query('[data-cws-profile-save]'),
    profileDelete: query('[data-cws-profile-delete]'),
    profileStatus: query('[data-cws-profile-status]'),
    search: query('[data-cws-search]'),
    discoverRetry: query('[data-cws-discover-retry]'),
    discoverStatus: query('[data-cws-discover-status]'),
    discoverList: query('[data-cws-discover-list]'),
    detail: query('[data-cws-detail]'),
    detailClose: query('[data-cws-detail-close]'),
    detailBody: query('[data-cws-detail-body]'),
    fileInput: query('[data-cws-file]'),
    localText: query('[data-cws-local-text]'),
    localValidate: query('[data-cws-local-validate]'),
    localClear: query('[data-cws-local-clear]'),
    localStatus: query('[data-cws-local-status]'),
    localResult: query('[data-cws-local-result]'),
    localId: query('[data-cws-local-id]'),
    localTitle: query('[data-cws-local-title]'),
    localStage: query('[data-cws-local-stage]'),
    localSummary: query('[data-cws-local-summary]'),
    localMeta: query('[data-cws-local-meta]'),
    fileSelect: query('[data-cws-file-select]'),
    preview: query('[data-cws-preview]'),
    localDownload: query('[data-cws-local-download]'),
    localPublish: query('[data-cws-local-publish]'),
    publishStatus: query('[data-cws-publish-status]'),
    mineRetry: query('[data-cws-mine-retry]'),
    mineStatus: query('[data-cws-mine-status]'),
    mineList: query('[data-cws-mine-list]'),
  };

  const state = {
    view: ['discover', 'local', 'mine'].includes(root.dataset.initialView) ? root.dataset.initialView : 'discover',
    communityItems: [],
    discoveryBusy: false,
    discoveryError: '',
    selectedItem: null,
    detailBusy: false,
    detailSequence: 0,
    localPackage: null,
    publishBusy: false,
    auth: { checked: false, loggedIn: false },
    authBusy: false,
    authEpoch: 0,
    tokenMemory: null,
    loginAttempt: null,
    logoutBusy: false,
    profileBusy: false,
    profileAvatarDataUrl: undefined,
    mineBusy: false,
    mineError: '',
    minePackages: [],
    withdrawingIds: new Set(),
  };

  function setMessage(element, message, kind = '') {
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = !message;
  }

  function createElement(tagName, className = '', text = '') {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function cleanText(value, maxLength, fallback = '') {
    if (typeof value !== 'string') return fallback;
    const text = value.trim();
    if (!text || text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) return fallback;
    return text;
  }

  function cleanIdList(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map((item) => cleanText(item, 120))
      .filter((item) => /^[a-z0-9][a-z0-9._-]{2,119}$/.test(item)))]
      .slice(0, 64);
  }

  function normalizePublisherProfile(value, authorName) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const displayName = cleanText(source.displayName, 80, authorName);
    const publisherId = cleanText(source.publisherId, 120);
    let avatarUrl = '';
    const candidateUrl = cleanText(source.avatarUrl, 2048);
    if (candidateUrl) {
      try {
        const parsed = new URL(candidateUrl);
        if (parsed.protocol === 'https:') avatarUrl = parsed.toString();
      } catch (_) {}
    }
    const revision = Number(source.revision);
    return {
      displayName,
      avatarUrl,
      publisherId,
      revision: Number.isInteger(revision) && revision >= 0 ? revision : 0,
      updatedAt: cleanText(source.updatedAt, 80),
    };
  }

  function componentPackageFromResponse(raw) {
    const candidate = raw?.package?.format === componentPackageContract.format
      ? raw.package
      : raw?.payload?.format === componentPackageContract.format
        ? raw.payload
        : raw;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('component-package-missing');
    }
    const unknownField = Object.keys(candidate)
      .find((key) => !componentPackageFields.includes(key) && !componentResponseMetadataFields.has(key));
    if (unknownField) {
      const error = new Error(`unknown-component-package-field: ${unknownField}`);
      error.code = 'unknown-component-package-field';
      throw error;
    }
    const strictInput = Object.fromEntries(componentPackageFields
      .filter((key) => Object.hasOwn(candidate, key))
      .map((key) => [key, candidate[key]]));
    return componentPackageContract.normalizePackage(strictInput);
  }

  function normalizeCommunityItem(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const content = raw.package?.format === componentPackageContract.format
      ? raw.package
      : raw.payload?.format === componentPackageContract.format
        ? raw.payload
        : raw;
    const id = cleanText(content.id, 120);
    const title = cleanText(content.title, 120);
    const version = cleanText(content.version, 40);
    if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(id) || !title) return null;
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return null;
    if (raw.reviewStatus && raw.reviewStatus !== 'approved') return null;
    if (raw.withdrawnAt) return null;
    let componentPackage = null;
    if (Array.isArray(content.files)) {
      try { componentPackage = componentPackageFromResponse(content); } catch (_) { return null; }
    }
    const authorName = cleanText(content.authorName, 80, 'anonymous');
    return {
      key: `community:${id}`,
      origin: 'community',
      id,
      title,
      summary: cleanText(content.summary, 1200, '社区组件未提供简介。'),
      authorName,
      publisherProfile: normalizePublisherProfile(raw.publisherProfile || content.publisherProfile, authorName),
      version,
      license: cleanText(content.license, 80, 'UNLICENSED'),
      tags: Array.isArray(content.tags) ? content.tags.map((tag) => cleanText(tag, 40)).filter(Boolean).slice(0, 16) : [],
      compatibility: content.compatibility && typeof content.compatibility === 'object' ? content.compatibility : {},
      dependencies: cleanIdList(content.dependencies),
      conflicts: cleanIdList(content.conflicts),
      replaces: cleanIdList(content.replaces),
      replacedBy: cleanIdList(content.replacedBy),
      workflowStage: cleanText(content.workflowStage, 40),
      componentPackage,
    };
  }

  function renderView() {
    dom.shell.dataset.cwsActiveView = state.view;
    dom.views.forEach((view) => { view.hidden = view.dataset.cwsView !== state.view; });
    dom.viewLinks.forEach((button) => {
      const active = button.dataset.cwsViewLink === state.view;
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    if (state.view === 'mine' && state.auth.loggedIn) void loadMine();
  }

  function setView(view) {
    if (!['discover', 'local', 'mine'].includes(view)) return;
    state.view = view;
    renderView();
  }

  function relationRow(label, values) {
    const row = document.createDocumentFragment();
    const dt = createElement('dt', '', label);
    const dd = createElement('dd', '', values.length ? values.join('、') : '无');
    row.append(dt, dd);
    return row;
  }

  function publisherIdentity(item, compact = false) {
    const profile = item.publisherProfile || normalizePublisherProfile({}, item.authorName);
    const identity = createElement('div', compact ? 'cws-publisher cws-publisher-compact' : 'cws-publisher');
    if (profile.avatarUrl) {
      const avatar = document.createElement('img');
      avatar.src = profile.avatarUrl;
      avatar.alt = '';
      avatar.loading = 'lazy';
      avatar.referrerPolicy = 'no-referrer';
      identity.append(avatar);
    } else {
      identity.append(createElement('span', 'cws-publisher-fallback', profile.displayName.slice(0, 1).toUpperCase() || '?'));
    }
    const copy = createElement('span');
    copy.append(createElement('strong', '', profile.displayName));
    if (profile.publisherId) copy.append(createElement('small', '', profile.publisherId));
    identity.append(copy);
    return identity;
  }

  function renderDiscover() {
    const queryText = dom.search.value.trim().toLocaleLowerCase('zh-CN');
    const items = state.communityItems.filter((item) => {
      if (!queryText) return true;
      return [item.id, item.title, item.summary, item.authorName, ...item.tags]
        .join('\n')
        .toLocaleLowerCase('zh-CN')
        .includes(queryText);
    });

    dom.discoverList.replaceChildren();
    for (const item of items) {
      const card = createElement('article', 'cws-package-card');
      card.dataset.cwsPackageOrigin = item.origin;
      card.dataset.cwsPackageId = item.id;
      const heading = createElement('div', 'cws-package-heading');
      const titleWrap = createElement('div');
      titleWrap.append(createElement('span', '', item.id), createElement('h3', '', item.title));
      const badge = createElement('span', 'cws-badge cws-badge-community', '社区组件');
      heading.append(titleWrap, badge);
      const summary = createElement('p', '', item.summary);
      const meta = createElement('p', 'cws-card-meta', `${item.version} · ${item.license}`);
      const tags = createElement('div', 'cws-tags');
      item.tags.slice(0, 6).forEach((tag) => tags.append(createElement('span', '', tag)));
      const open = createElement('button', '', '查看详情');
      open.type = 'button';
      open.dataset.cwsOpenPackage = item.key;
      card.append(heading, summary, publisherIdentity(item, true), meta, tags, open);
      dom.discoverList.append(card);
    }

    dom.discoverRetry.disabled = state.discoveryBusy;
    if (state.discoveryBusy) setMessage(dom.discoverStatus, '正在读取社区组件…');
    else if (state.discoveryError) setMessage(dom.discoverStatus, `${state.discoveryError}；可以刷新重试，或继续使用格式与安全检查。`, 'error');
    else if (items.length) setMessage(dom.discoverStatus, `共显示 ${items.length} 个组件`);
    else if (queryText) setMessage(dom.discoverStatus, '没有匹配当前搜索的组件。');
    else setMessage(dom.discoverStatus, '社区暂时还没有已发布组件。');
  }

  function appendDetailMeta(container, item) {
    const meta = createElement('dl', 'cws-meta');
    meta.append(
      relationRow('来源', ['社区组件']),
      relationRow('版本', [item.version]),
      relationRow('发布者', [item.publisherProfile?.displayName || item.authorName]),
      relationRow('发布者 ID', item.publisherProfile?.publisherId ? [item.publisherProfile.publisherId] : []),
      relationRow('包内署名', [item.authorName]),
      relationRow('许可', [item.license]),
      relationRow('工作流阶段', [item.workflowStage ? stageLabels[item.workflowStage] || item.workflowStage : '由 recipe 决定']),
      relationRow('依赖', item.dependencies),
      relationRow('冲突', item.conflicts),
      relationRow('替换', item.replaces),
      relationRow('被替换为', item.replacedBy),
    );
    container.append(meta);
  }

  function renderDetail(item, componentPackage = item.componentPackage) {
    dom.detailBody.replaceChildren();
    const source = createElement('span', 'cws-badge cws-badge-community', '社区组件');
    const id = createElement('span', 'cws-detail-id', item.id);
    const title = createElement('h3', '', item.title);
    const summary = createElement('p', '', item.summary);
    dom.detailBody.append(source, id, title, publisherIdentity(item), summary);
    appendDetailMeta(dom.detailBody, item);
    if (item.replacementStatus) dom.detailBody.append(createElement('p', 'cws-message', item.replacementStatus));
    if (componentPackage) {
      const filesTitle = createElement('h4', '', `文件（${componentPackage.files.length}）`);
      const fileList = createElement('ul', 'cws-detail-files');
      componentPackage.files.forEach((file) => {
        fileList.append(createElement('li', '', `${file.path} · ${file.mediaType}`));
      });
      dom.detailBody.append(filesTitle, fileList);
    }
    dom.detail.hidden = false;
  }

  function closeDetail() {
    state.detailSequence += 1;
    state.detailBusy = false;
    state.selectedItem = null;
    dom.detail.hidden = true;
    dom.detailBody.replaceChildren();
  }

  async function openDetail(item) {
    const sequence = state.detailSequence + 1;
    state.detailSequence = sequence;
    state.selectedItem = item;
    renderDetail(item);
    if (item.origin !== 'community' || item.componentPackage) return;
    state.detailBusy = true;
    dom.detailBody.append(createElement('p', 'cws-message', '正在读取组件包详情…'));
    try {
      const result = await apiRequest(`/api/component-workshop/packages/${encodeURIComponent(item.id)}`, { auth: false });
      if (!result.response.ok) throw requestFailure(result, '读取组件详情');
      const componentPackage = await componentPackageContract.verifyPackageHashes(componentPackageFromResponse(result.body));
      if (state.selectedItem !== item || sequence !== state.detailSequence) return;
      item.componentPackage = componentPackage;
      renderDetail(item, componentPackage);
    } catch (error) {
      if (state.selectedItem === item && sequence === state.detailSequence) {
        dom.detailBody.append(createElement('p', 'cws-message cws-message-error', requestErrorMessage(error, '读取组件详情')));
      }
    } finally {
      if (sequence === state.detailSequence) state.detailBusy = false;
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

  async function loadDiscovery() {
    if (state.discoveryBusy) return;
    closeDetail();
    state.discoveryBusy = true;
    state.discoveryError = '';
    renderDiscover();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetchJson(new URL('/api/component-workshop/packages', gatewayBase), controller.signal);
      if (Array.isArray(response?.packages)) {
        state.communityItems = response.packages.map(normalizeCommunityItem).filter(Boolean);
      } else {
        state.communityItems = [];
        state.discoveryError = '社区组件索引格式无效';
      }
    } catch (_) {
      state.communityItems = [];
      state.discoveryError = '社区组件服务暂不可用';
    } finally {
      window.clearTimeout(timeout);
      state.discoveryBusy = false;
      renderDiscover();
    }
  }

  function localErrorMessage(error) {
    const code = cleanText(error?.code, 120, error?.message || 'invalid-component-package');
    const messages = {
      'component-package-not-object': '组件包根节点必须是对象。',
      'invalid-component-package-format': 'format 必须是 rpn-component-package。',
      'invalid-component-package-schema-version': '当前仅支持组件包 schemaVersion 1。',
      'invalid-component-file-path': '组件文件路径不安全；只允许相对路径与正斜杠。',
      'reserved-component-file-path': '组件文件路径包含系统保留名称。',
      'unsupported-component-file-type': '组件包包含不支持的文件扩展名。',
      'component-file-media-type-mismatch': '文件扩展名与 mediaType 不匹配。',
      'component-file-too-large': '单个组件文件超过 256 KiB。',
      'component-files-too-large': '组件包文件正文总计超过 1 MiB。',
      'component-file-sha256-mismatch': '至少一个文件的 SHA-256 与正文不一致。',
    };
    return messages[code] || `组件包校验失败：${code}`;
  }

  function renderMetaList(componentPackage) {
    dom.localMeta.replaceChildren(
      relationRow('版本', [componentPackage.version]),
      relationRow('作者', [componentPackage.authorName]),
      relationRow('许可', [componentPackage.license]),
      relationRow('组件库', [componentPackage.compatibility.libraryVersion]),
      relationRow('依赖', componentPackage.dependencies),
      relationRow('冲突', componentPackage.conflicts),
      relationRow('替换', componentPackage.replaces),
      relationRow('被替换为', componentPackage.replacedBy),
    );
  }

  function staticHtmlDocument(source) {
    const parsed = new DOMParser().parseFromString(String(source), 'text/html');
    const forbidden = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'BASE', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);
    const allowed = new Set([
      'HTML', 'HEAD', 'BODY', 'STYLE', 'MAIN', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
      'DIV', 'SPAN', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'DL', 'DT', 'DD',
      'B', 'STRONG', 'I', 'EM', 'SMALL', 'MARK', 'CODE', 'PRE', 'BLOCKQUOTE', 'BR', 'HR', 'TABLE',
      'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION', 'FIGURE', 'FIGCAPTION',
    ]);
    [...parsed.querySelectorAll('*')].forEach((element) => {
      if (forbidden.has(element.tagName)) {
        element.remove();
        return;
      }
      if (!allowed.has(element.tagName)) {
        element.replaceWith(...element.childNodes);
        return;
      }
      [...element.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name === 'style' || name === 'class' || name === 'id' || name === 'title' || name === 'role' || name.startsWith('aria-')) return;
        element.removeAttribute(attribute.name);
      });
      if (element.tagName === 'STYLE') {
        element.textContent = element.textContent
          .replace(/@import\s+[^;]+;?/gi, '')
          .replace(/url\s*\([^)]*\)/gi, 'none');
      }
    });
    const styles = [...parsed.querySelectorAll('style')].map((style) => style.outerHTML).join('');
    const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html{color:#edf2ee;background:#111716;font-family:system-ui,sans-serif}body{margin:16px}</style>${styles}</head><body>${parsed.body.innerHTML}</body></html>`;
  }

  function renderFilePreview() {
    dom.preview.replaceChildren();
    const componentPackage = state.localPackage;
    if (!componentPackage) return;
    const file = componentPackage.files[Number(dom.fileSelect.value) || 0];
    if (!file) return;
    if (file.mediaType === 'text/html') {
      const note = createElement('p', 'cws-preview-note', '不透明 sandbox 静态预览：脚本、表单、外链和事件处理器已移除。');
      const frame = document.createElement('iframe');
      frame.title = `${file.path} 静态预览`;
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', '');
      frame.dataset.cwsHtmlPreview = '';
      frame.srcdoc = staticHtmlDocument(file.text);
      dom.preview.append(note, frame);
      return;
    }
    const pre = createElement('pre');
    const code = createElement('code');
    code.textContent = file.text;
    pre.append(code);
    dom.preview.append(pre);
  }

  function updatePublishAction() {
    const available = Boolean(state.localPackage)
      && state.auth.loggedIn
      && Boolean(state.auth.publisherProfile)
      && !state.publishBusy;
    dom.localPublish.disabled = !available;
    if (state.publishBusy) dom.localPublish.textContent = '正在提交…';
    else if (!state.auth.loggedIn) dom.localPublish.textContent = '登录后发布';
    else if (!state.auth.publisherProfile) dom.localPublish.textContent = '先设置公开署名';
    else dom.localPublish.textContent = '发布组件包';
  }

  function renderLocalPackage() {
    const componentPackage = state.localPackage;
    dom.localResult.hidden = !componentPackage;
    if (!componentPackage) {
      updatePublishAction();
      return;
    }
    dom.localId.textContent = componentPackage.id;
    dom.localTitle.textContent = componentPackage.title;
    dom.localStage.textContent = stageLabels[componentPackage.workflowStage] || componentPackage.workflowStage;
    dom.localSummary.textContent = componentPackage.summary;
    renderMetaList(componentPackage);
    dom.fileSelect.replaceChildren();
    componentPackage.files.forEach((file, index) => {
      const option = createElement('option', '', `${file.path} · ${file.mediaType}`);
      option.value = String(index);
      dom.fileSelect.append(option);
    });
    renderFilePreview();
    updatePublishAction();
  }

  async function validateLocalText() {
    try {
      const raw = JSON.parse(dom.localText.value);
      state.localPackage = await componentPackageContract.verifyPackageHashes(raw);
      setMessage(dom.localStatus, `校验通过：${state.localPackage.files.length} 个文件；所有内容仅按文本处理。`, 'success');
      setMessage(dom.publishStatus, !state.auth.loggedIn
        ? '登录后可以发布。'
        : state.auth.publisherProfile
          ? '可以提交审核。'
          : '发布前请先设置公开署名；退出登录后署名仍会保留在公开资料中。');
      renderLocalPackage();
    } catch (error) {
      state.localPackage = null;
      setMessage(dom.localStatus, error instanceof SyntaxError ? 'JSON 语法无效。' : localErrorMessage(error), 'error');
      setMessage(dom.publishStatus, '');
      renderLocalPackage();
    }
  }

  function downloadLocalPackage() {
    if (!state.localPackage) return;
    const blob = new Blob([`${JSON.stringify(state.localPackage, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.localPackage.id}-${state.localPackage.version}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function workshopToken() {
    if (state.tokenMemory !== null) return state.tokenMemory;
    try { return localStorage.getItem(tokenStorageKey) || ''; } catch (_) { return ''; }
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
    }
    return persisted;
  }

  function renderAuth() {
    const profile = state.auth.publisherProfile;
    if (state.loginAttempt) dom.authStatus.textContent = '等待 Discord 登录完成…';
    else if (state.authBusy && !state.auth.checked) dom.authStatus.textContent = '正在检查登录状态…';
    else if (state.auth.loggedIn && profile) dom.authStatus.textContent = `已登录 · 公开署名：${profile.displayName}`;
    else if (state.auth.loggedIn) dom.authStatus.textContent = `已登录 · ${state.auth.publisherId || '发布者'} · 尚未设置公开署名`;
    else dom.authStatus.textContent = '未登录；发现与本地校验仍可使用。';
    dom.login.hidden = state.auth.loggedIn;
    dom.profileOpen.hidden = !state.auth.loggedIn;
    dom.logout.hidden = !state.auth.loggedIn;
    dom.login.disabled = Boolean(state.loginAttempt) || state.authBusy;
    dom.logout.disabled = state.logoutBusy;
    updatePublishAction();
  }

  function invalidateAuth(requestToken = workshopToken(), requestEpoch = state.authEpoch) {
    if (requestToken !== workshopToken() || requestEpoch !== state.authEpoch) return false;
    storeWorkshopToken('');
    state.auth = { checked: true, loggedIn: false };
    state.profileAvatarDataUrl = undefined;
    dom.profilePanel.hidden = true;
    state.mineError = '';
    state.minePackages = [];
    renderAuth();
    renderMine();
    return true;
  }

  async function apiRequest(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || requestTimeoutMs);
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const requestToken = options.auth === false ? '' : workshopToken();
    const authEpoch = state.authEpoch;
    if (requestToken) headers.Authorization = `Bearer ${requestToken}`;
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
        requestToken,
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

  function requestFailure(result, action) {
    const error = new Error(`${action}失败`);
    error.status = result.response.status;
    error.code = cleanText(result.body?.error, 120, `http-${result.response.status}`);
    if (result.response.status === 401) invalidateAuth(result.requestToken, result.authEpoch);
    return error;
  }

  function requestErrorMessage(error, action) {
    if (error?.code === 'request-timeout') return `${action}超时，请稍后重试。`;
    if (error?.status === 401) return '登录已失效，请重新登录。';
    if (error?.status === 403) return '当前 Discord 账户没有执行此操作的权限。';
    if (error?.status === 409) return '组件状态或修订号已变化，请刷新后重试。';
    if (error?.status === 429) return '请求过于频繁，请稍后再试。';
    if (error?.status >= 500) return '组件社区服务暂不可用，请稍后再试。';
    if (error?.name === 'TypeError') return '无法连接组件社区服务，请检查网络。';
    return `${action}失败，请稍后重试。`;
  }

  async function refreshAuth() {
    if (state.authBusy) return;
    state.authBusy = true;
    renderAuth();
    try {
      const result = await apiRequest('/api/identity/me');
      if (result.authEpoch !== state.authEpoch || result.requestToken !== workshopToken()) return;
      if (result.response.status === 401) {
        invalidateAuth(result.requestToken, result.authEpoch);
        setMessage(dom.authError, '');
        return;
      }
      if (!result.response.ok) throw requestFailure(result, '确认登录状态');
      const profile = result.body.publisherProfile
        ? normalizePublisherProfile(result.body.publisherProfile, '发布者')
        : null;
      state.auth = {
        checked: true,
        loggedIn: Boolean(result.body.loggedIn),
        publisherId: cleanText(result.body.publisherId, 120),
        publisherProfile: profile?.publisherId ? profile : null,
        publisherProfileRevision: Number.isInteger(Number(result.body.publisherProfileRevision))
          ? Number(result.body.publisherProfileRevision)
          : Number(profile?.revision) || 0,
      };
      setMessage(dom.authError, '');
    } catch (error) {
      state.auth = { checked: true, loggedIn: false };
      setMessage(dom.authError, requestErrorMessage(error, '确认登录状态'), 'error');
    } finally {
      state.authBusy = false;
      renderAuth();
      renderMine();
    }
  }

  function randomHex(byteLength) {
    if (typeof crypto?.getRandomValues !== 'function') throw new Error('secure-random-unavailable');
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  async function handoffChallenge(secret) {
    if (typeof crypto?.subtle?.digest !== 'function') throw new Error('secure-digest-unavailable');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function beginLogin() {
    if (state.loginAttempt || state.auth.loggedIn) return;
    setMessage(dom.authError, '');
    const popup = window.open('about:blank', 'rpn-component-workshop-login', 'width=520,height=720');
    if (!popup) {
      setMessage(dom.authError, '浏览器阻止了登录窗口，请允许弹窗后重试。', 'error');
      return;
    }
    const attempt = { popup };
    state.loginAttempt = attempt;
    renderAuth();
    try {
      const handoffId = `cwh_${randomHex(24)}`;
      const secret = randomHex(32);
      const challenge = await handoffChallenge(secret);
      const started = await apiRequest('/api/identity/login-handoff/start', {
        method: 'POST',
        auth: false,
        body: { handoffId, challenge },
      });
      if (!started.response.ok) throw requestFailure(started, '启动登录');
      const expiresInMs = Number(started.body.expiresInMs);
      if (!Number.isFinite(expiresInMs) || expiresInMs < 1000 || expiresInMs > 10 * 60 * 1000) {
        throw new Error('invalid-login-deadline');
      }
      const loginUrl = new URL('/auth/identity/discord/login', gatewayBase);
      loginUrl.searchParams.set('handoff', handoffId);
      popup.location.replace(loginUrl.toString());
      const deadline = Date.now() + expiresInMs;
      while (state.loginAttempt === attempt && Date.now() <= deadline) {
        const claimed = await apiRequest('/api/identity/login-handoff', {
          method: 'POST',
          auth: false,
          body: { handoffId, secret },
        });
        if (claimed.response.ok && claimed.body.status === 'ready' && claimed.body.token) {
          const persisted = storeWorkshopToken(claimed.body.token);
          state.auth = { checked: false, loggedIn: false };
          await refreshAuth();
          if (!state.auth.loggedIn) throw new Error('invalid-login-token');
          setMessage(dom.authError, persisted ? '' : '浏览器本地存储不可用；登录只在当前页面有效。', persisted ? '' : 'warning');
          return;
        }
        if (claimed.response.status !== 202) throw requestFailure(claimed, '完成登录');
        if (popup.closed) throw new Error('login-popup-closed');
        await wait(800);
      }
      throw new Error('login-timeout');
    } catch (error) {
      storeWorkshopToken('');
      state.auth = { checked: true, loggedIn: false };
      const message = error?.message === 'login-popup-closed'
        ? '登录窗口已关闭，请重新尝试。'
        : error?.message === 'login-timeout'
          ? '登录等待已超时，请重新尝试。'
          : requestErrorMessage(error, 'Discord 登录');
      setMessage(dom.authError, message, 'error');
    } finally {
      if (state.loginAttempt === attempt) state.loginAttempt = null;
      try { popup.close(); } catch (_) {}
      renderAuth();
    }
  }

  async function logout() {
    if (state.logoutBusy) return;
    state.logoutBusy = true;
    renderAuth();
    try { await apiRequest('/api/identity/logout', { method: 'POST' }); } catch (_) {}
    storeWorkshopToken('');
    state.auth = { checked: true, loggedIn: false };
    state.profileAvatarDataUrl = undefined;
    dom.profilePanel.hidden = true;
    state.mineError = '';
    state.minePackages = [];
    state.logoutBusy = false;
    renderAuth();
    renderMine();
  }

  function normalizeProfileDisplayName(value) {
    const text = String(value || '').normalize('NFKC').trim();
    if (!text || text.length > 64) throw new Error('公开显示名需要 1–64 个字符。');
    if (/[\u0000-\u001f\u007f\p{Cf}]/u.test(text)) throw new Error('公开显示名包含不可见控制字符。');
    if (/\d{17,20}/.test(text)) throw new Error('公开显示名不能包含疑似账号或凭证的长数字。');
    return text;
  }

  function renderProfileEditor() {
    const profile = state.auth.publisherProfile;
    const pendingAvatar = state.profileAvatarDataUrl;
    const avatarUrl = pendingAvatar === undefined ? profile?.avatarUrl || '' : pendingAvatar || '';
    const previewName = dom.profileName.value.trim() || profile?.displayName || '尚未设置';
    dom.profilePreviewName.textContent = previewName;
    dom.profileId.textContent = state.auth.publisherId || profile?.publisherId || '';
    dom.profileAvatar.hidden = !avatarUrl;
    dom.profileAvatarFallback.hidden = Boolean(avatarUrl);
    if (avatarUrl) dom.profileAvatar.src = avatarUrl;
    else dom.profileAvatar.removeAttribute('src');
    dom.profileAvatarFallback.textContent = previewName.slice(0, 1).toUpperCase() || '?';
    dom.profileSave.disabled = state.profileBusy;
    dom.profileClearAvatar.disabled = state.profileBusy || (!avatarUrl && pendingAvatar === null);
    dom.profileDelete.hidden = !profile;
    dom.profileDelete.disabled = state.profileBusy;
    dom.profileClose.disabled = state.profileBusy;
  }

  function openProfileEditor() {
    if (!state.auth.loggedIn) return;
    state.profileAvatarDataUrl = undefined;
    dom.profileName.value = state.auth.publisherProfile?.displayName || '';
    dom.profileAvatarFile.value = '';
    setMessage(dom.profileStatus, state.auth.publisherProfile
      ? '修改后会更新所有公开组件显示的署名。'
      : '首次保存后会建立稳定的公开发布者资料。');
    dom.profilePanel.hidden = false;
    renderProfileEditor();
    dom.profileName.focus({ preventScroll: true });
  }

  function closeProfileEditor() {
    if (state.profileBusy) return;
    state.profileAvatarDataUrl = undefined;
    dom.profileAvatarFile.value = '';
    dom.profilePanel.hidden = true;
    dom.profileOpen.focus({ preventScroll: true });
  }

  function readAvatarDataUrl(file) {
    const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (!file || !allowedTypes.has(file.type)) return Promise.reject(new Error('头像只支持 PNG、JPEG 或 WebP。'));
    if (file.size > 256 * 1024) return Promise.reject(new Error('头像文件不得超过 256 KiB。'));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('头像读取失败。'));
      reader.onerror = () => reject(reader.error || new Error('头像读取失败。'));
      reader.readAsDataURL(file);
    });
  }

  function profileErrorMessage(error, action) {
    if (error?.status === 428) return '公开资料缺少修订号，请重新登录或刷新后再试。';
    if (error?.status === 409) return '公开资料已在别处更新，请刷新登录状态后再试。';
    if (error?.status === 413) return '头像或请求正文超过服务端限制。';
    if (error?.status === 400) return `${action}未通过资料格式检查。`;
    return requestErrorMessage(error, action);
  }

  async function savePublisherProfile() {
    if (!state.auth.loggedIn || state.profileBusy) return;
    let displayName;
    try { displayName = normalizeProfileDisplayName(dom.profileName.value); }
    catch (error) { setMessage(dom.profileStatus, error.message, 'error'); return; }
    const revision = Number(state.auth.publisherProfileRevision) || 0;
    const body = { displayName };
    if (state.profileAvatarDataUrl !== undefined) body.avatarDataUrl = state.profileAvatarDataUrl;
    state.profileBusy = true;
    renderProfileEditor();
    setMessage(dom.profileStatus, '正在保存公开署名…');
    try {
      const result = await apiRequest('/api/identity/publisher-profile', {
        method: 'PUT',
        headers: { 'X-Publisher-Profile-Revision': String(revision) },
        body,
      });
      if (!result.response.ok) throw requestFailure(result, '保存公开署名');
      const profile = normalizePublisherProfile(result.body.publisherProfile, displayName);
      if (!profile.publisherId) throw new Error('invalid-publisher-profile-response');
      state.auth = {
        ...state.auth,
        publisherId: profile.publisherId,
        publisherProfile: profile,
        publisherProfileRevision: profile.revision,
      };
      state.profileAvatarDataUrl = undefined;
      dom.profileName.value = profile.displayName;
      dom.profileAvatarFile.value = '';
      setMessage(dom.profileStatus, '公开署名已保存；退出登录不会移除这份公开资料。', 'success');
      renderAuth();
      void loadDiscovery();
    } catch (error) {
      setMessage(dom.profileStatus, profileErrorMessage(error, '保存公开署名'), 'error');
    } finally {
      state.profileBusy = false;
      renderProfileEditor();
    }
  }

  async function deletePublisherProfile() {
    const profile = state.auth.publisherProfile;
    if (!profile || state.profileBusy || !window.confirm('删除公开发布者资料吗？已发布组件不会被撤回，但公开头像与资料名会移除。')) return;
    state.profileBusy = true;
    renderProfileEditor();
    setMessage(dom.profileStatus, '正在删除公开资料…');
    try {
      const result = await apiRequest('/api/identity/publisher-profile', {
        method: 'DELETE',
        headers: { 'X-Publisher-Profile-Revision': String(state.auth.publisherProfileRevision || profile.revision) },
      });
      if (!result.response.ok) throw requestFailure(result, '删除公开资料');
      state.auth = {
        ...state.auth,
        publisherProfile: null,
        publisherProfileRevision: Number(result.body.publisherProfileRevision) || (profile.revision + 1),
      };
      state.profileAvatarDataUrl = undefined;
      dom.profileName.value = '';
      dom.profileAvatarFile.value = '';
      setMessage(dom.profileStatus, '公开资料已删除；组件内容与审核状态未改变。', 'success');
      renderAuth();
      void loadDiscovery();
    } catch (error) {
      setMessage(dom.profileStatus, profileErrorMessage(error, '删除公开资料'), 'error');
    } finally {
      state.profileBusy = false;
      renderProfileEditor();
    }
  }

  function normalizeMineItem(raw) {
    const item = normalizeCommunityItem({ ...raw, reviewStatus: undefined, withdrawnAt: undefined });
    if (!item) return null;
    const reviewStatus = ['pending', 'approved', 'rejected', 'withdrawn'].includes(raw.reviewStatus)
      ? raw.reviewStatus
      : 'pending';
    const revision = Number(raw.revision);
    return {
      ...item,
      reviewStatus,
      revision: Number.isInteger(revision) && revision > 0 ? revision : null,
      rejectionReason: cleanText(raw.rejectionReason, 600),
    };
  }

  function renderMine() {
    dom.mineList.replaceChildren();
    if (!state.auth.loggedIn) {
      setMessage(dom.mineStatus, '登录后可查看和管理你的组件发布。');
      return;
    }
    if (state.mineBusy) {
      setMessage(dom.mineStatus, '正在读取我的发布…');
      return;
    }
    if (state.mineError) {
      setMessage(dom.mineStatus, state.mineError, 'error');
      return;
    }
    if (!state.minePackages.length) {
      setMessage(dom.mineStatus, '当前没有组件发布。');
      return;
    }
    setMessage(dom.mineStatus, `共 ${state.minePackages.length} 个组件发布。`);
    for (const item of state.minePackages) {
      const card = createElement('article', 'cws-package-card');
      card.dataset.cwsMinePackageId = item.id;
      const heading = createElement('div', 'cws-package-heading');
      const titleWrap = createElement('div');
      titleWrap.append(createElement('span', '', item.id), createElement('h3', '', item.title));
      heading.append(titleWrap, createElement('span', `cws-badge cws-status-${item.reviewStatus}`, reviewLabels[item.reviewStatus]));
      const meta = createElement('p', 'cws-card-meta', `${item.version} · revision ${item.revision ?? '未知'}`);
      card.append(heading, createElement('p', '', item.summary), meta);
      if (item.rejectionReason) card.append(createElement('p', 'cws-message cws-message-error', `拒绝原因：${item.rejectionReason}`));
      if (item.reviewStatus !== 'withdrawn') {
        const withdraw = createElement('button', '', state.withdrawingIds.has(item.id) ? '正在撤回…' : '撤回');
        withdraw.type = 'button';
        withdraw.disabled = state.withdrawingIds.has(item.id) || !item.revision;
        withdraw.dataset.cwsWithdraw = item.id;
        card.append(withdraw);
      }
      dom.mineList.append(card);
    }
  }

  async function loadMine() {
    if (!state.auth.loggedIn || state.mineBusy) return;
    state.mineBusy = true;
    state.mineError = '';
    renderMine();
    try {
      const result = await apiRequest('/api/component-workshop/me/packages');
      if (!result.response.ok) throw requestFailure(result, '读取我的发布');
      if (result.authEpoch !== state.authEpoch || result.requestToken !== workshopToken()) return;
      const source = Array.isArray(result.body?.packages) ? result.body.packages : [];
      state.minePackages = source.map(normalizeMineItem).filter(Boolean);
    } catch (error) {
      state.mineError = requestErrorMessage(error, '读取我的发布');
    } finally {
      state.mineBusy = false;
      renderMine();
    }
  }

  async function publishLocalPackage() {
    if (!state.localPackage || !state.auth.loggedIn || !state.auth.publisherProfile || state.publishBusy) return;
    const candidate = componentPackageContract.normalizePackage(state.localPackage);
    const existing = state.minePackages.find((item) => item.id === candidate.id);
    if (existing && !existing.revision) {
      setMessage(dom.publishStatus, '缺少现有组件的修订号，请刷新“我的发布”后重试。', 'error');
      return;
    }
    if (existing && !window.confirm(existing.reviewStatus === 'withdrawn'
      ? `将重新提交已撤回的“${existing.title}” revision ${existing.revision}，是否继续？`
      : `将更新“${existing.title}” revision ${existing.revision}，是否继续？`)) return;
    state.publishBusy = true;
    updatePublishAction();
    try {
      const updating = Boolean(existing);
      const headers = updating ? { 'X-Package-Revision': String(existing.revision) } : {};
      const path = updating
        ? `/api/component-workshop/packages/${encodeURIComponent(candidate.id)}`
        : '/api/component-workshop/packages';
      const result = await apiRequest(path, {
        method: updating ? 'PUT' : 'POST',
        headers,
        body: candidate,
      });
      if (!result.response.ok) throw requestFailure(result, updating ? '更新组件' : '发布组件');
      setMessage(dom.publishStatus, `${candidate.title} 已提交审核。`, 'success');
      await loadMine();
    } catch (error) {
      setMessage(dom.publishStatus, requestErrorMessage(error, '发布组件'), 'error');
    } finally {
      state.publishBusy = false;
      updatePublishAction();
    }
  }

  async function withdrawPackage(item) {
    if (!item?.revision || state.withdrawingIds.has(item.id)) return;
    if (!window.confirm(`撤回组件“${item.title}”吗？`)) return;
    state.withdrawingIds.add(item.id);
    renderMine();
    try {
      const result = await apiRequest(`/api/component-workshop/packages/${encodeURIComponent(item.id)}`, {
        method: 'DELETE',
        headers: { 'X-Package-Revision': String(item.revision) },
      });
      if (!result.response.ok) throw requestFailure(result, '撤回组件');
      await loadMine();
    } catch (error) {
      setMessage(dom.mineStatus, requestErrorMessage(error, '撤回组件'), 'error');
    } finally {
      state.withdrawingIds.delete(item.id);
      renderMine();
    }
  }

  dom.viewLinks.forEach((button) => button.addEventListener('click', () => setView(button.dataset.cwsViewLink)));
  dom.search.addEventListener('input', renderDiscover);
  dom.discoverRetry.addEventListener('click', () => void loadDiscovery());
  dom.discoverList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cws-open-package]');
    if (!button) return;
    const item = state.communityItems.find((candidate) => candidate.key === button.dataset.cwsOpenPackage);
    if (item) void openDetail(item);
  });
  dom.detailClose.addEventListener('click', closeDetail);
  dom.fileInput.addEventListener('change', async () => {
    const file = dom.fileInput.files?.[0];
    if (!file) return;
    if (file.size > componentPackageContract.limits.maxPackageBytes) {
      setMessage(dom.localStatus, 'JSON 文件超过组件包大小上限。', 'error');
      return;
    }
    dom.localText.value = await file.text();
    dom.fileInput.value = '';
    await validateLocalText();
  });
  dom.localValidate.addEventListener('click', () => void validateLocalText());
  dom.localClear.addEventListener('click', () => {
    state.localPackage = null;
    dom.localText.value = '';
    setMessage(dom.localStatus, '尚未导入组件包。');
    setMessage(dom.publishStatus, '');
    renderLocalPackage();
  });
  dom.fileSelect.addEventListener('change', renderFilePreview);
  dom.localDownload.addEventListener('click', downloadLocalPackage);
  dom.localPublish.addEventListener('click', () => void publishLocalPackage());
  dom.login.addEventListener('click', () => void beginLogin());
  dom.profileOpen.addEventListener('click', openProfileEditor);
  dom.profileClose.addEventListener('click', closeProfileEditor);
  dom.profileName.addEventListener('input', renderProfileEditor);
  dom.profileAvatarFile.addEventListener('change', async () => {
    const file = dom.profileAvatarFile.files?.[0];
    if (!file) return;
    try {
      state.profileAvatarDataUrl = await readAvatarDataUrl(file);
      setMessage(dom.profileStatus, '头像已在本页预览；点击保存后才会公开。');
    } catch (error) {
      state.profileAvatarDataUrl = undefined;
      dom.profileAvatarFile.value = '';
      setMessage(dom.profileStatus, error.message, 'error');
    }
    renderProfileEditor();
  });
  dom.profileClearAvatar.addEventListener('click', () => {
    state.profileAvatarDataUrl = null;
    dom.profileAvatarFile.value = '';
    setMessage(dom.profileStatus, '头像将在保存时移除。');
    renderProfileEditor();
  });
  dom.profileSave.addEventListener('click', () => void savePublisherProfile());
  dom.profileDelete.addEventListener('click', () => void deletePublisherProfile());
  dom.logout.addEventListener('click', () => void logout());
  dom.mineRetry.addEventListener('click', () => void loadMine());
  dom.mineList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cws-withdraw]');
    if (!button) return;
    const item = state.minePackages.find((candidate) => candidate.id === button.dataset.cwsWithdraw);
    if (item) void withdrawPackage(item);
  });

  renderView();
  renderAuth();
  renderLocalPackage();
  renderMine();
  void loadDiscovery();
  if (workshopToken()) void refreshAuth();
  else {
    state.auth = { checked: true, loggedIn: false };
    renderAuth();
  }
}
