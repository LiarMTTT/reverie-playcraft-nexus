import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AirpPresetError,
  OpenAICompatibleClient,
  STUDIO_AI_API_FORMATS,
  StudioAiError,
  apiFormatSwitchBaseUrl,
  assembleAirpPrompt,
  createDesktopAiFetch,
  importAirpPreset,
  inspectAirpPreset,
  normalizeApiProfileTransport,
  normalizeOpenAiBaseUrl,
  parseAgentTurnResponse,
  summarizeAirpPreset,
  validateAirpPreset,
} from '../portal/assets/studio-ai.js';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(toolsDir, '..', 'portal', 'assets', 'studio-ai.js'), 'utf8');
const cardStudioSource = readFileSync(path.join(toolsDir, '..', 'portal', 'assets', 'card-studio.js'), 'utf8');
const portalSource = readFileSync(path.join(toolsDir, '..', 'portal', 'index.html'), 'utf8');

for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
  assert.equal(source.includes(forbidden), false, `studio-ai.js 不得持久化凭证：${forbidden}`);
}

assert.deepEqual(parseAgentTurnResponse('普通回答'), {
  reply: '普通回答',
  proposal: null,
  format: 'text',
});
assert.deepEqual(parseAgentTurnResponse(JSON.stringify({
  reply: '建议已整理。',
  proposal: {
    type: 'replace-worldbook-entry-content',
    summary: '精简当前条目',
    content: '新的完整正文',
    projectId: 'model-controlled-project',
    targetUid: 999,
    path: '$.worldbook.entries[999]',
    status: 'approved',
    command: 'powershell.exe',
  },
}), { allowProposal: true }), {
  reply: '建议已整理。',
  proposal: {
    type: 'replace-worldbook-entry-content',
    summary: '精简当前条目',
    content: '新的完整正文',
  },
  format: 'json',
}, 'Agent 解析器只能保留白名单提案字段，目标与批准状态必须由本地绑定');
assert.equal(parseAgentTurnResponse(JSON.stringify({
  reply: '请求执行命令。',
  proposal: { type: 'run-command', content: 'rm -rf /' },
}), { allowProposal: true }).proposal, null, '非白名单操作不得成为 Agent 提案');
assert.deepEqual(parseAgentTurnResponse(JSON.stringify({
  reply: '只读回答。',
  proposal: {
    type: 'replace-worldbook-entry-content',
    summary: '不应恢复',
    content: '不得进入提案',
  },
}), { allowProposal: false }), {
  reply: '只读回答。',
  proposal: null,
  format: 'json',
}, '只读回合即使收到合法 JSON，也不得接受提案');
const invalidMultilineReply = '{"reply":"第一行\n第二行","proposal":null}';
assert.deepEqual(parseAgentTurnResponse(invalidMultilineReply, { allowProposal: false }), {
  reply: '第一行\n第二行',
  proposal: null,
  format: 'text',
}, '只读回合应安全剥离仅含 proposal:null 的近似 JSON 包裹');
assert.equal(
  parseAgentTurnResponse(invalidMultilineReply, { allowProposal: true }).reply,
  invalidMultilineReply,
  '允许提案的回合不得修复坏 JSON',
);
assert.deepEqual(parseAgentTurnResponse(`\`\`\`json
${invalidMultilineReply}
\`\`\``), {
  reply: '第一行\n第二行',
  proposal: null,
  format: 'text',
}, '只读回合应剥离代码围栏内的近似 JSON 包裹');
const escapedMultilineReply = '{"reply":"路径 C:\\\\Temp\\\\file，称为 \\"测试\\"\n下一行","proposal":null}';
assert.deepEqual(parseAgentTurnResponse(escapedMultilineReply), {
  reply: '路径 C:\\Temp\\file，称为 "测试"\n下一行',
  proposal: null,
  format: 'text',
}, '近似 JSON 恢复应保留已转义的引号、反斜杠与真实换行');
const ambiguousMalformedProposal = '{"reply":"正文\n仍是正文","proposal":{"type":"replace-worldbook-entry-content"}}';
assert.equal(
  parseAgentTurnResponse(ambiguousMalformedProposal, { allowProposal: false }).reply,
  ambiguousMalformedProposal,
  '只读回合不得从带非 null proposal 的坏 JSON 中提取内容',
);

assert.equal(
  normalizeOpenAiBaseUrl(' https://API.Example.com/v1/// '),
  'https://api.example.com/v1',
);
assert.equal(
  normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1', { pageUrl: 'http://localhost:4174/studio' }),
  'http://127.0.0.1:11434/v1',
);
assert.equal(
  normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1', {
    pageUrl: 'tauri://localhost/studio',
    allowLoopbackHttp: true,
  }),
  'http://127.0.0.1:11434/v1',
);
assert.throws(
  () => normalizeOpenAiBaseUrl('http://api.example.com/v1', { pageUrl: 'http://localhost:4174' }),
  (error) => error instanceof StudioAiError && error.code === 'insecure-base-url',
);
assert.throws(
  () => normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1', { pageUrl: 'https://rpn.example.com' }),
  (error) => error instanceof StudioAiError && error.code === 'insecure-base-url',
);
assert.throws(
  () => normalizeOpenAiBaseUrl('http://api.example.com/v1', {
    pageUrl: 'tauri://localhost/studio',
    allowLoopbackHttp: true,
  }),
  (error) => error instanceof StudioAiError && error.code === 'insecure-base-url',
);
assert.throws(
  () => normalizeOpenAiBaseUrl('https://user:secret@example.com/v1'),
  (error) => error instanceof StudioAiError && error.code === 'base-url-credentials',
);
assert.throws(
  () => normalizeOpenAiBaseUrl('https://example.com/v1?key=secret'),
  (error) => error instanceof StudioAiError && error.code === 'base-url-components',
);
assert.throws(
  () => normalizeOpenAiBaseUrl('https://example.com/v1/chat/completions'),
  (error) => error instanceof StudioAiError && error.code === 'base-url-is-endpoint',
);

