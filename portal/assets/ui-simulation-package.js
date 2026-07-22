export const UI_SIMULATION_PACKAGE_FORMAT = 'rpn-ui-simulation-package';
export const UI_SIMULATION_PACKAGE_VERSION = 1;
export const UI_SIMULATION_PREVIEW_BRIDGE = 'rpn.ui-simulation-preview';
export const UI_SIMULATION_PREVIEW_PROTOCOL = 1;

export const UI_SIMULATION_PACKAGE_LIMITS = Object.freeze({
  packageBytes: 2 * 1024 * 1024,
  stateBytes: 512 * 1024,
  maxDepth: 48,
  maxNodes: 30000,
  maxScenarios: 32,
  maxStepsPerScenario: 256,
  maxTotalSteps: 1024,
  maxDiffEntries: 2048,
  maxEvents: 512,
  maxIdLength: 160,
  maxActionIdLength: 128,
  maxTitleLength: 240,
  maxDescriptionLength: 4000,
  maxSourceFingerprintLength: 512,
  maxStringLength: 256 * 1024,
});

const ENGINES = new Set(['mvu', 'database', 'other']);
const POISON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EXECUTABLE_KEYS = new Set([
  'callback', 'callbacks', 'code', 'command', 'commands', 'eval', 'exec', 'executable',
  'function', 'functions', 'handler', 'handlers', 'javascript', 'script', 'scripts',
]);
const DANGEROUS_TEXT = /<\/?script\b|javascript\s*:|data\s*:\s*(?:text\/html|application\/javascript)/i;
const TOP_LEVEL_FIELDS = new Set([
  'format', 'schemaVersion', 'engine', 'title', 'description', 'sourceFingerprint',
  'initialState', 'scenarios', 'fingerprint',
]);
const SCENARIO_FIELDS = new Set(['id', 'title', 'description', 'steps']);
const STEP_FIELDS = new Set(['id', 'actionId', 'label', 'state', 'diff', 'events']);

