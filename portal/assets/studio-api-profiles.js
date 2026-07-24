/**
 * API 配置档的凭证分层与 Coding Plan 预设。
 *
 * 本模块只保存不含密钥的元数据。普通 API Key 与 Coding Plan Key 必须由
 * 调用方放进不同的会话内存容器，不能自动导入 CLI/OAuth 凭证或彼此回退。
 */

'use strict';

const DEFAULT_CREDENTIAL_KIND = 'sessionApiKey';
const DEFAULT_PROVIDER_PRESET = 'custom';
const DEFAULT_CONNECTION_MODE = 'custom';
const STUDIO_AI_CONNECTION_MODES = Object.freeze({
  provider: Object.freeze({
    label: '供应商 API',
    help: '由供应商预设管理原生格式与固定端点。',
  }),
  codingPlan: Object.freeze({
    label: 'Coding Plan',
    help: '套餐 Key 与普通 API Key 分开保存。',
  }),
  custom: Object.freeze({
    label: '自定义 / 本地服务',
    help: '手动配置原生格式、Base URL 与模型。',
  }),
});
const STUDIO_AI_CREDENTIAL_KINDS = Object.freeze({
  sessionApiKey: Object.freeze({
    label: '按量 API Key',
    shortLabel: 'API Key',
    storageBucket: 'api',
    delegationAllowed: true,
    help: '用于普通按量 API；Key 只驻留当前页面会话。',
  }),
  sessionCodingPlanKey: Object.freeze({
    label: 'Coding Plan Key',
    shortLabel: 'Coding Plan Key',
    storageBucket: 'codingPlan',
    delegationAllowed: false,
    help: '与按量 Key 分开保存；仅用于用户发起的交互请求，不参与后台或子代理扇出。',
  }),
});

const STUDIO_CODING_PLAN_PRESETS = Object.freeze({
  aliyun: Object.freeze({
    label: '阿里云百炼 Coding Plan',
    provider: 'Alibaba Cloud Model Studio',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    modelPlaceholder: '填写套餐支持的模型名',
    termsUrl: 'https://help.aliyun.com/en/model-studio/coding-plan',
    delegationAllowed: false,
    usageBoundary: '仅供用户主动发起的交互式 coding 请求；不要用于自动脚本或批处理。',
  }),
  minimax: Object.freeze({
    label: 'MiniMax Token Plan',
    provider: 'MiniMax',
    apiFormat: 'anthropic-messages',
    // MiniMax documents the SDK base as /anthropic because the Anthropic SDK
    // appends /v1/messages. RPN calls the HTTP endpoint directly, so its
    // stored base must include /v1 before providerChatEndpoint adds /messages.
    baseUrl: 'https://api.minimax.io/anthropic/v1',
    modelPlaceholder: '填写 Token Plan 支持的模型名',
    termsUrl: 'https://platform.minimax.io/docs/token-plan/quickstart',
    delegationAllowed: false,
    usageBoundary: '套餐 Key 与普通按量 Key 分离；RPN 不将其用于无人值守扇出。',
  }),
  glm: Object.freeze({
    label: '智谱 GLM Coding Plan',
    provider: 'Zhipu AI',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    modelPlaceholder: '填写 Coding Plan 支持的模型名',
    termsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
    delegationAllowed: false,
    usageBoundary: '官方声明仅限指定工具与产品环境；RPN 是否在当前支持范围需由你先行确认。RPN 不做自动回退、批处理或子代理扇出。',
  }),
  kimi: Object.freeze({
    label: 'Kimi Code',
    provider: 'Moonshot AI',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.kimi.com/coding/v1',
    modelPlaceholder: '填写 Kimi Code 支持的模型名',
    termsUrl: 'https://www.kimi.com/help/kimi-code/third-party-agents',
    delegationAllowed: false,
    usageBoundary: '官方当前仅列出 Kimi Code CLI、Claude Code 与 Roo Code；RPN 未在支持列表，使用前请自行确认授权，否则可能被限制访问。RPN 不绕过客户端限制。',
  }),
});

const STUDIO_AI_PROVIDER_GROUPS = Object.freeze({
  direct: '模型官方',
  china: '国产模型',
  gateway: '聚合与云推理',
  local: '本机与自建',
  custom: '自定义',
});

