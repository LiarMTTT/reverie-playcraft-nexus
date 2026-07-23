/**
 * RPN 制卡工作台的独立 AI 边界。
 *
 * - 统一适配 OpenAI Chat / Responses、Anthropic Messages、Google Gemini、
 *   Cohere v2、DashScope Native 与 Ollama Native。
 * - 各格式只开放模型列表与非流式聊天端点，并把响应归一为 OpenAI choices/model/usage。
 * - API Key 只存在函数参数或实例私有字段中，不提供任何持久化能力。
 * - AIRP 按 SillyTavern OpenAI Settings / Prompt Manager 的真实导出结构读取，
 *   未知字段原样保留；提示词中的宏、EJS 或 JavaScript 永远不会在这里执行。
 */

'use strict';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TIMEOUT_MS = 5 * 60_000;
const MAX_BASE_URL_LENGTH = 2048;
const MAX_MODEL_ID_LENGTH = 512;
const MAX_MESSAGE_COUNT = 512;
const MAX_MESSAGE_CONTENT_CHARS = 4 * 1024 * 1024;
const MAX_AIRP_BYTES = 8 * 1024 * 1024;
const MAX_AIRP_PROMPTS = 2048;
const MAX_AIRP_CONTENT_CHARS = 8 * 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 100_000;

const DEFAULT_API_FORMAT = 'openai-compatible';
const DEFAULT_NETWORK_MODE = 'direct';
const LEGACY_NETWORK_MODE = 'systemProxy';
const STUDIO_AI_API_FORMATS = Object.freeze({
  'openai-compatible': Object.freeze({
    label: 'OpenAI Compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlPlaceholder: 'https://api.example.com/v1',
    credentialHelp: '使用 Authorization: Bearer <API Key>；本地免鉴权服务可留空。',
    supportsModelList: true,
  }),
  'openai-responses': Object.freeze({
    label: 'OpenAI Responses',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrlPlaceholder: 'https://api.openai.com/v1',
    credentialHelp: '使用 Authorization: Bearer <API Key>，请求发送到 /responses。',
    supportsModelList: true,
  }),
  'anthropic-messages': Object.freeze({
    label: 'Anthropic Messages',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    baseUrlPlaceholder: 'https://api.anthropic.com/v1',
    credentialHelp: '使用 x-api-key，并固定发送 anthropic-version: 2023-06-01。',
    supportsModelList: true,
  }),
  'google-gemini': Object.freeze({
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    baseUrlPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
    credentialHelp: '使用 x-goog-api-key；Key 不会写入 URL、配置档或持久化存储。',
    supportsModelList: true,
  }),
  'cohere-v2': Object.freeze({
    label: 'Cohere v2 Chat',
    defaultBaseUrl: 'https://api.cohere.com',
    baseUrlPlaceholder: 'https://api.cohere.com',
    credentialHelp: '使用 Authorization: Bearer <API Key>；聊天与模型列表分别使用 v2 / v1。',
    supportsModelList: true,
  }),
  'dashscope-native': Object.freeze({
    label: 'DashScope Native',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    baseUrlPlaceholder: 'https://dashscope.aliyuncs.com/api/v1',
    credentialHelp: '使用 Authorization: Bearer <API Key>；原生文本端点不提供统一模型列表。',
    supportsModelList: false,
  }),
  'ollama-native': Object.freeze({
    label: 'Ollama Native',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    baseUrlPlaceholder: 'http://127.0.0.1:11434',
    credentialHelp: 'Ollama 本机服务通常无需 API Key；填写的 Key 不会发送。',
    supportsModelList: true,
  }),
});
const STUDIO_AI_NETWORK_MODES = Object.freeze({
  direct: '直连',
  systemProxy: '使用系统代理',
});
const VALID_API_FORMATS = new Set(Object.keys(STUDIO_AI_API_FORMATS));
const VALID_NETWORK_MODES = new Set(Object.keys(STUDIO_AI_NETWORK_MODES));
const VALID_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);
const AIRP_SENSITIVE_FIELDS = Object.freeze([
  'reverse_proxy',
  'proxy_password',
  'custom_url',
  'custom_include_headers',
  'custom_include_body',
  'custom_exclude_body',
  'vertexai_region',
  'vertexai_express_project_id',
  'azure_base_url',
  'azure_deployment_name',
  'api_key',
  'authorization',
  'access_token',
  'client_secret',
  'password',
]);

const AIRP_SENSITIVE_COMPACT_KEYS = new Set(AIRP_SENSITIVE_FIELDS.map((key) => key.replace(/[^a-z0-9]/g, '')));

const AIRP_MARKER_IDENTIFIERS = new Set([
  'dialogueExamples',
  'chatHistory',
  'worldInfoAfter',
  'worldInfoBefore',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
]);

const AIRP_SAMPLING_PARAMETER_SPECS = Object.freeze([
  Object.freeze({ sourceKey: 'temperature', directKey: 'temperature', min: 0, max: 2 }),
  Object.freeze({ sourceKey: 'top_p', directKey: 'top_p', min: 0, max: 1 }),
  Object.freeze({ sourceKey: 'frequency_penalty', directKey: 'frequency_penalty', min: -2, max: 2 }),
  Object.freeze({ sourceKey: 'presence_penalty', directKey: 'presence_penalty', min: -2, max: 2 }),
  Object.freeze({ sourceKey: 'openai_max_tokens', directKey: 'max_tokens', min: 1, max: 1_000_000, integer: true }),
  Object.freeze({ sourceKey: 'seed', directKey: 'seed', min: -2_147_483_648, max: 2_147_483_647, integer: true }),
  Object.freeze({ sourceKey: 'n', directKey: 'n', min: 1, max: 8, integer: true }),
  Object.freeze({ sourceKey: 'top_k', directKey: null }),
  Object.freeze({ sourceKey: 'top_a', directKey: null }),
  Object.freeze({ sourceKey: 'min_p', directKey: null }),
  Object.freeze({ sourceKey: 'repetition_penalty', directKey: null }),
  Object.freeze({ sourceKey: 'openai_max_context', directKey: null }),
]);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

class StudioAiError extends Error {
  constructor(code, message, { status = null, retryable = false, cause = undefined, details = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'StudioAiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (details !== undefined) this.details = details;
  }
}

class AirpPresetError extends Error {
  constructor(code, message, { issues = [], cause = undefined } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AirpPresetError';
    this.code = code;
    this.issues = issues;
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function safeJsonClone(value) {
  const seen = new WeakSet();
  let nodes = 0;

  const visit = (current, path, depth) => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      throw new AirpPresetError('airp-too-complex', 'AIRP 数据节点过多。');
    }
    if (depth > MAX_JSON_DEPTH) {
      throw new AirpPresetError('airp-too-deep', 'AIRP 数据嵌套过深。');
    }

    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new AirpPresetError('airp-non-json-number', `${path} 包含非有限数值。`);
      }
      return current;
    }
    if (typeof current !== 'object') {
      throw new AirpPresetError('airp-non-json-value', `${path} 包含非 JSON 值。`);
    }
    if (seen.has(current)) {
      throw new AirpPresetError('airp-cycle', `${path} 包含循环引用。`);
    }
    seen.add(current);

    if (Array.isArray(current)) {
      const cloned = current.map((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      seen.delete(current);
      return cloned;
    }
    if (!isPlainRecord(current)) {
      throw new AirpPresetError('airp-exotic-object', `${path} 必须是普通 JSON 对象。`);
    }

    const descriptors = Object.getOwnPropertyDescriptors(current);
    if (Object.getOwnPropertySymbols(current).length > 0) {
      throw new AirpPresetError('airp-symbol-key', `${path} 包含 Symbol 键。`);
    }

    const cloned = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (!hasOwn(descriptor, 'value')) {
        throw new AirpPresetError('airp-accessor', `${path}.${key} 不得使用 getter/setter。`);
      }
      Object.defineProperty(cloned, key, {
        value: visit(descriptor.value, `${path}.${key}`, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    seen.delete(current);
    return cloned;
  };

  return visit(value, '$', 0);
}

function appendJsonPath(path, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function isSensitiveAirpKey(key) {
  const compact = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact) return false;
  if (AIRP_SENSITIVE_COMPACT_KEYS.has(compact)) return true;

  // Provider-prefixed and camelCase credential variants are common in ST
  // exports and third-party AIRP extensions (for example openaiApiKey).
  return compact.includes('apikey')
    || compact.endsWith('password')
    || compact.endsWith('authorization')
    || compact.endsWith('accesstoken')
    || compact.endsWith('clientsecret')
    || compact.endsWith('authtoken')
    || compact.endsWith('bearertoken')
    || compact.endsWith('refreshtoken')
    || compact === 'token'
    || compact.endsWith('credential')
    || compact.endsWith('credentials');
}

function sensitiveAirpPaths(value) {
  const paths = [];
  const visit = (current, path) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainRecord(current)) return;
    for (const [key, child] of Object.entries(current)) {
      const childPath = appendJsonPath(path, key);
      if (isSensitiveAirpKey(key)) paths.push(childPath);
      else visit(child, childPath);
    }
  };
  visit(value, '$');
  return paths;
}

function stripSensitiveAirpFields(value) {
  const removedSensitiveFields = [];
  const visit = (current, path) => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainRecord(current)) return;
    for (const key of Object.keys(current)) {
      const childPath = appendJsonPath(path, key);
      if (isSensitiveAirpKey(key)) {
        delete current[key];
        removedSensitiveFields.push(childPath);
      } else {
        visit(current[key], childPath);
      }
    }
  };
  visit(value, '$');
  return removedSensitiveFields;
}

