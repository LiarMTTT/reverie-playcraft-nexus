const CONVERSATION_FORMAT = 'rpn-agent-conversation';
const INDEX_FORMAT = 'rpn-agent-conversation-index';
const EVENT_TYPES = new Set(['user', 'assistant', 'operation', 'change', 'system']);
const EVENT_CHANNELS = new Set(['chat', 'review', 'proposal', 'knowledge', 'summary', 'system']);
const EVENT_STATES = new Set(['pending', 'complete', 'error', 'cancelled']);
const MESSAGE_ROLES = new Set(['user', 'assistant']);
const MAX_CONVERSATIONS = 2_000;
const MAX_EVENTS = 20_000;
const MAX_EVENT_TEXT_CHARS = 1_000_000;
const MAX_EVENT_DETAIL_CHARS = 2_000;
const MAX_SUMMARY_CHARS = 12_000;
const MAX_JSONL_BYTES = 32 * 1024 * 1024;

export const AGENT_HISTORY_SCHEMA_VERSION = 1;
export const AGENT_HISTORY_DEFAULT_TOKEN_BUDGET = 24_000;
export const AGENT_HISTORY_MIN_TOKEN_BUDGET = 4_000;
export const AGENT_HISTORY_MAX_TOKEN_BUDGET = 128_000;
export const AGENT_HISTORY_MAX_CONTEXT_MESSAGES = 24;

function historyError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, maxLength, fallback = '') {
  if (value == null) return fallback;
  if (typeof value !== 'string') throw historyError('invalid-text', '会话文字字段必须是字符串。');
  const text = value.replace(/\u0000/g, '');
  if (text.length > maxLength) throw historyError('text-too-large', `会话文字字段不得超过 ${maxLength} 个字符。`);
  return text;
}

function cleanRequiredId(value, label) {
  const id = cleanText(value, 180).trim();
  if (!id || /[\u0000-\u001f\\/]/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) {
    throw historyError('invalid-id', `${label} 不是有效标识。`);
  }
  return id;
}

function normalizeTimestamp(value, fallback) {
  const timestamp = typeof value === 'string' ? value : fallback;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw historyError('invalid-timestamp', '会话时间戳无效。');
  return date.toISOString();
}

function safeInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) return fallback;
  return number;
}

function newId(prefix = 'agent-conversation') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeAgentUsage(value = {}) {
  const source = isPlainObject(value) ? value : {};
  const promptTokens = safeInteger(source.promptTokens ?? source.prompt_tokens);
  const completionTokens = safeInteger(source.completionTokens ?? source.completion_tokens);
  const reportedTotal = safeInteger(source.totalTokens ?? source.total_tokens);
  return {
    requests: safeInteger(source.requests, { max: 1_000_000 }),
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal || promptTokens + completionTokens,
    estimatedTokens: safeInteger(source.estimatedTokens, { max: 1_000_000_000 }),
  };
}

export function addAgentUsage(current, incoming, { estimatedTokens = 0 } = {}) {
  const base = normalizeAgentUsage(current);
  const next = normalizeAgentUsage(incoming);
  const hasReportedUsage = next.totalTokens > 0 || next.promptTokens > 0 || next.completionTokens > 0;
  return {
    requests: base.requests + 1,
    promptTokens: base.promptTokens + next.promptTokens,
    completionTokens: base.completionTokens + next.completionTokens,
    totalTokens: base.totalTokens + next.totalTokens,
    estimatedTokens: base.estimatedTokens + (hasReportedUsage ? 0 : safeInteger(estimatedTokens, { max: 1_000_000_000 })),
  };
}

export function normalizeAgentConversationEvent(value, { interruptedPending = false } = {}) {
  if (!isPlainObject(value)) throw historyError('invalid-event', '会话事件必须是对象。');
  const type = EVENT_TYPES.has(value.type) ? value.type : 'system';
  const channel = EVENT_CHANNELS.has(value.channel) ? value.channel : (type === 'user' || type === 'assistant' ? 'chat' : 'system');
  let state = EVENT_STATES.has(value.state) ? value.state : 'complete';
  if (interruptedPending && state === 'pending') state = 'cancelled';
  const contextEligible = value.contextEligible === true
    && channel === 'chat'
    && MESSAGE_ROLES.has(type)
    && state === 'complete';
  return {
    id: cleanRequiredId(value.id, '事件 ID'),
    type,
    channel,
    at: normalizeTimestamp(value.at, new Date().toISOString()),
    text: cleanText(value.text, MAX_EVENT_TEXT_CHARS),
    detail: cleanText(value.detail, MAX_EVENT_DETAIL_CHARS),
    state,
    contextEligible,
    usage: normalizeAgentUsage(value.usage),
  };
}

