export const MVU_TURN_TRACE_FORMAT = 'rolecard-mvu-turn-trace';
export const MVU_TURN_TRACE_VERSION = 1;
export const MVU_SAFE_CONTRACT_FORMAT = 'rolecard-mvu-safe-contract';
export const MVU_SAFE_CONTRACT_VERSION = 1;
export const MVU_TURN_KERNEL_VERSION = 'mvu-turn-v1';

const SUPPORTED_DIALECTS = new Set(['rfc6902', 'official_jsonpatch']);
const VALUE_TYPES = new Set(['any', 'string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
const RANGE_MODES = new Set(['reject', 'clamp']);
const POISON_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LIMITS = Object.freeze({
  stateBytes: 256 * 1024,
  operationBytes: 128 * 1024,
  contractBytes: 256 * 1024,
  maxDepth: 32,
  maxNodes: 6000,
  maxOperations: 64,
  maxFields: 1000,
  maxChecks: 2000,
  maxPathLength: 512,
  maxKeyLength: 160,
  maxStringLength: 64 * 1024,
  maxYamlLines: 12000,
});

export class MvuSimulationError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'MvuSimulationError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = '') {
  throw new MvuSimulationError(code, message, detail);
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

function validateKey(key, label, { allowWildcard = false } = {}) {
  if (!key || key.length > LIMITS.maxKeyLength) fail('E_PATH_KEY', `${label} 含空键或超长键。`);
  if (POISON_KEYS.has(key)) fail('E_PATH_POISON', `${label} 含被禁止的原型链键：${key}。`);
  if (key === '*') {
    if (allowWildcard) return;
    fail('E_PATH_KEY', `${label} 的字面“*”会与契约通配符冲突。`);
  }
  if (key.includes('.') || key.includes('/') || key.includes('~') || /[\u0000-\u001f\u007f]/.test(key)) {
    fail('E_PATH_KEY', `${label} 的键“${key}”含点、斜杠、波浪号或控制字符。`);
  }
}

function validateJsonSafe(value, label = '数据') {
  const seen = new Set();
  let nodes = 0;
  const visit = (input, depth, path) => {
    nodes += 1;
    if (nodes > LIMITS.maxNodes) fail('E_DATA_SIZE', `${label} 的节点数量超过 ${LIMITS.maxNodes}。`);
    if (depth > LIMITS.maxDepth) fail('E_DATA_DEPTH', `${label} 的嵌套深度超过 ${LIMITS.maxDepth}。`);
    if (input === null || typeof input === 'boolean') return;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) fail('E_DATA_NUMBER', `${path} 不是有限数字。`);
      return;
    }
    if (typeof input === 'string') {
      if (input.length > LIMITS.maxStringLength) fail('E_DATA_STRING', `${path} 的文字过长。`);
      return;
    }
    if (typeof input !== 'object') fail('E_DATA_TYPE', `${path} 含函数、undefined、BigInt 或其他非 JSON 值。`);
    if (seen.has(input)) fail('E_DATA_CYCLE', `${label} 含循环引用。`);
    seen.add(input);
    if (Array.isArray(input)) {
      const keys = Object.keys(input);
      if (keys.length !== input.length || keys.some((key, index) => key !== String(index))) {
        fail('E_DATA_ARRAY', `${path} 必须是连续、且不含自定义字段的 JSON 数组。`);
      }
      for (let index = 0; index < input.length; index += 1) {
        visit(input[index], depth + 1, `${path}/${index}`);
      }
    } else {
      if (!isPlainRecord(input)) fail('E_DATA_OBJECT', `${path} 必须是普通 JSON 对象，不能是 Date、Map、Set 或类实例。`);
      Object.keys(input).forEach((key) => {
        validateKey(key, `${path} 的字段`);
        visit(input[key], depth + 1, `${path}/${key}`);
      });
    }
    seen.delete(input);
  };
  visit(value, 0, label);
  return value;
}

function assertNoDuplicateJsonObjectKeys(source, label = 'JSON') {
  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/.test(source[cursor] || '')) cursor += 1;
  };
  const readString = () => {
    const start = cursor;
    cursor += 1;
    let escaped = false;
    while (cursor < source.length) {
      const char = source[cursor];
      cursor += 1;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        return JSON.parse(source.slice(start, cursor));
      }
    }
    return '';
  };
  const readValue = (depth = 0) => {
    if (depth > LIMITS.maxDepth) fail('E_DATA_DEPTH', `${label} 的嵌套深度超过 ${LIMITS.maxDepth}。`);
    skipWhitespace();
    if (source[cursor] === '{') {
      cursor += 1;
      skipWhitespace();
      const keys = new Set();
      if (source[cursor] === '}') {
        cursor += 1;
        return;
      }
      while (cursor < source.length) {
        const key = readString();
        if (keys.has(key)) fail('E_JSON_DUPLICATE', `${label} 重复定义字段“${key}”。`);
        keys.add(key);
        skipWhitespace();
        cursor += 1;
        readValue(depth + 1);
        skipWhitespace();
        if (source[cursor] === '}') {
          cursor += 1;
          return;
        }
        cursor += 1;
        skipWhitespace();
      }
      return;
    }
    if (source[cursor] === '[') {
      cursor += 1;
      skipWhitespace();
      if (source[cursor] === ']') {
        cursor += 1;
        return;
      }
      while (cursor < source.length) {
        readValue(depth + 1);
        skipWhitespace();
        if (source[cursor] === ']') {
          cursor += 1;
          return;
        }
        cursor += 1;
      }
      return;
    }
    if (source[cursor] === '"') {
      readString();
      return;
    }
    while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor += 1;
  };
  skipWhitespace();
  readValue();
}

export function cloneMvuStateData(value) {
  if (!isPlainRecord(value)) fail('E_STATE_ROOT', '运行前状态的根必须是对象。');
  validateJsonSafe(value, '运行前状态');
  return cloneJson(value);
}

function parseJsonText(source, label, maxBytes) {
  if (byteLength(source) > maxBytes) fail('E_TEXT_SIZE', `${label} 超过 ${Math.floor(maxBytes / 1024)} KiB。`);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    fail('E_JSON_PARSE', `${label} 不是有效 JSON。`, error.message);
  }
  assertNoDuplicateJsonObjectKeys(source, label);
  return parsed;
}