function cleanSourceName(sourceName) {
  const base = String(sourceName || '').trim().replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
  return base.slice(0, 240);
}

function detectAirpDocument(preset) {
  if (!isPlainRecord(preset)) return null;
  if (Array.isArray(preset.prompts) && Array.isArray(preset.prompt_order)) {
    return {
      kind: 'sillytavern-openai-settings',
      root: preset,
      prompts: preset.prompts,
      promptOrder: preset.prompt_order,
      orderShape: 'groups',
    };
  }
  if (
    isPlainRecord(preset.data)
    && Array.isArray(preset.data.prompts)
    && Array.isArray(preset.data.prompt_order)
  ) {
    return {
      kind: 'sillytavern-prompt-manager',
      root: preset.data,
      prompts: preset.data.prompts,
      promptOrder: preset.data.prompt_order,
      orderShape: 'flat',
    };
  }
  return null;
}

function issue(code, path, message, severity = 'error') {
  return { code, path, message, severity };
}

function validateAirpClone(preset) {
  const errors = [];
  const warnings = [];
  const document = detectAirpDocument(preset);

  if (!document) {
    errors.push(issue(
      'airp-shape',
      '$',
      '不是 SillyTavern OpenAI Settings 或 Prompt Manager 导出的 AIRP JSON。',
    ));
    return { valid: false, kind: null, errors, warnings };
  }

  if (document.prompts.length > MAX_AIRP_PROMPTS) {
    errors.push(issue('airp-too-many-prompts', '$.prompts', `提示词数量不得超过 ${MAX_AIRP_PROMPTS}。`));
  }

  const firstPromptById = new Map();
  const duplicateIds = new Set();
  let contentChars = 0;

  document.prompts.forEach((prompt, index) => {
    const path = document.kind === 'sillytavern-prompt-manager'
      ? `$.data.prompts[${index}]`
      : `$.prompts[${index}]`;
    if (!isPlainRecord(prompt)) {
      errors.push(issue('airp-prompt-object', path, '提示词必须是对象。'));
      return;
    }

    const identifier = prompt.identifier;
    if (typeof identifier !== 'string' || !identifier.trim() || identifier.length > 512) {
      errors.push(issue('airp-prompt-identifier', `${path}.identifier`, 'identifier 必须是非空字符串。'));
    } else if (firstPromptById.has(identifier)) {
      duplicateIds.add(identifier);
    } else {
      firstPromptById.set(identifier, prompt);
    }

    if (prompt.name !== undefined && typeof prompt.name !== 'string') {
      errors.push(issue('airp-prompt-name', `${path}.name`, 'name 必须是字符串。'));
    }
    if (prompt.content !== undefined && typeof prompt.content !== 'string') {
      errors.push(issue('airp-prompt-content', `${path}.content`, 'content 必须是字符串。'));
    } else if (typeof prompt.content === 'string') {
      contentChars += prompt.content.length;
    }
    if (prompt.role !== undefined && !VALID_MESSAGE_ROLES.has(prompt.role)) {
      warnings.push(issue('airp-prompt-role', `${path}.role`, '未知 role 将在组装时回退为 system。', 'warning'));
    }
    if (prompt.marker !== undefined && typeof prompt.marker !== 'boolean') {
      errors.push(issue('airp-prompt-marker', `${path}.marker`, 'marker 必须是布尔值。'));
    }
    if (prompt.injection_position !== undefined && ![0, 1].includes(prompt.injection_position)) {
      warnings.push(issue(
        'airp-injection-position',
        `${path}.injection_position`,
        '未知 injection_position 将按线性顺序组装。',
        'warning',
      ));
    }
    if (prompt.injection_trigger !== undefined && !Array.isArray(prompt.injection_trigger)) {
      errors.push(issue('airp-injection-trigger', `${path}.injection_trigger`, 'injection_trigger 必须是数组。'));
    }
  });

  if (contentChars > MAX_AIRP_CONTENT_CHARS) {
    errors.push(issue('airp-content-too-large', '$.prompts', 'AIRP 提示词正文总量过大。'));
  }
  for (const identifier of duplicateIds) {
    warnings.push(issue(
      'airp-duplicate-identifier',
      '$.prompts',
      `存在重复 identifier：${identifier}；按 SillyTavern 行为使用首个匹配项。`,
      'warning',
    ));
  }

  const validateOrderEntries = (entries, path) => {
    if (!Array.isArray(entries)) {
      errors.push(issue('airp-order-array', path, 'order 必须是数组。'));
      return;
    }
    entries.forEach((entry, index) => {
      const entryPath = `${path}[${index}]`;
      if (!isPlainRecord(entry)) {
        errors.push(issue('airp-order-entry', entryPath, '顺序项必须是对象。'));
        return;
      }
      if (typeof entry.identifier !== 'string' || !entry.identifier.trim()) {
        errors.push(issue('airp-order-identifier', `${entryPath}.identifier`, 'identifier 必须是非空字符串。'));
        return;
      }
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
        errors.push(issue('airp-order-enabled', `${entryPath}.enabled`, 'enabled 必须是布尔值。'));
      }
      if (!firstPromptById.has(entry.identifier)) {
        warnings.push(issue(
          'airp-order-missing-prompt',
          `${entryPath}.identifier`,
          `顺序引用了不存在的提示词：${entry.identifier}。`,
          'warning',
        ));
      }
    });
  };

  if (document.orderShape === 'groups') {
    document.promptOrder.forEach((group, index) => {
      const path = `$.prompt_order[${index}]`;
      if (!isPlainRecord(group)) {
        errors.push(issue('airp-order-group', path, 'prompt_order 项必须是对象。'));
        return;
      }
      if (!hasOwn(group, 'character_id')) {
        warnings.push(issue('airp-order-character', `${path}.character_id`, '缺少 character_id。', 'warning'));
      }
      validateOrderEntries(group.order, `${path}.order`);
    });
  } else {
    validateOrderEntries(document.promptOrder, '$.data.prompt_order');
  }

  const sensitiveFields = sensitiveAirpPaths(preset);
  if (sensitiveFields.length > 0) {
    warnings.push(issue(
      'airp-connection-fields',
      '$',
      `预设含连接或凭证字段：${sensitiveFields.join(', ')}；导入时不会保存这些字段。`,
      'warning',
    ));
  }

  return {
    valid: errors.length === 0,
    kind: document.kind,
    errors,
    warnings,
  };
}

function validateAirpPreset(input) {
  try {
    const text = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : null;
    if (text !== null && utf8ByteLength(text) > MAX_AIRP_BYTES) {
      throw new AirpPresetError('airp-file-too-large', `AIRP 文件不得超过 ${MAX_AIRP_BYTES} 字节。`);
    }
    const preset = safeJsonClone(text === null ? input : JSON.parse(text));
    if (text === null && utf8ByteLength(JSON.stringify(preset)) > MAX_AIRP_BYTES) {
      throw new AirpPresetError('airp-file-too-large', `AIRP 数据不得超过 ${MAX_AIRP_BYTES} 字节。`);
    }
    return validateAirpClone(preset);
  } catch (error) {
    const message = error instanceof SyntaxError ? 'AIRP JSON 解析失败。' : error.message;
    return {
      valid: false,
      kind: null,
      errors: [issue(error.code || 'airp-parse', '$', message)],
      warnings: [],
    };
  }
}

