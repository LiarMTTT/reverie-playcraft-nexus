import { parseMvuVariableState } from './mvu-variable-structure.js?v=0721m3i2';
import { buildMvuSafeContract } from './mvu-turn-simulator.js?v=0721m3i2';
import { resolveCharacterBookPositionType } from './rolecard-file-codec.js?v=0721m3d1';

export const ROLECARD_EXPORT_PLAN_FORMAT = 'rpn-rolecard-export-plan';
export const ROLECARD_EXPORT_PLAN_VERSION = 1;

const MANAGED_DATA_FIELDS = new Set([
  'name',
  'description',
  'personality',
  'scenario',
  'system_prompt',
  'post_history_instructions',
  'first_mes',
  'mes_example',
  'creator_notes',
  'tags',
  'creator',
  'character_version',
  'alternate_greetings',
  'group_only_greetings',
  'character_book',
]);

const POISON_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const REVIEW_TEXT_FIELDS = [
  ['description', '角色描述'],
  ['personality', '性格'],
  ['scenario', '场景'],
  ['system_prompt', '系统提示词'],
  ['post_history_instructions', '历史后指令'],
  ['first_mes', '首条开场白'],
  ['mes_example', '对话示例'],
  ['creator_notes', '创作者注释'],
];

const REVIEW_GREETING_FIELDS = [
  ['alternate_greetings', '备选开场白'],
  ['group_only_greetings', '群聊开场白'],
];

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function jsonClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stablePrettyValue(value) {
  if (Array.isArray(value)) return value.map(stablePrettyValue);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stablePrettyValue(value[key])]));
  return value;
}

function reviewText(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(stablePrettyValue(value), null, 2);
  return serialized === undefined ? String(value) : serialized;
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const source = String(value ?? '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function equal(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function pointerSegment(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1');
}

function pointerFromSegments(segments) {
  return segments.length ? `/${segments.map(pointerSegment).join('/')}` : '/';
}