const STUDIO_AI_PROVIDER_PRESETS = Object.freeze({
  openai: Object.freeze({
    label: 'OpenAI',
    group: 'direct',
    apiFormat: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: '例如：gpt-5',
    help: '优先使用 Responses；旧 Chat Completions 配置仍可保留。',
  }),
  xai: Object.freeze({
    label: 'xAI · Grok',
    group: 'direct',
    apiFormat: 'openai-responses',
    baseUrl: 'https://api.x.ai/v1',
    modelPlaceholder: '填写 xAI 当前模型名',
    help: '使用 xAI 的 Responses 接口。',
  }),
  anthropic: Object.freeze({
    label: 'Anthropic · Claude',
    group: 'direct',
    apiFormat: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    modelPlaceholder: '填写 Claude 模型名',
    help: '使用 Anthropic Messages 与 x-api-key。',
  }),
  google: Object.freeze({
    label: 'Google · Gemini',
    group: 'direct',
    apiFormat: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    modelPlaceholder: '填写 Gemini 模型名',
    help: '使用 Gemini Developer API；Vertex AI 需要另行配置企业认证。',
  }),
  cohere: Object.freeze({
    label: 'Cohere · Command',
    group: 'direct',
    apiFormat: 'cohere-v2',
    baseUrl: 'https://api.cohere.com',
    modelPlaceholder: '填写 Command 模型名',
    help: '使用 Cohere v2 Chat，模型列表来自 v1 Models。',
  }),
  mistral: Object.freeze({
    label: 'Mistral AI',
    group: 'direct',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    modelPlaceholder: '填写 Mistral / Codestral 模型名',
    help: '文本与工具调用复用 OpenAI Chat Completions 兼容格式。',
  }),
  deepseek: Object.freeze({
    label: 'DeepSeek',
    group: 'china',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    modelPlaceholder: '填写 DeepSeek 模型名',
    help: '复用 OpenAI Chat Completions 兼容格式。',
  }),
  qwen: Object.freeze({
    label: '阿里云百炼 · Qwen（兼容）',
    group: 'china',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelPlaceholder: '填写 Qwen 模型名',
    help: '适合普通文本与工具调用；使用 OpenAI 兼容端点。',
  }),
  'qwen-native': Object.freeze({
    label: '阿里云百炼 · Qwen（原生）',
    group: 'china',
    apiFormat: 'dashscope-native',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
    modelPlaceholder: '填写 Qwen / DashScope 模型名',
    help: '使用 DashScope 原生文本生成接口；模型名需要手动填写。',
  }),
  kimi: Object.freeze({
    label: 'Moonshot AI · Kimi',
    group: 'china',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    modelPlaceholder: '填写 Kimi 模型名',
    help: '复用 OpenAI Chat Completions 兼容格式。',
  }),
  glm: Object.freeze({
    label: '智谱 AI · GLM',
    group: 'china',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    modelPlaceholder: '填写 GLM 模型名',
    help: '复用 OpenAI Chat Completions 兼容格式。',
  }),
  minimax: Object.freeze({
    label: 'MiniMax',
    group: 'china',
    apiFormat: 'anthropic-messages',
    baseUrl: 'https://api.minimaxi.com/anthropic/v1',
    modelPlaceholder: '填写 MiniMax 模型名',
    help: '使用官方推荐的 Anthropic Messages 兼容接口。',
  }),
  volcengine: Object.freeze({
    label: '火山方舟 · 豆包 / Seed',
    group: 'china',
    apiFormat: 'openai-responses',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    modelPlaceholder: '填写模型名或推理接入点 ID',
    help: '使用火山方舟 Responses；Coding Plan 与按量端点必须分开。',
  }),
  qianfan: Object.freeze({
    label: '百度千帆 · ERNIE',
    group: 'china',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    modelPlaceholder: '填写 ERNIE 或千帆模型名',
    help: '复用千帆 OpenAI 兼容接口。',
  }),
  hunyuan: Object.freeze({
    label: '腾讯 TokenHub · 混元 / DeepSeek',
    group: 'china',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://tokenhub.tencentmaas.com/v1',
    modelPlaceholder: '填写 TokenHub 服务 ID',
    help: '使用腾讯 TokenHub 当前 OpenAI 兼容入口；国际站需改为对应地域地址。',
  }),
  openrouter: Object.freeze({
    label: 'OpenRouter',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelPlaceholder: '例如：meta-llama/…',
    help: '一个配置可访问多个模型供应商；可选归因头不属于必需鉴权。',
  }),
  groq: Object.freeze({
    label: 'Groq',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelPlaceholder: '填写 Groq 当前模型名',
    help: '复用 Groq 的 OpenAI 兼容接口。',
  }),
  together: Object.freeze({
    label: 'Together AI',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.together.ai/v1',
    modelPlaceholder: '填写命名空间模型名',
    help: '复用 Together 的 OpenAI 兼容接口。',
  }),
  fireworks: Object.freeze({
    label: 'Fireworks AI',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    modelPlaceholder: '填写 Fireworks 模型名',
    help: '复用 Fireworks 的 OpenAI 兼容接口。',
  }),
  huggingface: Object.freeze({
    label: 'Hugging Face Inference',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://router.huggingface.co/v1',
    modelPlaceholder: '例如：meta-llama/…:fastest',
    help: '使用 Inference Providers 的 OpenAI 兼容 Chat 端点。',
  }),
  perplexity: Object.freeze({
    label: 'Perplexity · Sonar',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.perplexity.ai',
    modelPlaceholder: '填写 Sonar 模型名',
    help: '复用 OpenAI Chat Completions 兼容格式。',
  }),
  siliconflow: Object.freeze({
    label: '硅基流动',
    group: 'gateway',
    apiFormat: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    modelPlaceholder: '填写平台模型名',
    help: '复用 OpenAI Chat Completions 兼容格式。',
  }),
  ollama: Object.freeze({
    label: 'Ollama',
    group: 'local',
    apiFormat: 'ollama-native',
    baseUrl: 'http://127.0.0.1:11434',
    modelPlaceholder: '例如：qwen3',
    help: '使用 Ollama 原生模型列表与聊天接口。',
  }),
  'lm-studio': Object.freeze({
    label: 'LM Studio',
    group: 'local',
    apiFormat: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    modelPlaceholder: '填写已载入模型名',
    help: '使用 LM Studio 本机 OpenAI 兼容服务。',
  }),
  vllm: Object.freeze({
    label: 'vLLM / NVIDIA NIM',
    group: 'local',
    apiFormat: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelPlaceholder: '填写已部署模型名',
    help: '使用 vLLM 或 NIM 的 OpenAI 兼容服务；端口可按部署修改。',
  }),
  localai: Object.freeze({
    label: 'LocalAI',
    group: 'local',
    apiFormat: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8080/v1',
    modelPlaceholder: '填写已部署模型名',
    help: '使用 LocalAI 本机 OpenAI 兼容服务。',
  }),
  azure: Object.freeze({
    label: 'Azure OpenAI / Foundry',
    group: 'gateway',
    apiFormat: 'openai-responses',
    baseUrl: '',
    baseUrlPlaceholder: 'https://<resource>.openai.azure.com/openai/v1',
    modelPlaceholder: '填写部署名',
    help: '需要填写自己的资源地址；RPN 不读取 Azure CLI 或 Entra 凭证。',
  }),
  custom: Object.freeze({
    label: '不使用预设 · 手动配置',
    group: 'custom',
    apiFormat: 'openai-compatible',
    baseUrl: '',
    baseUrlPlaceholder: 'https://api.example.com/v1',
    modelPlaceholder: '填写服务端模型名',
    help: '服务商预设是可选项；可直接手动选择协议、Base URL 与模型。',
  }),
});

