const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const POSITION_NUMBER_TO_CANONICAL = [
  'before_character_definition',
  'after_character_definition',
  'before_author_note',
  'after_author_note',
  'at_depth',
  'before_example_messages',
  'after_example_messages',
  'outlet',
];
const POSITION_ALIAS_TO_CANONICAL = {
  before_char: 'before_character_definition',
  after_char: 'after_character_definition',
  before_an: 'before_author_note',
  after_an: 'after_author_note',
  at_depth: 'at_depth',
  before_example: 'before_example_messages',
  after_example: 'after_example_messages',
  outlet: 'outlet',
};
const ROLECARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Expected ArrayBuffer or Uint8Array');
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function uint32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, false);
  return bytes;
}

function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;
  return bytes;
}

function asciiText(bytes) {
  let output = '';
  for (let index = 0; index < bytes.length; index += 1) output += String.fromCharCode(bytes[index]);
  return output;
}

export function crc32(value) {
  const bytes = asBytes(value);
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, dataValue) {
  const typeBytes = asciiBytes(type);
  const data = asBytes(dataValue);
  const checksum = crc32(concatBytes([typeBytes, data]));
  return concatBytes([uint32Bytes(data.length), typeBytes, data, uint32Bytes(checksum)]);
}

export function isPngBytes(value) {
  const bytes = asBytes(value);
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function readPngChunks(value, { verifyCrc = true } = {}) {
  const bytes = asBytes(value);
  if (!isPngBytes(bytes)) throw new Error('png-signature-mismatch');
  const chunks = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('png-truncated-chunk-header');
    const length = readUint32(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) throw new Error('png-truncated-chunk');
    const typeBytes = bytes.slice(typeOffset, dataOffset);
    const type = asciiText(typeBytes);
    const data = bytes.slice(dataOffset, dataEnd);
    const expectedCrc = readUint32(bytes, dataEnd);
    if (verifyCrc && crc32(concatBytes([typeBytes, data])) !== expectedCrc) throw new Error(`png-crc-mismatch:${type}`);
    chunks.push({ type, data, raw: bytes.slice(offset, chunkEnd) });
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  if (!chunks.some((chunk) => chunk.type === 'IEND')) throw new Error('png-iend-missing');
  return chunks;
}

export function bytesToBase64(value) {
  const bytes = asBytes(value);
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const hasB = index + 1 < bytes.length;
    const hasC = index + 2 < bytes.length;
    const b = hasB ? bytes[index + 1] : 0;
    const c = hasC ? bytes[index + 2] : 0;
    output += BASE64_ALPHABET[a >>> 2];
    output += BASE64_ALPHABET[((a & 0x03) << 4) | (b >>> 4)];
    output += hasB ? BASE64_ALPHABET[((b & 0x0f) << 2) | (c >>> 6)] : '=';
    output += hasC ? BASE64_ALPHABET[c & 0x3f] : '=';
  }
  return output;
}

export function base64ToBytes(value) {
  const source = String(value || '').replace(/\s+/g, '');
  if (!source || source.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(source) || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) {
    throw new Error('invalid-base64');
  }
  const outputLength = (source.length / 4) * 3 - (source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0);
  const output = new Uint8Array(outputLength);
  let cursor = 0;
  for (let index = 0; index < source.length; index += 4) {
    const a = BASE64_ALPHABET.indexOf(source[index]);
    const b = BASE64_ALPHABET.indexOf(source[index + 1]);
    const c = source[index + 2] === '=' ? 0 : BASE64_ALPHABET.indexOf(source[index + 2]);
    const d = source[index + 3] === '=' ? 0 : BASE64_ALPHABET.indexOf(source[index + 3]);
    const triple = (a << 18) | (b << 12) | (c << 6) | d;
    if (cursor < output.length) output[cursor++] = (triple >>> 16) & 0xff;
    if (cursor < output.length) output[cursor++] = (triple >>> 8) & 0xff;
    if (cursor < output.length) output[cursor++] = triple & 0xff;
  }
  return output;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function semanticJsonEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

export function canonicalPositionType(value, fallback = 'after_character_definition') {
  if (value && typeof value === 'object' && !Array.isArray(value)) return canonicalPositionType(value.type, fallback);
  if (typeof value === 'number' && Number.isInteger(value)) return POSITION_NUMBER_TO_CANONICAL[value] || fallback;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (POSITION_NUMBER_TO_CANONICAL.includes(normalized)) return normalized;
  return POSITION_ALIAS_TO_CANONICAL[normalized] || fallback;
}

export function resolveCharacterBookPositionType(sourcePosition, extensionPosition, fallback = 'after_character_definition') {
  const extensionType = canonicalPositionType(extensionPosition, '');
  const sourceType = canonicalPositionType(sourcePosition, '');
  return extensionType || sourceType || fallback;
}

export function isLikelyRolecardObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value;
  const spec = String(value.spec || data.spec || '').toLowerCase();
  if (spec.startsWith('chara_card_')) return true;
  const hasName = typeof data.name === 'string';
  const cardSignals = ROLECARD_FIELDS.filter((field) => field !== 'name' && Object.hasOwn(data, field)).length;
  const hasCardContainers = Object.hasOwn(data, 'character_book') || Object.hasOwn(data, 'alternate_greetings') || Object.hasOwn(data, 'extensions');
  return hasName && (cardSignals > 0 || hasCardContainers);
}

