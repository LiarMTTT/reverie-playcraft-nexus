import assert from 'node:assert/strict';
import {
  STUDIO_AI_CONNECTION_MODES,
  STUDIO_AI_CREDENTIAL_KINDS,
  STUDIO_AI_PROVIDER_GROUPS,
  STUDIO_AI_PROVIDER_PRESETS,
  STUDIO_CODING_PLAN_PRESETS,
  applyCodingPlanPreset,
  applyProviderPreset,
  codingPlanPreset,
  credentialStorageBucket,
  normalizeConnectionMode,
  normalizeCodingPlanPreset,
  normalizeCredentialKind,
  normalizeProviderPreset,
  profileDelegationAllowed,
  profileConnectionMode,
  providerPreset,
  reconcileApiProfilePresetState,
  sanitizeApiProfileCredentialMetadata,
} from '../portal/assets/studio-api-profiles.js';

assert.deepEqual(Object.keys(STUDIO_AI_CONNECTION_MODES), ['provider', 'codingPlan', 'custom']);
assert.equal(normalizeConnectionMode('provider'), 'provider');
assert.equal(normalizeConnectionMode('unknown'), 'custom');
assert.equal(normalizeCredentialKind('sessionApiKey'), 'sessionApiKey');
assert.equal(normalizeCredentialKind('sessionCodingPlanKey'), 'sessionCodingPlanKey');
assert.equal(normalizeCredentialKind('oauth'), 'sessionApiKey', 'CLI/OAuth 不得成为隐式凭证类型');
assert.notEqual(
  STUDIO_AI_CREDENTIAL_KINDS.sessionApiKey.storageBucket,
  STUDIO_AI_CREDENTIAL_KINDS.sessionCodingPlanKey.storageBucket,
  '普通 Key 与 Coding Plan Key 必须使用独立会话桶',
);
assert.equal(credentialStorageBucket({ credentialKind: 'sessionApiKey' }), 'api');
assert.equal(credentialStorageBucket({ credentialKind: 'sessionCodingPlanKey' }), 'codingPlan');

assert.deepEqual(Object.keys(STUDIO_AI_PROVIDER_GROUPS), ['direct', 'china', 'gateway', 'local', 'custom']);
assert.ok(Object.keys(STUDIO_AI_PROVIDER_PRESETS).length >= 25, '设置页应覆盖绝大多数常用官方、聚合与本机模型服务');
for (const [id, preset] of Object.entries(STUDIO_AI_PROVIDER_PRESETS)) {
  assert.ok(Object.hasOwn(STUDIO_AI_PROVIDER_GROUPS, preset.group), `${id} 必须属于已知分组`);
  assert.equal(providerPreset(id), preset);
  if (preset.baseUrl) assert.ok(['https:', 'http:'].includes(new URL(preset.baseUrl).protocol), `${id} Base URL 必须可解析`);
}
assert.equal(normalizeProviderPreset('unknown-provider'), 'custom');
assert.match(STUDIO_AI_PROVIDER_PRESETS.custom.label, /不使用预设.*手动配置/, '服务商预设必须明确为可选项');
assert.deepEqual(
  applyProviderPreset({ baseUrl: '', apiFormat: 'openai-compatible' }, 'openai'),
  {
    baseUrl: 'https://api.openai.com/v1',
    apiFormat: 'openai-responses',
    providerPreset: 'openai',
  },
);
const retainedGateway = applyProviderPreset({
  baseUrl: 'https://gateway.example.test/v1',
  apiFormat: 'openai-compatible',
  providerPreset: 'custom',
}, 'anthropic');
assert.equal(retainedGateway.baseUrl, 'https://api.anthropic.com/v1', '固定供应商预设必须接管 Base URL');
assert.equal(retainedGateway.apiFormat, 'anthropic-messages');
const explicitCustomGateway = applyProviderPreset({
  baseUrl: 'https://gateway.example.test/v1',
  apiFormat: 'openai-compatible',
  providerPreset: 'custom',
}, 'anthropic', { overwriteBaseUrl: false });
assert.equal(explicitCustomGateway.baseUrl, 'https://gateway.example.test/v1', '自定义模式仍可显式保留代理网关');

assert.deepEqual(Object.keys(STUDIO_CODING_PLAN_PRESETS), ['aliyun', 'minimax', 'glm', 'kimi']);
for (const [id, preset] of Object.entries(STUDIO_CODING_PLAN_PRESETS)) {
  assert.equal(new URL(preset.baseUrl).protocol, 'https:', `${id} 必须使用 HTTPS`);
  assert.equal(preset.delegationAllowed, false, `${id} 不得进入自动子代理扇出`);
  assert.equal(codingPlanPreset(id), preset);
}
assert.equal(normalizeCodingPlanPreset('aliyun', 'sessionApiKey'), '');
assert.equal(normalizeCodingPlanPreset('aliyun', 'sessionCodingPlanKey'), 'aliyun');
assert.equal(profileDelegationAllowed({ credentialKind: 'sessionApiKey' }), true);
assert.equal(profileDelegationAllowed({ credentialKind: 'sessionCodingPlanKey', codingPlanPreset: 'glm' }), false);
assert.match(
  STUDIO_CODING_PLAN_PRESETS.kimi.usageBoundary,
  /RPN 未在支持列表/,
  'Kimi Code 预设必须明确当前第三方客户端授权边界',
);
assert.match(
  STUDIO_CODING_PLAN_PRESETS.glm.usageBoundary,
  /RPN 是否在当前支持范围需由你先行确认/,
  'GLM Coding Plan 预设必须明确指定工具授权边界',
);