function normalizeCredentialKind(value) {
  return Object.hasOwn(STUDIO_AI_CREDENTIAL_KINDS, value) ? value : DEFAULT_CREDENTIAL_KIND;
}

function normalizeProviderPreset(value) {
  return Object.hasOwn(STUDIO_AI_PROVIDER_PRESETS, value) ? value : DEFAULT_PROVIDER_PRESET;
}

function normalizeConnectionMode(value) {
  return Object.hasOwn(STUDIO_AI_CONNECTION_MODES, value) ? value : DEFAULT_CONNECTION_MODE;
}

function providerPreset(value) {
  return STUDIO_AI_PROVIDER_PRESETS[normalizeProviderPreset(value)];
}

function applyProviderPreset(profile, presetId, {
  overwriteBaseUrl = true,
  previousPresetId = profile?.providerPreset,
} = {}) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const nextId = normalizeProviderPreset(presetId);
  const nextPreset = providerPreset(nextId);
  if (nextId === DEFAULT_PROVIDER_PRESET) {
    return { ...source, providerPreset: DEFAULT_PROVIDER_PRESET };
  }
  const previousPreset = providerPreset(previousPresetId);
  const currentBaseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  const replaceBaseUrl = overwriteBaseUrl
    || !currentBaseUrl
    || Boolean(previousPreset?.baseUrl && currentBaseUrl === previousPreset.baseUrl);
  return {
    ...source,
    providerPreset: nextId,
    apiFormat: nextPreset.apiFormat,
    baseUrl: nextPreset.baseUrl && replaceBaseUrl ? nextPreset.baseUrl : currentBaseUrl,
  };
}