const airpFixture = {
  temperature: 1.1,
  top_p: 0.9,
  frequency_penalty: 0.2,
  presence_penalty: -0.1,
  openai_max_tokens: 4096,
  seed: 42,
  n: 1,
  top_k: 40,
  reverse_proxy: 'https://preset-endpoint.invalid/v1',
  extensions: {
    future_airp_field: {
      preserved: true,
      public_url: 'https://docs.example.com/airp',
      connection_settings: {
        proxy_password: 'proxy-secret',
        custom_url: 'https://custom-endpoint.invalid/v1',
        custom_include_headers: 'Authorization: Bearer header-secret',
        custom_include_body: 'body-secret',
        custom_exclude_body: 'exclude-secret',
        azure_base_url: 'https://azure-endpoint.invalid',
        api_key: 'snake-api-secret',
        apiKey: 'camel-api-secret',
        'API Key': 'spaced-api-secret',
        authorization: 'Bearer authorization-secret',
        accessToken: 'access-token-secret',
        client_secret: 'client-secret-value',
        password: 'password-secret',
      },
      provider_profiles: [{ name: '保留的配置名', clientSecret: 'array-client-secret' }],
    },
  },
  prompts: [
    {
      identifier: 'main',
      name: 'Main Prompt',
      system_prompt: true,
      extension: true,
      role: 'system',
      content: '为 {{user}} 写卡。<% globalThis.__airpExecuted = true %>',
    },
    {
      identifier: 'worldInfoBefore',
      name: 'World Info (before)',
      system_prompt: true,
      marker: true,
    },
    {
      identifier: 'absolute-note',
      name: 'Absolute note',
      system_prompt: false,
      role: 'user',
      content: '保留 {{unknownMacro}} 原文。',
      injection_position: 1,
      injection_depth: 2,
      injection_order: 100,
      injection_trigger: ['normal'],
      forbid_overrides: true,
    },
    {
      identifier: 'disabled-note',
      name: 'Disabled',
      role: 'assistant',
      content: '不得出现',
    },
    {
      identifier: 'unreferenced-note',
      name: 'Unreferenced',
      role: 'system',
      content: '没有进入所选顺序组。',
    },
  ],
  prompt_order: [
    {
      character_id: 100000,
      order: [{ identifier: 'main', enabled: true }],
    },
    {
      character_id: 100001,
      order: [
        { identifier: 'main', enabled: true },
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'absolute-note', enabled: true },
        { identifier: 'disabled-note', enabled: false },
      ],
    },
  ],
};

const originalAirpFixture = structuredClone(airpFixture);
const imported = importAirpPreset(airpFixture, { sourceName: 'C:\\Downloads\\写卡预设.json' });
assert.equal(imported.kind, 'sillytavern-openai-settings');
assert.equal(imported.name, '写卡预设');
assert.equal(imported.preset.extensions.future_airp_field.preserved, true);
assert.equal(imported.preset.extensions.future_airp_field.public_url, 'https://docs.example.com/airp');
assert.equal('connection_settings' in imported.preset.extensions.future_airp_field, true, '非敏感容器字段应保留');
assert.deepEqual(imported.preset.extensions.future_airp_field.connection_settings, {});
assert.deepEqual(imported.preset.extensions.future_airp_field.provider_profiles, [{ name: '保留的配置名' }]);
assert.equal('reverse_proxy' in imported.preset, false);
assert.deepEqual(airpFixture, originalAirpFixture, '导入不得修改调用方的原始 AIRP 对象');
assert.deepEqual(imported.removedSensitiveFields, [
  '$.reverse_proxy',
  '$.extensions.future_airp_field.connection_settings.proxy_password',
  '$.extensions.future_airp_field.connection_settings.custom_url',
  '$.extensions.future_airp_field.connection_settings.custom_include_headers',
  '$.extensions.future_airp_field.connection_settings.custom_include_body',
  '$.extensions.future_airp_field.connection_settings.custom_exclude_body',
  '$.extensions.future_airp_field.connection_settings.azure_base_url',
  '$.extensions.future_airp_field.connection_settings.api_key',
  '$.extensions.future_airp_field.connection_settings.apiKey',
  '$.extensions.future_airp_field.connection_settings["API Key"]',
  '$.extensions.future_airp_field.connection_settings.authorization',
  '$.extensions.future_airp_field.connection_settings.accessToken',
  '$.extensions.future_airp_field.connection_settings.client_secret',
  '$.extensions.future_airp_field.connection_settings.password',
  '$.extensions.future_airp_field.provider_profiles[0].clientSecret',
]);
const importedJson = JSON.stringify(imported.preset);
for (const sensitiveKey of [
  'reverse_proxy',
  'proxy_password',
  'custom_url',
  'custom_include_headers',
  'custom_include_body',
  'custom_exclude_body',
  'azure_base_url',
  'api_key',
  'apiKey',
  'API Key',
  'authorization',
  'accessToken',
  'client_secret',
  'clientSecret',
  'password',
]) {
  assert.equal(importedJson.includes(`"${sensitiveKey}"`), false, `导入后的 AIRP 不得保留敏感字段：${sensitiveKey}`);
}
for (const secret of [
  'preset-endpoint.invalid',
  'proxy-secret',
  'custom-endpoint.invalid',
  'header-secret',
  'body-secret',
  'exclude-secret',
  'azure-endpoint.invalid',
  'snake-api-secret',
  'camel-api-secret',
  'spaced-api-secret',
  'authorization-secret',
  'access-token-secret',
  'client-secret-value',
  'password-secret',
  'array-client-secret',
]) {
  assert.equal(importedJson.includes(secret), false, `导入后的 AIRP 不得保留凭证：${secret}`);
}
assert.equal(imported.validation.valid, true);
assert.ok(imported.validation.warnings.some((item) => item.code === 'airp-sensitive-fields-removed'));

const summary = summarizeAirpPreset(imported.preset);
assert.deepEqual(
  {
    kind: summary.kind,
    promptCount: summary.promptCount,
    selectedOrderCharacterId: summary.selectedOrderCharacterId,
    enabledPromptCount: summary.enabledPromptCount,
    markerCount: summary.markerCount,
    absoluteInjectionCount: summary.absoluteInjectionCount,
    sensitiveFields: summary.sensitiveFields,
  },
  {
    kind: 'sillytavern-openai-settings',
    promptCount: 5,
    selectedOrderCharacterId: 100001,
    enabledPromptCount: 3,
    markerCount: 1,
    absoluteInjectionCount: 1,
    sensitiveFields: [],
  },
);

