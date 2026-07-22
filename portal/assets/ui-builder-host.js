const BRIDGE = 'mttt.rolecard.ui-builder';
const PROTOCOL_VERSION = 1;
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const encoder = new TextEncoder();

function randomId(prefix) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validSnapshot(value) {
  if (!isPlainObject(value) || Number(value.schemaVersion) !== 1 || typeof value.draftId !== 'string') return false;
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !isPlainObject(value.project) || !isPlainObject(value.tokens)) return false;
  if (!Array.isArray(value.project.nodes) || value.project.nodes.length > 1000) return false;
  return encoder.encode(JSON.stringify(value)).byteLength <= MAX_ENVELOPE_BYTES - 64 * 1024;
}

function validArtifact(value) {
  if (!isPlainObject(value) || Number(value.schemaVersion) !== 1) return false;
  if (!['design-json', 'html', 'st-html'].includes(value.target) || typeof value.content !== 'string') return false;
  if (typeof value.filename !== 'string' || !/^[^/\\]{1,160}$/.test(value.filename)) return false;
  if (typeof value.mime !== 'string' || !['application/json;charset=utf-8', 'text/html;charset=utf-8'].includes(value.mime)) return false;
  return encoder.encode(value.content).byteLength <= MAX_ENVELOPE_BYTES - 64 * 1024;
}