function stripYamlComment(line) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && double) {
      escaped = true;
      continue;
    }
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    else if (char === '#' && !single && !double && (index === 0 || /\s/.test(line[index - 1]))) return line.slice(0, index).trimEnd();
  }
  return line;
}

function splitInlineList(value) {
  const items = [];
  let current = '';
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && double) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    if (char === ',' && !single && !double) {
      items.push(current.trim());
      current = '';
    } else current += char;
  }
  if (single || double) fail('E_YAML_SCALAR', 'YAML 行内数组含未闭合引号。');
  if (current.trim() || value.trim()) items.push(current.trim());
  return items;
}

function parseYamlScalar(raw, lineNumber) {
  const value = raw.trim();
  if (value === '' || value === '{}' ) return {};
  if (value === '[]') return [];
  if (value === 'null' || value === 'Null' || value === 'NULL' || value === '~') return null;
  if (/^(?:true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) fail('E_YAML_NUMBER', `YAML 第 ${lineNumber} 行不是有限数字。`);
    return numeric;
  }
  if (value.startsWith('"')) {
    try { return JSON.parse(value); } catch (error) { fail('E_YAML_SCALAR', `YAML 第 ${lineNumber} 行的双引号文字无效。`, error.message); }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitInlineList(inner).map((item) => parseYamlScalar(item, lineNumber));
  }
  if (value.startsWith('{') || value.startsWith('[')) {
    let parsed;
    try { parsed = JSON.parse(value); } catch (error) { fail('E_YAML_FLOW', `YAML 第 ${lineNumber} 行的行内 JSON 无效。`, error.message); }
    assertNoDuplicateJsonObjectKeys(value, `YAML 第 ${lineNumber} 行的行内 JSON`);
    return parsed;
  }
  if (value === '|' || value === '>' || /^!!|^[&*!]|^<<:/.test(value)) {
    fail('E_YAML_UNSAFE', `YAML 第 ${lineNumber} 行使用了 P1 安全子集不支持的标签、锚点或块文本。`);
  }
  return value;
}

function parseYamlKey(raw, lineNumber) {
  const source = raw.trim();
  let key = source;
  if (source.startsWith('"')) {
    try { key = JSON.parse(source); } catch (error) { fail('E_YAML_KEY', `YAML 第 ${lineNumber} 行的键无效。`, error.message); }
  } else if (source.startsWith("'") && source.endsWith("'")) key = source.slice(1, -1).replace(/''/g, "'");
  validateKey(key, `YAML 第 ${lineNumber} 行`);
  return key;
}

function splitYamlPair(content, lineNumber) {
  let single = false;
  let double = false;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && double) {
      escaped = true;
      continue;
    }
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    else if (char === ':' && !single && !double && (index === content.length - 1 || /\s/.test(content[index + 1]))) {
      return [content.slice(0, index), content.slice(index + 1)];
    }
  }
  fail('E_YAML_PAIR', `YAML 第 ${lineNumber} 行缺少“键: 值”结构。`);
}

function parseYamlSubset(source) {
  if (source.includes('\t')) fail('E_YAML_TAB', 'YAML 安全子集不接受 Tab 缩进，请改为空格。');
  const rawLines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (rawLines.length > LIMITS.maxYamlLines) fail('E_YAML_LINES', `YAML 超过 ${LIMITS.maxYamlLines} 行。`);
  const tokens = [];
  rawLines.forEach((rawLine, index) => {
    const stripped = stripYamlComment(rawLine);
    if (!stripped.trim() || /^\s*(?:---|\.\.\.)\s*$/.test(stripped)) return;
    const indent = stripped.match(/^ */)[0].length;
    const content = stripped.slice(indent).trimEnd();
    if (/^(?:!!|[&*!]|<<:)/.test(content)) fail('E_YAML_UNSAFE', `YAML 第 ${index + 1} 行使用了不安全或不支持的语法。`);
    tokens.push({ indent, content, line: index + 1 });
  });
  if (!tokens.length) return {};

  const parseBlock = (start, indent) => {
    const sequence = tokens[start].indent === indent && /^-(?:\s|$)/.test(tokens[start].content);
    const output = sequence ? [] : {};
    let cursor = start;
    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (token.indent < indent) break;
      if (token.indent > indent) fail('E_YAML_INDENT', `YAML 第 ${token.line} 行存在无法归属的缩进。`);
      const isSequenceItem = /^-(?:\s|$)/.test(token.content);
      if (isSequenceItem !== sequence) fail('E_YAML_MIXED', `YAML 第 ${token.line} 行混用了对象与数组层级。`);

      if (sequence) {
        const rest = token.content.replace(/^-(?:\s|$)/, '').trim();
        if (!rest) {
          if (cursor + 1 < tokens.length && tokens[cursor + 1].indent > indent) {
            const nested = parseBlock(cursor + 1, tokens[cursor + 1].indent);
            output.push(nested.value);
            cursor = nested.next;
          } else {
            output.push(null);
            cursor += 1;
          }
          continue;
        }
        let pair = null;
        try { pair = splitYamlPair(rest, token.line); } catch (error) { if (!(error instanceof MvuSimulationError) || error.code !== 'E_YAML_PAIR') throw error; }
        if (pair) {
          const item = {};
          const key = parseYamlKey(pair[0], token.line);
          const tail = pair[1].trim();
          item[key] = tail ? parseYamlScalar(tail, token.line) : {};
          cursor += 1;
          if (cursor < tokens.length && tokens[cursor].indent > indent) {
            const nested = parseBlock(cursor, tokens[cursor].indent);
            if (!isPlainRecord(nested.value)) fail('E_YAML_SEQUENCE_MAP', `YAML 第 ${token.line} 行的数组对象后必须继续对象字段。`);
            Object.assign(item, nested.value);
            cursor = nested.next;
          }
          output.push(item);
        } else {
          output.push(parseYamlScalar(rest, token.line));
          cursor += 1;
        }
        continue;
      }

      const [rawKey, rawValue] = splitYamlPair(token.content, token.line);
      const key = parseYamlKey(rawKey, token.line);
      if (Object.hasOwn(output, key)) fail('E_YAML_DUPLICATE', `YAML 第 ${token.line} 行重复定义字段“${key}”。`);
      const tail = rawValue.trim();
      if (tail) {
        output[key] = parseYamlScalar(tail, token.line);
        cursor += 1;
      } else if (cursor + 1 < tokens.length && tokens[cursor + 1].indent > indent) {
        const nested = parseBlock(cursor + 1, tokens[cursor + 1].indent);
        output[key] = nested.value;
        cursor = nested.next;
      } else {
        output[key] = {};
        cursor += 1;
      }
    }
    return { value: output, next: cursor };
  };

  const parsed = parseBlock(0, tokens[0].indent);
  if (parsed.next !== tokens.length) fail('E_YAML_TRAILING', 'YAML 存在未解析内容。');
  return parsed.value;
}