globalThis.__airpExecuted = false;
const inspection = inspectAirpPreset(imported.preset);
assert.equal(globalThis.__airpExecuted, false, '检查 AIRP 时不得执行正文中的 EJS/JavaScript');
assert.equal(inspection.kind, 'sillytavern-openai-settings');
assert.deepEqual(inspection.orderGroups, [
  { characterId: 100000, entryCount: 1, enabledCount: 1 },
  { characterId: 100001, entryCount: 4, enabledCount: 3 },
]);
assert.equal(inspection.selectedOrderCharacterId, 100001);
assert.deepEqual(
  inspection.entries.map(({ index, identifier, enabled, missing, directGenerationStatus }) => ({
    index,
    identifier,
    enabled,
    missing,
    directGenerationStatus,
  })),
  [
    { index: 0, identifier: 'main', enabled: true, missing: false, directGenerationStatus: 'included' },
    { index: 1, identifier: 'worldInfoBefore', enabled: true, missing: false, directGenerationStatus: 'marker' },
    { index: 2, identifier: 'absolute-note', enabled: true, missing: false, directGenerationStatus: 'skipped' },
    { index: 3, identifier: 'disabled-note', enabled: false, missing: false, directGenerationStatus: 'disabled' },
  ],
);
assert.deepEqual(
  inspection.entries[0],
  {
    index: 0,
    identifier: 'main',
    enabled: true,
    missing: false,
    name: 'Main Prompt',
    role: 'system',
    effectiveRole: 'system',
    roleFallsBackToSystem: false,
    marker: false,
    systemPrompt: true,
    extension: true,
    injectionPosition: 0,
    injectionDepth: null,
    injectionOrder: null,
    injectionTrigger: [],
    forbidOverrides: false,
    content: '为 {{user}} 写卡。<% globalThis.__airpExecuted = true %>',
    contentChars: 52,
    directGenerationStatus: 'included',
    directGenerationReason: 'included',
  },
);
assert.deepEqual(
  inspection.entries[1],
  {
    index: 1,
    identifier: 'worldInfoBefore',
    enabled: true,
    missing: false,
    name: 'World Info (before)',
    role: null,
    effectiveRole: 'system',
    roleFallsBackToSystem: true,
    marker: true,
    systemPrompt: true,
    extension: false,
    injectionPosition: 0,
    injectionDepth: null,
    injectionOrder: null,
    injectionTrigger: [],
    forbidOverrides: false,
    content: '',
    contentChars: 0,
    directGenerationStatus: 'marker',
    directGenerationReason: 'marker-value-required',
  },
);
assert.deepEqual(
  {
    injectionPosition: inspection.entries[2].injectionPosition,
    injectionDepth: inspection.entries[2].injectionDepth,
    injectionOrder: inspection.entries[2].injectionOrder,
    injectionTrigger: inspection.entries[2].injectionTrigger,
    forbidOverrides: inspection.entries[2].forbidOverrides,
    directGenerationStatus: inspection.entries[2].directGenerationStatus,
    directGenerationReason: inspection.entries[2].directGenerationReason,
  },
  {
    injectionPosition: 1,
    injectionDepth: 2,
    injectionOrder: 100,
    injectionTrigger: ['normal'],
    forbidOverrides: true,
    directGenerationStatus: 'skipped',
    directGenerationReason: 'in-chat',
  },
);
assert.deepEqual(
  inspection.unreferencedPrompts.map((entry) => ({
    index: entry.index,
    identifier: entry.identifier,
    content: entry.content,
    contentChars: entry.contentChars,
    directGenerationStatus: entry.directGenerationStatus,
  })),
  [{
    index: 4,
    identifier: 'unreferenced-note',
    content: '没有进入所选顺序组。',
    contentChars: 10,
    directGenerationStatus: 'unreferenced',
  }],
);
assert.deepEqual(inspection.samplingParameters, [
  { sourceKey: 'temperature', directKey: 'temperature', value: 1.1, usedByDirectGeneration: true },
  { sourceKey: 'top_p', directKey: 'top_p', value: 0.9, usedByDirectGeneration: true },
  { sourceKey: 'frequency_penalty', directKey: 'frequency_penalty', value: 0.2, usedByDirectGeneration: true },
  { sourceKey: 'presence_penalty', directKey: 'presence_penalty', value: -0.1, usedByDirectGeneration: true },
  { sourceKey: 'openai_max_tokens', directKey: 'max_tokens', value: 4096, usedByDirectGeneration: true },
  { sourceKey: 'seed', directKey: 'seed', value: 42, usedByDirectGeneration: true },
  { sourceKey: 'n', directKey: 'n', value: 1, usedByDirectGeneration: true },
  { sourceKey: 'top_k', directKey: null, value: 40, usedByDirectGeneration: false },
]);

globalThis.__airpExecuted = false;
const assembled = assembleAirpPrompt(imported.preset, {
  markerValues: {
    worldInfoBefore: { role: 'system', content: '世界书正文' },
  },
  substitutions: { user: 'Alice' },
  task: '生成角色卡候选。',
});
assert.equal(globalThis.__airpExecuted, false, 'AIRP 内的 EJS/JS 不得执行');
delete globalThis.__airpExecuted;
assert.deepEqual(assembled.messages, [
  { role: 'system', content: '为 Alice 写卡。<% globalThis.__airpExecuted = true %>' },
  { role: 'system', content: '世界书正文' },
  { role: 'user', content: '生成角色卡候选。' },
]);
assert.deepEqual(assembled.parameters, {
  temperature: 1.1,
  top_p: 0.9,
  frequency_penalty: 0.2,
  presence_penalty: -0.1,
  max_tokens: 4096,
  seed: 42,
  n: 1,
});
assert.deepEqual(assembled.diagnostics.substitutedKeys, ['user']);
assert.deepEqual(assembled.diagnostics.flattenedAbsoluteInjections, []);
assert.deepEqual(assembled.diagnostics.unsupportedInChatPrompts, ['absolute-note']);
assert.ok(assembled.diagnostics.literalTemplateFragments.includes('main'));

const assembledWithoutPreset = assembleAirpPrompt(null, {
  extraMessages: [
    { role: 'system', content: '基础协作规则' },
    { role: 'assistant', content: '已读取当前工作区上下文' },
  ],
  task: '直接处理当前任务。',
});
assert.equal(assembledWithoutPreset.kind, 'plain');
assert.equal(assembledWithoutPreset.orderCharacterId, null);
assert.deepEqual(assembledWithoutPreset.messages, [
  { role: 'system', content: '基础协作规则' },
  { role: 'assistant', content: '已读取当前工作区上下文' },
  { role: 'user', content: '直接处理当前任务。' },
]);
assert.deepEqual(assembledWithoutPreset.parameters, {}, '未启用 AIRP 时不得虚构采样参数');

const duplicatePreset = structuredClone(airpFixture);
duplicatePreset.prompts.push({
  identifier: 'main',
  name: 'Duplicate',
  role: 'system',
  content: '第二个同名提示词',
});
const duplicateValidation = validateAirpPreset(duplicatePreset);
assert.equal(duplicateValidation.valid, true, '真实 AIRP 中允许重复 ID，行为与 SillyTavern 首项匹配一致');
assert.ok(duplicateValidation.warnings.some((item) => item.code === 'airp-duplicate-identifier'));
assert.match(assembleAirpPrompt(duplicatePreset).messages[0].content, /^为 /);