function normalizeCodingPlanPreset(value, credentialKind = DEFAULT_CREDENTIAL_KIND) {
  if (normalizeCredentialKind(credentialKind) !== 'sessionCodingPlanKey') return '';
  return Object.hasOwn(STUDIO_CODING_PLAN_PRESETS, value) ? value : '';
}

function credentialStorageBucket(profile) {
  return STUDIO_AI_CREDENTIAL_KINDS[normalizeCredentialKind(profile?.credentialKind)].storageBucket;
}

function codingPlanPreset(value) {
  return STUDIO_CODING_PLAN_PRESETS[normalizeCodingPlanPreset(value, 'sessionCodingPlanKey')] || null;
}

function profileDelegationAllowed(profile) {
  const kind = STUDIO_AI_CREDENTIAL_KINDS[normalizeCredentialKind(profile?.credentialKind)];
  if (!kind.delegationAllowed) return false;
  const preset = codingPlanPreset(profile?.codingPlanPreset);
  return preset ? preset.delegationAllowed === true : true;
}

function applyCodingPlanPreset(profile, presetId, {
  overwriteBaseUrl = true,
  previousPresetId = profile?.codingPlanPreset,
} = {}) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const nextPreset = codingPlanPreset(presetId);
  if (!nextPreset) {
    return {
      ...source,
      credentialKind: 'sessionCodingPlanKey',
      codingPlanPreset: '',
    };
  }
  const previousPreset = codingPlanPreset(previousPresetId);
  const currentBaseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  const replaceBaseUrl = overwriteBaseUrl
    || !currentBaseUrl
    || (previousPreset && currentBaseUrl === previousPreset.baseUrl);
  return {
    ...source,
    credentialKind: 'sessionCodingPlanKey',
    codingPlanPreset: presetId,
    apiFormat: nextPreset.apiFormat,
    baseUrl: replaceBaseUrl ? nextPreset.baseUrl : currentBaseUrl,
  };
}

function samePresetEndpoint(left, right) {
  return String(left || '').trim().replace(/\/+$/, '') === String(right || '').trim().replace(/\/+$/, '');
}

function reconcileApiProfilePresetState(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const credential = sanitizeApiProfileCredentialMetadata(source);
  const baseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  const apiFormat = typeof source.apiFormat === 'string' ? source.apiFormat : '';
  if (credential.credentialKind === 'sessionCodingPlanKey') {
    const plan = codingPlanPreset(credential.codingPlanPreset);
    const planMatches = Boolean(
      plan
      && apiFormat === plan.apiFormat
      && samePresetEndpoint(baseUrl, plan.baseUrl)
    );
    return {
      ...source,
      baseUrl,
      providerPreset: DEFAULT_PROVIDER_PRESET,
      credentialKind: 'sessionCodingPlanKey',
      codingPlanPreset: planMatches ? credential.codingPlanPreset : '',
    };
  }
  const providerId = normalizeProviderPreset(source.providerPreset);
  const preset = providerPreset(providerId);
  const providerMatches = providerId !== DEFAULT_PROVIDER_PRESET
    && apiFormat === preset.apiFormat
    && (!preset.baseUrl || samePresetEndpoint(baseUrl, preset.baseUrl));
  return {
    ...source,
    baseUrl,
    providerPreset: providerMatches ? providerId : DEFAULT_PROVIDER_PRESET,
    credentialKind: DEFAULT_CREDENTIAL_KIND,
    codingPlanPreset: '',
  };
}

function profileConnectionMode(profile) {
  const reconciled = reconcileApiProfilePresetState(profile);
  if (reconciled.credentialKind === 'sessionCodingPlanKey') return 'codingPlan';
  return reconciled.providerPreset === DEFAULT_PROVIDER_PRESET ? 'custom' : 'provider';
}

function sanitizeApiProfileCredentialMetadata(profile) {
  const source = profile && typeof profile === 'object' ? profile : {};
  const credentialKind = normalizeCredentialKind(source.credentialKind);
  return {
    credentialKind,
    codingPlanPreset: normalizeCodingPlanPreset(source.codingPlanPreset, credentialKind),
  };
}

export {
  DEFAULT_CONNECTION_MODE,
  DEFAULT_CREDENTIAL_KIND,
  DEFAULT_PROVIDER_PRESET,
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
};