export function parseMvuStateText(source) {
  const text = String(source ?? '').trim();
  if (!text) fail('E_STATE_EMPTY', '运行前状态为空。');
  if (byteLength(text) > LIMITS.stateBytes) fail('E_STATE_SIZE', '运行前状态超过 256 KiB。');
  let parsed;
  let parsedAsJson = false;
  try {
    parsed = JSON.parse(text);
    parsedAsJson = true;
  } catch {
    parsed = parseYamlSubset(text);
  }
  if (parsedAsJson) assertNoDuplicateJsonObjectKeys(text, '运行前状态 JSON');
  return cloneMvuStateData(parsed);
}

function normalizePath(raw, label, { allowWildcard = false } = {}) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw === '/' || raw.length > LIMITS.maxPathLength) {
    fail('E_PATH', `${label} 必须是非根的 /顶层/字段 路径。`);
  }
  const segments = raw.slice(1).split('/');
  if (!segments.length || segments.some((segment) => !segment)) fail('E_PATH', `${label} 含空路径段。`);
  segments.forEach((segment) => validateKey(segment, label, { allowWildcard }));
  return { path: `/${segments.join('/')}`, segments };
}

function pathFromSegments(segments) {
  return `/${segments.join('/')}`;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isPlainRecord(value)) return 'object';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function parseLooseScalar(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^(?:true|false)$/i.test(text)) return text.toLowerCase() === 'true';
  if (/^(?:null|~)$/i.test(text)) return null;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return Number(text);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith('[') && text.endsWith(']')) || (text.startsWith('{') && text.endsWith('}'))) {
    try { return JSON.parse(text); } catch { /* Keep the literal below. */ }
  }
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

function normalizeRulePath(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\$\{[^}]+\}|\{\{[^}]+\}\}|<[^>]+>/g, '*');
}

function extractRuleContracts(updateRules) {
  const source = String(updateRules ?? '');
  const lines = source.split(/\r?\n/);
  const fields = [];
  const checks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const pathMatch = lines[index].match(/^(\s*)path\s*:\s*(\/\S.*?)\s*$/i);
    if (!pathMatch) continue;
    const pathIndent = pathMatch[1].length;
    const rawPath = normalizeRulePath(pathMatch[2]);
    let label = rawPath;
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const heading = lines[cursor].match(/^(\s*)([^#\-][^:]*?)\s*:\s*$/);
      if (heading && heading[1].length < pathIndent) {
        label = heading[2].trim();
        break;
      }
    }
    let type = '';
    let minimum;
    let maximum;
    let enumValues = [];
    let required = false;
    let defaultValue;
    let inChecks = false;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) continue;
      const indent = line.match(/^\s*/)[0].length;
      const sameLevelKey = line.match(/^\s*([^\-][^:]+?)\s*:/);
      const isKnownFieldProperty = sameLevelKey && /^(?:type|range|enum|required|default|check|关联同步|兼容字段|UID格式|警告|示例)$/i.test(sameLevelKey[1].trim());
      if (indent < pathIndent || (indent === pathIndent && sameLevelKey && !isKnownFieldProperty)) break;
      const typeMatch = line.match(/^\s*type\s*:\s*(number|integer|string|boolean|array|object)\b/i);
      if (typeMatch) type = typeMatch[1].toLowerCase();
      const rangeMatch = line.match(/^\s*range\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*(?:~|～|\.\.)\s*([+-]?(?:\d+\.?\d*|\.\d+))\s*$/i);
      if (rangeMatch) {
        minimum = Number(rangeMatch[1]);
        maximum = Number(rangeMatch[2]);
      }
      const enumMatch = line.match(/^\s*enum\s*:\s*(.+?)\s*$/i);
      if (enumMatch) {
        const body = enumMatch[1].replace(/^\[/, '').replace(/\]$/, '');
        enumValues = splitInlineList(body).map(parseLooseScalar);
      }
      const requiredMatch = line.match(/^\s*required\s*:\s*(true|false)\s*$/i);
      if (requiredMatch) required = requiredMatch[1].toLowerCase() === 'true';
      const defaultMatch = line.match(/^\s*default\s*:\s*(.+?)\s*$/i);
      if (defaultMatch) defaultValue = parseLooseScalar(defaultMatch[1]);
      if (/^\s*check\s*:\s*$/i.test(line)) {
        inChecks = true;
        continue;
      }
      if (inChecks) {
        const checkMatch = line.match(/^\s*-\s*([^:]+?)(?:\s*:\s*(.*))?$/);
        if (checkMatch) checks.push({
          id: `rule-${checks.length + 1}`,
          path: rawPath,
          label: checkMatch[1].trim(),
          detail: (checkMatch[2] || '').trim(),
        });
        else if (indent <= pathIndent) inChecks = false;
      }
    }
    fields.push({
      path: rawPath,
      label,
      ...(type ? { type } : {}),
      required,
      ...(minimum !== undefined ? { minimum, maximum, rangeMode: 'clamp' } : {}),
      ...(enumValues.length ? { enum: enumValues } : {}),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    });
  }
  return { fields, checks };
}

function contractPayload(contract) {
  return {
    format: contract.format,
    schemaVersion: contract.schemaVersion,
    closed: contract.closed,
    source: contract.source,
    fields: contract.fields,
    ruleChecks: contract.ruleChecks,
  };
}