const emptyOrderPreset = {
  prompts: [{ identifier: 'must-not-send', role: 'system', content: '不得绕过空顺序组发送' }],
  prompt_order: [{ character_id: 100001, order: [] }],
};
const emptyOrderInspection = inspectAirpPreset(emptyOrderPreset);
assert.deepEqual(emptyOrderInspection.entries, [], '显式空顺序组必须保持为空');
assert.deepEqual(emptyOrderInspection.unreferencedPrompts.map((entry) => entry.identifier), ['must-not-send']);
assert.deepEqual(
  assembleAirpPrompt(emptyOrderPreset, { task: '仅保留调用方任务' }).messages,
  [{ role: 'user', content: '仅保留调用方任务' }],
  '空 prompt_order 不得回退发送全部 prompts',
);
assert.equal(summarizeAirpPreset(emptyOrderPreset).enabledPromptCount, 0);

const unknownRolePreset = structuredClone(airpFixture);
unknownRolePreset.prompts[0].role = 'tool';
const unknownRoleEntry = inspectAirpPreset(unknownRolePreset).entries[0];
assert.deepEqual(
  {
    role: unknownRoleEntry.role,
    effectiveRole: unknownRoleEntry.effectiveRole,
    roleFallsBackToSystem: unknownRoleEntry.roleFallsBackToSystem,
  },
  { role: 'tool', effectiveRole: 'system', roleFallsBackToSystem: true },
);
assert.equal(assembleAirpPrompt(unknownRolePreset).messages[0].role, 'system');

const promptManagerExport = {
  version: 1,
  type: 'full',
  future_wrapper_field: 'preserve-me',
  data: {
    prompts: [{
      identifier: 'custom-prompt',
      name: 'Custom prompt',
      role: 'system',
      content: '自定义写作说明',
      system_prompt: false,
      marker: false,
    }],
    prompt_order: [{ identifier: 'custom-prompt', enabled: true }],
    future_data_field: 7,
  },
};
const importedPromptManager = importAirpPreset(promptManagerExport, { sourceName: 'st-prompts.json' });
assert.equal(importedPromptManager.kind, 'sillytavern-prompt-manager');
assert.equal(importedPromptManager.preset.future_wrapper_field, 'preserve-me');
assert.equal(importedPromptManager.preset.data.future_data_field, 7);
assert.deepEqual(assembleAirpPrompt(importedPromptManager.preset).messages, [
  { role: 'system', content: '自定义写作说明' },
]);
const promptManagerInspection = inspectAirpPreset(importedPromptManager.preset);
assert.deepEqual(promptManagerInspection.orderGroups, [
  { characterId: null, entryCount: 1, enabledCount: 1 },
]);
assert.equal(promptManagerInspection.selectedOrderCharacterId, null);
assert.equal(promptManagerInspection.entries[0].identifier, 'custom-prompt');
assert.equal(promptManagerInspection.entries[0].content, '自定义写作说明');
assert.equal(promptManagerInspection.entries[0].directGenerationStatus, 'included');
assert.deepEqual(promptManagerInspection.unreferencedPrompts, []);
assert.deepEqual(promptManagerInspection.samplingParameters, []);

assert.equal(validateAirpPreset('{}').valid, false);
assert.throws(
  () => importAirpPreset('{broken'),
  (error) => error instanceof AirpPresetError && error.code === 'airp-json',
);

let getterExecuted = false;
const accessorPreset = {};
Object.defineProperty(accessorPreset, 'prompts', {
  enumerable: true,
  get() {
    getterExecuted = true;
    return [];
  },
});
assert.throws(
  () => importAirpPreset(accessorPreset),
  (error) => error instanceof AirpPresetError && error.code === 'airp-accessor',
);
assert.equal(getterExecuted, false, '导入对象不得触发 accessor');

