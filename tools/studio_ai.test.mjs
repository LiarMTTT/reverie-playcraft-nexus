import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AirpPresetError,
  OpenAICompatibleClient,
  StudioAiError,
  assembleAirpPrompt,
  importAirpPreset,
  inspectAirpPreset,
  normalizeOpenAiBaseUrl,
  parseAgentTurnResponse,
  summarizeAirpPreset,
  validateAirpPreset,
} from '../portal/assets/studio-ai.js';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(toolsDir, '..', 'portal', 'assets', 'studio-ai.js'), 'utf8');

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
})), {
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
})).proposal, null, '非白名单操作不得成为 Agent 提案');

assert.equal(
  normalizeOpenAiBaseUrl(' https://API.Example.com/v1/// '),
  'https://api.example.com/v1',
);
assert.equal(
  normalizeOpenAiBaseUrl('http://127.0.0.1:11434/v1', { pageUrl: 'http://localhost:4174/studio' }),
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

const client = new OpenAICompatibleClient({
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'test-secret-key',
  fetchImpl: successfulFetch,
});
assert.equal(client.baseUrl, 'https://api.example.com/v1');
assert.equal(client.hasApiKey, true);
assert.equal(JSON.stringify(client).includes('test-secret-key'), false, '序列化客户端不得泄漏 API Key');
assert.deepEqual(client.toJSON(), { baseUrl: 'https://api.example.com/v1', hasApiKey: true });
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
assert.equal(completionRequest.options.headers.Authorization, 'Bearer test-secret-key');

client.clearApiKey();
assert.equal(client.hasApiKey, false);
await client.listModels({ apiKey: 'one-shot-key' });
assert.equal(capturedRequests[2].options.headers.Authorization, 'Bearer one-shot-key');
assert.equal(JSON.stringify(client).includes('one-shot-key'), false);

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