export function normalizeMvuSafeContract(raw) {
  const source = typeof raw === 'string'
    ? parseJsonText(raw, '安全模拟契约', LIMITS.contractBytes)
    : raw;
  if (!isPlainRecord(source)) fail('E_CONTRACT_ROOT', '安全模拟契约必须是对象。');
  if (source.format !== MVU_SAFE_CONTRACT_FORMAT || Number(source.schemaVersion) !== MVU_SAFE_CONTRACT_VERSION) {
    fail('E_CONTRACT_VERSION', '安全模拟契约的格式或版本不受支持。');
  }
  if (!Array.isArray(source.fields) || source.fields.length > LIMITS.maxFields) fail('E_CONTRACT_FIELDS', '安全模拟契约字段数量无效。');
  if (!Array.isArray(source.ruleChecks) || source.ruleChecks.length > LIMITS.maxChecks) fail('E_CONTRACT_CHECKS', '安全模拟契约 ruleChecks 数量无效。');
  const normalized = {
    format: MVU_SAFE_CONTRACT_FORMAT,
    schemaVersion: MVU_SAFE_CONTRACT_VERSION,
    closed: source.closed !== false,
    source: {
      sourceSignature: String(source.source?.sourceSignature || ''),
      initialFingerprint: String(source.source?.initialFingerprint || ''),
      rulesFingerprint: String(source.source?.rulesFingerprint || ''),
      zodSourceFingerprint: String(source.source?.zodSourceFingerprint || ''),
      zodStatus: 'source_only',
      zodExecuted: false,
    },
    fields: source.fields.map((field, index) => {
      if (!isPlainRecord(field)) fail('E_CONTRACT_FIELD', `安全模拟契约 fields[${index}] 必须是对象。`);
      const path = normalizePath(field.path, `fields[${index}].path`, { allowWildcard: true }).path;
      const type = String(field.type || 'any');
      if (!VALUE_TYPES.has(type)) fail('E_CONTRACT_TYPE', `fields[${index}].type 不受支持。`);
      const rangeMode = String(field.rangeMode || 'reject');
      if (!RANGE_MODES.has(rangeMode)) fail('E_CONTRACT_RANGE', `fields[${index}].rangeMode 不受支持。`);
      const minimum = field.minimum == null ? null : Number(field.minimum);
      const maximum = field.maximum == null ? null : Number(field.maximum);
      if ((minimum != null && !Number.isFinite(minimum)) || (maximum != null && !Number.isFinite(maximum)) || (minimum != null && maximum != null && minimum > maximum)) {
        fail('E_CONTRACT_RANGE', `fields[${index}] 的数值范围无效。`);
      }
      const enumValues = field.enum == null ? [] : field.enum;
      if (!Array.isArray(enumValues) || enumValues.length > 200) fail('E_CONTRACT_ENUM', `fields[${index}].enum 无效。`);
      enumValues.forEach((item) => {
        if (item !== null && !['string', 'number', 'boolean'].includes(typeof item)) fail('E_CONTRACT_ENUM', `fields[${index}].enum 只能包含标量。`);
        if (typeof item === 'number' && !Number.isFinite(item)) fail('E_CONTRACT_ENUM', `fields[${index}].enum 含非有限数字。`);
      });
      const result = {
        path,
        label: String(field.label || path),
        type,
        required: field.required === true,
        coerce: field.coerce === true,
        rangeMode,
        ...(minimum != null ? { minimum } : {}),
        ...(maximum != null ? { maximum } : {}),
        ...(enumValues.length ? { enum: cloneJson(enumValues) } : {}),
      };
      if (Object.hasOwn(field, 'default')) {
        validateJsonSafe(field.default, `fields[${index}].default`);
        result.default = cloneJson(field.default);
      }
      return result;
    }),
    ruleChecks: source.ruleChecks.map((item, index) => {
      if (!isPlainRecord(item)) fail('E_CONTRACT_CHECK', `ruleChecks[${index}] 必须是对象。`);
      return {
        id: String(item.id || `rule-${index + 1}`),
        path: normalizePath(item.path, `ruleChecks[${index}].path`, { allowWildcard: true }).path,
        label: String(item.label || `规则 Check ${index + 1}`),
        detail: String(item.detail || ''),
      };
    }),
  };
  const fieldPaths = new Set();
  normalized.fields.forEach((field) => {
    if (fieldPaths.has(field.path)) fail('E_CONTRACT_DUPLICATE', `安全模拟契约重复定义路径 ${field.path}。`);
    fieldPaths.add(field.path);
  });
  validateJsonSafe(contractPayload(normalized), '安全模拟契约');
  normalized.fingerprint = `fnv1a:${hashText(stableStringify(contractPayload(normalized)))}`;
  return normalized;
}

export function mvuSimulationSourceSignature({ dialect, initialVariables, updateRules = '', schema = '' } = {}) {
  return `fnv1a:${hashText(stableStringify({
    engine: 'mvu',
    dialect: String(dialect || ''),
    initialHash: hashText(String(initialVariables || '')),
    rulesHash: hashText(String(updateRules || '')),
    schemaHash: hashText(String(schema || '')),
  }))}`;
}

export function mvuSimulationDraftSignature({ sourceSignature = '', dialect = '', beforeText = '', operationText = '', contractText = '' } = {}) {
  return `fnv1a:${hashText(stableStringify({
    sourceSignature: String(sourceSignature),
    dialect: String(dialect),
    beforeHash: hashText(String(beforeText)),
    operationHash: hashText(String(operationText)),
    contractHash: hashText(String(contractText)),
  }))}`;
}