const capturedRequests = [];
const successfulFetch = async (url, options) => {
  capturedRequests.push({ url, options });
  if (url.endsWith('/models')) {
    return new Response(JSON.stringify({
      object: 'list',
      data: [
        { id: 'model-b', owned_by: 'provider', future: { value: 1 } },
        { id: 'model-a', owned_by: 'provider' },
        { id: 'model-a', owned_by: 'duplicate' },
        { no_id: true },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    model: 'model-a',
    choices: [{
      index: 0,
      message: { role: 'assistant', content: '候选正文' },
      finish_reason: 'stop',
    }],
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

let fetchReceiver = null;
function receiverSensitiveFetch() {
  fetchReceiver = this;
  return Promise.resolve(new Response(JSON.stringify({
    data: [{ id: 'receiver-model' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

const receiverClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: receiverSensitiveFetch,
});
await receiverClient.listModels();
assert.equal(fetchReceiver, globalThis, 'fetch implementation must receive the global object as its receiver');

const client = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'test-secret-key',
  fetchImpl: successfulFetch,
});
assert.equal(client.baseUrl, 'https://api.example.com/v1');
assert.equal(client.hasApiKey, true);
assert.equal(JSON.stringify(client).includes('test-secret-key'), false, '序列化客户端不得泄漏 API Key');
assert.deepEqual(client.toJSON(), {
  baseUrl: 'https://api.example.com/v1',
  apiFormat: 'openai-compatible',
  networkMode: 'direct',
  hasApiKey: true,
});
assert.equal(Object.keys(client).some((key) => /key/i.test(key)), false, 'API Key 必须使用私有字段');

const modelsResult = await client.listModels({ method: 'POST', body: { unsafe: true } });
assert.deepEqual(modelsResult.ids, ['model-b', 'model-a']);
assert.equal(modelsResult.models[0].future.value, 1);
assert.equal(capturedRequests[0].url, 'https://api.example.com/v1/models');
assert.equal(capturedRequests[0].options.method, 'GET');
assert.equal(capturedRequests[0].options.credentials, 'omit');
assert.equal(capturedRequests[0].options.redirect, 'error');
assert.equal(capturedRequests[0].options.cache, 'no-store');
assert.equal(capturedRequests[0].options.referrerPolicy, 'no-referrer');
assert.equal(capturedRequests[0].options.headers.Authorization, 'Bearer test-secret-key');

const completion = await client.createChatCompletion({
  model: 'model-a',
  messages: assembled.messages,
  ...assembled.parameters,
  stream: true,
  apiKey: 'must-not-enter-body',
});
assert.equal(completion.text, '候选正文');
assert.equal(completion.finishReason, 'stop');
assert.equal(completion.usage.total_tokens, 14);
const completionRequest = capturedRequests[1];
assert.equal(completionRequest.url, 'https://api.example.com/v1/chat/completions');
assert.equal(completionRequest.options.method, 'POST');
const completionBody = JSON.parse(completionRequest.options.body);
assert.equal(completionBody.stream, false);
assert.equal(completionBody.model, 'model-a');
assert.equal(hasOwn(completionBody, 'apiKey'), false);
assert.equal(completionBody.max_tokens, 4096, '第三方 OpenAI-compatible 端点继续接收 max_tokens');
assert.equal(completionBody.max_completion_tokens, undefined);
assert.equal(completionRequest.options.headers.Authorization, 'Bearer test-secret-key');

client.clearApiKey();
assert.equal(client.hasApiKey, false);
await client.listModels({ apiKey: 'one-shot-key' });
assert.equal(capturedRequests[2].options.headers.Authorization, 'Bearer one-shot-key');
assert.equal(JSON.stringify(client).includes('one-shot-key'), false);

const officialOpenAiRequests = [];
const officialOpenAiClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'openai-key',
  fetchImpl: async (url, options) => {
    officialOpenAiRequests.push({ url, options });
    return new Response(JSON.stringify({
      id: 'chatcmpl-official',
      model: 'o3',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    }), { status: 200 });
  },
});
await officialOpenAiClient.createChatCompletion({
  model: 'o3',
  messages: [{ role: 'user', content: 'Reply with OK.' }],
  max_tokens: 8,
});
const officialOpenAiBody = JSON.parse(officialOpenAiRequests[0].options.body);
assert.equal(officialOpenAiBody.max_tokens, undefined);
assert.equal(officialOpenAiBody.max_completion_tokens, 8);

assert.deepEqual(Object.keys(STUDIO_AI_API_FORMATS), [
  'openai-compatible',
  'openai-responses',
  'anthropic-messages',
  'google-gemini',
  'cohere-v2',
  'dashscope-native',
  'ollama-native',
]);
assert.deepEqual(
  normalizeApiProfileTransport({}),
  { apiFormat: 'openai-compatible', networkMode: 'systemProxy' },
  '缺少新字段的 v2 配置档必须按旧行为迁移',
);
assert.match(cardStudioSource, /normalizeApiProfileTransport\(item\)/, '配置档载入必须应用协议与网络模式迁移');
for (const value of [
  'openai-compatible',
  'openai-responses',
  'anthropic-messages',
  'google-gemini',
  'cohere-v2',
  'dashscope-native',
  'ollama-native',
]) {
  assert.match(portalSource, new RegExp(`option value="${value}"`), `设置页必须提供 ${value} 下拉项`);
}
for (const value of ['direct', 'systemProxy']) {
  assert.match(portalSource, new RegExp(`option value="${value}"`), `设置页必须提供 ${value} 网络路径`);
}
assert.deepEqual(
  normalizeApiProfileTransport({ apiFormat: 'google-gemini', networkMode: 'direct' }),
  { apiFormat: 'google-gemini', networkMode: 'direct' },
);
assert.equal(
  apiFormatSwitchBaseUrl(
    STUDIO_AI_API_FORMATS['openai-compatible'].defaultBaseUrl,
    'openai-compatible',
    'anthropic-messages',
  ),
  STUDIO_AI_API_FORMATS['anthropic-messages'].defaultBaseUrl,
  '仍是上一格式默认值时应切换默认 Base URL',
);
assert.equal(
  apiFormatSwitchBaseUrl('https://gateway.example.com/custom', 'openai-compatible', 'google-gemini'),
  'https://gateway.example.com/custom',
  '格式切换不得覆盖用户填写的自定义 Base URL',
);

const responsesRequests = [];
const responsesClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'responses-key',
  apiFormat: 'openai-responses',
  fetchImpl: async (url, options) => {
    responsesRequests.push({ url, options });
    if (options.method === 'GET') {
      return new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: 'gpt-5',
      status: 'completed',
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Responses OK' }],
      }],
      usage: { input_tokens: 11, output_tokens: 3, total_tokens: 14 },
    }), { status: 200 });
  },
});
assert.deepEqual((await responsesClient.listModels()).ids, ['gpt-5']);
const responsesCompletion = await responsesClient.createChatCompletion({
  model: 'gpt-5',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 48,
  response_format: { type: 'json_object' },
});
assert.equal(responsesRequests[0].url, 'https://api.openai.com/v1/models');
assert.equal(responsesRequests[1].url, 'https://api.openai.com/v1/responses');
assert.deepEqual(JSON.parse(responsesRequests[1].options.body), {
  model: 'gpt-5',
  input: [{ role: 'user', content: 'Hello' }],
  max_output_tokens: 48,
  text: { format: { type: 'json_object' } },
});
assert.equal(responsesCompletion.text, 'Responses OK');
assert.deepEqual(responsesCompletion.usage, {
  prompt_tokens: 11,
  completion_tokens: 3,
  total_tokens: 14,
});

const anthropicRequests = [];
const anthropicClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.anthropic.com/v1',
  apiKey: 'anthropic-key',
  apiFormat: 'anthropic-messages',
  fetchImpl: async (url, options) => {
    anthropicRequests.push({ url, options });
    if (options.method === 'GET') {
      return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-5' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: 'claude-sonnet-4-5',
      content: [{ type: 'text', text: 'Anthropic OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 3 },
    }), { status: 200 });
  },
});
assert.deepEqual((await anthropicClient.listModels()).ids, ['claude-sonnet-4-5']);
const anthropicCompletion = await anthropicClient.createChatCompletion({
  model: 'claude-sonnet-4-5',
  messages: [
    { role: 'system', content: 'System rule' },
    { role: 'user', content: 'Hello' },
  ],
  temperature: 1.1,
  top_p: 0.9,
  max_tokens: 32,
  stop: ['DONE'],
});
assert.equal(anthropicRequests[0].url, 'https://api.anthropic.com/v1/models');
assert.equal(anthropicRequests[0].options.headers['x-api-key'], 'anthropic-key');
assert.equal(anthropicRequests[0].options.headers['anthropic-version'], '2023-06-01');
assert.equal(anthropicRequests[0].options.headers.Authorization, undefined);
assert.equal(anthropicRequests[1].url, 'https://api.anthropic.com/v1/messages');
assert.deepEqual(JSON.parse(anthropicRequests[1].options.body), {
  model: 'claude-sonnet-4-5',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 32,
  system: 'System rule',
  stop_sequences: ['DONE'],
});
assert.equal(JSON.parse(anthropicRequests[1].options.body).temperature, undefined);
assert.equal(JSON.parse(anthropicRequests[1].options.body).top_p, undefined);
assert.equal(anthropicCompletion.text, 'Anthropic OK');
assert.deepEqual(anthropicCompletion.data.choices[0].message, {
  role: 'assistant',
  content: 'Anthropic OK',
});
assert.deepEqual(anthropicCompletion.usage, {
  prompt_tokens: 12,
  completion_tokens: 3,
  total_tokens: 15,
});