function importAirpPreset(input, { sourceName = '' } = {}) {
  let parsed;
  let byteLength;

  try {
    if (typeof input === 'string') {
      const text = input.replace(/^\uFEFF/, '');
      byteLength = utf8ByteLength(text);
      if (byteLength > MAX_AIRP_BYTES) {
        throw new AirpPresetError('airp-file-too-large', `AIRP 文件不得超过 ${MAX_AIRP_BYTES} 字节。`);
      }
      parsed = JSON.parse(text);
    } else {
      parsed = input;
    }
  } catch (error) {
    if (error instanceof AirpPresetError) throw error;
    throw new AirpPresetError('airp-json', 'AIRP JSON 解析失败。', { cause: error });
  }

  const preset = safeJsonClone(parsed);
  if (byteLength === undefined) {
    byteLength = utf8ByteLength(JSON.stringify(preset));
    if (byteLength > MAX_AIRP_BYTES) {
      throw new AirpPresetError('airp-file-too-large', `AIRP 数据不得超过 ${MAX_AIRP_BYTES} 字节。`);
    }
  }

  const sourceValidation = validateAirpClone(preset);
  if (!sourceValidation.valid) {
    throw new AirpPresetError('airp-invalid', 'AIRP 预设校验失败。', { issues: sourceValidation.errors });
  }

  // `preset` is already a defensive clone, so recursively removing credentials
  // cannot mutate the caller's object. The result remains a genuine ST AIRP
  // document and can be exported without introducing an RPN-native wrapper.
  const removedSensitiveFields = stripSensitiveAirpFields(preset);
  const validation = validateAirpClone(preset);
  if (removedSensitiveFields.length > 0) {
    validation.warnings.push(issue(
      'airp-sensitive-fields-removed',
      '$',
      `导入时已移除 ${removedSensitiveFields.length} 个连接或凭证字段。`,
      'warning',
    ));
  }

  return {
    kind: validation.kind,
    name: cleanSourceName(sourceName),
    byteLength,
    preset,
    removedSensitiveFields,
    validation,
  };
}

function selectAirpOrder(document, requestedCharacterId) {
  if (document.orderShape === 'flat') {
    return {
      characterId: null,
      entries: document.promptOrder,
    };
  }

  const requested = requestedCharacterId === undefined || requestedCharacterId === null
    ? '100001'
    : String(requestedCharacterId);
  const selected = document.promptOrder.find((group) => String(group?.character_id) === requested)
    || document.promptOrder.find((group) => String(group?.character_id) === '100001')
    || document.promptOrder.find((group) => Array.isArray(group?.order));

  return {
    characterId: selected?.character_id ?? null,
    entries: Array.isArray(selected?.order) ? selected.order : [],
  };
}

function firstPromptMap(prompts) {
  const map = new Map();
  const duplicates = [];
  for (const prompt of prompts) {
    if (!isPlainRecord(prompt) || typeof prompt.identifier !== 'string') continue;
    if (map.has(prompt.identifier)) duplicates.push(prompt.identifier);
    else map.set(prompt.identifier, prompt);
  }
  return { map, duplicates: [...new Set(duplicates)] };
}

function safeSubstituteAirpText(content, substitutions, usedKeys) {
  if (!isPlainRecord(substitutions)) return content;
  return content.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,63})\s*\}\}/g, (match, key) => {
    if (!hasOwn(substitutions, key)) return match;
    const value = substitutions[key];
    if (!['string', 'number', 'boolean'].includes(typeof value)) return match;
    usedKeys.add(key);
    return String(value);
  });
}

function normalizePromptMessage(message, fallbackRole = 'system') {
  if (!isPlainRecord(message) || typeof message.content !== 'string') {
    throw new AirpPresetError('airp-marker-message', 'markerValues 与 extraMessages 必须包含字符串 content。');
  }
  const role = VALID_MESSAGE_ROLES.has(message.role) ? message.role : fallbackRole;
  if (message.content.length > MAX_MESSAGE_CONTENT_CHARS) {
    throw new AirpPresetError('airp-message-too-large', '组装后的单条消息过大。');
  }
  return { role, content: message.content };
}

function markerMessages(value, fallbackRole) {
  if (typeof value === 'string') return [{ role: fallbackRole, content: value }];
  if (Array.isArray(value)) return value.map((message) => normalizePromptMessage(message, fallbackRole));
  if (isPlainRecord(value)) return [normalizePromptMessage(value, fallbackRole)];
  throw new AirpPresetError('airp-marker-value', 'markerValues 只接受字符串、消息对象或消息数组。');
}

function extractAirpParameters(preset, diagnostics) {
  const parameters = {};
  const addNumber = (sourceKey, targetKey, min, max, { integer = false } = {}) => {
    const value = preset[sourceKey];
    if (value === undefined || value === null || value === '') return;
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < min
      || value > max
      || (integer && !Number.isInteger(value))
    ) {
      diagnostics.ignoredParameters.push(sourceKey);
      return;
    }
    parameters[targetKey] = value;
  };

  for (const spec of AIRP_SAMPLING_PARAMETER_SPECS) {
    if (!spec.directKey) continue;
    addNumber(spec.sourceKey, spec.directKey, spec.min, spec.max, { integer: spec.integer === true });
  }
  return parameters;
}

function inspectAirpPreset(presetInput, { orderCharacterId = undefined } = {}) {
  const preset = safeJsonClone(presetInput);
  const validation = validateAirpClone(preset);
  if (!validation.valid) {
    throw new AirpPresetError('airp-invalid', 'AIRP 预设校验失败。', { issues: validation.errors });
  }

  const document = detectAirpDocument(preset);
  const selection = selectAirpOrder(document, orderCharacterId);
  const { map: promptMap } = firstPromptMap(document.prompts);
  const selectedEntries = selection.entries;
  const selectedPrompts = new Set();

  const inspectEntry = (orderEntry, index, prompt, directGenerationStatus = null) => {
    const enabled = orderEntry?.enabled !== false;
    const missing = !prompt;
    const identifier = typeof orderEntry?.identifier === 'string'
      ? orderEntry.identifier
      : typeof prompt?.identifier === 'string' ? prompt.identifier : '';
    const content = typeof prompt?.content === 'string' ? prompt.content : '';
    const marker = !missing && (
      prompt.marker === true
      || (AIRP_MARKER_IDENTIFIERS.has(prompt.identifier) && prompt.content === undefined)
    );
    const role = typeof prompt?.role === 'string' ? prompt.role : null;
    const injectionTrigger = Array.isArray(prompt?.injection_trigger)
      ? safeJsonClone(prompt.injection_trigger)
      : [];
    let status = directGenerationStatus;
    let reason = directGenerationStatus === 'unreferenced' ? 'not-in-selected-order' : null;

    if (!status && !enabled) {
      status = 'disabled';
      reason = 'order-disabled';
    } else if (!status && missing) {
      status = 'missing';
      reason = 'missing-prompt';
    } else if (!status && injectionTrigger.length > 0 && !injectionTrigger.includes('normal')) {
      status = 'skipped';
      reason = 'generation-trigger';
    } else if (!status && prompt.injection_position === 1) {
      status = 'skipped';
      reason = 'in-chat';
    } else if (!status && marker && content.length === 0) {
      status = 'marker';
      reason = 'marker-value-required';
    } else if (!status && content.length === 0) {
      status = 'empty';
      reason = 'empty-content';
    } else if (!status) {
      status = 'included';
      reason = 'included';
    }

    return {
      index,
      identifier,
      enabled,
      missing,
      name: typeof prompt?.name === 'string' ? prompt.name : '',
      role,
      effectiveRole: VALID_MESSAGE_ROLES.has(role) ? role : 'system',
      roleFallsBackToSystem: !VALID_MESSAGE_ROLES.has(role),
      marker,
      systemPrompt: prompt?.system_prompt === true,
      extension: prompt?.extension === true,
      injectionPosition: prompt?.injection_position ?? 0,
      injectionDepth: prompt?.injection_depth ?? null,
      injectionOrder: prompt?.injection_order ?? null,
      injectionTrigger,
      forbidOverrides: prompt?.forbid_overrides === true,
      content,
      contentChars: content.length,
      directGenerationStatus: status,
      directGenerationReason: reason,
    };
  };

  const entries = selectedEntries.map((orderEntry, index) => {
    const prompt = promptMap.get(orderEntry.identifier);
    if (prompt) selectedPrompts.add(prompt);
    return inspectEntry(orderEntry, index, prompt);
  });

  const unreferencedPrompts = document.prompts
    .map((prompt, index) => ({ prompt, index }))
    .filter(({ prompt }) => !selectedPrompts.has(prompt))
    .map(({ prompt, index }) => inspectEntry(
      { identifier: prompt.identifier, enabled: prompt.enabled !== false },
      index,
      prompt,
      'unreferenced',
    ));

  const orderGroups = document.orderShape === 'groups'
    ? document.promptOrder
      .filter((group) => isPlainRecord(group) && Array.isArray(group.order))
      .map((group) => ({
        characterId: group.character_id ?? null,
        entryCount: group.order.length,
        enabledCount: group.order.filter((entry) => entry?.enabled !== false).length,
      }))
    : [{
      characterId: null,
      entryCount: document.promptOrder.length,
      enabledCount: document.promptOrder.filter((entry) => entry?.enabled !== false).length,
    }];

  const directDiagnostics = { ignoredParameters: [] };
  const directParameters = extractAirpParameters(
    document.kind === 'sillytavern-openai-settings' ? preset : {},
    directDiagnostics,
  );
  const samplingParameters = AIRP_SAMPLING_PARAMETER_SPECS
    .filter((spec) => hasOwn(document.root, spec.sourceKey))
    .map((spec) => ({
      sourceKey: spec.sourceKey,
      directKey: spec.directKey,
      value: safeJsonClone(document.root[spec.sourceKey]),
      usedByDirectGeneration: Boolean(spec.directKey && hasOwn(directParameters, spec.directKey)),
    }));

  return {
    kind: document.kind,
    orderGroups,
    selectedOrderCharacterId: selection.characterId,
    entries,
    unreferencedPrompts,
    samplingParameters,
  };
}