export function buildMvuSafeContract({ before, updateRules = '', schema = '', sourceSignature = '' } = {}) {
  validateJsonSafe(before, '运行前状态');
  if (!isPlainRecord(before)) fail('E_STATE_ROOT', '运行前状态的根必须是对象。');
  const fields = new Map();
  const registerField = (path, label, valueType) => {
    const existing = fields.get(path);
    fields.set(path, {
      path,
      label,
      type: existing && existing.type !== valueType ? 'any' : valueType,
      required: false,
      coerce: false,
      rangeMode: 'reject',
    });
  };
  const walk = (value, segments = []) => {
    if (segments.length) {
      const path = pathFromSegments(segments);
      registerField(path, segments.at(-1), typeOf(value));
    }
    if (Array.isArray(value)) value.forEach((item) => walk(item, [...segments, '*']));
    else if (isPlainRecord(value)) Object.keys(value).sort().forEach((key) => walk(value[key], [...segments, key]));
  };
  walk(before);
  const extracted = extractRuleContracts(updateRules);
  extracted.fields.forEach((ruleField) => {
    const normalizedPath = normalizePath(ruleField.path, `规则字段 ${ruleField.label}`, { allowWildcard: true }).path;
    const existing = fields.get(normalizedPath) || {
      path: normalizedPath,
      label: ruleField.label,
      type: 'any',
      required: false,
      coerce: false,
      rangeMode: 'reject',
    };
    const nextType = ruleField.type || existing.type;
    fields.set(normalizedPath, {
      ...existing,
      ...ruleField,
      path: normalizedPath,
      type: nextType,
      coerce: nextType === 'number' || nextType === 'integer',
      rangeMode: ruleField.rangeMode || existing.rangeMode,
    });
  });
  return normalizeMvuSafeContract({
    format: MVU_SAFE_CONTRACT_FORMAT,
    schemaVersion: MVU_SAFE_CONTRACT_VERSION,
    closed: true,
    source: {
      sourceSignature,
      initialFingerprint: `fnv1a:${hashText(stableStringify(before))}`,
      rulesFingerprint: `fnv1a:${hashText(String(updateRules || ''))}`,
      zodSourceFingerprint: `fnv1a:${hashText(String(schema || ''))}`,
      zodStatus: 'source_only',
      zodExecuted: false,
    },
    fields: [...fields.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    ruleChecks: extracted.checks,
  });
}

export function createMvuSimulationSeed({ initialVariables, updateRules = '', schema = '', dialect = 'rfc6902' } = {}) {
  const before = parseMvuStateText(initialVariables);
  const sourceSignature = mvuSimulationSourceSignature({ dialect, initialVariables, updateRules, schema });
  const contract = buildMvuSafeContract({ before, updateRules, schema, sourceSignature });
  return {
    dialect,
    sourceSignature,
    before,
    beforeText: JSON.stringify(before, null, 2),
    operationText: '[]',
    contract,
    contractText: JSON.stringify(contract, null, 2),
  };
}

function extractOperationPayload(source) {
  const raw = String(source ?? '').trim();
  if (!raw) fail('E_OPERATION_EMPTY', '候选更新操作为空。');
  if (byteLength(raw) > LIMITS.operationBytes) fail('E_OPERATION_SIZE', '候选更新操作超过 128 KiB。');
  if (raw.startsWith('[') || raw.startsWith('{')) return raw;
  let inJsonString = false;
  let escaped = false;
  let openingCount = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inJsonString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inJsonString = false;
      continue;
    }
    if (character === '"') {
      inJsonString = true;
      continue;
    }
    if (/^<json_?patch>/i.test(raw.slice(index))) openingCount += 1;
  }
  if (openingCount > 1) fail('E_OPERATION_BLOCKS', '候选输入包含多个 JSONPatch 块。');
  const direct = raw.match(/^<json_?patch>\s*([\s\S]*)\s*<\/json_?patch>$/i);
  if (direct) return direct[1];
  const wrapped = raw.match(/^<(update(?:variable)?|variableupdate)>\s*(?:<analysis>(?:(?!<\/?analysis\b)[\s\S])*<\/analysis>\s*)?<json_?patch>\s*([\s\S]*)\s*<\/json_?patch>\s*<\/\1>$/i);
  if (wrapped) return wrapped[2];
  if (/<\/?(?:update(?:variable)?|variableupdate|analysis|json_?patch)\b/i.test(raw)) {
    fail('E_OPERATION_BLOCK', '候选输入必须是唯一、完整的 JSONPatch 块，或由单个 UpdateVariable 完整包裹。');
  }
  if (/\b_\.set\s*\(/.test(raw)) fail('E_NATIVE_UNSUPPORTED', 'P1 不执行 MVU 原生命令文本；请使用 JSONPatch 数据方言。');
  return raw;
}

function normalizeOperationObject(raw, dialect, index) {
  if (!isPlainRecord(raw)) fail('E_OPERATION_ITEM', `operations[${index}] 必须是对象。`);
  const op = String(raw.op || '').toLowerCase();
  const allowed = dialect === 'rfc6902'
    ? new Set(['add', 'replace', 'remove', 'move'])
    : new Set(['replace', 'remove', 'move', 'delta', 'insert']);
  if (!allowed.has(op)) fail('E_OPERATION_OP', `${dialect} 不支持操作 ${op || '(empty)'}。`);
  const allowedKeys = dialect === 'rfc6902'
    ? new Set(['op', 'path', 'from', 'value'])
    : new Set(['op', 'path', 'from', 'to', 'value']);
  Object.keys(raw).forEach((key) => {
    if (!allowedKeys.has(key)) fail('E_OPERATION_FIELD', `operations[${index}] 含未知字段 ${key}。`);
  });
  const targetRaw = op === 'move' && !raw.path && raw.to ? raw.to : raw.path;
  const path = normalizePath(targetRaw, `operations[${index}].path`).path;
  const result = { op, path };
  if (op === 'move') {
    if (raw.path && raw.to) fail('E_OPERATION_FIELD', `operations[${index}] 不能同时声明 path 与 to。`);
    result.from = normalizePath(raw.from, `operations[${index}].from`).path;
    if (path === result.from || path.startsWith(`${result.from}/`)) fail('E_OPERATION_MOVE', `operations[${index}] 不能把路径移入自身。`);
  } else if (raw.from != null || raw.to != null) fail('E_OPERATION_FIELD', `operations[${index}] 仅 move 可以使用 from/to。`);
  const needsValue = ['add', 'replace', 'delta', 'insert'].includes(op);
  if (needsValue && !Object.hasOwn(raw, 'value')) fail('E_OPERATION_VALUE', `operations[${index}] 缺少 value。`);
  if (!needsValue && Object.hasOwn(raw, 'value')) fail('E_OPERATION_VALUE', `operations[${index}] 不应包含 value。`);
  if (needsValue) {
    validateJsonSafe(raw.value, `operations[${index}].value`);
    result.value = cloneJson(raw.value);
  }
  if (op === 'delta' && (typeof result.value !== 'number' || !Number.isFinite(result.value))) {
    fail('E_OPERATION_DELTA', `operations[${index}].value 必须是有限数字。`);
  }
  return result;
}

