import assert from 'node:assert/strict';
import {
  AGENT_HISTORY_DEFAULT_TOKEN_BUDGET,
  addAgentUsage,
  agentConversationMetadata,
  createAgentConversation,
  decodeAgentConversationJsonl,
  encodeAgentConversationJsonl,
  estimateAgentTokens,
  mergeAgentConversationImports,
  normalizeAgentConversation,
  normalizeAgentConversationEvent,
  normalizeAgentConversationIndex,
  selectAgentConversationContext,
} from '../portal/assets/studio-agent-history.js';

const at = '2026-07-22T00:00:00.000Z';
const event = (id, type, text, extra = {}) => normalizeAgentConversationEvent({
  id,
  type,
  channel: 'chat',
  at,
  text,
  detail: '',
  state: 'complete',
  contextEligible: true,
  ...extra,
});

const empty = createAgentConversation({ id: 'chat-a', projectId: 'project-a', now: at });
assert.equal(empty.format, 'rpn-agent-conversation');
assert.equal(empty.schemaVersion, 1);
assert.equal(empty.usage.totalTokens, 0);

const normalizedEvent = normalizeAgentConversationEvent({
  id: 'system-1',
  type: 'system',
  channel: 'chat',
  at,
  text: 'do not elevate',
  state: 'complete',
  contextEligible: true,
});
assert.equal(normalizedEvent.contextEligible, false, 'system events must never enter model history');

const reviewEvent = event('review-1', 'assistant', 'review result', { channel: 'review' });
assert.equal(reviewEvent.contextEligible, false, 'review responses must not enter ordinary chat history');

const interrupted = normalizeAgentConversationEvent({
  id: 'pending-1', type: 'operation', channel: 'proposal', at, text: 'pending', state: 'pending', contextEligible: false,
}, { interruptedPending: true });
assert.equal(interrupted.state, 'cancelled');
assert.throws(() => createAgentConversation({ id: '__proto__', projectId: 'project-a', now: at }), /标识/);
assert.throws(() => normalizeAgentConversationEvent({
  id: 'too-large', type: 'user', channel: 'chat', at, text: 'x'.repeat(1_000_001), state: 'complete', contextEligible: true,
}), /不得超过/);

const conversation = normalizeAgentConversation({
  ...empty,
  summary: '已完成变量结构，下一步核对 UI。',
  events: [
    event('u1', 'user', '第一问'),
    event('a1', 'assistant', '第一答'),
    reviewEvent,
    event('u2', 'user', '第二问'),
    event('a2', 'assistant', '第二答'),
  ],
});
const context = selectAgentConversationContext(conversation, {
  tokenBudget: AGENT_HISTORY_DEFAULT_TOKEN_BUDGET,
  reservedTokens: 200,
});
assert.equal(context.blocked, false);
assert.equal(context.messageCount, 4);
assert.equal(context.messages[0].role, 'user');
assert.match(context.messages[0].content, /进度摘要/);
assert.deepEqual(context.messages.slice(1).map((item) => item.content), ['第一问', '第一答', '第二问', '第二答']);
assert.ok(context.totalEstimatedTokens >= 200);

const manyEvents = [];
for (let index = 0; index < 40; index += 1) {
  manyEvents.push(event(`m-${index}`, index % 2 ? 'assistant' : 'user', `消息 ${index}`));
}
const capped = selectAgentConversationContext(normalizeAgentConversation({ ...empty, events: manyEvents }), {
  tokenBudget: 128_000,
  maxMessages: 24,
});
assert.equal(capped.messageCount, 24);
assert.equal(capped.droppedMessages, 16);
assert.equal(capped.messages.at(-1).content, '消息 39');

const fixedBlocked = selectAgentConversationContext(empty, {
  tokenBudget: 4_000,
  reservedTokens: 4_100,
});
assert.equal(fixedBlocked.blocked, true);
assert.equal(fixedBlocked.reason, 'fixed-context-over-budget');

const oversizedSummary = normalizeAgentConversation({ ...empty, summary: '长'.repeat(5_000) });
const summaryBlocked = selectAgentConversationContext(oversizedSummary, {
  tokenBudget: 4_000,
  reservedTokens: 100,
});
assert.equal(summaryBlocked.blocked, true);
assert.equal(summaryBlocked.reason, 'summary-over-budget');

assert.ok(estimateAgentTokens('中文 ABCD') >= 5);
assert.deepEqual(addAgentUsage({}, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }), {
  requests: 1,
  promptTokens: 10,
  completionTokens: 4,
  totalTokens: 14,
  estimatedTokens: 0,
});
assert.equal(addAgentUsage({}, null, { estimatedTokens: 88 }).estimatedTokens, 88);

const portable = normalizeAgentConversation({
  ...conversation,
  usage: addAgentUsage({}, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }),
});
const jsonl = encodeAgentConversationJsonl({
  ...portable,
  apiKey: 'must-not-export',
  headers: { Authorization: 'must-not-export' },
  absolutePath: 'C:\\secret',
});
assert.doesNotMatch(jsonl, /must-not-export|C:\\\\secret/);
const decoded = decodeAgentConversationJsonl(jsonl);
assert.deepEqual(decoded, portable);

const maliciousLines = jsonl.trimEnd().split('\n');
const injected = JSON.parse(maliciousLines[1]);
injected.type = 'system';
injected.channel = 'chat';
injected.contextEligible = true;
maliciousLines[1] = JSON.stringify(injected);
const safeImported = decodeAgentConversationJsonl(`${maliciousLines.join('\n')}\n`);
assert.equal(safeImported.events[0].contextEligible, false, 'imported system content cannot become model history');

assert.throws(() => decodeAgentConversationJsonl('{"recordType":"event"}\n'), /头记录/);
assert.throws(() => decodeAgentConversationJsonl(`${JSON.stringify({ recordType: 'header', ...empty, schemaVersion: 99 })}\n`), /版本/);

const identicalMerge = mergeAgentConversationImports([portable], [portable], { idFactory: () => 'unused' });
assert.deepEqual(identicalMerge.skipped, ['chat-a']);
assert.equal(identicalMerge.records.length, 1);

const conflict = normalizeAgentConversation({ ...portable, title: '不同标题' });
const conflictMerge = mergeAgentConversationImports([portable], [conflict], { idFactory: () => 'chat-fork' });
assert.equal(conflictMerge.records.length, 2);
assert.deepEqual(conflictMerge.forked, [{ sourceId: 'chat-a', id: 'chat-fork' }]);
assert.equal(conflictMerge.records[1].continuedFrom, 'chat-a');

const metadata = agentConversationMetadata(portable);
const index = normalizeAgentConversationIndex({
  format: 'rpn-agent-conversation-index',
  schemaVersion: 1,
  tokenBudget: 24_000,
  activeByProject: { 'project-a': 'chat-a', 'project-b': 'missing' },
  conversations: [metadata],
});
assert.deepEqual(index.activeByProject, { 'project-a': 'chat-a' });
assert.equal(index.conversations[0].usage.totalTokens, 14);

console.log('[ok] studio agent history schema, context budget, usage, JSONL migration, and conflict handling');