function assembleAirpPrompt(presetInput, {
  orderCharacterId = undefined,
  generationType = 'normal',
  markerValues = {},
  substitutions = {},
  extraMessages = [],
  task = '',
} = {}) {
  const hasPreset = presetInput !== undefined && presetInput !== null;
  const preset = hasPreset ? safeJsonClone(presetInput) : null;
  if (hasPreset) {
    const validation = validateAirpClone(preset);
    if (!validation.valid) {
      throw new AirpPresetError('airp-invalid', 'AIRP 预设校验失败。', { issues: validation.errors });
    }
  }

  const document = hasPreset
    ? detectAirpDocument(preset)
    : {
      kind: 'plain',
      root: {},
      prompts: [],
      promptOrder: [],
      orderShape: 'flat',
    };
  const selection = selectAirpOrder(document, orderCharacterId);
  const { map: promptMap, duplicates } = firstPromptMap(document.prompts);
  const diagnostics = {
    duplicateIdentifiers: duplicates,
    missingIdentifiers: [],
    unresolvedMarkers: [],
    skippedByTrigger: [],
    flattenedAbsoluteInjections: [],
    unsupportedInChatPrompts: [],
    literalTemplateFragments: [],
    substitutedKeys: [],
    ignoredParameters: [],
  };
  const usedKeys = new Set();
  const messages = [];
  let totalChars = 0;

  const append = (message) => {
    const normalized = normalizePromptMessage(message);
    totalChars += normalized.content.length;
    if (totalChars > MAX_AIRP_CONTENT_CHARS) {
      throw new AirpPresetError('airp-assembled-too-large', '组装后的 AIRP 提示词总量过大。');
    }
    if (normalized.content.length > 0) messages.push(normalized);
  };

  const orderEntries = selection.entries;
  const normalizedGenerationType = String(generationType || 'normal').toLowerCase().trim();

  for (const orderEntry of orderEntries) {
    if (orderEntry.enabled === false) continue;
    const prompt = promptMap.get(orderEntry.identifier);
    if (!prompt) {
      diagnostics.missingIdentifiers.push(orderEntry.identifier);
      continue;
    }
    if (
      Array.isArray(prompt.injection_trigger)
      && prompt.injection_trigger.length > 0
      && !prompt.injection_trigger.includes(normalizedGenerationType)
    ) {
      diagnostics.skippedByTrigger.push(prompt.identifier);
      continue;
    }

    // SillyTavern places In-Chat prompts relative to existing history. RPN's
    // direct generation request has no chat-history coordinate system, so
    // linearizing them would silently change the AIRP's meaning.
    if (prompt.injection_position === 1) {
      diagnostics.unsupportedInChatPrompts.push(prompt.identifier);
      continue;
    }

    const fallbackRole = VALID_MESSAGE_ROLES.has(prompt.role) ? prompt.role : 'system';
    const isMarker = prompt.marker === true || (AIRP_MARKER_IDENTIFIERS.has(prompt.identifier) && prompt.content === undefined);
    if (isMarker && hasOwn(markerValues, prompt.identifier)) {
      for (const message of markerMessages(markerValues[prompt.identifier], fallbackRole)) {
        append({
          role: message.role,
          content: safeSubstituteAirpText(message.content, substitutions, usedKeys),
        });
      }
      continue;
    }

    if (typeof prompt.content !== 'string' || prompt.content.length === 0) {
      if (isMarker) diagnostics.unresolvedMarkers.push(prompt.identifier);
      continue;
    }
    if (/<%[=-]?[\s\S]*?%>|\{\{[\s\S]*?\}\}/.test(prompt.content)) {
      diagnostics.literalTemplateFragments.push(prompt.identifier);
    }
    append({
      role: fallbackRole,
      content: safeSubstituteAirpText(prompt.content, substitutions, usedKeys),
    });
  }

  if (!Array.isArray(extraMessages)) {
    throw new AirpPresetError('airp-extra-messages', 'extraMessages 必须是数组。');
  }
  for (const message of extraMessages) append(message);
  if (task !== undefined && task !== null && String(task).length > 0) {
    append({ role: 'user', content: String(task) });
  }

  diagnostics.duplicateIdentifiers = [...new Set(diagnostics.duplicateIdentifiers)];
  diagnostics.missingIdentifiers = [...new Set(diagnostics.missingIdentifiers)];
  diagnostics.unresolvedMarkers = [...new Set(diagnostics.unresolvedMarkers)];
  diagnostics.skippedByTrigger = [...new Set(diagnostics.skippedByTrigger)];
  diagnostics.flattenedAbsoluteInjections = [...new Set(diagnostics.flattenedAbsoluteInjections)];
  diagnostics.unsupportedInChatPrompts = [...new Set(diagnostics.unsupportedInChatPrompts)];
  diagnostics.literalTemplateFragments = [...new Set(diagnostics.literalTemplateFragments)];
  diagnostics.substitutedKeys = [...usedKeys];

  return {
    kind: document.kind,
    orderCharacterId: selection.characterId,
    messages,
    parameters: extractAirpParameters(document.kind === 'sillytavern-openai-settings' ? preset : {}, diagnostics),
    diagnostics,
  };
}

function parseAgentTurnResponse(value, { allowProposal = false } = {}) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { reply: '', proposal: null, format: 'text' };
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : raw;
  let document;
  try {
    document = JSON.parse(candidate);
  } catch {
    if (!allowProposal) {
      const wrappedReply = candidate.match(/^\s*\{\s*"reply"\s*:\s*"([\s\S]*)"\s*,\s*"proposal"\s*:\s*null\s*\}\s*$/);
      if (wrappedReply) {
        const escapedControls = wrappedReply[1].replace(
          /[\u0000-\u001f]/g,
          (character) => JSON.stringify(character).slice(1, -1),
        );
        try {
          const reply = JSON.parse(`"${escapedControls}"`).trim();
          if (reply) {
            return { reply: reply.slice(0, MAX_MESSAGE_CONTENT_CHARS), proposal: null, format: 'text' };
          }
        } catch {
          // Keep malformed or ambiguous wrappers as inert text.
        }
      }
    }
    return { reply: raw.slice(0, MAX_MESSAGE_CONTENT_CHARS), proposal: null, format: 'text' };
  }
  if (!isPlainRecord(document)) {
    return { reply: raw.slice(0, MAX_MESSAGE_CONTENT_CHARS), proposal: null, format: 'text' };
  }
  const sourceProposal = isPlainRecord(document.proposal) ? document.proposal : null;
  const proposal = allowProposal
    && sourceProposal?.type === 'replace-worldbook-entry-content'
    && typeof sourceProposal.content === 'string'
    && sourceProposal.content.trim()
    ? {
        type: 'replace-worldbook-entry-content',
        summary: typeof sourceProposal.summary === 'string'
          ? sourceProposal.summary.trim().slice(0, 500)
          : '替换当前世界书条目正文',
        content: sourceProposal.content.slice(0, MAX_MESSAGE_CONTENT_CHARS),
      }
    : null;
  const reply = typeof document.reply === 'string' && document.reply.trim()
    ? document.reply.trim().slice(0, MAX_MESSAGE_CONTENT_CHARS)
    : proposal
      ? `已形成变更提案：${proposal.summary}`
      : raw.slice(0, MAX_MESSAGE_CONTENT_CHARS);
  return { reply, proposal, format: 'json' };
}