export function encodePngTextChunk(keyword, payloadText) {
  const encodedPayload = bytesToBase64(TEXT_ENCODER.encode(payloadText));
  return makeChunk('tEXt', concatBytes([asciiBytes(keyword), new Uint8Array([0]), asciiBytes(encodedPayload)]));
}

function decodeTextPayload(data) {
  const separator = data.indexOf(0);
  if (separator < 1) return null;
  const keyword = asciiText(data.slice(0, separator)).toLowerCase();
  if (keyword !== 'chara' && keyword !== 'ccv3') return null;
  const payloadBytes = base64ToBytes(asciiText(data.slice(separator + 1)));
  const text = TEXT_DECODER.decode(payloadBytes);
  let card;
  try {
    card = JSON.parse(text);
  } catch {
    throw new Error(`invalid-rolecard-json:${keyword}`);
  }
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error(`invalid-rolecard-object:${keyword}`);
  return { keyword, text, card };
}

export function decodeRolecardPng(value, options = {}) {
  const chunks = readPngChunks(value, options);
  const payloads = new Map();
  const payloadErrors = new Map();
  const seenKeywords = new Set();
  for (const chunk of chunks) {
    if (chunk.type !== 'tEXt') continue;
    const separator = chunk.data.indexOf(0);
    if (separator < 1) continue;
    const keyword = asciiText(chunk.data.slice(0, separator)).toLowerCase();
    if (keyword !== 'chara' && keyword !== 'ccv3') continue;
    if (seenKeywords.has(keyword)) throw new Error(`duplicate-rolecard-payload:${keyword}`);
    seenKeywords.add(keyword);
    try {
      const decoded = decodeTextPayload(chunk.data);
      if (decoded) payloads.set(decoded.keyword, decoded);
    } catch (error) {
      payloadErrors.set(keyword, error);
    }
  }
  const warnings = [];
  let selected = payloads.get('ccv3');
  if (selected) {
    if (payloadErrors.has('chara')) warnings.push('chara-invalid-ignored');
    else if (payloads.has('chara') && !semanticJsonEqual(payloads.get('chara').card, selected.card)) {
      const legacyCard = payloads.get('chara').card;
      const isExpectedBackfill = legacyCard?.spec === 'chara_card_v2' && selected.card?.spec === 'chara_card_v3';
      warnings.push(isExpectedBackfill ? 'chara-v2-backfill-present' : 'chara-differs-from-ccv3');
    }
  } else {
    selected = payloads.get('chara');
    if (selected && payloadErrors.has('ccv3')) warnings.push('ccv3-invalid-fell-back-to-chara');
  }
  if (!selected) {
    const error = payloadErrors.get('ccv3') || payloadErrors.get('chara');
    if (error) throw error;
    throw new Error('rolecard-payload-missing');
  }
  return {
    card: selected.card,
    selectedKeyword: selected.keyword,
    keywords: [...payloads.keys()],
    payloads,
    payloadErrors,
    warnings,
    chunks,
  };
}

export function embedRolecardPng(shellValue, card, { keywords = ['ccv3'], payloadByKeyword = {} } = {}) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('invalid-rolecard-object');
  const normalizedKeywords = [...new Set(keywords.map((keyword) => String(keyword).toLowerCase()))];
  if (!normalizedKeywords.length) throw new Error('rolecard-payload-required');
  if (normalizedKeywords.some((keyword) => keyword !== 'chara' && keyword !== 'ccv3')) throw new Error('unsupported-rolecard-payload');
  const chunks = readPngChunks(shellValue);
  const payloadChunks = normalizedKeywords.map((keyword) => {
    const payloadCard = payloadByKeyword[keyword] || card;
    if (!payloadCard || typeof payloadCard !== 'object' || Array.isArray(payloadCard)) throw new Error(`invalid-rolecard-object:${keyword}`);
    return encodePngTextChunk(keyword, JSON.stringify(payloadCard, null, keyword === 'chara' ? 2 : 0));
  });
  const output = [PNG_SIGNATURE];
  for (const chunk of chunks) {
    let keyword = '';
    if (chunk.type === 'tEXt') {
      const separator = chunk.data.indexOf(0);
      if (separator > 0) keyword = asciiText(chunk.data.slice(0, separator)).toLowerCase();
    }
    if (keyword === 'chara' || keyword === 'ccv3') continue;
    if (chunk.type === 'IEND') output.push(...payloadChunks);
    output.push(chunk.raw);
  }
  return concatBytes(output);
}