const anonymousAnthropicRequests = [];
const anonymousAnthropicClient = new OpenAICompatibleClient({
  baseUrl: 'https://anthropic-compatible.example/v1',
  apiFormat: 'anthropic-messages',
  fetchImpl: async (url, options) => {
    anonymousAnthropicRequests.push({ url, options });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  },
});
await anonymousAnthropicClient.listModels();
assert.equal(
  anonymousAnthropicRequests[0].options.headers['anthropic-version'],
  '2023-06-01',
  'Anthropic-compatible 服务即使无需鉴权也必须收到版本头',
);
assert.equal(anonymousAnthropicRequests[0].options.headers['x-api-key'], undefined);

const geminiRequests = [];
const geminiClient = new OpenAICompatibleClient({
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKey: 'gemini-key',
  apiFormat: 'google-gemini',
  fetchImpl: async (url, options) => {
    geminiRequests.push({ url, options });
    if (options.method === 'GET') {
      return new Response(JSON.stringify({
        models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      modelVersion: 'gemini-2.5-pro',
      candidates: [{
        content: { role: 'model', parts: [{ text: 'Gemini ' }, { text: 'OK' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
    }), { status: 200 });
  },
});
assert.deepEqual((await geminiClient.listModels()).ids, ['gemini-2.5-pro']);
const geminiCompletion = await geminiClient.createChatCompletion({
  model: 'models/gemini-2.5-pro',
  messages: [
    { role: 'system', content: 'System rule' },
    { role: 'assistant', content: 'Prior answer' },
    { role: 'user', content: 'Continue' },
  ],
  top_p: 0.8,
  max_tokens: 64,
  n: 2,
  response_format: { type: 'json_object' },
});
assert.equal(geminiRequests[0].url, 'https://generativelanguage.googleapis.com/v1beta/models');
assert.equal(geminiRequests[0].options.headers['x-goog-api-key'], 'gemini-key');
assert.equal(geminiRequests[0].options.headers.Authorization, undefined);
assert.equal(
  geminiRequests[1].url,
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
);
assert.deepEqual(JSON.parse(geminiRequests[1].options.body), {
  contents: [
    { role: 'model', parts: [{ text: 'Prior answer' }] },
    { role: 'user', parts: [{ text: 'Continue' }] },
  ],
  systemInstruction: { parts: [{ text: 'System rule' }] },
  generationConfig: {
    topP: 0.8,
    maxOutputTokens: 64,
    candidateCount: 2,
    responseMimeType: 'application/json',
  },
});
assert.equal(geminiCompletion.text, 'Gemini OK');
assert.deepEqual(geminiCompletion.usage, {
  prompt_tokens: 7,
  completion_tokens: 2,
  total_tokens: 9,
});

const cohereRequests = [];
const cohereClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.cohere.com',
  apiKey: 'cohere-key',
  apiFormat: 'cohere-v2',
  fetchImpl: async (url, options) => {
    cohereRequests.push({ url, options });
    if (options.method === 'GET') {
      return new Response(JSON.stringify({ models: [{ name: 'command-a-03-2025' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: 'command-a-03-2025',
      finish_reason: 'COMPLETE',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Cohere OK' }] },
      usage: { tokens: { input_tokens: 9, output_tokens: 2 } },
    }), { status: 200 });
  },
});
assert.deepEqual((await cohereClient.listModels()).ids, ['command-a-03-2025']);
const cohereCompletion = await cohereClient.createChatCompletion({
  model: 'command-a-03-2025',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 32,
  top_p: 0.8,
});
assert.equal(cohereRequests[0].url, 'https://api.cohere.com/v1/models');
assert.equal(cohereRequests[1].url, 'https://api.cohere.com/v2/chat');
assert.deepEqual(JSON.parse(cohereRequests[1].options.body), {
  model: 'command-a-03-2025',
  messages: [{ role: 'user', content: 'Hello' }],
  p: 0.8,
  max_tokens: 32,
});
assert.equal(cohereCompletion.text, 'Cohere OK');
assert.deepEqual(cohereCompletion.usage, {
  prompt_tokens: 9,
  completion_tokens: 2,
  total_tokens: 11,
});

const dashscopeRequests = [];
const dashscopeClient = new OpenAICompatibleClient({
  baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  apiKey: 'dashscope-key',
  apiFormat: 'dashscope-native',
  fetchImpl: async (url, options) => {
    dashscopeRequests.push({ url, options });
    return new Response(JSON.stringify({
      output: {
        model: 'qwen-plus',
        choices: [{ message: { role: 'assistant', content: 'DashScope OK' }, finish_reason: 'stop' }],
      },
      usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
    }), { status: 200 });
  },
});
await assert.rejects(
  () => dashscopeClient.listModels(),
  (error) => error instanceof StudioAiError && error.code === 'models-unsupported',
);
const dashscopeCompletion = await dashscopeClient.createChatCompletion({
  model: 'qwen-plus',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 64,
});
assert.equal(
  dashscopeRequests[0].url,
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
);
assert.deepEqual(JSON.parse(dashscopeRequests[0].options.body), {
  model: 'qwen-plus',
  input: { messages: [{ role: 'user', content: 'Hello' }] },
  parameters: { result_format: 'message', max_tokens: 64 },
});
assert.equal(dashscopeCompletion.text, 'DashScope OK');

const ollamaRequests = [];
const ollamaClient = new OpenAICompatibleClient({
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: 'must-not-be-sent',
  apiFormat: 'ollama-native',
  allowLoopbackHttp: true,
  fetchImpl: async (url, options) => {
    ollamaRequests.push({ url, options });
    if (options.method === 'GET') {
      return new Response(JSON.stringify({
        models: [{ name: 'qwen3:8b', size: 123 }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      model: 'qwen3:8b',
      message: { role: 'assistant', content: 'Ollama OK' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 6,
      eval_count: 2,
    }), { status: 200 });
  },
});
assert.deepEqual((await ollamaClient.listModels()).ids, ['qwen3:8b']);
const ollamaCompletion = await ollamaClient.createChatCompletion({
  model: 'qwen3:8b',
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.6,
  top_p: 0.9,
  seed: 42,
  max_tokens: 128,
  stop: 'END',
  response_format: { type: 'json_object' },
});
assert.equal(ollamaRequests[0].url, 'http://127.0.0.1:11434/api/tags');
assert.equal(ollamaRequests[0].options.headers.Authorization, undefined);
assert.equal(ollamaRequests[1].url, 'http://127.0.0.1:11434/api/chat');
assert.deepEqual(JSON.parse(ollamaRequests[1].options.body), {
  model: 'qwen3:8b',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: false,
  options: {
    temperature: 0.6,
    top_p: 0.9,
    seed: 42,
    num_predict: 128,
    stop: ['END'],
  },
  format: 'json',
});
assert.equal(ollamaCompletion.text, 'Ollama OK');
assert.deepEqual(ollamaCompletion.usage, {
  prompt_tokens: 6,
  completion_tokens: 2,
  total_tokens: 8,
});

const httpCases = [
  [401, 'authentication', false],
  [403, 'permission', false],
  [404, 'not-found', false],
  [429, 'rate-limit', true],
  [503, 'server-error', true],
];
for (const [status, code, retryable] of httpCases) {
  const errorClient = new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'never-echo-this-key',
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: 'never-echo-this-key', type: 'provider_error', code: `e${status}` },
    }), { status }),
  });
  await assert.rejects(
    () => errorClient.listModels(),
    (error) => {
      assert.equal(error instanceof StudioAiError, true);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.retryable, retryable);
      assert.equal(error.message.includes('never-echo-this-key'), false);
      assert.deepEqual(error.details, { type: 'provider_error', code: `e${status}` });
      assert.equal(JSON.stringify(error).includes('never-echo-this-key'), false, '可序列化错误不得回显 API Key');
      return true;
    },
  );
}

const redactionClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'secret-in-provider-code',
  fetchImpl: async () => new Response(JSON.stringify({
    error: { type: 'provider', code: 'echo-secret-in-provider-code' },
  }), { status: 400 }),
});
await assert.rejects(
  () => redactionClient.listModels(),
  (error) => error instanceof StudioAiError && error.details.code === '[redacted]',
);

const invalidJsonClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: async () => new Response('not json', { status: 200 }),
});
await assert.rejects(
  () => invalidJsonClient.listModels(),
  (error) => error instanceof StudioAiError && error.code === 'invalid-json',
);

const oversizedClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  maxResponseBytes: 8,
  fetchImpl: async () => new Response('0123456789', {
    status: 200,
    headers: { 'content-length': '10' },
  }),
});
await assert.rejects(
  () => oversizedClient.listModels(),
  (error) => error instanceof StudioAiError && error.code === 'response-too-large',
);

const chunkedOversizedClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  maxResponseBytes: 8,
  fetchImpl: async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('01234'));
      controller.enqueue(new TextEncoder().encode('56789'));
      controller.close();
    },
  }), { status: 200 }),
});
await assert.rejects(
  () => chunkedOversizedClient.listModels(),
  (error) => error instanceof StudioAiError && error.code === 'response-too-large',
);

const networkClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: async () => { throw new TypeError('CORS blocked'); },
});
await assert.rejects(
  () => networkClient.listModels(),
  (error) => error instanceof StudioAiError && error.code === 'network' && error.retryable === true,
);

const abortAwareFetch = async (_url, { signal }) => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(signal.reason || new Error('aborted'));
    return;
  }
  signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
});
const timeoutClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: abortAwareFetch,
  timeoutMs: 5,
});
await assert.rejects(
  () => timeoutClient.listModels(),
  (error) => error instanceof StudioAiError && error.code === 'timeout' && error.retryable === true,
);

const callerController = new AbortController();
callerController.abort(new Error('user cancelled'));
const cancelClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: abortAwareFetch,
});
await assert.rejects(
  () => cancelClient.listModels({ signal: callerController.signal }),
  (error) => error instanceof StudioAiError && error.code === 'cancelled',
);

const liveController = new AbortController();
const liveRequest = cancelClient.listModels({ signal: liveController.signal });
queueMicrotask(() => liveController.abort(new Error('cancel during request')));
await assert.rejects(
  () => liveRequest,
  (error) => error instanceof StudioAiError && error.code === 'cancelled',
);

const desktopInvocations = [];
const desktopFetch = createDesktopAiFetch({
  makeRequestId: () => 'desktop-request-1',
  invoke: async (command, args) => {
    desktopInvocations.push({ command, args });
    if (command !== 'desktop_ai_request') return false;
    return {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-rpn-transport': 'native' },
      body: args.request.operation === 'chatCompletions'
        ? JSON.stringify({ model: 'native-model', choices: [{ message: { content: 'OK' } }] })
        : JSON.stringify({ data: [{ id: 'native-model' }] }),
    };
  },
});
const desktopClient = new OpenAICompatibleClient({
  baseUrl: 'http://127.0.0.1:11434/v1',
  pageUrl: 'tauri://localhost/index.html#studio',
  allowLoopbackHttp: true,
  fetchImpl: desktopFetch,
  maxResponseBytes: 4_096,
});
assert.deepEqual((await desktopClient.listModels()).ids, ['native-model']);
assert.equal(desktopInvocations[0].command, 'desktop_ai_request');
assert.deepEqual(desktopInvocations[0].args.request, {
  requestId: 'desktop-request-1',
  baseUrl: 'http://127.0.0.1:11434/v1',
  operation: 'models',
  networkMode: 'direct',
  headers: { accept: 'application/json' },
  body: null,
  timeoutMs: 30_000,
  maxResponseBytes: 4_096,
});
const desktopChatBody = JSON.stringify({
  model: 'native-model',
  messages: [{ role: 'user', content: 'ping' }],
});
await desktopFetch('http://127.0.0.1:11434/v1/chat/completions', {
  method: 'POST',
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  body: desktopChatBody,
  timeoutMs: 12_000,
  maxResponseBytes: 2_048,
});
assert.deepEqual(desktopInvocations[1].args.request, {
  requestId: 'desktop-request-1',
  baseUrl: 'http://127.0.0.1:11434/v1',
  operation: 'chatCompletions',
  networkMode: 'direct',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: desktopChatBody,
  timeoutMs: 12_000,
  maxResponseBytes: 2_048,
});