function summarizeAirpPreset(presetInput, { orderCharacterId = undefined } = {}) {
  const preset = safeJsonClone(presetInput);
  const validation = validateAirpClone(preset);
  if (!validation.valid) {
    throw new AirpPresetError('airp-invalid', 'AIRP 预设校验失败。', { issues: validation.errors });
  }
  const document = detectAirpDocument(preset);
  const selection = selectAirpOrder(document, orderCharacterId);
  const { map } = firstPromptMap(document.prompts);
  const entries = selection.entries;
  const enabledPrompts = entries
    .filter((entry) => entry.enabled !== false)
    .map((entry) => map.get(entry.identifier))
    .filter(Boolean);
  const roles = { system: 0, user: 0, assistant: 0, unspecified: 0 };
  let markerCount = 0;
  let contentChars = 0;
  let absoluteInjectionCount = 0;
  for (const prompt of enabledPrompts) {
    if (VALID_MESSAGE_ROLES.has(prompt.role)) roles[prompt.role] += 1;
    else roles.unspecified += 1;
    if (prompt.marker === true || AIRP_MARKER_IDENTIFIERS.has(prompt.identifier)) markerCount += 1;
    if (typeof prompt.content === 'string') contentChars += prompt.content.length;
    if (prompt.injection_position === 1) absoluteInjectionCount += 1;
  }

  const sensitiveFields = sensitiveAirpPaths(preset);

  return {
    kind: document.kind,
    promptCount: document.prompts.length,
    orderGroupCount: document.orderShape === 'groups' ? document.promptOrder.length : 1,
    selectedOrderCharacterId: selection.characterId,
    enabledPromptCount: enabledPrompts.length,
    markerCount,
    contentChars,
    roles,
    absoluteInjectionCount,
    sensitiveFields,
    warningCount: validation.warnings.length,
  };
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized === '0:0:0:0:0:0:0:1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function defaultPageUrl() {
  try {
    return globalThis.location?.href || null;
  } catch {
    return null;
  }
}

function normalizeApiFormat(value) {
  return VALID_API_FORMATS.has(value) ? value : DEFAULT_API_FORMAT;
}

function normalizeNetworkMode(value, { legacy = false } = {}) {
  if (VALID_NETWORK_MODES.has(value)) return value;
  return legacy ? LEGACY_NETWORK_MODE : DEFAULT_NETWORK_MODE;
}

function normalizeApiProfileTransport(profile) {
  return {
    apiFormat: normalizeApiFormat(profile?.apiFormat),
    networkMode: normalizeNetworkMode(profile?.networkMode, { legacy: true }),
  };
}

function apiFormatSwitchBaseUrl(currentValue, previousFormat, nextFormat) {
  const current = String(currentValue || '').trim();
  const previous = STUDIO_AI_API_FORMATS[normalizeApiFormat(previousFormat)];
  const next = STUDIO_AI_API_FORMATS[normalizeApiFormat(nextFormat)];
  return !current || current === previous.defaultBaseUrl ? next.defaultBaseUrl : current;
}

function normalizeOpenAiBaseUrl(value, {
  pageUrl = defaultPageUrl(),
  allowLoopbackHttp = false,
} = {}) {
  if (typeof value !== 'string') {
    throw new StudioAiError('invalid-base-url', 'Base URL 必须是字符串。');
  }
  const raw = value.trim();
  if (!raw || raw.length > MAX_BASE_URL_LENGTH || /[\u0000-\u001F\u007F]/.test(raw)) {
    throw new StudioAiError('invalid-base-url', 'Base URL 为空、过长或包含控制字符。');
  }

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new StudioAiError('invalid-base-url', 'Base URL 无法解析。', { cause: error });
  }
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new StudioAiError('invalid-base-url-protocol', 'Base URL 只允许 HTTPS；本机开发可使用受限 HTTP。');
  }
  if (url.username || url.password) {
    throw new StudioAiError('base-url-credentials', 'Base URL 不得包含用户名或密码。');
  }
  if (url.search || url.hash) {
    throw new StudioAiError('base-url-components', 'Base URL 不得包含 query 或 hash。');
  }
  if (!url.hostname) {
    throw new StudioAiError('invalid-base-url', 'Base URL 缺少主机名。');
  }

  if (url.protocol === 'http:') {
    let page;
    try {
      page = pageUrl ? new URL(pageUrl) : null;
    } catch {
      page = null;
    }
    const localDevelopment = isLoopbackHostname(url.hostname)
      && (allowLoopbackHttp || (page?.protocol === 'http:' && isLoopbackHostname(page.hostname)));
    if (!localDevelopment) {
      throw new StudioAiError(
        'insecure-base-url',
        'HTTP 只允许桌面原生通道或本机 HTTP 预览连接回环地址。',
      );
    }
  }

  const pathname = url.pathname.replace(/\/+$/, '');
  if (
    /(?:^|\/)(?:models|messages|chat\/completions|api\/tags|api\/chat)$/i.test(pathname)
    || /\/models\/[^/]+:generateContent$/i.test(pathname)
  ) {
    throw new StudioAiError('base-url-is-endpoint', '请填写 API Base URL，不要填写具体的模型列表或推理端点。');
  }
  return `${url.origin}${pathname}`;
}

function endpointUrl(baseUrl, endpoint) {
  const url = new URL(`${baseUrl}/`);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${endpoint}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function normalizeTimeout(value) {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
    throw new StudioAiError('invalid-timeout', `timeoutMs 必须在 1 到 ${MAX_TIMEOUT_MS} 之间。`);
  }
  return timeout;
}

function normalizeMaxBytes(value) {
  const maxBytes = value ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) {
    throw new StudioAiError('invalid-response-limit', 'maxResponseBytes 超出允许范围。');
  }
  return maxBytes;
}

function createAbortScope(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort(callerSignal.reason);
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    const error = new Error('Request timed out');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    callerAborted: () => Boolean(callerSignal?.aborted),
    cleanup() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

let desktopAiRequestSequence = 0;

function defaultDesktopAiRequestId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  desktopAiRequestSequence += 1;
  return `rpn-ai-${Date.now().toString(36)}-${desktopAiRequestSequence.toString(36)}`;
}

function normalizeDesktopAiError(error) {
  if (error instanceof StudioAiError) return error;
  let source = error;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  if (isPlainRecord(source)) {
    const normalizedCode = typeof source.code === 'string' ? source.code.replaceAll('_', '-') : '';
    const code = /^[a-z][a-z0-9-]{0,63}$/.test(normalizedCode)
      ? normalizedCode
      : 'desktop-transport';
    const message = typeof source.message === 'string'
      && source.message.length > 0
      && source.message.length <= 500
      && !/[\r\n]/.test(source.message)
      ? source.message
      : '桌面原生网络请求失败。';
    return new StudioAiError(code, message, {
      status: Number.isInteger(source.status) ? source.status : null,
      retryable: source.retryable === true,
      cause: error,
    });
  }
  return new StudioAiError('desktop-transport', '桌面原生网络请求失败。', {
    retryable: true,
    cause: error,
  });
}

function normalizeGeminiModel(value) {
  const model = String(value || '').trim().replace(/^models\//, '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model)) {
    throw new StudioAiError('invalid-model', 'Gemini model 必须是不含路径分隔符的有效模型 ID。');
  }
  return model;
}

function desktopAiTarget(input, method, apiFormat) {
  const raw = String(input);
  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new StudioAiError('desktop-transport-invalid', '桌面 AI 请求 URL 无效。', { cause: error });
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
    || /[?#]/.test(raw)) {
    throw new StudioAiError('desktop-transport-invalid', '桌面 AI 请求 URL 包含不允许的组成部分。');
  }

  const format = normalizeApiFormat(apiFormat);
  let operation;
  let suffix;
  let model;
  if (
    method === 'GET'
    && url.pathname.endsWith('/models')
    && ['openai-compatible', 'openai-responses'].includes(format)
  ) {
    operation = 'models';
    suffix = '/models';
  } else if (method === 'POST' && url.pathname.endsWith('/chat/completions') && format === 'openai-compatible') {
    operation = 'chatCompletions';
    suffix = '/chat/completions';
  } else if (method === 'POST' && url.pathname.endsWith('/responses') && format === 'openai-responses') {
    operation = 'responses';
    suffix = '/responses';
  } else if (method === 'GET' && url.pathname.endsWith('/models') && format === 'anthropic-messages') {
    operation = 'anthropicModels';
    suffix = '/models';
  } else if (method === 'POST' && url.pathname.endsWith('/messages') && format === 'anthropic-messages') {
    operation = 'anthropicMessages';
    suffix = '/messages';
  } else if (method === 'GET' && url.pathname.endsWith('/models') && format === 'google-gemini') {
    operation = 'geminiModels';
    suffix = '/models';
  } else if (method === 'POST' && format === 'google-gemini') {
    const matched = url.pathname.match(/\/models\/([^/]+):generateContent$/);
    if (matched) {
      try {
        model = normalizeGeminiModel(decodeURIComponent(matched[1]));
      } catch (error) {
        if (error instanceof StudioAiError) throw error;
        throw new StudioAiError('desktop-transport-invalid', 'Gemini model URL 编码无效。', { cause: error });
      }
      suffix = matched[0];
      operation = 'geminiGenerateContent';
    }
  } else if (method === 'GET' && url.pathname.endsWith('/v1/models') && format === 'cohere-v2') {
    operation = 'cohereModels';
    suffix = '/v1/models';
  } else if (method === 'POST' && url.pathname.endsWith('/v2/chat') && format === 'cohere-v2') {
    operation = 'cohereChat';
    suffix = '/v2/chat';
  } else if (
    method === 'POST'
    && url.pathname.endsWith('/services/aigc/text-generation/generation')
    && format === 'dashscope-native'
  ) {
    operation = 'dashscopeGeneration';
    suffix = '/services/aigc/text-generation/generation';
  } else if (method === 'GET' && url.pathname.endsWith('/api/tags') && format === 'ollama-native') {
    operation = 'ollamaTags';
    suffix = '/api/tags';
  } else if (method === 'POST' && url.pathname.endsWith('/api/chat') && format === 'ollama-native') {
    operation = 'ollamaChat';
    suffix = '/api/chat';
  }
  if (!operation || !suffix) {
    throw new StudioAiError('desktop-transport-invalid', '桌面 AI 通道拒绝了与所选 API 格式不匹配的端点或方法。');
  }
  const basePath = url.pathname.slice(0, -suffix.length).replace(/\/+$/, '');
  return {
    baseUrl: `${url.origin}${basePath}`,
    operation,
    ...(operation === 'geminiGenerateContent' ? { model } : {}),
  };
}