export function parseRolecardJson(text) {
  let card;
  try {
    card = JSON.parse(String(text));
  } catch {
    throw new Error('invalid-rolecard-json');
  }
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('invalid-rolecard-object');
  return card;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

const V2_BACKFILL_WARNING = 'Compatibility notice: this chara payload was backfilled from Character Card V3. Use a ccv3-compatible application for the complete card.';

function withoutV3Decorators(value) {
  return String(value || '')
    .split(/\r?\n/)
    .filter((line) => !/^@@@?[a-z_]+(?:\s.*)?$/i.test(line.trim()))
    .join('\n')
    .replace(/^\n+/, '');
}

function backfillCharacterBookV2(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = cloneJson(value);
  const output = {
    extensions: source.extensions && typeof source.extensions === 'object' && !Array.isArray(source.extensions) ? source.extensions : {},
    entries: Array.isArray(source.entries) ? source.entries.map((entry, index) => {
      const item = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
      const result = {
        keys: Array.isArray(item.keys) ? item.keys.map(String) : [],
        content: withoutV3Decorators(item.content),
        extensions: item.extensions && typeof item.extensions === 'object' && !Array.isArray(item.extensions) ? item.extensions : {},
        enabled: item.enabled !== false,
        insertion_order: Number.isFinite(Number(item.insertion_order)) ? Number(item.insertion_order) : index,
      };
      if (typeof item.case_sensitive === 'boolean') result.case_sensitive = item.case_sensitive;
      if (typeof item.name === 'string') result.name = item.name;
      if (Number.isFinite(Number(item.priority))) result.priority = Number(item.priority);
      if (typeof item.id === 'number' && Number.isFinite(item.id)) result.id = item.id;
      if (typeof item.comment === 'string') result.comment = item.comment;
      if (typeof item.selective === 'boolean') result.selective = item.selective;
      if (Array.isArray(item.secondary_keys)) result.secondary_keys = item.secondary_keys.map(String);
      if (typeof item.constant === 'boolean') result.constant = item.constant;
      result.position = canonicalPositionType(item.position) === 'before_character_definition' ? 'before_char' : 'after_char';
      return result;
    }) : [],
  };
  if (typeof source.name === 'string') output.name = source.name;
  if (typeof source.description === 'string') output.description = source.description;
  if (Number.isFinite(Number(source.scan_depth))) output.scan_depth = Number(source.scan_depth);
  if (Number.isFinite(Number(source.token_budget))) output.token_budget = Number(source.token_budget);
  if (typeof source.recursive_scanning === 'boolean') output.recursive_scanning = source.recursive_scanning;
  return output;
}

export function backfillRolecardV2(card) {
  const source = rolecardData(card);
  const creatorNotes = String(source.creator_notes || '').trim();
  const data = {
    name: String(source.name || ''),
    description: String(source.description || ''),
    personality: String(source.personality || ''),
    scenario: String(source.scenario || ''),
    first_mes: String(source.first_mes || ''),
    mes_example: String(source.mes_example || ''),
    creator_notes: creatorNotes ? `${creatorNotes}\n\n${V2_BACKFILL_WARNING}` : V2_BACKFILL_WARNING,
    system_prompt: String(source.system_prompt || ''),
    post_history_instructions: String(source.post_history_instructions || ''),
    alternate_greetings: Array.isArray(source.alternate_greetings) ? source.alternate_greetings.map(String) : [],
    tags: Array.isArray(source.tags) ? source.tags.map(String) : [],
    creator: String(source.creator || ''),
    character_version: String(source.character_version || ''),
    extensions: source.extensions && typeof source.extensions === 'object' && !Array.isArray(source.extensions) ? cloneJson(source.extensions) : {},
  };
  const characterBook = backfillCharacterBookV2(source.character_book);
  if (characterBook) data.character_book = characterBook;
  return { spec: 'chara_card_v2', spec_version: '2.0', data };
}

export function mergeRolecardData(rawCard, patch = {}) {
  const clonedRaw = cloneJson(rawCard);
  const raw = clonedRaw && typeof clonedRaw === 'object' && !Array.isArray(clonedRaw) ? clonedRaw : {};
  const hadData = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data);
  const sourceData = hadData ? raw.data : raw;
  const data = {
    name: '',
    description: '',
    tags: [],
    creator: '',
    character_version: '',
    mes_example: '',
    extensions: {},
    system_prompt: '',
    post_history_instructions: '',
    first_mes: '',
    alternate_greetings: [],
    personality: '',
    scenario: '',
    creator_notes: '',
    group_only_greetings: [],
    ...cloneJson(sourceData),
    ...cloneJson(patch.fields || {}),
  };
  if (!data.extensions || typeof data.extensions !== 'object' || Array.isArray(data.extensions)) data.extensions = {};
  if (!Array.isArray(data.tags)) data.tags = [];
  if (!Array.isArray(data.alternate_greetings)) data.alternate_greetings = [];
  if (!Array.isArray(data.group_only_greetings)) data.group_only_greetings = [];
  if (patch.characterBook) data.character_book = cloneJson(patch.characterBook);
  const output = hadData ? raw : { ...raw };
  output.spec = 'chara_card_v3';
  output.spec_version = '3.0';
  output.data = data;
  const mirroredFields = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example', 'tags'];
  for (const field of mirroredFields) output[field] = cloneJson(data[field]);
  output.creatorcomment = String(data.creator_notes || output.creatorcomment || '');
  return output;
}