function reviewIdSegment(value) {
  const source = String(value ?? '');
  if (/^[A-Za-z0-9._-]+$/u.test(source)) return source;
  if (!source) return '%e';
  let encoded = '%u';
  for (let index = 0; index < source.length; index += 1) {
    encoded += source.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}

function summaryValue(value) {
  if (value === undefined) return '不存在';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 72 ? `${value.slice(0, 69)}…` : value || '空字符串';
  if (Array.isArray(value)) return `数组 · ${value.length} 项`;
  if (isRecord(value)) return `对象 · ${Object.keys(value).length} 项`;
  return String(value);
}

function item(id, path, label, detail = '') {
  return { id, path, label, detail };
}

function collectDiff(before, after, limit = 80) {
  const items = [];
  let truncated = false;
  const walk = (left, right, segments) => {
    if (equal(left, right)) return;
    if (items.length >= limit) {
      truncated = true;
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      keys.forEach((key) => walk(left[key], right[key], [...segments, key]));
      return;
    }
    const kind = left === undefined ? 'added' : right === undefined ? 'removed' : 'changed';
    items.push({
      path: pointerFromSegments(segments),
      kind,
      before: summaryValue(left),
      after: summaryValue(right),
    });
  };
  walk(before, after, []);
  return { items, truncated };
}

function cardData(card) {
  return isRecord(card?.data) ? card.data : (isRecord(card) ? card : {});
}

function ownValue(source, key) {
  return isRecord(source) && Object.hasOwn(source, key)
    ? { present: true, value: source[key] }
    : { present: false, value: undefined };
}

function addReviewItem(output, {
  id,
  label,
  path,
  kind,
  language = kind === 'text' ? 'text' : 'json',
  boundary,
  originalKnown,
  originalValue,
  originalPresent,
  currentValue,
  currentPresent,
}) {
  if (!originalPresent && !currentPresent) return;
  let change = 'current-only';
  if (originalKnown) {
    if (!originalPresent) change = 'added';
    else if (!currentPresent) change = 'removed';
    else change = equal(originalValue, currentValue) ? 'unchanged' : 'changed';
  }
  output.push({
    id,
    label,
    path,
    kind,
    change,
    original: reviewText(originalValue),
    current: reviewText(currentValue),
    language,
    boundary,
    originalStatus: originalKnown ? (originalPresent ? 'available' : 'absent') : 'missing',
  });
}

function worldbookUid(entry, fallback = '') {
  const value = entry?.id ?? entry?.uid;
  return value == null || value === '' ? String(fallback) : String(value);
}

function worldbookExplicitUid(entry) {
  const value = entry?.id ?? entry?.uid;
  return value == null || value === '' ? '' : String(value);
}

function worldbookName(entry, fallback = '未命名条目') {
  return String(entry?.comment ?? entry?.name ?? fallback).trim() || fallback;
}

function worldbookNameIsCode(name) {
  const normalized = String(name || '').trim();
  if (/^\[mvu_plot\]/iu.test(normalized)) return false;
  if (/^\[\s*(?:initvar|mvu_update|mvu_schema|schema|zod|update[_-]?variable|script|javascript|typescript|regex|html|css|ejs|变量更新规则|更新变量|输出格式)\s*\]/iu.test(normalized)) return true;
  if (/^(?:schema|zod|update[_-]?variable|(?:变量)?更新规则|更新变量|输出格式)(?:\s|$|[\[:：])/iu.test(normalized)) return true;
  return /\b(?:script|javascript|typescript|regex|html|css|ejs)\b/iu.test(normalized);
}

function worldbookReviewKind(...names) {
  return names.some(worldbookNameIsCode) ? 'code' : 'text';
}

function worldbookLanguage(names, kind) {
  if (kind === 'text') return 'text';
  const name = (Array.isArray(names) ? names : [names]).join(' ');
  if (/\binitvar\b/iu.test(name)) return 'json';
  if (/mvu_update|update[_-]?variable|更新规则|更新变量/iu.test(name)) return 'yaml';
  if (/zod|schema|typescript/iu.test(name)) return 'typescript';
  if (/regex/iu.test(name)) return 'regex';
  if (/html/iu.test(name)) return 'html';
  if (/css/iu.test(name)) return 'css';
  if (/ejs/iu.test(name)) return 'ejs';
  if (/script|javascript/iu.test(name)) return 'javascript';
  return 'text';
}

function worldbookStructure(entry) {
  if (!isRecord(entry)) return {};
  const extensions = isRecord(entry.extensions) ? entry.extensions : {};
  const pick = (...candidates) => {
    for (const [source, key] of candidates) {
      if (isRecord(source) && Object.hasOwn(source, key)) return source[key];
    }
    return undefined;
  };
  const output = {};
  const assign = (key, value) => { if (value !== undefined) output[key] = jsonClone(value); };
  assign('name', pick([entry, 'comment'], [entry, 'name']));
  const enabled = pick([entry, 'enabled']);
  const disabled = pick([entry, 'disable']);
  assign('enabled', enabled === undefined && disabled !== undefined ? !disabled : enabled);
  assign('constant', pick([entry, 'constant']));
  assign('selective', pick([entry, 'selective']));
  const sourcePosition = pick([entry, 'position']);
  const extensionPosition = pick([extensions, 'position']);
  assign('position', resolveCharacterBookPositionType(sourcePosition, extensionPosition));
  assign('order', pick([entry, 'insertion_order'], [entry, 'order']));
  assign('depth', pick([entry, 'depth'], [extensions, 'depth']));
  assign('probability', pick([entry, 'probability'], [extensions, 'probability']));
  assign('use_probability', pick([entry, 'use_probability'], [entry, 'useProbability'], [extensions, 'use_probability'], [extensions, 'useProbability']));
  assign('keys', pick([entry, 'keys'], [entry, 'key']));
  assign('secondary_keys', pick([entry, 'secondary_keys'], [entry, 'keysecondary'], [entry, 'secondaryKeys']));
  assign('selective_logic', pick([entry, 'selective_logic'], [entry, 'selectiveLogic'], [extensions, 'selectiveLogic'], [extensions, 'selective_logic']));
  assign('role', pick([entry, 'role'], [extensions, 'role']));
  assign('case_sensitive', pick([entry, 'case_sensitive'], [entry, 'caseSensitive'], [extensions, 'case_sensitive']));
  assign('match_whole_words', pick([entry, 'match_whole_words'], [entry, 'matchWholeWords'], [extensions, 'match_whole_words']));
  assign('prevent_incoming', pick([entry, 'exclude_recursion'], [entry, 'excludeRecursion'], [entry, 'preventIncoming'], [extensions, 'exclude_recursion']));
  assign('prevent_outgoing', pick([entry, 'prevent_recursion'], [entry, 'preventRecursion'], [entry, 'preventOutgoing'], [extensions, 'prevent_recursion']));
  assign('delay_until_recursion', pick([entry, 'delay_until_recursion'], [entry, 'delayUntilRecursion'], [extensions, 'delay_until_recursion']));
  return output;
}

function rawWorldbookIndex(entries) {
  const queues = { uid: new Map(), signature: new Map() };
  const signatureIndexes = new Map();
  const records = entries.map((entry, index) => ({
    entry,
    index,
    identity: `raw:${index}`,
    signature: stableStringify(entry),
  }));
  const enqueue = (map, key, record) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, { records: [], cursor: 0 });
    map.get(key).records.push(record);
  };
  records.forEach((record) => {
    enqueue(queues.uid, worldbookExplicitUid(record.entry), record);
    enqueue(queues.signature, record.signature, record);
    if (!signatureIndexes.has(record.signature)) signatureIndexes.set(record.signature, new Set());
    signatureIndexes.get(record.signature).add(String(record.index));
  });
  return { records, queues, signatureIndexes, consumed: new Set(), claimedPassthroughSignatures: new Set() };
}

function consumeRawRecord(index, queueName, key) {
  const queue = key ? index.queues[queueName].get(key) : null;
  while (queue && queue.cursor < queue.records.length) {
    const record = queue.records[queue.cursor++];
    if (index.consumed.has(record.identity)) continue;
    index.consumed.add(record.identity);
    return record;
  }
  return null;
}

function uniqueWorldbookReviewId(used, base, identity) {
  let value = base;
  let suffix = 1;
  while (used.has(value)) value = `${base}-${reviewIdSegment(identity)}-${suffix++}`;
  used.add(value);
  return value;
}