function createDesktopAiFetch({
  invoke = globalThis.__TAURI__?.core?.invoke,
  makeRequestId = defaultDesktopAiRequestId,
} = {}) {
  if (typeof invoke !== 'function') {
    throw new StudioAiError('desktop-transport-unavailable', '当前页面不在 RPN 桌面程序中。');
  }
  if (typeof makeRequestId !== 'function') {
    throw new StudioAiError('desktop-transport-invalid', '桌面请求 ID 生成器无效。');
  }

  return async (input, init = {}) => {
    const requestId = String(makeRequestId());
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
      throw new StudioAiError('desktop-transport-invalid', '桌面请求 ID 无效。');
    }
    if (init.signal?.aborted) {
      throw new StudioAiError('cancelled', '请求已取消。');
    }
    const method = String(init.method || 'GET').toUpperCase();
    if (!['GET', 'POST'].includes(method)) {
      throw new StudioAiError('desktop-transport-invalid', '桌面 AI 通道只允许 GET 或 POST。');
    }
    if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
      throw new StudioAiError('desktop-transport-invalid', '桌面 AI 请求正文必须是字符串。');
    }
    if (method === 'GET' && init.body !== undefined && init.body !== null) {
      throw new StudioAiError('desktop-transport-invalid', '桌面 AI GET 请求不得包含正文。');
    }
    const apiFormat = normalizeApiFormat(init.apiFormat);
    const networkMode = normalizeNetworkMode(init.networkMode);
    const target = desktopAiTarget(input, method, apiFormat);
    const headers = {};
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const request = {
      requestId,
      baseUrl: target.baseUrl,
      operation: target.operation,
      networkMode,
      ...(target.operation === 'geminiGenerateContent' ? { model: target.model } : {}),
      headers,
      body: typeof init.body === 'string' ? init.body : null,
      timeoutMs: normalizeTimeout(init.timeoutMs),
      maxResponseBytes: normalizeMaxBytes(init.maxResponseBytes),
    };

    let rejectAbort;
    const abortPromise = init.signal
      ? new Promise((_, reject) => {
        rejectAbort = reject;
      })
      : null;
    const onAbort = () => {
      void invoke('desktop_ai_cancel', { requestId }).catch(() => {});
      rejectAbort?.(new StudioAiError('cancelled', '请求已取消。'));
    };
    init.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const invocation = invoke('desktop_ai_request', { request });
      const result = await (abortPromise ? Promise.race([invocation, abortPromise]) : invocation);
      if (!isPlainRecord(result)
        || !Number.isInteger(result.status)
        || result.status < 200
        || result.status > 599
        || typeof result.body !== 'string'
        || !isPlainRecord(result.headers)) {
        throw new StudioAiError('desktop-transport-response', '桌面原生通道返回了无效响应。');
      }
      const responseBody = [204, 205, 304].includes(result.status) ? null : result.body;
      return new Response(responseBody, {
        status: result.status,
        headers: result.headers,
      });
    } catch (error) {
      if (init.signal?.aborted) {
        throw new StudioAiError('cancelled', '请求已取消。', { cause: error });
      }
      throw normalizeDesktopAiError(error);
    } finally {
      init.signal?.removeEventListener('abort', onAbort);
    }
  };
}

async function readLimitedText(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new StudioAiError('response-too-large', '服务端响应超过大小限制。', { status: response.status });
  }

  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new StudioAiError('response-too-large', '服务端响应超过大小限制。', { status: response.status });
    }
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new StudioAiError('response-too-large', '服务端响应超过大小限制。', { status: response.status });
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

function classifyHttpError(status) {
  if (status === 400 || status === 422) return ['bad-request', '请求被服务端拒绝。', false];
  if (status === 401) return ['authentication', 'API Key 无效或缺失。', false];
  if (status === 403) return ['permission', '当前凭证没有访问权限。', false];
  if (status === 404) return ['not-found', 'API 端点或模型不存在。', false];
  if (status === 408) return ['remote-timeout', '服务端处理请求超时。', true];
  if (status === 409) return ['conflict', '服务端报告请求冲突。', true];
  if (status === 413) return ['request-too-large', '请求正文超过服务端限制。', false];
  if (status === 429) return ['rate-limit', '请求频率或配额受限。', true];
  if (status >= 500) return ['server-error', '服务端暂时不可用。', true];
  return ['http-error', `服务端返回 HTTP ${status}。`, false];
}

function providerErrorMetadata(text, secret = '') {
  try {
    const parsed = JSON.parse(text);
    const providerError = isPlainRecord(parsed?.error) ? parsed.error : parsed;
    const metadata = {};
    const safeValue = (value) => {
      const output = String(value).slice(0, 120);
      return secret && output.includes(secret) ? '[redacted]' : output;
    };
    if (typeof providerError?.type === 'string') metadata.type = safeValue(providerError.type);
    if (typeof providerError?.code === 'string' || typeof providerError?.code === 'number') {
      metadata.code = safeValue(providerError.code);
    }
    return Object.keys(metadata).length > 0 ? metadata : undefined;
  } catch {
    return undefined;
  }
}

function normalizeApiKey(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new StudioAiError('invalid-api-key', 'API Key 必须是字符串。');
  const key = value.trim();
  if (key.length > 4096 || /[\r\n]/.test(key)) {
    throw new StudioAiError('invalid-api-key', 'API Key 过长或包含换行。');
  }
  return key;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGE_COUNT) {
    throw new StudioAiError('invalid-messages', `messages 必须包含 1 到 ${MAX_MESSAGE_COUNT} 条消息。`);
  }
  return messages.map((message, index) => {
    if (!isPlainRecord(message) || !VALID_MESSAGE_ROLES.has(message.role) || typeof message.content !== 'string') {
      throw new StudioAiError('invalid-message', `messages[${index}] 必须包含有效 role 与字符串 content。`);
    }
    if (message.content.length > MAX_MESSAGE_CONTENT_CHARS) {
      throw new StudioAiError('message-too-large', `messages[${index}] 正文过大。`);
    }
    return { role: message.role, content: message.content };
  });
}

function addNumericBodyField(body, request, key, min, max, { integer = false } = {}) {
  if (request[key] === undefined) return;
  const value = request[key];
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < min
    || value > max
    || (integer && !Number.isInteger(value))
  ) {
    throw new StudioAiError('invalid-request-option', `${key} 超出允许范围。`);
  }
  body[key] = value;
}

function buildChatCompletionBody(request) {
  if (!isPlainRecord(request)) throw new StudioAiError('invalid-request', '聊天请求必须是对象。');
  const model = typeof request.model === 'string' ? request.model.trim() : '';
  if (!model || model.length > MAX_MODEL_ID_LENGTH || /[\r\n]/.test(model)) {
    throw new StudioAiError('invalid-model', 'model 必须是非空模型 ID。');
  }

  const body = {
    model,
    messages: normalizeMessages(request.messages),
    stream: false,
  };
  addNumericBodyField(body, request, 'temperature', 0, 2);
  addNumericBodyField(body, request, 'top_p', 0, 1);
  addNumericBodyField(body, request, 'frequency_penalty', -2, 2);
  addNumericBodyField(body, request, 'presence_penalty', -2, 2);
  addNumericBodyField(body, request, 'max_tokens', 1, 1_000_000, { integer: true });
  addNumericBodyField(body, request, 'seed', -2_147_483_648, 2_147_483_647, { integer: true });
  addNumericBodyField(body, request, 'n', 1, 8, { integer: true });

  if (request.stop !== undefined) {
    const stop = typeof request.stop === 'string' ? [request.stop] : request.stop;
    if (
      !Array.isArray(stop)
      || stop.length === 0
      || stop.length > 4
      || stop.some((item) => typeof item !== 'string' || item.length > 1024)
    ) {
      throw new StudioAiError('invalid-request-option', 'stop 必须是 1 到 4 个短字符串。');
    }
    body.stop = typeof request.stop === 'string' ? request.stop : [...stop];
  }

  if (request.response_format !== undefined) {
    const format = request.response_format;
    if (!isPlainRecord(format) || !['text', 'json_object'].includes(format.type)) {
      throw new StudioAiError('invalid-request-option', 'response_format 只支持 text 或 json_object。');
    }
    body.response_format = { type: format.type };
  }
  return body;
}