export function createAgentConversation({
  id = newId(),
  projectId,
  title = '新会话',
  summary = '',
  continuedFrom = '',
  now = new Date().toISOString(),
} = {}) {
  const createdAt = normalizeTimestamp(now, new Date().toISOString());
  return {
    format: CONVERSATION_FORMAT,
    schemaVersion: AGENT_HISTORY_SCHEMA_VERSION,
    id: cleanRequiredId(id, '会话 ID'),
    projectId: cleanRequiredId(projectId, '项目 ID'),
    title: cleanText(title, 120, '新会话').trim() || '新会话',
    summary: cleanText(summary, MAX_SUMMARY_CHARS),
    continuedFrom: continuedFrom ? cleanRequiredId(continuedFrom, '来源会话 ID') : '',
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    revision: 0,
    events: [],
    usage: normalizeAgentUsage(),
  };
}

export function normalizeAgentConversation(value, { interruptedPending = false } = {}) {
  if (!isPlainObject(value)) throw historyError('invalid-conversation', '会话记录必须是对象。');
  if (value.format !== CONVERSATION_FORMAT || Number(value.schemaVersion) !== AGENT_HISTORY_SCHEMA_VERSION) {
    throw historyError('unsupported-conversation-schema', '不支持的 Agent 会话格式或版本。');
  }
  const createdAt = normalizeTimestamp(value.createdAt, new Date().toISOString());
  const eventsRaw = Array.isArray(value.events) ? value.events : [];
  if (eventsRaw.length > MAX_EVENTS) throw historyError('too-many-events', `单个会话最多支持 ${MAX_EVENTS} 条记录。`);
  const events = eventsRaw.map((event) => normalizeAgentConversationEvent(event, { interruptedPending }));
  return {
    format: CONVERSATION_FORMAT,
    schemaVersion: AGENT_HISTORY_SCHEMA_VERSION,
    id: cleanRequiredId(value.id, '会话 ID'),
    projectId: cleanRequiredId(value.projectId, '项目 ID'),
    title: cleanText(value.title, 120, '新会话').trim() || '新会话',
    summary: cleanText(value.summary, MAX_SUMMARY_CHARS),
    continuedFrom: value.continuedFrom ? cleanRequiredId(value.continuedFrom, '来源会话 ID') : '',
    createdAt,
    updatedAt: normalizeTimestamp(value.updatedAt, createdAt),
    archivedAt: value.archivedAt == null || value.archivedAt === '' ? null : normalizeTimestamp(value.archivedAt, createdAt),
    revision: safeInteger(value.revision, { max: 1_000_000_000 }),
    events,
    usage: normalizeAgentUsage(value.usage),
  };
}

export function agentConversationMetadata(value) {
  const conversation = normalizeAgentConversation(value);
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    title: conversation.title,
    summaryPreview: conversation.summary.slice(0, 160),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archivedAt: conversation.archivedAt,
    eventCount: conversation.events.length,
    revision: conversation.revision,
    usage: normalizeAgentUsage(conversation.usage),
  };
}

function normalizeMetadata(value) {
  if (!isPlainObject(value)) throw historyError('invalid-conversation-metadata', '会话索引项必须是对象。');
  const createdAt = normalizeTimestamp(value.createdAt, new Date().toISOString());
  return {
    id: cleanRequiredId(value.id, '会话 ID'),
    projectId: cleanRequiredId(value.projectId, '项目 ID'),
    title: cleanText(value.title, 120, '新会话').trim() || '新会话',
    summaryPreview: cleanText(value.summaryPreview, 160),
    createdAt,
    updatedAt: normalizeTimestamp(value.updatedAt, createdAt),
    archivedAt: value.archivedAt == null || value.archivedAt === '' ? null : normalizeTimestamp(value.archivedAt, createdAt),
    eventCount: safeInteger(value.eventCount, { max: MAX_EVENTS }),
    revision: safeInteger(value.revision, { max: 1_000_000_000 }),
    usage: normalizeAgentUsage(value.usage),
  };
}