export function createUiBuilderHost(options) {
  const {
    iframe,
    builderUrl = './ui-builder/index.html?v=0721m3g2',
    getSnapshot,
    getContext,
    persistSnapshot,
    onStatus = () => {},
    onArtifact = () => {},
    onError = () => {},
  } = options;
  if (!(iframe instanceof HTMLIFrameElement)) throw new Error('ui-builder iframe is required');

  let sessionId = '';
  let nonce = '';
  let connected = false;
  let nodeCount = 0;
  let destroyed = false;
  let persistQueue = Promise.resolve();
  const seenMessages = new Set();
  const pendingArtifacts = new Map();
  const pendingFlushes = new Map();
  const resolvedBuilderUrl = new URL(builderUrl, location.href);

  function send(type, payload, { replyTo } = {}) {
    if (destroyed || !iframe.contentWindow || !sessionId || !nonce) return '';
    const messageId = randomId('host-message');
    const envelope = {
      bridge: BRIDGE,
      protocolVersion: PROTOCOL_VERSION,
      type,
      sessionId,
      nonce,
      messageId,
      sentAt: new Date().toISOString(),
      payload,
      ...(replyTo ? { replyTo } : {}),
    };
    if (encoder.encode(JSON.stringify(envelope)).byteLength > MAX_ENVELOPE_BYTES) throw new Error('E_BRIDGE_PAYLOAD_TOO_LARGE');
    // UI Builder 在无 allow-same-origin 的 opaque sandbox 中运行；nonce/session/source
    // 是桥接边界，不能让嵌入快照共享 RPN 的 Cookie、LocalStorage 或 DOM。
    iframe.contentWindow.postMessage(envelope, '*');
    return messageId;
  }

  function acceptedEnvelope(event) {
    if (event.source !== iframe.contentWindow || event.origin !== 'null') return null;
    const value = event.data;
    if (!isPlainObject(value) || value.bridge !== BRIDGE || value.protocolVersion !== PROTOCOL_VERSION) return null;
    if (value.sessionId !== sessionId || value.nonce !== nonce || typeof value.type !== 'string' || typeof value.messageId !== 'string') return null;
    try {
      if (encoder.encode(JSON.stringify(value)).byteLength > MAX_ENVELOPE_BYTES) return null;
    } catch {
      return null;
    }
    if (seenMessages.has(value.messageId)) return null;
    seenMessages.add(value.messageId);
    if (seenMessages.size > 256) seenMessages.delete(seenMessages.values().next().value);
    return value;
  }

  function initPayload() {
    return {
      snapshot: clone(getSnapshot?.() ?? null),
      context: clone(getContext?.() ?? null),
      persistence: { mode: 'host-managed', autosave: true },
      capabilities: { artifacts: ['design-json', 'html', 'st-html'], writeToSillyTavern: false },
      security: {
        allowStWrite: false,
        allowTavernHelperMutation: false,
        allowArbitraryCommand: false,
        securityHold: { active: true, phase: 'P7.3D-S0' },
      },
    };
  }

  function requestSnapshot(reason = 'host-request') {
    return send('host.draft.snapshot.request', { reason });
  }

  function settleFlush(replyTo, error = null) {
    if (!replyTo || !pendingFlushes.has(replyTo)) return;
    const pending = pendingFlushes.get(replyTo);
    pendingFlushes.delete(replyTo);
    window.clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  function handleSnapshot(envelope) {
    const snapshot = envelope.payload?.snapshot;
    if (!validSnapshot(snapshot)) {
      settleFlush(envelope.replyTo, new Error('E_INVALID_SNAPSHOT'));
      send('host.error', { code: 'E_INVALID_SNAPSHOT', message: 'Snapshot rejected by host validator.' }, { replyTo: envelope.messageId });
      onError(new Error('E_INVALID_SNAPSHOT'));
      return;
    }
    const activeSession = sessionId;
    persistQueue = persistQueue.then(async () => {
      if (activeSession !== sessionId || destroyed) return;
      onStatus({ state: 'saving', revision: snapshot.revision });
      const persisted = await persistSnapshot(clone(snapshot));
      if (activeSession !== sessionId || destroyed) return;
      send('host.draft.persisted', {
        draftId: persisted?.draftId ?? snapshot.draftId,
        revision: persisted?.revision ?? snapshot.revision,
        sha256: persisted?.sha256 ?? '',
        persistedAt: persisted?.updatedAt ?? new Date().toISOString(),
      }, { replyTo: envelope.messageId });
      onStatus({ state: 'saved', revision: persisted?.revision ?? snapshot.revision });
      settleFlush(envelope.replyTo);
    }).catch((error) => {
      settleFlush(envelope.replyTo, error);
      send('host.error', { code: 'E_PERSIST_FAILED', message: error instanceof Error ? error.message : String(error) }, { replyTo: envelope.messageId });
      onStatus({ state: 'error' });
      onError(error);
    });
  }

  async function handleArtifact(envelope) {
    const artifact = envelope.payload;
    if (!validArtifact(artifact)) {
      send('host.error', { code: 'E_INVALID_ARTIFACT', message: 'Artifact rejected by host validator.' }, { replyTo: envelope.messageId });
      onError(new Error('E_INVALID_ARTIFACT'));
      return;
    }
    const action = envelope.replyTo ? (pendingArtifacts.get(envelope.replyTo) ?? 'download') : 'download';
    if (envelope.replyTo) pendingArtifacts.delete(envelope.replyTo);
    await onArtifact(clone(artifact), action);
    send('host.artifact.stored', { artifactId: artifact.artifactId, action }, { replyTo: envelope.messageId });
  }

  function onMessage(event) {
    const envelope = acceptedEnvelope(event);
    if (!envelope) return;
    if (envelope.type === 'uib.hello') {
      const versions = envelope.payload?.supportedProtocolVersions;
      if (!Array.isArray(versions) || !versions.includes(PROTOCOL_VERSION) || envelope.payload?.capabilities?.stWrite !== false) {
        send('host.error', { code: 'E_PROTOCOL_MISMATCH', message: 'UI Builder protocol or safety capabilities do not match.' }, { replyTo: envelope.messageId });
        onStatus({ state: 'error' });
        return;
      }
      send('host.init', initPayload(), { replyTo: envelope.messageId });
      return;
    }
    if (envelope.type === 'uib.ready') {
      connected = true;
      nodeCount = Number.isSafeInteger(envelope.payload?.nodeCount) ? envelope.payload.nodeCount : 0;
      onStatus({ state: 'ready', revision: envelope.payload?.localRevision ?? 0 });
      return;
    }
    if (envelope.type === 'uib.draft.changed') {
      nodeCount = Number.isSafeInteger(envelope.payload?.nodeCount) ? envelope.payload.nodeCount : nodeCount;
      onStatus({ state: 'dirty', revision: envelope.payload?.localRevision ?? 0 });
      requestSnapshot('autosave');
      return;
    }
    if (envelope.type === 'uib.draft.snapshot') {
      handleSnapshot(envelope);
      return;
    }
    if (envelope.type === 'uib.artifact.content') {
      void handleArtifact(envelope).catch(onError);
      return;
    }
    if (envelope.type === 'uib.error') {
      const error = new Error(String(envelope.payload?.message || envelope.payload?.code || 'UI Builder bridge error'));
      onStatus({ state: 'error' });
      onError(error);
    }
  }

  function mount() {
    pendingFlushes.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('E_UI_BUILDER_SESSION_REPLACED'));
    });
    pendingFlushes.clear();
    sessionId = randomId('uib-session');
    nonce = randomId('uib-nonce');
    connected = false;
    nodeCount = 0;
    seenMessages.clear();
    pendingArtifacts.clear();
    onStatus({ state: 'connecting' });
    const params = new URLSearchParams({ embed: '1', session: sessionId, nonce, parent: location.origin });
    iframe.src = `${resolvedBuilderUrl.pathname}${resolvedBuilderUrl.search}#${params}`;
  }

  function syncContext() {
    if (!connected) return;
    send('host.context.replace', { context: clone(getContext?.() ?? null) });
  }

  function requestArtifact(target, action = 'download') {
    if (!['design-json', 'html', 'st-html'].includes(target)) throw new Error('E_UNSUPPORTED_ARTIFACT');
    const messageId = send('host.artifact.request', { target });
    if (messageId) pendingArtifacts.set(messageId, action);
    return messageId;
  }

  function flush() {
    if (!connected) return Promise.resolve();
    const requestId = requestSnapshot('workspace-flush');
    if (!requestId) return Promise.reject(new Error('E_UI_BUILDER_NOT_CONNECTED'));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (!pendingFlushes.has(requestId)) return;
        pendingFlushes.delete(requestId);
        reject(new Error('E_UI_BUILDER_FLUSH_TIMEOUT'));
      }, 8000);
      pendingFlushes.set(requestId, { resolve, reject, timer });
    });
  }

  function destroy() {
    destroyed = true;
    pendingFlushes.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('E_UI_BUILDER_SESSION_CLOSED'));
    });
    pendingFlushes.clear();
    window.removeEventListener('message', onMessage);
    iframe.removeAttribute('src');
  }

  window.addEventListener('message', onMessage);
  return {
    mount,
    reload: mount,
    destroy,
    flush,
    syncContext,
    requestSnapshot,
    requestArtifact,
    get connected() { return connected; },
    get nodeCount() { return nodeCount; },
  };
}