function worldbookIdentityPriority(rawIndex, currentEntry, passthroughRaw) {
  const currentUid = worldbookExplicitUid(currentEntry);
  if (!passthroughRaw) return currentUid ? 2 : 0;
  const sourceUid = worldbookExplicitUid(passthroughRaw);
  if (sourceUid && currentUid === sourceUid) return 2;
  const signature = stableStringify(passthroughRaw);
  return currentUid && rawIndex.signatureIndexes.get(signature)?.has(currentUid) === true ? 1 : 0;
}

function matchWorldbookRawRecord(rawIndex, currentEntry, passthroughRaw, allowPassthroughOnly) {
  if (!passthroughRaw) return consumeRawRecord(rawIndex, 'uid', worldbookExplicitUid(currentEntry));
  const signature = stableStringify(passthroughRaw);
  let rawMatch = consumeRawRecord(rawIndex, 'signature', signature);
  if (!rawMatch && !rawIndex.claimedPassthroughSignatures.has(signature)) {
    rawMatch = consumeRawRecord(rawIndex, 'uid', worldbookExplicitUid(passthroughRaw));
  }
  if (!rawMatch && allowPassthroughOnly && !rawIndex.claimedPassthroughSignatures.has(signature)) {
    rawMatch = { entry: passthroughRaw, index: -1, identity: `passthrough:${hashText(signature)}` };
  }
  if (rawMatch) rawIndex.claimedPassthroughSignatures.add(signature);
  return rawMatch;
}

function collectWorldbookReview({ rawData, candidateData, project, rawAvailable, text, code }) {
  const rawBook = isRecord(rawData.character_book) ? rawData.character_book : {};
  const candidateBook = isRecord(candidateData.character_book) ? candidateData.character_book : {};
  const rawEntries = Array.isArray(rawBook.entries) ? rawBook.entries : [];
  const candidateEntries = Array.isArray(candidateBook.entries) ? candidateBook.entries : [];
  const projectEntries = worldbookEntries(project);
  const rawIndex = rawWorldbookIndex(rawEntries);
  const allowPassthroughOnly = rawEntries.length === 0;
  const projectByUid = new Map();
  projectEntries.forEach((entry, index) => {
    const uid = worldbookUid(entry, `index:${index}`);
    if (!projectByUid.has(uid)) projectByUid.set(uid, { records: [], cursor: 0 });
    projectByUid.get(uid).records.push(entry);
  });
  const usedIds = new Set();

  const candidates = candidateEntries.map((currentEntry, index) => {
    const uid = worldbookUid(currentEntry, `index:${index}`);
    const projectQueue = projectByUid.get(uid);
    const projectEntry = projectQueue?.records[projectQueue.cursor++];
    const passthrough = isRecord(projectEntry?.meta?.studioPassthrough) ? projectEntry.meta.studioPassthrough : {};
    const passthroughRaw = isRecord(passthrough.raw) ? passthrough.raw : null;
    const identityPriority = worldbookIdentityPriority(rawIndex, currentEntry, passthroughRaw);
    return { currentEntry, index, uid, projectEntry, passthroughRaw, identityPriority, rawMatch: null };
  });
  const matchCandidate = (candidate) => {
    candidate.rawMatch = matchWorldbookRawRecord(rawIndex, candidate.currentEntry, candidate.passthroughRaw, allowPassthroughOnly);
  };
  [2, 1, 0].forEach((priority) => candidates.filter((candidate) => candidate.identityPriority === priority).forEach(matchCandidate));

  candidates.forEach(({ currentEntry, index, uid, projectEntry, passthroughRaw, rawMatch }) => {
    const originalEntry = rawMatch ? (passthroughRaw || rawMatch.entry) : null;
    const originalKnown = Boolean(originalEntry) || rawAvailable || (allowPassthroughOnly && Boolean(passthroughRaw));
    const name = worldbookName(currentEntry, worldbookName(projectEntry, worldbookName(originalEntry)));
    const originalName = worldbookName(originalEntry, worldbookName(projectEntry, name));
    const kind = worldbookReviewKind(name, originalName);
    const target = kind === 'code' ? code : text;
    addReviewItem(target, {
      id: uniqueWorldbookReviewId(usedIds, `worldbook-${kind}-${reviewIdSegment(uid)}`, `candidate:${index}`),
      label: `世界书 · ${name}`,
      path: `/data/character_book/entries/${index}/content`,
      kind,
      language: worldbookLanguage([name, originalName], kind),
      boundary: kind === 'code' ? 'worldbook-code' : 'worldbook-text',
      originalKnown,
      originalValue: originalEntry?.content,
      originalPresent: Boolean(originalEntry) && Object.hasOwn(originalEntry, 'content'),
      currentValue: currentEntry?.content,
      currentPresent: isRecord(currentEntry) && Object.hasOwn(currentEntry, 'content'),
    });
    addReviewItem(code, {
      id: uniqueWorldbookReviewId(usedIds, `worldbook-structure-${reviewIdSegment(uid)}`, `candidate:${index}`),
      label: `世界书结构 · ${name}`,
      path: `/data/character_book/entries/${index}`,
      kind: 'code',
      language: 'json',
      boundary: 'worldbook-structure',
      originalKnown,
      originalValue: worldbookStructure(originalEntry),
      originalPresent: Boolean(originalEntry),
      currentValue: worldbookStructure(currentEntry),
      currentPresent: isRecord(currentEntry),
    });
  });

  rawIndex.records.forEach(({ entry: originalEntry, index, identity }) => {
    if (rawIndex.consumed.has(identity)) return;
    const uid = worldbookUid(originalEntry, `index:${index}`);
    const name = worldbookName(originalEntry);
    const kind = worldbookReviewKind(name);
    addReviewItem(kind === 'code' ? code : text, {
      id: uniqueWorldbookReviewId(usedIds, `worldbook-${kind}-${reviewIdSegment(uid)}`, identity),
      label: `世界书 · ${name}`,
      path: `/data/character_book/entries/${index}/content`,
      kind,
      language: worldbookLanguage([name], kind),
      boundary: kind === 'code' ? 'worldbook-code' : 'worldbook-text',
      originalKnown: true,
      originalValue: originalEntry?.content,
      originalPresent: Object.hasOwn(originalEntry, 'content'),
      currentValue: undefined,
      currentPresent: false,
    });
    addReviewItem(code, {
      id: uniqueWorldbookReviewId(usedIds, `worldbook-structure-${reviewIdSegment(uid)}`, identity),
      label: `世界书结构 · ${name}`,
      path: `/data/character_book/entries/${index}`,
      kind: 'code',
      language: 'json',
      boundary: 'worldbook-structure',
      originalKnown: true,
      originalValue: worldbookStructure(originalEntry),
      originalPresent: true,
      currentValue: undefined,
      currentPresent: false,
    });
  });
}