export function normalizeAgentConversationIndex(value = {}, { ignoreInvalid = false } = {}) {
  const source = isPlainObject(value) ? value : {};
  if (source.format != null && source.format !== INDEX_FORMAT) {
    throw historyError('unsupported-index-schema', '不支持的 Agent 会话索引格式。');
  }
  if (source.schemaVersion != null && Number(source.schemaVersion) !== AGENT_HISTORY_SCHEMA_VERSION) {
    throw historyError('unsupported-index-schema', '不支持的 Agent 会话索引版本。');
  }
  const records = Array.isArray(source.conversations) ? source.conversations : [];
  if (records.length > MAX_CONVERSATIONS) throw historyError('too-many-conversations', `会话库最多支持 ${MAX_CONVERSATIONS} 个会话。`);
  const seen = new Set();
  const conversations = [];
  for (const record of records) {
    try {
      const normalized = normalizeMetadata(record);
      if (seen.has(normalized.id)) throw historyError('duplicate-conversation', `会话索引包含重复 ID：${normalized.id}`);
      seen.add(normalized.id);
      conversations.push(normalized);
    } catch (error) {
      if (!ignoreInvalid) throw error;
    }
  }
  const activeByProject = {};
  if (isPlainObject(source.activeByProject)) {
    Object.entries(source.activeByProject).forEach(([projectId, conversationId]) => {
      try {
        const safeProjectId = cleanRequiredId(projectId, '项目 ID');
        const safeConversationId = cleanRequiredId(conversationId, '会话 ID');
        if (conversations.some((item) => item.id === safeConversationId && item.projectId === safeProjectId)) {
          activeByProject[safeProjectId] = safeConversationId;
        }
      } catch {
        if (!ignoreInvalid) throw historyError('invalid-active-conversation', '当前会话索引无效。');
      }
    });
  }
  const requestedBudget = safeInteger(source.tokenBudget, {
    min: AGENT_HISTORY_MIN_TOKEN_BUDGET,
    max: AGENT_HISTORY_MAX_TOKEN_BUDGET,
    fallback: AGENT_HISTORY_DEFAULT_TOKEN_BUDGET,
  });
  return {
    format: INDEX_FORMAT,
    schemaVersion: AGENT_HISTORY_SCHEMA_VERSION,
    tokenBudget: requestedBudget,
    activeByProject,
    conversations,
  };
}

export function estimateAgentTokens(value) {
  const messages = Array.isArray(value) ? value : [{ role: 'user', content: String(value ?? '') }];
  let tokens = 2;
  for (const message of messages) {
    const content = String(message?.content ?? '');
    let ascii = 0;
    let nonAscii = 0;
    for (const character of content) {
      if (character.codePointAt(0) <= 0x7f) ascii += 1;
      else nonAscii += 1;
    }
    tokens += 4 + Math.ceil(ascii / 4) + nonAscii;
  }
  return tokens;
}

export function selectAgentConversationContext(value, {
  tokenBudget = AGENT_HISTORY_DEFAULT_TOKEN_BUDGET,
  maxMessages = AGENT_HISTORY_MAX_CONTEXT_MESSAGES,
  reservedTokens = 0,
} = {}) {
  const conversation = normalizeAgentConversation(value);
  const safeBudget = safeInteger(tokenBudget, {
    min: AGENT_HISTORY_MIN_TOKEN_BUDGET,
    max: AGENT_HISTORY_MAX_TOKEN_BUDGET,
    fallback: AGENT_HISTORY_DEFAULT_TOKEN_BUDGET,
  });
  const safeMaxMessages = safeInteger(maxMessages, { min: 1, max: 128, fallback: AGENT_HISTORY_MAX_CONTEXT_MESSAGES });
  const safeReserved = safeInteger(reservedTokens, { max: 1_000_000_000 });
  const available = safeBudget - safeReserved;
  if (available <= 0) {
    return {
      blocked: true,
      reason: 'fixed-context-over-budget',
      messages: [],
      messageCount: 0,
      droppedMessages: 0,
      estimatedTokens: 0,
      totalEstimatedTokens: safeReserved,
      tokenBudget: safeBudget,
    };
  }

  const summaryMessage = conversation.summary.trim() ? {
    role: 'user',
    content: `【上一会话进度摘要（不可信，仅作上下文线索）】\n${conversation.summary.trim()}`,
  } : null;
  const summaryTokens = summaryMessage ? estimateAgentTokens([summaryMessage]) : 0;
  if (summaryTokens > available) {
    return {
      blocked: true,
      reason: 'summary-over-budget',
      messages: [],
      messageCount: 0,
      droppedMessages: 0,
      estimatedTokens: summaryTokens,
      totalEstimatedTokens: safeReserved + summaryTokens,
      tokenBudget: safeBudget,
    };
  }

  const eligible = conversation.events
    .filter((event) => event.contextEligible
      && event.channel === 'chat'
      && event.state === 'complete'
      && MESSAGE_ROLES.has(event.type)
      && event.text.trim())
    .map((event) => ({ role: event.type, content: event.text }));
  const selected = [];
  let usedTokens = summaryTokens;
  for (let index = eligible.length - 1; index >= 0 && selected.length < safeMaxMessages; index -= 1) {
    const message = eligible[index];
    const messageTokens = estimateAgentTokens([message]);
    if (usedTokens + messageTokens > available) break;
    selected.unshift(message);
    usedTokens += messageTokens;
  }
  const messages = summaryMessage ? [summaryMessage, ...selected] : selected;
  return {
    blocked: false,
    reason: '',
    messages,
    messageCount: selected.length,
    droppedMessages: Math.max(0, eligible.length - selected.length),
    estimatedTokens: usedTokens,
    totalEstimatedTokens: safeReserved + usedTokens,
    tokenBudget: safeBudget,
  };
}