export function rolecardData(card) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('invalid-rolecard-object');
  const data = card.data && typeof card.data === 'object' && !Array.isArray(card.data) ? card.data : card;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('invalid-rolecard-data');
  return data;
}

const REGEX_EXTENSION_PATHS = ['regex_scripts', 'regexScripts'];
const TAVERN_HELPER_EXTENSION_PATHS = [
  'tavern_helper.scripts',
  'tavernHelper.scripts',
  'TavernHelper.scripts',
  'tavern_helper_scripts',
];

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extensionArrayAtPath(extensions, path) {
  const [containerKey, childKey] = path.split('.');
  const value = childKey ? extensions?.[containerKey]?.[childKey] : extensions?.[containerKey];
  return Array.isArray(value) ? value : null;
}

function extensionArraysAtPaths(extensions, paths) {
  return paths.flatMap((path) => {
    const items = extensionArrayAtPath(extensions, path);
    return items ? [{ items: cloneJson(items), path }] : [];
  });
}

function firstExtensionArray(extensions, paths) {
  const matches = extensionArraysAtPaths(extensions, paths);
  return {
    items: matches[0]?.items || [],
    path: matches[0]?.path || '',
    paths: matches.map((match) => match.path),
  };
}

function writeExtensionArray(extensions, path, items) {
  const [containerKey, childKey] = path.split('.');
  if (!childKey) {
    extensions[containerKey] = cloneJson(items);
    return;
  }
  const existing = isPlainRecord(extensions[containerKey]) ? extensions[containerKey] : {};
  extensions[containerKey] = { ...existing, [childKey]: cloneJson(items) };
}

export function extractRolecardExtensionAssets(card) {
  const data = rolecardData(card);
  const extensions = isPlainRecord(data.extensions) ? data.extensions : {};
  const regex = firstExtensionArray(extensions, REGEX_EXTENSION_PATHS);
  const tavernHelper = firstExtensionArray(extensions, TAVERN_HELPER_EXTENSION_PATHS);
  return {
    regexScripts: regex.items,
    tavernHelperScripts: tavernHelper.items,
    regexManaged: Boolean(regex.path),
    tavernHelperManaged: Boolean(tavernHelper.path),
    regexSourcePath: regex.path,
    tavernHelperSourcePath: tavernHelper.path,
    regexSourcePaths: regex.paths,
    tavernHelperSourcePaths: tavernHelper.paths,
    regexAmbiguous: regex.paths.length > 1,
    tavernHelperAmbiguous: tavernHelper.paths.length > 1,
  };
}