export function parseMvuOperationInput(input, dialect) {
  if (!SUPPORTED_DIALECTS.has(dialect)) {
    if (dialect === 'native') fail('E_DIALECT_UNSUPPORTED', 'P1 不执行 MVU 原生命令；需要独立的安全 AST 解释器。');
    fail('E_DIALECT_UNSUPPORTED', `P1 不支持方言 ${dialect || '(empty)'}。`);
  }
  let raw;
  if (typeof input === 'string') raw = parseJsonText(extractOperationPayload(input), '候选更新操作', LIMITS.operationBytes);
  else {
    validateJsonSafe(input, '候选更新操作');
    raw = cloneJson(input);
  }
  if (isPlainRecord(raw) && raw.format === 'mvu-operations-v1') {
    const envelopeFields = new Set(['format', 'dialect', 'operations']);
    const unknownField = Object.keys(raw).find((field) => !envelopeFields.has(field));
    if (unknownField) fail('E_OPERATION_FIELD', `候选操作信封含未知字段 ${unknownField}。`);
    if (raw.dialect !== dialect) fail('E_DIALECT_MISMATCH', '候选操作声明的方言与当前工作台不一致。');
    raw = raw.operations;
  }
  if (!Array.isArray(raw) || raw.length > LIMITS.maxOperations) fail('E_OPERATION_LIST', `候选操作必须是最多 ${LIMITS.maxOperations} 项的数组。`);
  validateJsonSafe(raw, '候选更新操作');
  return raw.map((operation, index) => normalizeOperationObject(operation, dialect, index));
}

function readLocation(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/.test(segment)) return { exists: false };
      const index = Number(segment);
      if (index < 0 || index >= current.length) return { exists: false };
      current = current[index];
    } else if (isPlainRecord(current)) {
      if (!Object.hasOwn(current, segment)) return { exists: false };
      current = current[segment];
    } else return { exists: false };
  }
  return { exists: true, value: current };
}

function parentLocation(root, path, operationIndex) {
  const segments = normalizePath(path, `operations[${operationIndex}].path`).segments;
  const key = segments.at(-1);
  const parentSegments = segments.slice(0, -1);
  const parentResult = parentSegments.length ? readLocation(root, parentSegments) : { exists: true, value: root };
  if (!parentResult.exists || (!Array.isArray(parentResult.value) && !isPlainRecord(parentResult.value))) {
    fail('E_OPERATION_PARENT', `operations[${operationIndex}] 的父路径不存在或不是容器：${path}。`);
  }
  return { parent: parentResult.value, key, segments };
}

function arrayIndex(key, length, { allowEnd = false, allowDash = false } = {}) {
  if (allowDash && key === '-') return length;
  if (!/^(?:0|[1-9]\d*)$/.test(key)) fail('E_ARRAY_INDEX', `数组索引 ${key} 无效。`);
  const index = Number(key);
  const upper = allowEnd ? length : length - 1;
  if (index < 0 || index > upper) fail('E_ARRAY_INDEX', `数组索引 ${key} 超出范围。`);
  return index;
}

function addValue(root, path, value, operationIndex, { insertOnly = false } = {}) {
  const { parent, key } = parentLocation(root, path, operationIndex);
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length, { allowEnd: true, allowDash: true });
    parent.splice(index, 0, cloneJson(value));
    return;
  }
  if (insertOnly) fail('E_INSERT_TARGET', `operations[${operationIndex}] 的 insert 只能写入数组。`);
  if (Object.hasOwn(parent, key)) fail('E_ADD_EXISTS', `operations[${operationIndex}] 的 add 目标已存在：${path}。`);
  parent[key] = cloneJson(value);
}

function replaceValue(root, path, value, operationIndex) {
  const { parent, key } = parentLocation(root, path, operationIndex);
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length);
    parent[index] = cloneJson(value);
  } else {
    if (!Object.hasOwn(parent, key)) fail('E_REPLACE_MISSING', `operations[${operationIndex}] 的 replace 目标不存在：${path}。`);
    parent[key] = cloneJson(value);
  }
}

function removeValue(root, path, operationIndex) {
  const { parent, key } = parentLocation(root, path, operationIndex);
  if (Array.isArray(parent)) {
    const index = arrayIndex(key, parent.length);
    return parent.splice(index, 1)[0];
  }
  if (!Object.hasOwn(parent, key)) fail('E_REMOVE_MISSING', `operations[${operationIndex}] 的 remove 目标不存在：${path}。`);
  const value = parent[key];
  delete parent[key];
  return value;
}

function applyOperations(before, operations) {
  const working = cloneJson(before);
  operations.forEach((operation, index) => {
    if (operation.op === 'add') addValue(working, operation.path, operation.value, index);
    else if (operation.op === 'insert') addValue(working, operation.path, operation.value, index, { insertOnly: true });
    else if (operation.op === 'replace') replaceValue(working, operation.path, operation.value, index);
    else if (operation.op === 'remove') removeValue(working, operation.path, index);
    else if (operation.op === 'delta') {
      const location = readLocation(working, normalizePath(operation.path, `operations[${index}].path`).segments);
      if (!location.exists || typeof location.value !== 'number' || !Number.isFinite(location.value)) {
        fail('E_DELTA_TARGET', `operations[${index}] 的 delta 目标必须是现有有限数字。`);
      }
      replaceValue(working, operation.path, location.value + operation.value, index);
    } else if (operation.op === 'move') {
      const fromSegments = normalizePath(operation.from, `operations[${index}].from`).segments;
      const source = readLocation(working, fromSegments);
      if (!source.exists) fail('E_MOVE_MISSING', `operations[${index}] 的 move 来源不存在：${operation.from}。`);
      const moved = cloneJson(source.value);
      removeValue(working, operation.from, index);
      addValue(working, operation.path, moved, index);
    }
  });
  return working;
}

function matchesPattern(pattern, path) {
  const patternSegments = normalizePath(pattern, '契约路径', { allowWildcard: true }).segments;
  const pathSegments = normalizePath(path, '操作路径').segments;
  if (patternSegments.length !== pathSegments.length) return false;
  return patternSegments.every((segment, index) => segment === '*' || segment === pathSegments[index]);
}

function assertClosedContractShape(value, contract, segments = []) {
  if (segments.length) {
    const path = pathFromSegments(segments);
    if (!contract.fields.some((field) => matchesPattern(field.path, path))) {
      fail('E_CONTRACT_CLOSED', `Patch 后状态含不在安全契约中的路径：${path}。`);
    }
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertClosedContractShape(item, contract, [...segments, String(index)]));
  } else if (isPlainRecord(value)) {
    Object.keys(value).sort().forEach((key) => assertClosedContractShape(value[key], contract, [...segments, key]));
  }
}