function extensionLanguage(key) {
  if (/regex/iu.test(key)) return 'regex';
  if (/(?:script|javascript|\bjs\b)/iu.test(key)) return 'javascript';
  if (/(?:ui.?builder|mttt\.rolecard\.ui-builder)/iu.test(key)) return 'json';
  return 'json';
}

function collectExtensionReview({ rawData, candidateData, rawAvailable, code }) {
  [
    ['extensions', rawData.extensions, candidateData.extensions, '/data/extensions', '角色卡扩展'],
    ['book-extensions', rawData.character_book?.extensions, candidateData.character_book?.extensions, '/data/character_book/extensions', '世界书扩展'],
  ].forEach(([idPrefix, rawValue, currentValue, path, labelPrefix]) => {
    const rawExtensions = isRecord(rawValue) ? rawValue : {};
    const currentExtensions = isRecord(currentValue) ? currentValue : {};
    const keys = [...new Set([...Object.keys(rawExtensions), ...Object.keys(currentExtensions)])].sort();
    keys.forEach((key) => addReviewItem(code, {
      id: `${idPrefix}-${reviewIdSegment(key)}`,
      label: `${labelPrefix} · ${key}`,
      path: `${path}/${pointerSegment(key)}`,
      kind: 'code',
      language: extensionLanguage(key),
      boundary: 'opaque-extension',
      originalKnown: rawAvailable,
      originalValue: rawExtensions[key],
      originalPresent: Object.hasOwn(rawExtensions, key),
      currentValue: currentExtensions[key],
      currentPresent: Object.hasOwn(currentExtensions, key),
    }));
  });
}

function collectProjectSourceReview(project, code) {
  const sources = [
    ['project-initvar', '工作台 · [InitVar] 初始变量源稿', '/project/state/initialVariables', project?.state?.initialVariables, 'json'],
    ['project-update-rules', '工作台 · [mvu_update] 更新规则源稿', '/project/state/updateRules', project?.state?.updateRules, 'yaml'],
    ['project-schema', '工作台 · Schema / Zod 源稿', '/project/state/schema', project?.state?.schema, 'typescript'],
    ['project-output-format', '工作台 · 变量输出格式源稿', '/project/state/outputFormat', project?.state?.outputFormat, 'text'],
    ['project-ui-builder', '工作台 · UI Builder 设计源稿', '/project/frontend/builder/project', project?.frontend?.builder?.project, 'json'],
    ['project-ui-builder-tokens', '工作台 · UI Builder Token 源稿', '/project/frontend/builder/tokens', project?.frontend?.builder?.tokens, 'json'],
  ];
  sources.forEach(([id, label, path, value, language]) => {
    const present = typeof value === 'string' ? Boolean(value.trim()) : isRecord(value) && Object.keys(value).length > 0;
    if (!present) return;
    addReviewItem(code, {
      id,
      label,
      path,
      kind: 'code',
      language,
      boundary: 'project-source',
      originalKnown: false,
      originalValue: undefined,
      originalPresent: false,
      currentValue: value,
      currentPresent: true,
    });
  });
}