function providerModelsEndpoint(apiFormat) {
  if (apiFormat === 'ollama-native') return 'api/tags';
  if (apiFormat === 'cohere-v2') return 'v1/models';
  if (apiFormat === 'dashscope-native') {
    throw new StudioAiError('models-unsupported', 'DashScope 原生文本接口不提供统一模型列表，请手动填写模型名。');
  }
  return 'models';
}

function providerChatEndpoint(apiFormat, model) {
  if (apiFormat === 'openai-responses') return 'responses';
  if (apiFormat === 'anthropic-messages') return 'messages';
  if (apiFormat === 'google-gemini') return `models/${normalizeGeminiModel(model)}:generateContent`;
  if (apiFormat === 'cohere-v2') return 'v2/chat';
  if (apiFormat === 'dashscope-native') return 'services/aigc/text-generation/generation';
  if (apiFormat === 'ollama-native') return 'api/chat';
  return 'chat/completions';
}

function isOfficialOpenAiBaseUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'api.openai.com' || hostname.endsWith('.api.openai.com');
  } catch {
    return false;
  }
}

function providerHeaders(apiFormat, apiKey, hasBody) {
  const headers = { Accept: 'application/json' };
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (apiFormat === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
  } else if (apiFormat === 'google-gemini') {
    if (apiKey) headers['x-goog-api-key'] = apiKey;
  } else if (apiFormat !== 'ollama-native' && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

function providerChatBody(apiFormat, canonical) {
  if (apiFormat === 'openai-compatible') return canonical;
  if (apiFormat === 'openai-responses') {
    const body = {
      model: canonical.model,
      input: canonical.messages,
    };
    if (canonical.temperature !== undefined) body.temperature = canonical.temperature;
    if (canonical.top_p !== undefined) body.top_p = canonical.top_p;
    if (canonical.max_tokens !== undefined) body.max_output_tokens = canonical.max_tokens;
    if (canonical.response_format?.type === 'json_object') {
      body.text = { format: { type: 'json_object' } };
    }
    return body;
  }
  const systemText = canonical.messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversation = canonical.messages.filter((message) => message.role !== 'system');

  if (apiFormat === 'anthropic-messages') {
    const body = {
      model: canonical.model,
      messages: conversation,
      max_tokens: canonical.max_tokens ?? 4096,
    };
    if (systemText) body.system = systemText;
    if (canonical.stop !== undefined) {
      body.stop_sequences = typeof canonical.stop === 'string' ? [canonical.stop] : canonical.stop;
    }
    return body;
  }

  if (apiFormat === 'google-gemini') {
    const generationConfig = {};
    if (canonical.temperature !== undefined) generationConfig.temperature = canonical.temperature;
    if (canonical.top_p !== undefined) generationConfig.topP = canonical.top_p;
    if (canonical.max_tokens !== undefined) generationConfig.maxOutputTokens = canonical.max_tokens;
    if (canonical.stop !== undefined) {
      generationConfig.stopSequences = typeof canonical.stop === 'string' ? [canonical.stop] : canonical.stop;
    }
    if (canonical.n !== undefined) generationConfig.candidateCount = canonical.n;
    if (canonical.response_format?.type === 'json_object') generationConfig.responseMimeType = 'application/json';
    return {
      contents: conversation.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
      ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    };
  }

  if (apiFormat === 'cohere-v2') {
    const body = {
      model: canonical.model,
      messages: canonical.messages,
    };
    if (canonical.temperature !== undefined) body.temperature = canonical.temperature;
    if (canonical.top_p !== undefined) body.p = canonical.top_p;
    if (canonical.max_tokens !== undefined) body.max_tokens = canonical.max_tokens;
    if (canonical.seed !== undefined) body.seed = canonical.seed;
    if (canonical.stop !== undefined) {
      body.stop_sequences = typeof canonical.stop === 'string' ? [canonical.stop] : canonical.stop;
    }
    if (canonical.response_format?.type === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    return body;
  }

  if (apiFormat === 'dashscope-native') {
    const parameters = { result_format: 'message' };
    if (canonical.temperature !== undefined) parameters.temperature = canonical.temperature;
    if (canonical.top_p !== undefined) parameters.top_p = canonical.top_p;
    if (canonical.max_tokens !== undefined) parameters.max_tokens = canonical.max_tokens;
    if (canonical.seed !== undefined) parameters.seed = canonical.seed;
    if (canonical.stop !== undefined) parameters.stop = canonical.stop;
    return {
      model: canonical.model,
      input: { messages: canonical.messages },
      parameters,
    };
  }

  const options = {};
  if (canonical.temperature !== undefined) options.temperature = canonical.temperature;
  if (canonical.top_p !== undefined) options.top_p = canonical.top_p;
  if (canonical.seed !== undefined) options.seed = canonical.seed;
  if (canonical.max_tokens !== undefined) options.num_predict = canonical.max_tokens;
  if (canonical.stop !== undefined) {
    options.stop = typeof canonical.stop === 'string' ? [canonical.stop] : canonical.stop;
  }
  return {
    model: canonical.model,
    messages: canonical.messages,
    stream: false,
    ...(Object.keys(options).length ? { options } : {}),
    ...(canonical.response_format?.type === 'json_object' ? { format: 'json' } : {}),
  };
}

function normalizeUsage(promptTokens, completionTokens, totalTokens = undefined) {
  const prompt = Number.isFinite(promptTokens) ? promptTokens : 0;
  const completion = Number.isFinite(completionTokens) ? completionTokens : 0;
  const total = Number.isFinite(totalTokens) ? totalTokens : prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

function normalizeProviderChatResponse(apiFormat, data, requestedModel) {
  if (!isPlainRecord(data)) {
    throw new StudioAiError('invalid-response', '推理响应必须是 JSON 对象。');
  }
  if (apiFormat === 'openai-compatible') return data;
  if (apiFormat === 'openai-responses') {
    const text = typeof data.output_text === 'string'
      ? data.output_text
      : (Array.isArray(data.output) ? data.output : [])
        .flatMap((item) => (isPlainRecord(item) && Array.isArray(item.content) ? item.content : []))
        .filter((part) => isPlainRecord(part) && part.type === 'output_text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('');
    return {
      model: typeof data.model === 'string' ? data.model : requestedModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: data.incomplete_details?.reason ?? (data.status === 'completed' ? 'stop' : data.status ?? null),
      }],
      usage: normalizeUsage(data.usage?.input_tokens, data.usage?.output_tokens, data.usage?.total_tokens),
    };
  }
  if (apiFormat === 'anthropic-messages') {
    const text = Array.isArray(data.content)
      ? data.content
        .filter((part) => isPlainRecord(part) && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      : '';
    return {
      model: typeof data.model === 'string' ? data.model : requestedModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: data.stop_reason ?? null,
      }],
      usage: normalizeUsage(data.usage?.input_tokens, data.usage?.output_tokens),
    };
  }
  if (apiFormat === 'google-gemini') {
    const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
    const text = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
        .filter((part) => isPlainRecord(part) && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      : '';
    return {
      model: typeof data.modelVersion === 'string' ? data.modelVersion : requestedModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: candidate?.finishReason ?? null,
      }],
      usage: normalizeUsage(
        data.usageMetadata?.promptTokenCount,
        data.usageMetadata?.candidatesTokenCount,
        data.usageMetadata?.totalTokenCount,
      ),
    };
  }
  if (apiFormat === 'cohere-v2') {
    const text = Array.isArray(data.message?.content)
      ? data.message.content
        .filter((part) => isPlainRecord(part) && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
      : '';
    return {
      model: typeof data.model === 'string' ? data.model : requestedModel,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: data.finish_reason ?? null,
      }],
      usage: normalizeUsage(
        data.usage?.tokens?.input_tokens,
        data.usage?.tokens?.output_tokens,
      ),
    };
  }
  if (apiFormat === 'dashscope-native') {
    const choice = Array.isArray(data.output?.choices) ? data.output.choices[0] : null;
    return {
      model: typeof data.output?.model === 'string' ? data.output.model : requestedModel,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: typeof choice?.message?.content === 'string' ? choice.message.content : '',
        },
        finish_reason: choice?.finish_reason ?? null,
      }],
      usage: normalizeUsage(
        data.usage?.input_tokens,
        data.usage?.output_tokens,
        data.usage?.total_tokens,
      ),
    };
  }
  const promptTokens = data.prompt_eval_count;
  const completionTokens = data.eval_count;
  return {
    model: typeof data.model === 'string' ? data.model : requestedModel,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: typeof data.message?.content === 'string' ? data.message.content : '',
      },
      finish_reason: data.done_reason ?? (data.done === true ? 'stop' : null),
    }],
    usage: normalizeUsage(promptTokens, completionTokens),
  };
}