function expandPattern(root, pattern) {
  const segments = normalizePath(pattern, '契约路径', { allowWildcard: true }).segments;
  const output = [];
  const visit = (value, index, resolved) => {
    if (index === segments.length) {
      output.push(pathFromSegments(resolved));
      return;
    }
    const segment = segments[index];
    if (segment !== '*') {
      const next = readLocation(root, [...resolved, segment]);
      if (next.exists) visit(next.value, index + 1, [...resolved, segment]);
      else if (!segments.slice(index + 1).includes('*')) output.push(pathFromSegments([...resolved, ...segments.slice(index)]));
      return;
    }
    if (Array.isArray(value)) value.forEach((item, itemIndex) => visit(item, index + 1, [...resolved, String(itemIndex)]));
    else if (isPlainRecord(value)) Object.keys(value).sort().forEach((key) => visit(value[key], index + 1, [...resolved, key]));
  };
  visit(root, 0, []);
  return output;
}

function scalarEquals(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function coerceValue(value, field) {
  if (!field.coerce) return value;
  if ((field.type === 'number' || field.type === 'integer') && typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return value;
}

function validateFieldType(value, type) {
  if (type === 'any') return true;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeOf(value) === type;
}

function applySafeContract(patched, contract, operations) {
  const after = cloneJson(patched);
  if (contract.closed) {
    operations.forEach((operation, index) => {
      const paths = operation.op === 'move' ? [operation.from, operation.path] : [operation.path];
      paths.forEach((path) => {
        const directMatch = contract.fields.some((field) => matchesPattern(field.path, path));
        if (!directMatch) {
          fail('E_CONTRACT_CLOSED', `operations[${index}] 的路径不在安全契约中：${path}。`);
        }
      });
    });
    assertClosedContractShape(after, contract);
  }
  const checks = [];
  contract.fields.forEach((field) => {
    const paths = expandPattern(after, field.path);
    if (!paths.length && field.required) fail('E_CONTRACT_REQUIRED', `必需字段缺失：${field.path}。`);
    paths.forEach((path) => {
      const location = readLocation(after, normalizePath(path, '契约检查路径').segments);
      if (!location.exists) {
        if (field.required) fail('E_CONTRACT_REQUIRED', `必需字段缺失：${path}。`);
        return;
      }
      let value = coerceValue(location.value, field);
      if (!validateFieldType(value, field.type)) fail('E_CONTRACT_TYPE', `${path} 应为 ${field.type}，实际为 ${typeOf(value)}。`);
      if (field.enum?.length && !field.enum.some((item) => scalarEquals(item, value))) {
        fail('E_CONTRACT_ENUM', `${path} 不在允许枚举中。`);
      }
      if ((field.type === 'number' || field.type === 'integer') && typeof value === 'number') {
        const below = field.minimum != null && value < field.minimum;
        const above = field.maximum != null && value > field.maximum;
        if (below || above) {
          if (field.rangeMode !== 'clamp') fail('E_CONTRACT_RANGE', `${path} 超出安全契约范围。`);
          value = Math.min(field.maximum ?? value, Math.max(field.minimum ?? value, value));
        }
      }
      if (!scalarEquals(location.value, value)) replaceValue(after, path, value, -1);
      checks.push({ path, type: field.type, transformed: !scalarEquals(location.value, value) });
    });
  });
  return { after, fieldChecks: checks };
}

function diffValues(before, after, segments = []) {
  if (scalarEquals(before, after)) return [];
  const path = segments.length ? pathFromSegments(segments) : '';
  if (Array.isArray(before) || Array.isArray(after)) return [{ kind: 'replace', path, before: cloneJson(before), after: cloneJson(after) }];
  if (isPlainRecord(before) && isPlainRecord(after)) {
    const beforeKeys = new Set(Object.keys(before));
    const afterKeys = new Set(Object.keys(after));
    const output = [];
    [...beforeKeys].filter((key) => !afterKeys.has(key)).sort().forEach((key) => {
      output.push({ kind: 'remove', path: pathFromSegments([...segments, key]), before: cloneJson(before[key]), after: null });
    });
    [...afterKeys].filter((key) => !beforeKeys.has(key)).sort().forEach((key) => {
      output.push({ kind: 'add', path: pathFromSegments([...segments, key]), before: null, after: cloneJson(after[key]) });
    });
    [...beforeKeys].filter((key) => afterKeys.has(key)).sort().forEach((key) => {
      output.push(...diffValues(before[key], after[key], [...segments, key]));
    });
    return output;
  }
  return [{ kind: 'replace', path, before: cloneJson(before), after: cloneJson(after) }];
}

function touchedByOperations(path, operations) {
  return operations.some((operation) => {
    const candidates = operation.op === 'move' ? [operation.path, operation.from] : [operation.path];
    return candidates.some((candidate) => matchesPattern(path, candidate));
  });
}

export function simulateMvuTurn({
  engine = 'mvu',
  stateKind = 'mvu',
  sourceSignature,
  currentSourceSignature = sourceSignature,
  dialect,
  before,
  operationInput,
  contract,
} = {}) {
  if (engine !== 'mvu' || stateKind !== 'mvu') fail('E_ENGINE', 'MVU 单回合模拟只能在 MVU 路线运行。');
  if (!sourceSignature || sourceSignature !== currentSourceSignature) fail('E_SOURCE_STALE', '模拟输入来源已经变化，请重新载入当前源稿。');
  if (!SUPPORTED_DIALECTS.has(dialect)) {
    if (dialect === 'native') fail('E_DIALECT_UNSUPPORTED', 'P1 不执行 MVU 原生命令文本；请切换 JSONPatch 方言。');
    fail('E_DIALECT_UNSUPPORTED', `P1 不支持方言 ${dialect || '(empty)'}。`);
  }
  validateJsonSafe(before, '运行前状态');
  if (!isPlainRecord(before)) fail('E_STATE_ROOT', '运行前状态的根必须是对象。');
  const beforeFingerprint = stableStringify(before);
  const beforeSnapshot = cloneJson(before);
  const operations = parseMvuOperationInput(operationInput, dialect);
  const safeContract = normalizeMvuSafeContract(contract);
  if (safeContract.source.sourceSignature && safeContract.source.sourceSignature !== sourceSignature) {
    fail('E_CONTRACT_STALE', '安全模拟契约与当前状态来源不一致，请重新载入。');
  }
  const patched = applyOperations(beforeSnapshot, operations);
  validateJsonSafe(patched, 'Patch 后状态');
  const firstAdapterRun = applySafeContract(patched, safeContract, operations);
  const secondAdapterRun = applySafeContract(patched, safeContract, operations);
  if (stableStringify(firstAdapterRun.after) !== stableStringify(secondAdapterRun.after)) fail('E_ADAPTER_NONDETERMINISTIC', '安全契约适配器输出不确定。');
  const idempotentRun = applySafeContract(firstAdapterRun.after, safeContract, []);
  if (stableStringify(firstAdapterRun.after) !== stableStringify(idempotentRun.after)) fail('E_ADAPTER_NONIDEMPOTENT', '安全契约适配器不是幂等的。');
  if (stableStringify(before) !== beforeFingerprint) fail('E_INPUT_MUTATED', '模拟器检测到调用方输入被修改。');
  const after = firstAdapterRun.after;
  const diff = diffValues(beforeSnapshot, after);
  const schemaDiff = diffValues(patched, after);
  const checks = [
    { id: 'engine', nodeId: 'mvu.operation', status: 'pass', label: 'MVU 路线隔离', detail: '没有调用数据库、UI Builder、ST 或插件运行时。' },
    { id: 'dialect', nodeId: 'mvu.operation', status: 'pass', label: '方言一致', detail: `本次仅按 ${dialect} 解析 ${operations.length} 项操作。` },
    { id: 'contract', nodeId: 'mvu.validator', status: 'pass', label: '安全契约校验', detail: `检查 ${firstAdapterRun.fieldChecks.length} 个字段；任意 Zod 源码未执行。` },
    { id: 'deterministic', nodeId: 'mvu.validator', status: 'pass', label: '确定性与幂等', detail: '相同候选状态运行两次一致，且适配后再次适配不变化。' },
    { id: 'snapshot', nodeId: 'mvu.snapshot', status: 'pass', label: '原子快照', detail: `保留 before / operation / patched / after / ${diff.length} 项 Diff。` },
    ...safeContract.ruleChecks.map((item) => ({
      id: item.id,
      nodeId: 'mvu.rules',
      status: touchedByOperations(item.path, operations) ? 'observed' : 'not_triggered',
      label: item.label,
      detail: touchedByOperations(item.path, operations)
        ? `本次操作命中 ${item.path}；语义结果仍需驾驶员核对。${item.detail ? ` ${item.detail}` : ''}`
        : `本次未触发 ${item.path}。${item.detail ? ` ${item.detail}` : ''}`,
    })),
    {
      id: 'zod-source', nodeId: 'mvu.schema', status: 'not_run', label: 'Zod 源稿未执行',
      detail: `仅记录源稿指纹 ${safeContract.source.zodSourceFingerprint || 'none'}；真实 strip / transform 仍需可信 Adapter 或 ST 验证。`,
    },
  ];
  const traceCore = {
    format: MVU_TURN_TRACE_FORMAT,
    schemaVersion: MVU_TURN_TRACE_VERSION,
    kernelVersion: MVU_TURN_KERNEL_VERSION,
    engine: 'mvu',
    sourceSignature,
    dialect,
    schema: {
      status: 'safe_contract_only',
      zodExecuted: false,
      zodSourceFingerprint: safeContract.source.zodSourceFingerprint,
      contractFingerprint: safeContract.fingerprint,
    },
    before: cloneJson(beforeSnapshot),
    operation: {
      format: 'mvu-operations-v1',
      dialect,
      operations: cloneJson(operations),
    },
    patched: cloneJson(patched),
    schemaDiff: cloneJson(schemaDiff),
    after: cloneJson(after),
    diff: cloneJson(diff),
    checks: cloneJson(checks),
    contract: cloneJson(safeContract),
  };
  return {
    ...traceCore,
    traceId: `fnv1a:${hashText(stableStringify(traceCore))}`,
  };
}

export function replayMvuTurn(trace) {
  if (
    !isPlainRecord(trace)
    || trace.format !== MVU_TURN_TRACE_FORMAT
    || trace.schemaVersion !== MVU_TURN_TRACE_VERSION
    || trace.kernelVersion !== MVU_TURN_KERNEL_VERSION
  ) {
    fail('E_TRACE_VERSION', '单回合 Trace 的格式或版本不受支持。');
  }
  validateJsonSafe(trace, '单回合 Trace');
  const allowedFields = new Set([
    'format', 'schemaVersion', 'kernelVersion', 'engine', 'sourceSignature', 'dialect',
    'schema', 'before', 'operation', 'patched', 'schemaDiff', 'after', 'diff', 'checks',
    'contract', 'traceId',
  ]);
  const unknownField = Object.keys(trace).find((field) => !allowedFields.has(field));
  if (unknownField) fail('E_TRACE_FIELD', `单回合 Trace 含未声明字段：${unknownField}。`);
  const replay = simulateMvuTurn({
    engine: trace.engine,
    stateKind: 'mvu',
    sourceSignature: trace.sourceSignature,
    currentSourceSignature: trace.sourceSignature,
    dialect: trace.dialect,
    before: trace.before,
    operationInput: trace.operation,
    contract: trace.contract,
  });
  for (const field of [
    'format', 'schemaVersion', 'kernelVersion', 'engine', 'sourceSignature', 'dialect',
    'before', 'operation', 'patched', 'schemaDiff', 'after', 'diff', 'checks', 'schema', 'contract',
  ]) {
    if (stableStringify(replay[field]) !== stableStringify(trace[field])) fail('E_TRACE_REPLAY', `Trace 复放的 ${field} 不一致。`);
  }
  if (replay.traceId !== trace.traceId) fail('E_TRACE_REPLAY', 'Trace 指纹与复放结果不一致。');
  return replay;
}

export function createEmptyMvuSimulationSession() {
  return {
    sourceLabel: '手动输入',
    sourceSignature: '',
    dialect: 'rfc6902',
    beforeText: '',
    operationText: '[]',
    contractText: '',
    result: null,
    error: null,
    stale: false,
    sourceMode: 'manual',
    sourceWarnings: [],
    runDraftSignature: '',
  };
}