function collectReview(rawCard, candidateCard, project) {
  const fallbackRaw = isRecord(project?.entry?.source?.rawCard) ? project.entry.source.rawCard : {};
  const sourceRaw = isRecord(rawCard) && Object.keys(rawCard).length ? rawCard : fallbackRaw;
  const rawAvailable = isRecord(sourceRaw) && Object.keys(sourceRaw).length > 0;
  const rawData = cardData(sourceRaw);
  const candidateData = cardData(candidateCard);
  const text = [];
  const code = [];

  REVIEW_TEXT_FIELDS.forEach(([key, label]) => {
    const original = ownValue(rawData, key);
    const current = ownValue(candidateData, key);
    addReviewItem(text, {
      id: `card-text-${key}`,
      label,
      path: `/data/${pointerSegment(key)}`,
      kind: 'text',
      language: 'text',
      boundary: 'card-text',
      originalKnown: rawAvailable,
      originalValue: original.value,
      originalPresent: original.present,
      currentValue: current.value,
      currentPresent: current.present,
    });
  });

  REVIEW_GREETING_FIELDS.forEach(([key, label]) => {
    const original = ownValue(rawData, key);
    const current = ownValue(candidateData, key);
    const originals = Array.isArray(original.value) ? original.value : [];
    const currents = Array.isArray(current.value) ? current.value : [];
    const count = Math.max(originals.length, currents.length);
    for (let index = 0; index < count; index += 1) addReviewItem(text, {
      id: `card-text-${key}-${index}`,
      label: `${label} ${index + 1}`,
      path: `/data/${pointerSegment(key)}/${index}`,
      kind: 'text',
      language: 'text',
      boundary: 'card-text',
      originalKnown: rawAvailable,
      originalValue: originals[index],
      originalPresent: original.present && index < originals.length,
      currentValue: currents[index],
      currentPresent: current.present && index < currents.length,
    });
  });

  collectWorldbookReview({ rawData, candidateData, project, rawAvailable, text, code });
  collectExtensionReview({ rawData, candidateData, rawAvailable, code });
  collectProjectSourceReview(project, code);
  const limitations = [];
  if (!rawAvailable) limitations.push('未找到可用的导入原卡；候选内容只能标记为 current-only。');
  if ([...text, ...code].some((entry) => entry.boundary === 'project-source')) limitations.push('工作台源稿不伪造导入原文，仅以 current-only 证据展示。');
  const status = [...text, ...code].some((entry) => entry.originalStatus === 'missing') ? 'partial' : 'ready';
  const payload = { status, text, code, limitations, safety: { executesContent: false } };
  return { fingerprint: `fnv1a:${hashText(stableStringify(payload))}`, ...payload };
}

function collectIncluded(card) {
  const data = isRecord(card?.data) ? card.data : {};
  const output = [
    item('write-spec', '/spec', '角色卡规范', summaryValue(card?.spec)),
    item('write-spec-version', '/spec_version', '角色卡规范版本', summaryValue(card?.spec_version)),
  ];
  MANAGED_DATA_FIELDS.forEach((field) => {
    if (!Object.hasOwn(data, field)) return;
    output.push(item(`write-data-${field}`, `/data/${pointerSegment(field)}`, field === 'character_book' ? '内嵌世界书' : field, summaryValue(data[field])));
  });
  return output;
}

function collectPreserved(rawCard, candidateCard) {
  if (!isRecord(rawCard)) return [];
  const output = [];
  const preserve = (id, path, label, before, after) => {
    if (before !== undefined && equal(before, after)) output.push(item(id, path, label, summaryValue(before)));
  };
  Object.keys(rawCard).sort().forEach((key) => {
    if (key === 'spec' || key === 'spec_version' || key === 'data') return;
    preserve(`preserve-root-${key}`, `/${pointerSegment(key)}`, `原卡顶层字段 ${key}`, rawCard[key], candidateCard?.[key]);
  });
  const rawData = isRecord(rawCard.data) ? rawCard.data : {};
  const candidateData = isRecord(candidateCard?.data) ? candidateCard.data : {};
  Object.keys(rawData).sort().forEach((key) => {
    if (MANAGED_DATA_FIELDS.has(key) || key === 'extensions') return;
    preserve(`preserve-data-${key}`, `/data/${pointerSegment(key)}`, `原卡 data.${key}`, rawData[key], candidateData[key]);
  });
  const rawExtensions = isRecord(rawData.extensions) ? rawData.extensions : {};
  const candidateExtensions = isRecord(candidateData.extensions) ? candidateData.extensions : {};
  Object.keys(rawExtensions).sort().forEach((key) => {
    preserve(`preserve-extension-${key}`, `/data/extensions/${pointerSegment(key)}`, `原卡扩展 ${key}`, rawExtensions[key], candidateExtensions[key]);
  });
  const rawBook = isRecord(rawData.character_book) ? rawData.character_book : {};
  const candidateBook = isRecord(candidateData.character_book) ? candidateData.character_book : {};
  Object.keys(rawBook).sort().forEach((key) => {
    if (['name', 'description', 'entries', 'extensions'].includes(key)) return;
    preserve(`preserve-book-${key}`, `/data/character_book/${pointerSegment(key)}`, `世界书附加字段 ${key}`, rawBook[key], candidateBook[key]);
  });
  const rawBookExtensions = isRecord(rawBook.extensions) ? rawBook.extensions : {};
  const candidateBookExtensions = isRecord(candidateBook.extensions) ? candidateBook.extensions : {};
  Object.keys(rawBookExtensions).sort().forEach((key) => {
    preserve(`preserve-book-extension-${key}`, `/data/character_book/extensions/${pointerSegment(key)}`, `世界书扩展 ${key}`, rawBookExtensions[key], candidateBookExtensions[key]);
  });
  return output;
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isRecord(value)) return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function flattenVariables(value, segments = [], output = []) {
  if (segments.length) output.push({
    path: pointerFromSegments(segments),
    displayPath: `stat_data.${segments.map(String).join('.')}`,
    type: valueType(value),
    value: isRecord(value) || Array.isArray(value) ? undefined : value,
    usedBy: [],
  });
  if (Array.isArray(value)) value.forEach((child, index) => flattenVariables(child, [...segments, index], output));
  else if (isRecord(value)) Object.keys(value).sort().forEach((key) => flattenVariables(value[key], [...segments, key], output));
  return output;
}