const aliyun = applyCodingPlanPreset({ baseUrl: '', apiFormat: 'anthropic-messages' }, 'aliyun');
assert.equal(aliyun.baseUrl, 'https://coding.dashscope.aliyuncs.com/v1');
assert.equal(aliyun.apiFormat, 'openai-compatible');
assert.equal(aliyun.credentialKind, 'sessionCodingPlanKey');
assert.equal(aliyun.codingPlanPreset, 'aliyun');

const minimax = applyCodingPlanPreset({ baseUrl: '', apiFormat: 'openai-compatible' }, 'minimax');
assert.equal(
  minimax.baseUrl,
  'https://api.minimax.io/anthropic/v1',
  'RPN 直连必须包含 /v1，随后才会拼接 /messages',
);
assert.equal(
  new URL('messages', `${minimax.baseUrl}/`).href,
  'https://api.minimax.io/anthropic/v1/messages',
);

const customBase = applyCodingPlanPreset({
  baseUrl: 'https://gateway.example.test/coding',
  codingPlanPreset: 'aliyun',
}, 'minimax');
assert.equal(customBase.baseUrl, STUDIO_CODING_PLAN_PRESETS.minimax.baseUrl, '固定套餐预设必须接管 Base URL');
assert.equal(customBase.apiFormat, 'anthropic-messages');

const previousDefault = applyCodingPlanPreset({
  baseUrl: STUDIO_CODING_PLAN_PRESETS.aliyun.baseUrl,
  codingPlanPreset: 'aliyun',
}, 'glm');
assert.equal(previousDefault.baseUrl, STUDIO_CODING_PLAN_PRESETS.glm.baseUrl);

const canonicalProviderProfile = reconcileApiProfilePresetState({
  baseUrl: 'https://api.moonshot.cn/v1/',
  apiFormat: 'openai-compatible',
  providerPreset: 'kimi',
  credentialKind: 'sessionApiKey',
  codingPlanPreset: 'aliyun',
});
assert.equal(canonicalProviderProfile.providerPreset, 'kimi');
assert.equal(canonicalProviderProfile.codingPlanPreset, '');
assert.equal(profileConnectionMode(canonicalProviderProfile), 'provider');

const conflictingLegacyProvider = reconcileApiProfilePresetState({
  baseUrl: STUDIO_CODING_PLAN_PRESETS.aliyun.baseUrl,
  apiFormat: 'openai-compatible',
  providerPreset: 'kimi',
  credentialKind: 'sessionApiKey',
});
assert.equal(conflictingLegacyProvider.providerPreset, 'custom', '端点与供应商冲突的旧配置必须降级为自定义');
assert.equal(conflictingLegacyProvider.baseUrl, STUDIO_CODING_PLAN_PRESETS.aliyun.baseUrl, '旧配置降级不得覆盖用户端点');
assert.equal(profileConnectionMode(conflictingLegacyProvider), 'custom');

const canonicalCodingPlanProfile = reconcileApiProfilePresetState({
  baseUrl: STUDIO_CODING_PLAN_PRESETS.glm.baseUrl,
  apiFormat: STUDIO_CODING_PLAN_PRESETS.glm.apiFormat,
  providerPreset: 'glm',
  credentialKind: 'sessionCodingPlanKey',
  codingPlanPreset: 'glm',
});
assert.equal(canonicalCodingPlanProfile.providerPreset, 'custom');
assert.equal(canonicalCodingPlanProfile.codingPlanPreset, 'glm');
assert.equal(profileConnectionMode(canonicalCodingPlanProfile), 'codingPlan');

const conflictingLegacyCodingPlan = reconcileApiProfilePresetState({
  baseUrl: 'https://gateway.example.test/coding',
  apiFormat: 'openai-compatible',
  credentialKind: 'sessionCodingPlanKey',
  codingPlanPreset: 'aliyun',
});
assert.equal(conflictingLegacyCodingPlan.codingPlanPreset, '', '冲突套餐必须降级为手动 Coding Plan');
assert.equal(conflictingLegacyCodingPlan.baseUrl, 'https://gateway.example.test/coding');

assert.deepEqual(
  sanitizeApiProfileCredentialMetadata({
    credentialKind: 'sessionCodingPlanKey',
    codingPlanPreset: 'kimi',
    apiKey: 'must-not-persist',
    accessToken: 'must-not-persist',
  }),
  { credentialKind: 'sessionCodingPlanKey', codingPlanPreset: 'kimi' },
);

console.log('[ok] API credential and Coding Plan profile contracts passed');