export class UiSimulationPackageError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'UiSimulationPackageError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = '') {
  throw new UiSimulationPackageError(code, message, detail);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function byteLength(value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainRecord(value)) {
    const fields = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${fields.join(',')}}`;
  }
  return JSON.stringify(value);
}

function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isPlainRecord(value)) {
    const output = {};
    Object.keys(value).forEach((key) => { output[key] = cloneJson(value[key]); });
    return output;
  }
  return value;
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (isPlainRecord(value)) {
    const output = {};
    Object.keys(value).sort().forEach((key) => { output[key] = sortedJson(value[key]); });
    return output;
  }
  return value;
}

function normalizedKey(key) {
  return key.toLowerCase().replace(/[\s_-]+/g, '');
}

function validateKey(key, path) {
  if (!key || /[\u0000-\u001f\u007f]/.test(key)) fail('E_UNSAFE_KEY', `${path} 含空键或控制字符。`);
  if (POISON_KEYS.has(key)) fail('E_POISON_KEY', `${path} 含被禁止的原型链键：${key}。`);
  const compact = normalizedKey(key);
  if (EXECUTABLE_KEYS.has(compact) || /^on(?:click|error|load|message|submit|change|input|keydown|keyup)$/.test(compact)) {
    fail('E_EXECUTABLE_FIELD', `${path} 含脚本或命令字段：${key}。`);
  }
}

function validateJsonSafe(value, label = '模拟包') {
  const seen = new Set();
  let nodes = 0;
  const visit = (input, depth, path) => {
    nodes += 1;
    if (nodes > UI_SIMULATION_PACKAGE_LIMITS.maxNodes) {
      fail('E_NODE_LIMIT', `${label} 的节点数量超过 ${UI_SIMULATION_PACKAGE_LIMITS.maxNodes}。`);
    }
    if (depth > UI_SIMULATION_PACKAGE_LIMITS.maxDepth) {
      fail('E_DEPTH_LIMIT', `${label} 的嵌套深度超过 ${UI_SIMULATION_PACKAGE_LIMITS.maxDepth}。`);
    }
    if (input === null || typeof input === 'boolean') return;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail('E_NONFINITE_NUMBER', `${path} 不是有限数字。`);
      return;
    }
    if (typeof input === 'string') {
      if (input.length > UI_SIMULATION_PACKAGE_LIMITS.maxStringLength) fail('E_STRING_LIMIT', `${path} 的文字过长。`);
      if (DANGEROUS_TEXT.test(input)) fail('E_SCRIPT_TEXT', `${path} 含可执行脚本文本。`);
      return;
    }
    if (typeof input !== 'object') fail('E_NON_JSON_VALUE', `${path} 含函数、undefined、BigInt 或其他非 JSON 值。`);
    if (seen.has(input)) fail('E_CYCLE', `${label} 含循环引用。`);
    seen.add(input);

    if (Object.getOwnPropertySymbols(input).length) fail('E_NON_JSON_KEY', `${path} 含 Symbol 字段。`);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    Object.entries(descriptors).forEach(([key, descriptor]) => {
      if (key === 'length' && Array.isArray(input)) return;
      if (!descriptor.enumerable || descriptor.get || descriptor.set) {
        fail('E_NON_JSON_PROPERTY', `${path}/${key} 不是可序列化的普通 JSON 字段。`);
      }
    });
    if (Array.isArray(input)) {
      const stringKeys = Object.keys(input);
      if (stringKeys.length !== input.length || stringKeys.some((key, index) => key !== String(index))) {
        fail('E_INVALID_ARRAY', `${path} 必须是连续、且不含自定义字段的 JSON 数组。`);
      }
      input.forEach((item, index) => visit(item, depth + 1, `${path}/${index}`));
    } else {
      if (!isPlainRecord(input)) fail('E_NON_JSON_OBJECT', `${path} 必须是普通 JSON 对象。`);
      Object.keys(input).forEach((key) => {
        validateKey(key, `${path} 的字段`);
        visit(input[key], depth + 1, `${path}/${key}`);
      });
    }
    seen.delete(input);
  };
  visit(value, 0, label);
}

function assertAllowedFields(value, allowed, code, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(code, `${label} 含未知字段：${unknown.join('、')}。`);
}

function normalizeText(value, label, { required = false, maxLength = UI_SIMULATION_PACKAGE_LIMITS.maxTitleLength } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') fail('E_TEXT_TYPE', `${label} 必须是文字。`);
  const normalized = value.trim();
  if (required && !normalized) fail('E_TEXT_EMPTY', `${label} 不能为空。`);
  if (normalized.length > maxLength) fail('E_TEXT_LIMIT', `${label} 超过 ${maxLength} 字。`);
  if (/[\u0000-\u001f\u007f]/.test(normalized)) fail('E_TEXT_CONTROL', `${label} 含控制字符。`);
  return normalized;
}

function parseSource(raw) {
  if (typeof raw !== 'string') return raw;
  if (byteLength(raw) > UI_SIMULATION_PACKAGE_LIMITS.packageBytes) {
    fail('E_PACKAGE_SIZE', `模拟包超过 ${UI_SIMULATION_PACKAGE_LIMITS.packageBytes / 1024} KiB。`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('E_JSON_PARSE', '模拟包不是有效 JSON。', error.message);
  }
}

function validateState(state, label) {
  if (!isPlainRecord(state)) fail('E_STATE_ROOT', `${label} 的根必须是对象。`);
  if (byteLength(stableStringify(state)) > UI_SIMULATION_PACKAGE_LIMITS.stateBytes) {
    fail('E_STATE_SIZE', `${label} 超过 ${UI_SIMULATION_PACKAGE_LIMITS.stateBytes / 1024} KiB。`);
  }
  return cloneJson(state);
}

function normalizeList(value, label, limit, code) {
  if (!Array.isArray(value) || value.length > limit) fail(code, `${label} 必须是最多 ${limit} 项的数组。`);
  return cloneJson(value);
}

function normalizeStep(step, scenarioIndex, stepIndex) {
  const label = `scenarios[${scenarioIndex}].steps[${stepIndex}]`;
  if (!isPlainRecord(step)) fail('E_STEP_ROOT', `${label} 必须是对象。`);
  assertAllowedFields(step, STEP_FIELDS, 'E_STEP_FIELD', label);
  const actionId = normalizeText(step.actionId, `${label}.actionId`, {
    required: true,
    maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxActionIdLength,
  });
  if (!Object.hasOwn(step, 'state')) fail('E_STEP_STATE', `${label}.state 是必填字段。`);
  const state = validateState(step.state, `${label}.state`);
  const diff = Object.hasOwn(step, 'diff')
    ? normalizeList(step.diff, `${label}.diff`, UI_SIMULATION_PACKAGE_LIMITS.maxDiffEntries, 'E_DIFF_LIMIT')
    : undefined;
  const events = Object.hasOwn(step, 'events')
    ? normalizeList(step.events, `${label}.events`, UI_SIMULATION_PACKAGE_LIMITS.maxEvents, 'E_EVENT_LIMIT')
    : undefined;
  const id = normalizeText(step.id, `${label}.id`, { maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxIdLength })
    || `step-${hashText(stableStringify({ scenarioIndex, stepIndex, actionId, state, diff, events }))}`;
  const stepLabel = normalizeText(step.label, `${label}.label`, { maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxTitleLength });
  return {
    id,
    actionId,
    ...(stepLabel ? { label: stepLabel } : {}),
    state,
    ...(diff !== undefined ? { diff } : {}),
    ...(events !== undefined ? { events } : {}),
  };
}

function normalizeScenario(scenario, scenarioIndex) {
  const label = `scenarios[${scenarioIndex}]`;
  if (!isPlainRecord(scenario)) fail('E_SCENARIO_ROOT', `${label} 必须是对象。`);
  assertAllowedFields(scenario, SCENARIO_FIELDS, 'E_SCENARIO_FIELD', label);
  if (!Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > UI_SIMULATION_PACKAGE_LIMITS.maxStepsPerScenario) {
    fail('E_STEP_LIMIT', `${label}.steps 必须包含 1 至 ${UI_SIMULATION_PACKAGE_LIMITS.maxStepsPerScenario} 步。`);
  }
  const steps = scenario.steps.map((step, stepIndex) => normalizeStep(step, scenarioIndex, stepIndex));
  const title = normalizeText(scenario.title, `${label}.title`, { maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxTitleLength });
  const description = normalizeText(scenario.description, `${label}.description`, {
    maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxDescriptionLength,
  });
  const id = normalizeText(scenario.id, `${label}.id`, { maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxIdLength })
    || `scenario-${hashText(stableStringify({ scenarioIndex, title, description, steps }))}`;
  const stepIds = new Set();
  steps.forEach((step) => {
    if (stepIds.has(step.id)) fail('E_DUPLICATE_STEP_ID', `${label} 重复定义步骤 id：${step.id}。`);
    stepIds.add(step.id);
  });
  return {
    id,
    title: title || `场景 ${scenarioIndex + 1}`,
    ...(description ? { description } : {}),
    steps,
  };
}

function packagePayload(value) {
  return {
    format: value.format,
    schemaVersion: value.schemaVersion,
    engine: value.engine,
    title: value.title,
    description: value.description,
    sourceFingerprint: value.sourceFingerprint,
    initialState: value.initialState,
    scenarios: value.scenarios,
  };
}

export function normalizeUiSimulationPackage(raw) {
  const source = parseSource(raw);
  if (!isPlainRecord(source)) fail('E_PACKAGE_ROOT', '模拟包根必须是对象。');
  validateJsonSafe(source);
  if (byteLength(stableStringify(source)) > UI_SIMULATION_PACKAGE_LIMITS.packageBytes) {
    fail('E_PACKAGE_SIZE', `模拟包超过 ${UI_SIMULATION_PACKAGE_LIMITS.packageBytes / 1024} KiB。`);
  }
  assertAllowedFields(source, TOP_LEVEL_FIELDS, 'E_PACKAGE_FIELD', '模拟包');
  if (source.format !== UI_SIMULATION_PACKAGE_FORMAT || source.schemaVersion !== UI_SIMULATION_PACKAGE_VERSION) {
    fail('E_PACKAGE_VERSION', '模拟包的格式或版本不受支持。');
  }
  if (!ENGINES.has(source.engine)) fail('E_ENGINE', '模拟包 engine 只支持 mvu、database 或 other。');
  const title = normalizeText(source.title, 'title', { maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxTitleLength });
  const description = normalizeText(source.description, 'description', {
    maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxDescriptionLength,
  });
  const sourceFingerprint = normalizeText(source.sourceFingerprint, 'sourceFingerprint', {
    maxLength: UI_SIMULATION_PACKAGE_LIMITS.maxSourceFingerprintLength,
  });
  if (!Object.hasOwn(source, 'initialState')) fail('E_INITIAL_STATE', '模拟包 initialState 是必填字段。');
  const initialState = validateState(source.initialState, 'initialState');
  if (!Array.isArray(source.scenarios) || !source.scenarios.length || source.scenarios.length > UI_SIMULATION_PACKAGE_LIMITS.maxScenarios) {
    fail('E_SCENARIO_LIMIT', `模拟包 scenarios 必须包含 1 至 ${UI_SIMULATION_PACKAGE_LIMITS.maxScenarios} 个场景。`);
  }
  const scenarios = source.scenarios.map(normalizeScenario);
  const totalSteps = scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0);
  if (totalSteps > UI_SIMULATION_PACKAGE_LIMITS.maxTotalSteps) {
    fail('E_TOTAL_STEP_LIMIT', `模拟包总步骤数超过 ${UI_SIMULATION_PACKAGE_LIMITS.maxTotalSteps}。`);
  }
  const scenarioIds = new Set();
  scenarios.forEach((scenario) => {
    if (scenarioIds.has(scenario.id)) fail('E_DUPLICATE_SCENARIO_ID', `模拟包重复定义场景 id：${scenario.id}。`);
    scenarioIds.add(scenario.id);
  });
  const normalized = {
    format: UI_SIMULATION_PACKAGE_FORMAT,
    schemaVersion: UI_SIMULATION_PACKAGE_VERSION,
    engine: source.engine,
    title,
    description,
    sourceFingerprint,
    initialState,
    scenarios,
  };
  normalized.fingerprint = `fnv1a:${hashText(stableStringify(packagePayload(normalized)))}`;
  if (Object.hasOwn(source, 'fingerprint') && source.fingerprint !== normalized.fingerprint) {
    fail('E_FINGERPRINT', '模拟包 fingerprint 与归一化内容不一致。');
  }
  return normalized;
}

export function fingerprintUiSimulationPackage(raw) {
  return normalizeUiSimulationPackage(raw).fingerprint;
}

export function serializeUiSimulationPackage(raw, space = 2) {
  const indentation = Number.isInteger(space) && space >= 0 && space <= 8 ? space : 2;
  return JSON.stringify(sortedJson(normalizeUiSimulationPackage(raw)), null, indentation);
}

function inlineScriptLiteral(value) {
  return JSON.stringify(String(value))
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function previewScriptNonce(value) {
  const bytes = new TextEncoder().encode(String(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function previewSecurityPolicy(scriptNonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${scriptNonce}'`,
    "script-src-attr 'none'",
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    'media-src data:',
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function normalizePreviewBootstrapOptions(options = {}) {
  const sessionId = normalizeText(options.sessionId, 'preview.sessionId', { required: true, maxLength: 200 });
  const nonce = normalizeText(options.nonce, 'preview.nonce', { required: true, maxLength: 200 });
  let parentOrigin;
  try {
    parentOrigin = new URL(String(options.parentOrigin || '')).origin;
  } catch {
    fail('E_PREVIEW_ORIGIN', 'preview.parentOrigin 不是有效 URL。');
  }
  if (!/^https?:\/\//.test(parentOrigin)) fail('E_PREVIEW_ORIGIN', 'preview.parentOrigin 只允许 HTTP(S) 来源。');
  return { sessionId, nonce, parentOrigin };
}

function uiSimulationPreviewRuntime({ sessionId, nonce, parentOrigin }, html) {
  return `(() => {
  'use strict';
  const BRIDGE = ${inlineScriptLiteral(UI_SIMULATION_PREVIEW_BRIDGE)};
  const PROTOCOL = ${UI_SIMULATION_PREVIEW_PROTOCOL};
  const SESSION = ${inlineScriptLiteral(sessionId)};
  const NONCE = ${inlineScriptLiteral(nonce)};
  const PARENT_ORIGIN = ${inlineScriptLiteral(parentOrigin)};
  const SOURCE_HTML = ${inlineScriptLiteral(html)};
  const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
  const BLOCKED_ELEMENTS = [
    'script', 'noscript', 'iframe', 'frame', 'frameset', 'fencedframe', 'object',
    'embed', 'portal', 'applet', 'webview', 'meta', 'base', 'link', 'template',
  ];
  const BLOCKED_ATTRIBUTES = new Set([
    'http-equiv', 'href', 'xlink:href', 'srcdoc', 'srcset', 'imagesrcset',
    'action', 'formaction', 'formtarget', 'target', 'ping', 'attributionsrc',
    'background', 'manifest', 'profile', 'code', 'codebase', 'archive', 'classid',
    'data', 'usemap', 'longdesc', 'lowsrc', 'dynsrc', 'nonce', 'csp',
  ]);
  let messageCounter = 0;
  let currentFrame = { revision: 0, scenarioId: '', stepId: '' };

  function send(type, payload = {}) {
    window.parent.postMessage({
      bridge: BRIDGE,
      protocolVersion: PROTOCOL,
      sessionId: SESSION,
      nonce: NONCE,
      messageId: SESSION + ':preview:' + (++messageCounter),
      type,
      payload,
    }, PARENT_ORIGIN);
  }

  function pathSegments(path) {
    const source = String(path || '').trim();
    if (!source) return [];
    if (source.startsWith('/')) {
      return source.slice(1).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'));
    }
    return source.split('.').map((part) => part.trim()).filter(Boolean);
  }

  function readPath(state, path) {
    let current = state;
    for (const segment of pathSegments(path)) {
      if (BLOCKED.has(segment) || current == null || (typeof current !== 'object' && !Array.isArray(current))) {
        return { found: false };
      }
      if (!Object.prototype.hasOwnProperty.call(current, segment)) return { found: false };
      current = current[segment];
    }
    return { found: true, value: current };
  }

  function textValue(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      const encoded = JSON.stringify(value);
      return encoded.length > 4000 ? encoded.slice(0, 3997) + '...' : encoded;
    }
    return String(value).slice(0, 4000);
  }

  function visibleValue(value) {
    if (value == null || value === false || value === 0) return false;
    if (typeof value === 'string' && ['', '0', 'false', 'null', 'undefined'].includes(value.trim().toLowerCase())) return false;
    return true;
  }

  function isDataUrl(value) {
    return /^\s*data:/i.test(String(value || ''));
  }

  function sanitizedSourceFragment() {
    const template = document.createElement('template');
    template.innerHTML = SOURCE_HTML;
    const fragment = template.content;
    fragment.querySelectorAll(BLOCKED_ELEMENTS.join(',')).forEach((node) => node.remove());
    fragment.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const unsafeSource = (name === 'src' || name === 'poster') && !isDataUrl(attribute.value);
        if (name.startsWith('on') || name === 'autoplay' || BLOCKED_ATTRIBUTES.has(name) || unsafeSource) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return fragment;
  }

  function applyState(payload) {
    const state = payload && payload.state && typeof payload.state === 'object' ? payload.state : {};
    let textBindings = 0;
    let visibilityBindings = 0;
    let missingBindings = 0;
    document.querySelectorAll('[data-rpn-bind-text]').forEach((node) => {
      const result = readPath(state, node.getAttribute('data-rpn-bind-text'));
      const target = node.querySelector('[data-rpn-bind-target="text"]');
      if (!result.found || !target) { missingBindings += 1; return; }
      target.textContent = textValue(result.value);
      textBindings += 1;
    });
    document.querySelectorAll('[data-rpn-bind-visible]').forEach((node) => {
      const result = readPath(state, node.getAttribute('data-rpn-bind-visible'));
      const visible = result.found && visibleValue(result.value);
      node.hidden = !visible;
      node.setAttribute('aria-hidden', String(!visible));
      if (result.found) visibilityBindings += 1;
      else missingBindings += 1;
    });
    currentFrame = {
      revision: Number.isSafeInteger(payload && payload.revision) ? payload.revision : 0,
      scenarioId: typeof (payload && payload.scenarioId) === 'string' ? payload.scenarioId.slice(0, 160) : '',
      stepId: typeof (payload && payload.stepId) === 'string' ? payload.stepId.slice(0, 160) : '',
    };
    send('preview.rendered', {
      revision: currentFrame.revision,
      textBindings,
      visibilityBindings,
      missingBindings,
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.origin !== PARENT_ORIGIN) return;
    const message = event.data;
    if (!message || message.bridge !== BRIDGE || message.protocolVersion !== PROTOCOL
      || message.sessionId !== SESSION || message.nonce !== NONCE || message.type !== 'host.state.replace') return;
    try { applyState(message.payload); }
    catch (error) { send('preview.error', { message: error instanceof Error ? error.message : String(error) }); }
  });

  document.addEventListener('submit', (event) => event.preventDefault(), true);

  document.addEventListener('click', (event) => {
    const source = event.target instanceof Element ? event.target : null;
    const formSubmitControl = source ? source.closest('button, input') : null;
    if (formSubmitControl?.form && ['submit', 'image'].includes(formSubmitControl.type)) event.preventDefault();
    const navigationTarget = source ? source.closest('a, area') : null;
    if (navigationTarget) event.preventDefault();
    const target = source ? source.closest('[data-rpn-action]') : null;
    if (!target) return;
    const actionId = String(target.getAttribute('data-rpn-action') || '').trim();
    if (!actionId) return;
    event.preventDefault();
    send('preview.action', { actionId, ...currentFrame });
  }, true);

  window.addEventListener('pagehide', () => send('preview.unloading', {}), { once: true });

  try {
    document.body.replaceChildren(sanitizedSourceFragment());
    send('preview.ready', {});
  } catch (error) {
    send('preview.error', { message: error instanceof Error ? error.message : String(error) });
  }
})();`;
}

export function createUiSimulationPreviewDocument(html, options = {}) {
  if (typeof html !== 'string' || !html.trim()) fail('E_PREVIEW_HTML', '预览 HTML 不能为空。');
  if (byteLength(html) > UI_SIMULATION_PACKAGE_LIMITS.packageBytes) fail('E_PREVIEW_HTML_SIZE', '预览 HTML 超过 2 MiB。');
  const bootstrap = normalizePreviewBootstrapOptions(options);
  const scriptNonce = previewScriptNonce(bootstrap.nonce);
  const policy = previewSecurityPolicy(scriptNonce);
  const runtime = uiSimulationPreviewRuntime(bootstrap, html).replaceAll('</script', '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><title>RPN UI simulation preview</title></head><body><script data-rpn-simulation-runtime nonce="${scriptNonce}">${runtime}</script></body></html>`;
}