function parseVariableSource(source) {
  if (!String(source || '').trim()) return null;
  try {
    return { parsed: parseMvuVariableState(source), error: null };
  } catch (error) {
    return { parsed: null, error: String(error?.message || error) };
  }
}

function semanticVariableSource(source) {
  const result = parseVariableSource(source);
  return result?.parsed ? stableStringify(result.parsed.data) : null;
}

function typeMatches(definition, expected) {
  if (!expected || expected === 'any') return true;
  if (expected === 'integer') return definition.type === 'number' && Number.isInteger(definition.value);
  if (expected === 'number') return definition.type === 'number' && Number.isFinite(definition.value);
  return definition.type === expected;
}

function wildcardMatch(rulePath, variablePath) {
  const rule = String(rulePath || '').split('/').slice(1);
  const variable = String(variablePath || '').split('/').slice(1);
  return rule.length === variable.length && rule.every((segment, index) => segment === '*' || segment === variable[index]);
}

function parseBindingPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (!raw) return { error: '绑定路径为空。' };
  let segments;
  let runtimePathMismatch = false;
  if (raw.startsWith('/')) {
    try {
      segments = raw.split('/').slice(1).map((segment) => {
        if (/~(?![01])/u.test(segment)) throw new Error('JSON Pointer 包含无效转义。');
        return segment.replace(/~1/g, '/').replace(/~0/g, '~');
      });
    } catch (error) {
      return { error: error.message };
    }
  } else {
    if (/[\[\]]/u.test(raw)) return { error: '当前预览运行时不支持方括号路径，请改用点路径或 JSON Pointer。' };
    segments = raw.split('.');
    if (segments.some((segment) => !segment)) return { error: '点路径包含空段。' };
    if (segments[0] === 'stat_data') {
      runtimePathMismatch = true;
      segments = segments.slice(1);
    }
  }
  if (!segments.length) return { error: '绑定路径没有指向具体变量。' };
  if (segments.some((segment) => POISON_SEGMENTS.has(segment))) return { error: '绑定路径包含禁止访问的危险字段。' };
  return { canonicalPath: pointerFromSegments(segments), runtimePathMismatch };
}

function worldbookEntries(project) {
  return Array.isArray(project?.worldbook?.entries) ? project.worldbook.entries : [];
}

function combinedUpdateRules(project, updateEntries) {
  const values = [project?.state?.updateRules, ...updateEntries.map((entry) => entry?.content)]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(values)].join('\n\n');
}