function normalizeProviderModels(apiFormat, data) {
  let candidates;
  if (apiFormat === 'ollama-native') candidates = data?.models;
  else candidates = data?.data || data?.models;
  if (!isPlainRecord(data) || !Array.isArray(candidates)) {
    throw new StudioAiError('invalid-response', '模型列表响应缺少模型数组。');
  }
  const models = [];
  const ids = new Set();
  for (const candidate of candidates) {
    if (!isPlainRecord(candidate)) continue;
    let id = candidate.id;
    if (['google-gemini', 'cohere-v2'].includes(apiFormat)) id = candidate.name;
    if (apiFormat === 'ollama-native') id = candidate.name || candidate.model;
    if (apiFormat === 'google-gemini' && typeof id === 'string') id = id.replace(/^models\//, '');
    if (typeof id !== 'string') continue;
    id = id.trim();
    if (!id || id.length > MAX_MODEL_ID_LENGTH || /[\r\n]/.test(id) || ids.has(id)) continue;
    ids.add(id);
    models.push({ ...safeJsonClone(candidate), id });
  }
  return { models, ids: [...ids], data };
}

function assistantTextFromResponse(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => isPlainRecord(part) && ['text', 'output_text'].includes(part.type) && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    if (text) return text;
  }
  throw new StudioAiError('invalid-response', '响应缺少 choices[0].message.content。');
}

class OpenAICompatibleClient {
  #apiKey = '';
  #apiFormat = DEFAULT_API_FORMAT;
  #allowLoopbackHttp = false;
  #baseUrl = '';
  #fetchImpl;
  #networkMode = DEFAULT_NETWORK_MODE;
  #pageUrl;
  #timeoutMs;
  #maxResponseBytes;

  constructor({
    baseUrl,
    apiKey = '',
    apiFormat = DEFAULT_API_FORMAT,
    networkMode = DEFAULT_NETWORK_MODE,
    allowLoopbackHttp = false,
    fetchImpl = globalThis.fetch,
    pageUrl = defaultPageUrl(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  } = {}) {
    if (typeof fetchImpl !== 'function') {
      throw new StudioAiError('fetch-unavailable', '当前环境不支持 fetch。');
    }
    if (typeof allowLoopbackHttp !== 'boolean') {
      throw new StudioAiError('invalid-transport-option', 'allowLoopbackHttp 必须是布尔值。');
    }
    this.#pageUrl = pageUrl;
    this.#allowLoopbackHttp = allowLoopbackHttp;
    this.#apiFormat = normalizeApiFormat(apiFormat);
    this.#networkMode = normalizeNetworkMode(networkMode);
    this.#baseUrl = normalizeOpenAiBaseUrl(baseUrl, { pageUrl, allowLoopbackHttp });
    this.#apiKey = normalizeApiKey(apiKey);
    this.#fetchImpl = fetchImpl.bind(globalThis);
    this.#timeoutMs = normalizeTimeout(timeoutMs);
    this.#maxResponseBytes = normalizeMaxBytes(maxResponseBytes);
  }

  get baseUrl() {
    return this.#baseUrl;
  }

  get hasApiKey() {
    return this.#apiKey.length > 0;
  }

  get apiFormat() {
    return this.#apiFormat;
  }

  get networkMode() {
    return this.#networkMode;
  }

  setBaseUrl(baseUrl) {
    this.#baseUrl = normalizeOpenAiBaseUrl(baseUrl, {
      pageUrl: this.#pageUrl,
      allowLoopbackHttp: this.#allowLoopbackHttp,
    });
  }

  setApiKey(apiKey) {
    this.#apiKey = normalizeApiKey(apiKey);
  }

  clearApiKey() {
    this.#apiKey = '';
  }

  toJSON() {
    return {
      baseUrl: this.#baseUrl,
      apiFormat: this.#apiFormat,
      networkMode: this.#networkMode,
      hasApiKey: this.hasApiKey,
    };
  }

  async #requestJson(endpoint, {
    method = 'GET',
    body = undefined,
    apiKey = undefined,
    signal = undefined,
    timeoutMs = this.#timeoutMs,
    maxResponseBytes = this.#maxResponseBytes,
  } = {}) {
    const timeout = normalizeTimeout(timeoutMs);
    const maxBytes = normalizeMaxBytes(maxResponseBytes);
    const requestKey = apiKey === undefined ? this.#apiKey : normalizeApiKey(apiKey);
    const abortScope = createAbortScope(signal, timeout);
    const headers = providerHeaders(this.#apiFormat, requestKey, body !== undefined);

    try {
      if (abortScope.callerAborted()) {
        throw new StudioAiError('cancelled', '请求已取消。');
      }
      const response = await this.#fetchImpl(endpointUrl(this.#baseUrl, endpoint), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: abortScope.signal,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        timeoutMs: timeout,
        maxResponseBytes: maxBytes,
        apiFormat: this.#apiFormat,
        networkMode: this.#networkMode,
      });
      if (abortScope.timedOut()) {
        throw new StudioAiError('timeout', '请求超时。', { retryable: true });
      }
      if (abortScope.callerAborted()) {
        throw new StudioAiError('cancelled', '请求已取消。');
      }
      if (!response || typeof response.ok !== 'boolean' || typeof response.status !== 'number') {
        throw new StudioAiError('invalid-fetch-response', 'fetch 返回了无效响应。');
      }
      const text = await readLimitedText(response, maxBytes);
      if (abortScope.timedOut()) {
        throw new StudioAiError('timeout', '请求超时。', { retryable: true });
      }
      if (abortScope.callerAborted()) {
        throw new StudioAiError('cancelled', '请求已取消。');
      }
      if (!response.ok) {
        const [code, message, retryable] = classifyHttpError(response.status);
        throw new StudioAiError(code, message, {
          status: response.status,
          retryable,
          details: providerErrorMetadata(text, requestKey),
        });
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new StudioAiError('invalid-json', '服务端返回的不是有效 JSON。', {
          status: response.status,
          cause: error,
        });
      }
    } catch (error) {
      if (abortScope.timedOut()) {
        throw new StudioAiError('timeout', '请求超时。', { retryable: true, cause: error });
      }
      if (abortScope.callerAborted()) {
        throw new StudioAiError('cancelled', '请求已取消。', { cause: error });
      }
      if (error instanceof StudioAiError) throw error;
      throw new StudioAiError('network', '网络、CORS 或重定向检查失败。', { retryable: true, cause: error });
    } finally {
      abortScope.cleanup();
    }
  }

  async listModels({ apiKey, signal, timeoutMs, maxResponseBytes } = {}) {
    const data = await this.#requestJson(providerModelsEndpoint(this.#apiFormat), {
      method: 'GET',
      apiKey,
      signal,
      timeoutMs,
      maxResponseBytes,
    });
    return normalizeProviderModels(this.#apiFormat, data);
  }

  async createChatCompletion(request, options = {}) {
    const canonical = buildChatCompletionBody(request);
    const endpoint = providerChatEndpoint(this.#apiFormat, canonical.model);
    const body = providerChatBody(this.#apiFormat, canonical);
    if (
      this.#apiFormat === 'openai-compatible'
      && isOfficialOpenAiBaseUrl(this.#baseUrl)
      && body.max_tokens !== undefined
    ) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
    const providerData = await this.#requestJson(endpoint, { ...options, method: 'POST', body });
    const data = normalizeProviderChatResponse(this.#apiFormat, providerData, canonical.model);
    const text = assistantTextFromResponse(data);
    const choice = data.choices[0];
    return {
      text,
      model: typeof data.model === 'string' ? data.model : canonical.model,
      finishReason: choice?.finish_reason ?? null,
      usage: isPlainRecord(data.usage) ? safeJsonClone(data.usage) : null,
      data,
      providerData,
    };
  }
}

export {
  AIRP_SENSITIVE_FIELDS,
  AirpPresetError,
  OpenAICompatibleClient,
  STUDIO_AI_API_FORMATS,
  STUDIO_AI_NETWORK_MODES,
  StudioAiError,
  apiFormatSwitchBaseUrl,
  assembleAirpPrompt,
  createDesktopAiFetch,
  importAirpPreset,
  inspectAirpPreset,
  normalizeApiFormat,
  normalizeApiProfileTransport,
  normalizeNetworkMode,
  normalizeOpenAiBaseUrl,
  parseAgentTurnResponse,
  summarizeAirpPreset,
  validateAirpPreset,
};