export function applyRolecardExtensionAssets(card, assets = {}) {
  const output = cloneJson(card);
  const data = rolecardData(output);
  data.extensions = isPlainRecord(data.extensions) ? data.extensions : {};
  if (assets.regexManaged) {
    writeExtensionArray(
      data.extensions,
      REGEX_EXTENSION_PATHS.includes(assets.regexSourcePath) ? assets.regexSourcePath : REGEX_EXTENSION_PATHS[0],
      Array.isArray(assets.regexScripts) ? assets.regexScripts : [],
    );
  }
  if (assets.tavernHelperManaged) {
    writeExtensionArray(
      data.extensions,
      TAVERN_HELPER_EXTENSION_PATHS.includes(assets.tavernHelperSourcePath)
        ? assets.tavernHelperSourcePath
        : TAVERN_HELPER_EXTENSION_PATHS[0],
      Array.isArray(assets.tavernHelperScripts) ? assets.tavernHelperScripts : [],
    );
  }
  return output;
}

function validateTavernHelperAsset(item, path, depth = 0, budget = { nodes: 0 }) {
  if (depth > 64 || ++budget.nodes > 10_000) throw new Error(`tavern-helper-asset-${path}-script-tree-limit`);
  if (!isPlainRecord(item)) throw new Error(`tavern-helper-asset-${path}-must-be-object`);
  const type = String(item.type || (Object.hasOwn(item, 'content') ? 'script' : '')).toLowerCase();
  if (type === 'script' && typeof item.content === 'string') return;
  if (type === 'folder' && Array.isArray(item.scripts)) {
    item.scripts.forEach((child, childIndex) => validateTavernHelperAsset(child, `${path}.scripts[${childIndex}]`, depth + 1, budget));
    return;
  }
  throw new Error(`tavern-helper-asset-${path}-invalid-script-tree`);
}

function validateExtensionAsset(item, kind, index, budget) {
  if (!isPlainRecord(item)) throw new Error(`${kind}-asset-${index}-must-be-object`);
  if (kind === 'regex') {
    if (typeof item.findRegex !== 'string') throw new Error(`regex-asset-${index}-missing-findRegex`);
    return;
  }
  validateTavernHelperAsset(item, index, 0, budget);
}

function extensionItemsFromRolecardPayload(payload, kind) {
  const hasExtensions = isPlainRecord(payload?.data?.extensions) || isPlainRecord(payload?.extensions);
  if (!isLikelyRolecardObject(payload) && !hasExtensions) return null;
  const extracted = extractRolecardExtensionAssets(payload);
  const sourcePaths = kind === 'regex' ? extracted.regexSourcePaths : extracted.tavernHelperSourcePaths;
  if (sourcePaths.length > 1) {
    throw new Error(`${kind}-asset-containers-ambiguous:${sourcePaths.join(',')}`);
  }
  return kind === 'regex' ? extracted.regexScripts : extracted.tavernHelperScripts;
}

export function parseRolecardExtensionAssetPayload(payload, kind) {
  if (!['regex', 'tavern-helper'].includes(kind)) throw new Error('unsupported-extension-asset-kind');
  let items = extensionItemsFromRolecardPayload(payload, kind);
  if (!items) {
    if (Array.isArray(payload)) items = payload;
    else if (kind === 'regex' && Array.isArray(payload?.regex_scripts)) items = payload.regex_scripts;
    else if (kind === 'regex' && Array.isArray(payload?.regexScripts)) items = payload.regexScripts;
    else if (kind === 'tavern-helper' && isPlainRecord(payload) && String(payload.type || '').toLowerCase() === 'folder') items = [payload];
    else if (kind === 'tavern-helper' && Array.isArray(payload?.scripts)) items = payload.scripts;
    else items = [payload];
  }
  if (!items.length) throw new Error(`${kind}-asset-list-empty`);
  const budget = { nodes: 0 };
  items.forEach((item, index) => validateExtensionAsset(item, kind, index, budget));
  return cloneJson(items);
}

function extensionAssetId(item) {
  return item?.id == null ? '' : String(item.id).trim();
}

export function mergeRolecardExtensionAssetItems(currentItems, incomingItems, { replaceConflicts = false } = {}) {
  const items = cloneJson(Array.isArray(currentItems) ? currentItems : []);
  const incoming = cloneJson(Array.isArray(incomingItems) ? incomingItems : []);
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  const conflicts = [];
  incoming.forEach((item) => {
    if (items.some((existing) => semanticJsonEqual(existing, item))) {
      skipped += 1;
      return;
    }
    const id = extensionAssetId(item);
    const conflictIndex = id ? items.findIndex((existing) => extensionAssetId(existing) === id) : -1;
    if (conflictIndex >= 0) {
      if (replaceConflicts) {
        items.splice(conflictIndex, 1, item);
        replaced += 1;
      } else {
        conflicts.push({ id, incoming: item, existing: items[conflictIndex] });
      }
      return;
    }
    items.push(item);
    added += 1;
  });
  return { items, added, replaced, skipped, conflicts };
}