function collectVariableReferences(project, checkResult) {
  const issues = [];
  const blockers = [];
  const projectOnly = [];
  const entries = worldbookEntries(project);
  const initEntries = entries.filter((entry) => /^\[InitVar\]\s*/iu.test(String(entry?.name || '').trim()));
  const initSources = initEntries.filter((entry) => String(entry?.content || '').trim());
  const updateEntries = entries.filter((entry) => /^\[mvu_update\]\s*/iu.test(String(entry?.name || '').trim()));
  const enabledUpdateEntries = updateEntries.filter((entry) => entry?.enabled !== false && String(entry?.content || '').trim());
  const stateDraft = String(project?.state?.initialVariables || '').trim();
  const stateRules = String(project?.state?.updateRules || '').trim();
  const addIssue = (level, code, title, detail, path = '') => {
    const issue = { level, code, title, detail, path };
    issues.push(issue);
    if (level === 'blocker') blockers.push(item(`blocker-${code}-${blockers.length}`, path || '/', title, detail));
  };

  let source = null;
  let parsedSource = null;
  if (stateDraft) {
    source = { kind: 'project-draft', label: '工作台状态草稿' };
    parsedSource = parseVariableSource(stateDraft);
    const semanticDraft = semanticVariableSource(stateDraft);
    const matches = semanticDraft == null ? [] : initSources.filter((entry) => semanticVariableSource(entry.content) === semanticDraft);
    if (parsedSource?.error) addIssue('blocker', 'invalid-state-draft', '工作台初始变量无法解析', parsedSource.error, '/project/state/initialVariables');
    else if (!matches.length) {
      projectOnly.push(item('project-only-initial-variables', '/project/state/initialVariables', '初始变量源稿尚未装配', '当前角色卡世界书没有语义一致的 [InitVar]。'));
      addIssue('blocker', 'unbound-state-draft', '初始变量尚未装配进角色卡', '请先显式写入或绑定 [InitVar]；预检不会自动改世界书。', '/project/state/initialVariables');
    } else {
      source.representedBy = matches.map((entry) => String(entry.name || '[InitVar]'));
      if (initSources.length > 1) addIssue('unverified', 'multiple-initvar', '存在多条 [InitVar]', '工作台草稿已有匹配项，但真实插件链对多来源的处理仍需在 ST 中确认。');
    }
  } else if (initSources.length === 1) {
    source = { kind: 'worldbook', label: String(initSources[0].name || '[InitVar]') };
    parsedSource = parseVariableSource(initSources[0].content);
    if (parsedSource?.error) addIssue('blocker', 'invalid-initvar', '[InitVar] 无法解析', parsedSource.error, '/data/character_book/entries');
  } else if (initSources.length > 1) {
    source = { kind: 'ambiguous', label: `${initSources.length} 条 [InitVar]` };
    addIssue('blocker', 'ambiguous-initvar', '初始变量来源不唯一', '工作台没有指定状态草稿，且角色卡包含多条 [InitVar]。', '/data/character_book/entries');
  }

  if (stateRules) {
    const exactRuleMatch = enabledUpdateEntries.some((entry) => String(entry.content || '').trim() === stateRules);
    if (!exactRuleMatch) {
      projectOnly.push(item('project-only-update-rules', '/project/state/updateRules', '变量更新规则尚未装配', '当前角色卡世界书没有内容一致且启用的 [mvu_update]。'));
      addIssue('blocker', 'unbound-update-rules', '变量更新规则尚未装配进角色卡', '请先显式写入或绑定 [mvu_update]；预检不会自动改世界书。', '/project/state/updateRules');
    }
  }
  if (String(project?.state?.schema || '').trim()) {
    projectOnly.push(item('project-only-schema', '/project/state/schema', 'Schema / Zod 源稿', '仅保存在项目备份；预检不执行也不自动写入脚本。'));
    addIssue('unverified', 'schema-source-only', 'Schema / Zod 仅作为源稿记录', '未执行 default、strip、transform 或类型推断。', '/project/state/schema');
  }
  if (String(project?.state?.outputFormat || '').trim()) {
    projectOnly.push(item('project-only-output-format', '/project/state/outputFormat', '变量输出格式源稿', '仅保存在项目备份，尚未绑定到角色卡脚本或提示词。'));
  }

  const definitions = parsedSource?.parsed ? flattenVariables(parsedSource.parsed.data) : [];
  const ruleText = combinedUpdateRules(project, enabledUpdateEntries);
  let rules = [];
  if (ruleText) {
    try {
      rules = buildMvuSafeContract({ before: {}, updateRules: ruleText, schema: '', sourceSignature: '' }).fields;
      if (!rules.length) addIssue('unverified', 'rules-not-structured', '更新规则没有可证明的结构化字段', '自由文本、动态路径与原生命令不会被预检猜测。');
    } catch (error) {
      addIssue('unverified', 'rules-unparsed', '更新规则只能部分验证', String(error?.message || error));
    }
  }

  rules.forEach((rule) => {
    const matches = definitions.filter((definition) => wildcardMatch(rule.path, definition.path));
    if (!matches.length) {
      addIssue(rule.required ? 'blocker' : 'unverified', rule.required ? 'required-rule-path-missing' : 'rule-path-unverified', `规则路径 ${rule.path} 未在初始变量中找到`, rule.required ? '显式 required 路径缺失。' : '它可能在运行时由动态更新创建，当前不能判定为错误。', rule.path);
      return;
    }
    matches.forEach((definition) => {
      definition.usedBy.push(`rule:${rule.path}`);
      if (!typeMatches(definition, rule.type)) addIssue('blocker', 'rule-type-conflict', `变量 ${definition.path} 与规则类型冲突`, `初值是 ${definition.type}，规则要求 ${rule.type}。`, definition.path);
    });
  });

  const consumers = [];
  const inactiveConsumers = [];
  const nodes = Array.isArray(project?.frontend?.builder?.project?.nodes) ? project.frontend.builder.project.nodes : [];
  nodes.forEach((node) => {
    ['bindTextPath', 'bindVisiblePath'].forEach((field) => {
      const rawPath = String(node?.props?.[field] || '').trim();
      if (!rawPath) return;
      const consumer = {
        nodeId: String(node.id || ''),
        componentId: String(node.componentId || ''),
        kind: field === 'bindTextPath' ? 'text' : 'visible',
        rawPath,
        active: node.hidden !== true,
      };
      if (!consumer.active) {
        inactiveConsumers.push(consumer);
        return;
      }
      const parsed = parseBindingPath(rawPath);
      consumer.canonicalPath = parsed.canonicalPath || '';
      consumer.runtimePathMismatch = parsed.runtimePathMismatch === true;
      consumer.error = parsed.error || '';
      consumers.push(consumer);
      if (parsed.error) {
        addIssue('blocker', 'invalid-ui-binding', `UI 节点 ${consumer.nodeId || '未命名'} 的绑定路径无效`, parsed.error, rawPath);
        return;
      }
      const definition = definitions.find((candidate) => candidate.path === parsed.canonicalPath);
      if (definition) definition.usedBy.push(`ui:${consumer.nodeId}:${consumer.kind}`);
      else addIssue('unverified', 'ui-path-unverified', `UI 绑定 ${rawPath} 未在初始变量中找到`, '动态规则可能在运行时创建该路径，当前只标为待确认。', parsed.canonicalPath);
      if (parsed.runtimePathMismatch) addIssue('warning', 'runtime-path-mismatch', `UI 绑定 ${rawPath} 使用 stat_data 前缀`, '当前模拟包注入裸状态根；规范路径可对应，但现有预览运行时不会直接命中。', parsed.canonicalPath);
    });
  });

  const unused = definitions.filter((definition) => !definition.usedBy.length);
  if (unused.length) addIssue('unverified', 'unused-variables', `${unused.length} 个变量尚无可证明消费者`, '动态 EJS、世界书正文和组件依赖未被静态猜测，因此这里只表示“未验证”。');

  const workflowDocuments = Object.values(project?.workflowBlueprint?.documents || {}).filter(Boolean).length;
  const checkErrors = Number(checkResult?.counts?.error || 0);
  return {
    source,
    definitions,
    rules: jsonClone(rules),
    consumers,
    inactiveConsumers,
    issues,
    blockers,
    projectOnly,
    workflow: { documentCount: workflowDocuments, role: 'explanatory_only' },
    check: { errorCount: checkErrors, status: checkResult ? (checkErrors ? 'blocked' : 'checked') : 'pending' },
    summary: {
      definitions: definitions.length,
      rules: rules.length,
      consumers: consumers.length,
      inactiveConsumers: inactiveConsumers.length,
      unused: unused.length,
      issues: issues.length,
    },
  };
}