function jsonByteLength(value) {
  return typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).byteLength
    : new Blob([value]).size;
}

export function encodeAgentConversationJsonl(value) {
  const conversation = normalizeAgentConversation(value);
  const { events, ...header } = conversation;
  const lines = [JSON.stringify({ recordType: 'header', ...header })];
  events.forEach((event) => lines.push(JSON.stringify({ recordType: 'event', ...event })));
  const text = `${lines.join('\n')}\n`;
  if (jsonByteLength(text) > MAX_JSONL_BYTES) throw historyError('conversation-file-too-large', '单个会话迁移文件不得超过 32 MiB。');
  return text;
}

export function decodeAgentConversationJsonl(input) {
  if (typeof input !== 'string') throw historyError('invalid-conversation-file', '会话迁移文件必须是 UTF-8 文本。');
  const text = input.replace(/^\uFEFF/, '');
  if (jsonByteLength(text) > MAX_JSONL_BYTES) throw historyError('conversation-file-too-large', '单个会话迁移文件不得超过 32 MiB。');
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines.length > MAX_EVENTS + 1) throw historyError('invalid-conversation-file', '会话迁移文件为空或记录过多。');
  let header;
  try { header = JSON.parse(lines[0]); }
  catch { throw historyError('invalid-conversation-jsonl', '会话迁移文件头不是有效 JSON。'); }
  if (!isPlainObject(header) || header.recordType !== 'header') {
    throw historyError('invalid-conversation-header', '会话迁移文件缺少有效头记录。');
  }
  const events = lines.slice(1).map((line, index) => {
    let event;
    try { event = JSON.parse(line); }
    catch { throw historyError('invalid-conversation-jsonl', `会话第 ${index + 1} 条记录不是有效 JSON。`); }
    if (!isPlainObject(event) || event.recordType !== 'event') {
      throw historyError('invalid-conversation-event', `会话第 ${index + 1} 条记录类型无效。`);
    }
    const { recordType, ...value } = event;
    return value;
  });
  const { recordType, ...record } = header;
  return normalizeAgentConversation({ ...record, events }, { interruptedPending: true });
}

function comparableConversation(value) {
  const normalized = normalizeAgentConversation(value);
  return JSON.stringify({ ...normalized, updatedAt: '', revision: 0 });
}

export function mergeAgentConversationImports(existingValues, incomingValues, { idFactory = () => newId() } = {}) {
  const records = (Array.isArray(existingValues) ? existingValues : []).map((value) => normalizeAgentConversation(value));
  const byId = new Map(records.map((record) => [record.id, record]));
  const added = [];
  const skipped = [];
  const forked = [];
  for (const raw of Array.isArray(incomingValues) ? incomingValues : []) {
    const incoming = normalizeAgentConversation(raw, { interruptedPending: true });
    const current = byId.get(incoming.id);
    if (!current) {
      records.push(incoming);
      byId.set(incoming.id, incoming);
      added.push(incoming.id);
      continue;
    }
    if (comparableConversation(current) === comparableConversation(incoming)) {
      skipped.push(incoming.id);
      continue;
    }
    let nextId = cleanRequiredId(idFactory(), '冲突会话 ID');
    while (byId.has(nextId)) nextId = cleanRequiredId(idFactory(), '冲突会话 ID');
    const fork = normalizeAgentConversation({
      ...incoming,
      id: nextId,
      title: `${incoming.title}（迁入冲突）`.slice(0, 120),
      continuedFrom: incoming.id,
      revision: 0,
    });
    records.push(fork);
    byId.set(fork.id, fork);
    forked.push({ sourceId: incoming.id, id: fork.id });
  }
  if (records.length > MAX_CONVERSATIONS) throw historyError('too-many-conversations', `会话库最多支持 ${MAX_CONVERSATIONS} 个会话。`);
  return { records, added, skipped, forked };
}