for (const requestCase of [
  {
    url: 'https://api.openai.com/v1/responses',
    method: 'POST',
    apiFormat: 'openai-responses',
    operation: 'responses',
    baseUrl: 'https://api.openai.com/v1',
  },
  {
    url: 'https://api.anthropic.com/v1/models',
    method: 'GET',
    apiFormat: 'anthropic-messages',
    operation: 'anthropicModels',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    apiFormat: 'anthropic-messages',
    operation: 'anthropicMessages',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    method: 'GET',
    apiFormat: 'google-gemini',
    operation: 'geminiModels',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  {
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    method: 'POST',
    apiFormat: 'google-gemini',
    operation: 'geminiGenerateContent',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-pro',
  },
  {
    url: 'https://api.cohere.com/v1/models',
    method: 'GET',
    apiFormat: 'cohere-v2',
    operation: 'cohereModels',
    baseUrl: 'https://api.cohere.com',
  },
  {
    url: 'https://api.cohere.com/v2/chat',
    method: 'POST',
    apiFormat: 'cohere-v2',
    operation: 'cohereChat',
    baseUrl: 'https://api.cohere.com',
  },
  {
    url: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    method: 'POST',
    apiFormat: 'dashscope-native',
    operation: 'dashscopeGeneration',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
  },
  {
    url: 'http://127.0.0.1:11434/api/tags',
    method: 'GET',
    apiFormat: 'ollama-native',
    operation: 'ollamaTags',
    baseUrl: 'http://127.0.0.1:11434',
  },
  {
    url: 'http://127.0.0.1:11434/api/chat',
    method: 'POST',
    apiFormat: 'ollama-native',
    operation: 'ollamaChat',
    baseUrl: 'http://127.0.0.1:11434',
  },
]) {
  await desktopFetch(requestCase.url, {
    method: requestCase.method,
    apiFormat: requestCase.apiFormat,
    networkMode: 'systemProxy',
    ...(requestCase.method === 'POST' ? { body: '{}' } : {}),
  });
  const invocation = desktopInvocations.at(-1);
  assert.equal(invocation.args.request.operation, requestCase.operation);
  assert.equal(invocation.args.request.baseUrl, requestCase.baseUrl);
  assert.equal(invocation.args.request.networkMode, 'systemProxy');
  assert.equal('apiFormat' in invocation.args.request, false, 'IPC 不得发送 Rust 未声明的 apiFormat 字段');
  if (requestCase.model) {
    assert.equal(invocation.args.request.model, requestCase.model);
  } else {
    assert.equal('model' in invocation.args.request, false, '仅 Gemini generateContent 可携带 model');
  }
}

const desktopInvocationCount = desktopInvocations.length;
for (const [url, method] of [
  ['https://api.example.com/v1/models?limit=1', 'GET'],
  ['https://api.example.com/v1/chat/completions#debug', 'POST'],
  ['https://api.example.com/v1/embeddings', 'POST'],
  ['https://api.example.com/v1/models', 'POST'],
]) {
  await assert.rejects(
    () => desktopFetch(url, { method }),
    (error) => error instanceof StudioAiError && error.code === 'desktop-transport-invalid',
    `${method} ${url} 不得进入桌面原生通道`,
  );
}
assert.equal(desktopInvocations.length, desktopInvocationCount, '无效端点不得调用 Tauri');
await assert.rejects(
  () => desktopFetch('https://api.example.com/v1/messages', {
    method: 'POST',
    apiFormat: 'google-gemini',
    body: '{}',
  }),
  (error) => error instanceof StudioAiError && error.code === 'desktop-transport-invalid',
  'API 格式与端点不匹配时不得调用 Tauri',
);
assert.equal(desktopInvocations.length, desktopInvocationCount);
await assert.rejects(
  () => desktopFetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini%2Fescape:generateContent',
    { method: 'POST', apiFormat: 'google-gemini', body: '{}' },
  ),
  (error) => error instanceof StudioAiError && ['invalid-model', 'desktop-transport-invalid'].includes(error.code),
  'Gemini model 不得通过编码斜杠逃逸单段路径',
);
assert.equal(desktopInvocations.length, desktopInvocationCount);

const nativeErrorFetch = createDesktopAiFetch({
  makeRequestId: () => 'desktop-request-error',
  invoke: async () => {
    throw { code: 'tls', message: 'TLS 握手失败。', retryable: false };
  },
});
await assert.rejects(
  () => new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1',
    fetchImpl: nativeErrorFetch,
  }).listModels(),
  (error) => error instanceof StudioAiError
    && error.code === 'tls'
    && error.message === 'TLS 握手失败。'
    && error.retryable === false,
);

let releaseDesktopRequest;
const cancelledDesktopInvocations = [];
const cancelledDesktopFetch = createDesktopAiFetch({
  makeRequestId: () => 'desktop-request-cancel',
  invoke: async (command, args) => {
    cancelledDesktopInvocations.push({ command, args });
    if (command === 'desktop_ai_cancel') return true;
    return new Promise((resolve) => {
      releaseDesktopRequest = resolve;
    });
  },
});
const desktopAbortController = new AbortController();
const cancelledDesktopRequest = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: cancelledDesktopFetch,
}).listModels({ signal: desktopAbortController.signal });
desktopAbortController.abort(new Error('stop native request'));
await assert.rejects(
  () => cancelledDesktopRequest,
  (error) => error instanceof StudioAiError && error.code === 'cancelled',
);
assert.equal(cancelledDesktopInvocations[1].command, 'desktop_ai_cancel');
assert.deepEqual(cancelledDesktopInvocations[1].args, { requestId: 'desktop-request-cancel' });
releaseDesktopRequest?.({
  status: 499,
  headers: { 'content-type': 'application/json' },
  body: '{}',
});

const timedOutDesktopInvocations = [];
const timedOutDesktopFetch = createDesktopAiFetch({
  makeRequestId: () => 'desktop-request-timeout',
  invoke: async (command, args) => {
    timedOutDesktopInvocations.push({ command, args });
    if (command === 'desktop_ai_cancel') return true;
    return new Promise(() => {});
  },
});
await assert.rejects(
  () => new OpenAICompatibleClient({
    baseUrl: 'https://api.example.com/v1',
    fetchImpl: timedOutDesktopFetch,
    timeoutMs: 5,
  }).listModels(),
  (error) => error instanceof StudioAiError && error.code === 'timeout',
);
assert.equal(timedOutDesktopInvocations[1].command, 'desktop_ai_cancel');
assert.equal(timedOutDesktopInvocations[0].args.request.timeoutMs, 5);

const arrayContentClient = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1',
  fetchImpl: async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: [
          { type: 'text', text: '分段' },
          { type: 'output_text', text: '正文' },
          { type: 'image', image_url: 'ignored' },
        ],
      },
    }],
  }), { status: 200 }),
});
assert.equal((await arrayContentClient.createChatCompletion({
  model: 'model-a',
  messages: [{ role: 'user', content: 'test' }],
})).text, '分段正文');

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

console.log('studio_ai.test.mjs: ok');