function collectProjectOnly(project, variableReferences) {
  const output = [...variableReferences.projectOnly];
  const selected = Array.isArray(project?.frontend?.selectedComponents) ? project.frontend.selectedComponents : [];
  if (selected.length) output.push(item('project-only-components', '/project/frontend/selectedComponents', '组件选型', `${selected.length} 个组件仅记录在项目中，M3-J 不伪造装配。`));
  const builder = project?.frontend?.builder?.project;
  if (isRecord(builder)) output.push(item('project-only-builder', '/project/frontend/builder/project', 'UI Builder 设计源稿', `${Array.isArray(builder.nodes) ? builder.nodes.length : 0} 个节点；是否已有独立前端产物需另验。`));
  const workflowDocuments = Object.values(project?.workflowBlueprint?.documents || {}).filter(Boolean);
  if (workflowDocuments.length) output.push(item('project-only-workflow', '/project/workflowBlueprint', '工作流蓝图', `${workflowDocuments.length} 份蓝图用于解释与检查，不作为角色卡写入源。`));
  if (project?.frontend?.simulationPreview?.packageId) output.push(item('project-only-simulation', '/project/frontend/simulationPreview', 'UI 变量模拟包引用', '模拟数据用于本地预览，不进入角色卡。'));
  return output;
}

export function createRolecardExportPlan({
  candidateCard,
  rawCard = {},
  project = {},
  checkResult = null,
  includeV2Backfill = true,
} = {}) {
  if (!isRecord(candidateCard)) throw new TypeError('candidateCard 必须是角色卡对象。');
  const card = jsonClone(candidateCard);
  const raw = isRecord(rawCard) ? jsonClone(rawCard) : {};
  const projectSnapshot = isRecord(project) ? jsonClone(project) : {};
  const included = collectIncluded(card);
  const preserved = collectPreserved(raw, card);
  const diff = collectDiff(raw, card);
  const normalized = diff.items
    .filter((entry) => entry.kind !== 'added')
    .map((entry, index) => item(`normalize-${index}`, entry.path, entry.kind === 'removed' ? '移除原卡路径' : '改变原卡路径', `${entry.before} → ${entry.after}`));
  const variableReferences = collectVariableReferences(projectSnapshot, checkResult);
  const projectOnly = collectProjectOnly(projectSnapshot, variableReferences);
  const review = collectReview(raw, card, projectSnapshot);
  const blockers = [...variableReferences.blockers];
  const checkErrors = Number(checkResult?.counts?.error || 0);
  const fingerprintPayload = {
    card,
    included,
    preserved,
    normalized,
    projectOnly,
    blockers,
    review: review.fingerprint,
    variables: {
      source: variableReferences.source,
      definitions: variableReferences.definitions,
      rules: variableReferences.rules,
      consumers: variableReferences.consumers,
      issues: variableReferences.issues,
    },
    includeV2Backfill: includeV2Backfill !== false,
  };
  return {
    format: ROLECARD_EXPORT_PLAN_FORMAT,
    schemaVersion: ROLECARD_EXPORT_PLAN_VERSION,
    status: blockers.length || checkErrors ? 'blocked' : 'ready',
    card,
    fingerprint: `fnv1a:${hashText(stableStringify(fingerprintPayload))}`,
    review,
    included,
    preserved,
    normalized,
    projectOnly,
    blockers,
    variableReferences,
    diff,
    compatibility: {
      includeV2Backfill: includeV2Backfill !== false,
      checkErrors,
    },
  };
}
