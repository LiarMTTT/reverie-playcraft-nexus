export const WORKFLOW_BLUEPRINT_FORMAT = 'rolecard-workflow-blueprint';
export const WORKFLOW_BLUEPRINT_VERSION = 1;
export const WORKFLOW_BLUEPRINT_GENERATOR_VERSION = 'p1-v2';

const ENGINES = new Set(['mvu', 'database']);
const VIEW_MODES = new Set(['simple', 'advanced']);
const NODE_KINDS = new Set(['source', 'rule', 'runtime', 'consumer', 'evidence', 'boundary']);
const NODE_STATES = new Set(['ready', 'missing', 'warning', 'planned', 'needs_real']);
const CHECK_STATES = new Set(['pass', 'missing', 'warning', 'planned', 'needs_real']);
const EDGE_LEVELS = new Set(['simple', 'advanced']);
const EDGE_RELATIONS = new Set(['data', 'control', 'evidence']);
const MAX_NODES = 64;
const MAX_EDGES = 128;
const MAX_LAYOUT_COORDINATE = 8192;
const MAX_NODE_LABEL_LENGTH = 80;
const MAX_NODE_DESCRIPTION_LENGTH = 1200;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function finiteInteger(value, fallback = 1) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
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
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function port(id, label, type) {
  return { id, label, type };
}

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

function layout(simpleColumn, simpleRow, advancedColumn, advancedRow) {
  return {
    simple: simpleColumn ? { column: simpleColumn, row: simpleRow || 1 } : null,
    advanced: { column: advancedColumn, row: advancedRow || 1 },
  };
}

function node({
  id,
  engine,
  kind,
  group,
  label,
  description,
  phase = 'P0',
  state = 'planned',
  sourceRoute = '',
  simple = false,
  nodeLayout,
  inputs = [],
  outputs = [],
  checks = [],
}) {
  return {
    id,
    engine,
    kind,
    group,
    label,
    description,
    phase,
    state,
    sourceRoute,
    simple,
    layout: nodeLayout,
    ports: { inputs, outputs },
    checks,
  };
}

function edge(id, engine, level, sourceNode, sourcePort, targetNode, targetPort, relation = 'data') {
  return {
    id,
    engine,
    level,
    relation,
    source: { nodeId: sourceNode, portId: sourcePort },
    target: { nodeId: targetNode, portId: targetPort },
  };
}

function normalizeWorkspace(workspace = {}) {
  const state = isRecord(workspace.state) ? workspace.state : {};
  const entries = Array.isArray(workspace.worldbookEntries) ? workspace.worldbookEntries : [];
  const components = Array.isArray(workspace.selectedComponents) ? workspace.selectedComponents : [];
  const builder = isRecord(workspace.builder) ? workspace.builder : {};
  return {
    state: {
      kind: ['none', 'mvu', 'database', 'other'].includes(state.kind) ? state.kind : 'none',
      updateDialect: ['rfc6902', 'official_jsonpatch', 'native'].includes(state.updateDialect) ? state.updateDialect : 'rfc6902',
      initialVariables: text(state.initialVariables),
      schema: text(state.schema),
      updateRules: text(state.updateRules),
      outputFormat: text(state.outputFormat),
    },
    worldbookEntries: entries.slice(0, 2000).map((entry) => ({
      name: text(entry?.name ?? entry?.comment),
      enabled: typeof entry?.enabled === 'boolean' ? entry.enabled : !entry?.disable,
      content: text(entry?.content),
    })),
    selectedComponents: components.slice(0, 500).map((component) => ({
      id: text(component?.id),
      label: text(component?.label ?? component?.commonName ?? component?.id),
      category: text(component?.category),
      scenarios: stringArray(component?.scenarios ?? component?.applicableScenarios),
    })),
    builder: {
      revision: Number.isSafeInteger(builder.revision) && builder.revision >= 0 ? builder.revision : 0,
      nodeCount: Number.isSafeInteger(builder.nodeCount) && builder.nodeCount >= 0 ? builder.nodeCount : 0,
    },
  };
}

function componentSearchText(component) {
  return `${component.id} ${component.label} ${component.category} ${component.scenarios.join(' ')}`;
}

function isDatabaseComponent(component) {
  return /数据库|database|table|sheet_/i.test(componentSearchText(component));
}

function isExplicitMvuComponent(component) {
  return /\bmvu\b|stat_data|jsonpatch|变量|状态栏|status.?bar/i.test(componentSearchText(component));
}

function mvuSourceFacts(source) {
  const acceptsStateDraft = source.state.kind !== 'database';
  const initEntry = source.worldbookEntries.find((entry) => /^\[InitVar\]/i.test(entry.name));
  const updateEntries = source.worldbookEntries.filter((entry) => /^\[mvu_update\]/i.test(entry.name));
  const contextEntries = source.worldbookEntries.filter((entry) => /读取变量|mvu_context/i.test(entry.name));
  const rulesText = [acceptsStateDraft ? source.state.updateRules : '', ...updateEntries.map((entry) => entry.content)].join('\n');
  const mvuComponents = source.selectedComponents.filter((component) => {
    if (isDatabaseComponent(component)) return false;
    return source.state.kind === 'mvu' || isExplicitMvuComponent(component);
  });
  const builderBound = false;
  return {
    acceptsStateDraft,
    initEntry,
    updateEntries,
    contextEntries,
    hasSchema: acceptsStateDraft && Boolean(source.state.schema.trim()),
    hasInitial: Boolean((acceptsStateDraft && source.state.initialVariables.trim()) || initEntry),
    hasRules: Boolean((acceptsStateDraft && source.state.updateRules.trim()) || updateEntries.length),
    hasOutput: acceptsStateDraft && Boolean(source.state.outputFormat.trim()),
    checkMarkers: (rulesText.match(/(^|\n)\s*check\s*:/gi) || []).length,
    mvuComponentIds: mvuComponents.map((component) => component.id).sort(),
    builderBound,
    hasUnboundBuilder: source.builder.nodeCount > 0,
  };
}

function databaseSourceFacts(source) {
  const acceptsStateDraft = source.state.kind !== 'mvu';
  const combined = [
    acceptsStateDraft ? source.state.initialVariables : '',
    acceptsStateDraft ? source.state.schema : '',
    acceptsStateDraft ? source.state.updateRules : '',
    acceptsStateDraft ? source.state.outputFormat : '',
    ...source.worldbookEntries.map((entry) => `${entry.name}\n${entry.content}`),
  ].join('\n');
  const databaseComponents = source.selectedComponents.filter(isDatabaseComponent);
  return {
    acceptsStateDraft,
    entryFingerprints: source.worldbookEntries.map((entry) => ({
      name: entry.name,
      enabled: entry.enabled,
      contentHash: hashText(entry.content),
    })),
    hasTemplate: /["']mate["']\s*:/i.test(combined) && /["']sheet_[^"']+["']\s*:/i.test(combined),
    hasSourceData: /sourceData\s*["']?\s*:/i.test(combined),
    providerHint: /sqlite|\bselect\b|\bupdate\b.+\bwhere\b/i.test(combined)
      ? 'sqlite'
      : /<tableEdit>|updateRow|insertRow|deleteRow/i.test(combined) ? 'native' : '',
    databaseComponentIds: databaseComponents.map((component) => component.id).sort(),
  };
}

export function workflowSourceSignature(workspace, engine) {
  if (!ENGINES.has(engine)) throw new Error(`不支持的蓝图引擎：${engine}`);
  const source = normalizeWorkspace(workspace);
  const mvuFacts = engine === 'mvu' ? mvuSourceFacts(source) : null;
  const databaseFacts = engine === 'database' ? databaseSourceFacts(source) : null;
  const acceptsStateDraft = mvuFacts?.acceptsStateDraft ?? databaseFacts?.acceptsStateDraft ?? false;
  const relevantEntries = engine === 'mvu' ? source.worldbookEntries
    .filter((entry) => /^\[(?:InitVar|mvu_update)\]/i.test(entry.name) || /读取变量|mvu_context/i.test(entry.name))
    .map((entry) => ({ name: entry.name, enabled: entry.enabled, contentHash: hashText(entry.content) }))
    : [];
  const fingerprint = {
    generatorVersion: WORKFLOW_BLUEPRINT_GENERATOR_VERSION,
    engine,
    stateKind: source.state.kind,
    dialect: acceptsStateDraft ? source.state.updateDialect : '',
    initialHash: hashText(acceptsStateDraft ? source.state.initialVariables : ''),
    schemaHash: hashText(acceptsStateDraft ? source.state.schema : ''),
    rulesHash: hashText(acceptsStateDraft ? source.state.updateRules : ''),
    outputHash: hashText(acceptsStateDraft ? source.state.outputFormat : ''),
    entries: relevantEntries,
    components: mvuFacts?.mvuComponentIds ?? databaseFacts?.databaseComponentIds ?? [],
    derivedFacts: mvuFacts ? {
      hasSchema: mvuFacts.hasSchema,
      hasInitial: mvuFacts.hasInitial,
      hasRules: mvuFacts.hasRules,
      hasOutput: mvuFacts.hasOutput,
      checkMarkers: mvuFacts.checkMarkers,
      builderBound: mvuFacts.builderBound,
      hasUnboundBuilder: mvuFacts.hasUnboundBuilder,
    } : databaseFacts,
    builderRevision: source.builder.revision,
    builderNodeCount: source.builder.nodeCount,
  };
  return `fnv1a:${hashText(stableStringify(fingerprint))}`;
}

function mvuDocument(workspace, generatedAt) {
  const source = normalizeWorkspace(workspace);
  const {
    initEntry,
    updateEntries,
    contextEntries,
    hasSchema,
    hasInitial,
    hasRules,
    hasOutput,
    checkMarkers,
    mvuComponentIds,
    builderBound,
    hasUnboundBuilder,
  } = mvuSourceFacts(source);
  const hasDisplay = mvuComponentIds.length > 0 || builderBound;
  const hasContext = contextEntries.length > 0;
  const simulatorDialectSupported = ['rfc6902', 'official_jsonpatch'].includes(source.state.updateDialect);
  const simulatorRouteReady = source.state.kind === 'mvu' && simulatorDialectSupported;
  const displayState = hasDisplay ? 'ready' : hasUnboundBuilder ? 'warning' : 'missing';
  const displayCheckState = hasDisplay ? 'pass' : hasUnboundBuilder ? 'warning' : 'missing';
  const displayDetail = hasDisplay
    ? `识别到 ${mvuComponentIds.length} 个 MVU 兼容组件；UI Builder ${builderBound ? `有 ${source.builder.nodeCount} 个已绑定视觉节点` : '未绑定 MVU 路线'}。`
    : hasUnboundBuilder ? '存在 UI Builder 视觉稿，但当前状态路线不是 MVU，不能把它算作 MVU 消费者。' : '尚未识别到 MVU 兼容组件或已绑定视觉稿。';
  const nodes = [
    node({
      id: 'mvu.schema', engine: 'mvu', kind: 'source', group: '定义层', label: 'Zod Schema',
      description: 'MVU 的唯一事实源；定义路径、类型、默认值、封闭性与 transform。',
      state: hasSchema ? 'ready' : 'missing', sourceRoute: 'mvu', simple: true,
      nodeLayout: layout(1, 1, 1, 1),
      outputs: [port('schema', 'Schema', 'mvu.schema'), port('contract', '字段契约', 'mvu.contract')],
      checks: [
        check('mvu-route', '状态路线明确为 MVU', source.state.kind === 'mvu' ? 'pass' : 'warning', source.state.kind === 'mvu' ? '当前工作台已选择 MVU。' : '可自由浏览，但正式装配前需要明确选择 MVU。'),
        check('schema-source', '存在 Schema 源稿', hasSchema ? 'pass' : 'missing', hasSchema ? '已读取工作台中的 Zod Schema 草稿。' : '状态机制模块尚无 Schema 源稿。'),
        check('schema-closure', 'Zod 源稿保持不可执行', hasSchema ? 'warning' : 'missing', hasSchema ? 'P1 仅记录 Zod 源稿指纹；网页不会 eval 任意 Schema。路径、类型与范围由可审计的安全契约模拟。' : '尚无 Schema 源稿；仍可用手工安全契约运行 Patch。'),
      ],
    }),
    node({
      id: 'mvu.init', engine: 'mvu', kind: 'source', group: '定义层', label: 'InitVar',
      description: '承载初始化变量；卡内 [InitVar] 条目应保持禁用并由 MVU 扫描。',
      state: initEntry?.enabled ? 'warning' : hasInitial ? 'ready' : 'missing', sourceRoute: 'mvu',
      nodeLayout: layout(null, null, 1, 2),
      inputs: [port('schema', 'Schema', 'mvu.schema')], outputs: [port('initialized', '初始化契约', 'mvu.initialized')],
      checks: [
        check('init-source', '存在初始变量来源', hasInitial ? 'pass' : 'missing', hasInitial ? '发现工作台源稿或 [InitVar] 条目。' : '尚未发现初始变量来源。'),
        check('init-disabled', '[InitVar] 保持禁用', !initEntry ? 'planned' : initEntry.enabled ? 'warning' : 'pass', !initEntry ? '导入或新建条目后再检查 enabled=false。' : initEntry.enabled ? '当前条目处于启用状态，需要复核。' : '已检测到条目禁用状态。'),
      ],
    }),
    node({
      id: 'mvu.rules', engine: 'mvu', kind: 'rule', group: '规则层', label: '更新规则与 Check',
      description: '字段五件套、触发条件、联动与清理规则；下级 check 会进入 Trace，标记本次命中或未触发。',
      state: hasRules ? 'ready' : 'missing', sourceRoute: 'mvu', simple: true,
      nodeLayout: layout(2, 1, 2, 2),
      inputs: [port('contract', '字段契约', 'mvu.contract'), port('initialized', '初始化契约', 'mvu.initialized')],
      outputs: [port('operation-contract', '更新契约', 'mvu.rules')],
      checks: [
        check('rules-source', '存在变量更新规则', hasRules ? 'pass' : 'missing', hasRules ? `源稿与世界书中共发现 ${updateEntries.length || 1} 个规则来源。` : '尚未发现更新规则。'),
        check('rules-check', '规则包含下级 check 条目', checkMarkers ? 'pass' : 'missing', checkMarkers ? `当前源稿识别到 ${checkMarkers} 个 check 标记。` : '尚未识别到可转为测试用例的 check 标记。'),
        check('rules-dialect', '规则方言与输出格式一致', hasOutput ? 'planned' : 'missing', hasOutput ? `当前声明为 ${source.state.updateDialect}，P1 解析时核对。` : '需要先补充输出格式。'),
      ],
    }),
    node({
      id: 'mvu.operation', engine: 'mvu', kind: 'runtime', group: '运行层', label: '候选更新操作',
      description: '在私有克隆上执行一回合 RFC 6902 或官方 JSONPatch 数据；不执行 AI 或原生命令文本。',
      phase: 'P1', state: simulatorRouteReady ? 'ready' : 'warning', simple: true,
      nodeLayout: layout(3, 1, 3, 2),
      inputs: [port('rules', '更新契约', 'mvu.rules')], outputs: [port('operation', '候选操作', 'mvu.operation')],
      checks: [
        check('operation-dialect', '只接受当前声明方言', simulatorDialectSupported ? 'pass' : 'warning', simulatorDialectSupported ? `P1 可确定性执行 ${source.state.updateDialect}。` : 'MVU 原生命令需要独立安全 AST 解释器，P1 明确拒绝执行。'),
        check('operation-model', '本地手填操作，不调用 AI', 'pass', 'AI 自动生成将在 P3 开放，不混入本地确定性模拟。'),
      ],
    }),
    node({
      id: 'mvu.validator', engine: 'mvu', kind: 'runtime', group: '运行层', label: 'Schema 安全契约',
      description: '用显式 JSON 契约校验路径、类型、枚举和数值范围；真实 Zod strip / transform 不在网页内执行。',
      phase: 'P1', state: hasInitial ? 'ready' : 'missing',
      nodeLayout: layout(null, null, 3, 1),
      inputs: [port('operation', '候选操作', 'mvu.operation')], outputs: [port('validated', '校验结果', 'mvu.validated')],
      checks: [
        check('validator-schema', '记录真实 Schema 来源', hasSchema ? 'warning' : 'missing', hasSchema ? '已记录 Zod 源稿指纹，但任意 JS 源码保持不执行。' : '没有 Zod 源稿；安全契约只从初始状态与规则镜像生成。'),
        check('validator-runtime', '本地纯函数解析器', 'pass', 'P1 已实现；不访问 window.Mvu、TavernHelper、ST、网络或持久化。'),
      ],
    }),
    node({
      id: 'mvu.snapshot', engine: 'mvu', kind: 'runtime', group: '运行层', label: '变量快照与 Diff',
      description: '记录运行前状态、实际操作、校验修正与运行后状态。',
      phase: 'P1', state: 'ready',
      nodeLayout: layout(null, null, 4, 1),
      inputs: [port('validated', '校验结果', 'mvu.validated')], outputs: [port('snapshot', '变量快照', 'mvu.snapshot')],
      checks: [check('snapshot-evidence', '保留 before / operation / patched / after', 'pass', 'P1 输出稳定排序的 Diff 与可复放 Trace；任一操作失败则整轮原子拒绝。')],
    }),
    node({
      id: 'mvu.context', engine: 'mvu', kind: 'consumer', group: '消费层', label: '读取变量 / EJS',
      description: '把 stat_data 以正确路由提供给剧情与变量模型；不把开发说明混进模型可见正文。',
      state: hasContext ? 'ready' : 'missing', sourceRoute: 'worldbook',
      nodeLayout: layout(null, null, 4, 2),
      inputs: [port('snapshot', '变量快照', 'mvu.snapshot')], outputs: [port('context', '读取上下文', 'mvu.context')],
      checks: [
        check('context-source', '存在读取变量条目', hasContext ? 'pass' : 'missing', hasContext ? `识别到 ${contextEntries.length} 个候选条目。` : '尚未识别到读取变量 / mvu_context 条目。'),
        check('context-routing', '读取变量条目无错误前缀', 'planned', 'P1 对条目路由做静态检查。'),
      ],
    }),
    node({
      id: 'mvu.display', engine: 'mvu', kind: 'consumer', group: '显示层', label: '前端显示绑定',
      description: '状态栏或 UI Builder 只读消费最终状态；前端不得直接写 stat_data。',
      state: displayState, sourceRoute: builderBound || hasUnboundBuilder ? 'design' : 'frontend', simple: true,
      nodeLayout: layout(4, 1, 5, 2),
      inputs: [port('preview-operation', '简化预览', 'mvu.operation'), port('context', '读取上下文', 'mvu.context')],
      outputs: [port('binding', '显示绑定', 'mvu.binding')],
      checks: [
        check('display-source', '存在显示消费者', displayCheckState, displayDetail),
        check('display-readonly', '前端只读消费变量', 'planned', 'P1 绑定清单校验；真实 iframe 行为仍需 ST 验证。'),
      ],
    }),
    node({
      id: 'mvu.features', engine: 'mvu', kind: 'consumer', group: '功能层', label: '功能与组件适配',
      description: '控制中心、脚本、状态栏与其他组件按变量链路后置适配。',
      state: mvuComponentIds.length ? 'ready' : 'missing', sourceRoute: 'frontend',
      nodeLayout: layout(null, null, 6, 2),
      inputs: [port('binding', '显示绑定', 'mvu.binding')], outputs: [port('evidence', '功能证据', 'evidence.report')],
      checks: [check('feature-selection', '存在组件选型', mvuComponentIds.length ? 'pass' : 'missing', mvuComponentIds.length ? `记录了 ${mvuComponentIds.length} 个 MVU 兼容组件。` : '尚未识别到 MVU 兼容组件选型。')],
    }),
    node({
      id: 'mvu.report', engine: 'mvu', kind: 'evidence', group: '证据层', label: '蓝图诊断',
      description: '汇总类型化连线、缺失来源、计划能力与必须留到真实 ST 的验收项。',
      state: 'ready', simple: true,
      nodeLayout: layout(5, 1, 6, 1),
      inputs: [port('binding', '显示绑定', 'mvu.binding'), port('evidence', '功能证据', 'evidence.report')],
      checks: [
        check('graph-contract', '节点和端口经过类型校验', 'pass', 'P0 生成器拒绝跨引擎或端口类型不匹配的连线。'),
        check('local-simulation', '确定性单回合模拟', 'pass', 'P1 在内存克隆上运行；模拟会话不进入项目、蓝图、角色卡或 ST。'),
        check('real-st', '真实 AI → MVU → 状态栏', 'needs_real', '本地蓝图不能替代真实模型输出、消息变量落库和 ST iframe 验收。'),
      ],
    }),
  ];
  const edges = [
    edge('mvu.simple.schema-rules', 'mvu', 'simple', 'mvu.schema', 'contract', 'mvu.rules', 'contract'),
    edge('mvu.simple.rules-operation', 'mvu', 'simple', 'mvu.rules', 'operation-contract', 'mvu.operation', 'rules'),
    edge('mvu.simple.operation-display', 'mvu', 'simple', 'mvu.operation', 'operation', 'mvu.display', 'preview-operation'),
    edge('mvu.simple.display-report', 'mvu', 'simple', 'mvu.display', 'binding', 'mvu.report', 'binding', 'evidence'),
    edge('mvu.advanced.schema-init', 'mvu', 'advanced', 'mvu.schema', 'schema', 'mvu.init', 'schema'),
    edge('mvu.advanced.init-rules', 'mvu', 'advanced', 'mvu.init', 'initialized', 'mvu.rules', 'initialized'),
    edge('mvu.advanced.rules-operation', 'mvu', 'advanced', 'mvu.rules', 'operation-contract', 'mvu.operation', 'rules'),
    edge('mvu.advanced.operation-validator', 'mvu', 'advanced', 'mvu.operation', 'operation', 'mvu.validator', 'operation'),
    edge('mvu.advanced.validator-snapshot', 'mvu', 'advanced', 'mvu.validator', 'validated', 'mvu.snapshot', 'validated'),
    edge('mvu.advanced.snapshot-context', 'mvu', 'advanced', 'mvu.snapshot', 'snapshot', 'mvu.context', 'snapshot'),
    edge('mvu.advanced.context-display', 'mvu', 'advanced', 'mvu.context', 'context', 'mvu.display', 'context'),
    edge('mvu.advanced.display-features', 'mvu', 'advanced', 'mvu.display', 'binding', 'mvu.features', 'binding'),
    edge('mvu.advanced.features-report', 'mvu', 'advanced', 'mvu.features', 'evidence', 'mvu.report', 'evidence', 'evidence'),
  ];
  return {
    format: WORKFLOW_BLUEPRINT_FORMAT,
    schemaVersion: WORKFLOW_BLUEPRINT_VERSION,
    id: `mvu-${hashText(`${generatedAt}:${workflowSourceSignature(source, 'mvu')}`)}`,
    engine: 'mvu',
    title: 'MVU 变量系统蓝图',
    generatedAt,
    sourceSignature: workflowSourceSignature(source, 'mvu'),
    nodes,
    edges,
  };
}

function databaseDocument(workspace, generatedAt) {
  const source = normalizeWorkspace(workspace);
  const { hasTemplate, hasSourceData, providerHint, databaseComponentIds } = databaseSourceFacts(source);
  const databaseComponentCount = databaseComponentIds.length;
  const hasBuilderDraft = source.builder.nodeCount > 0;
  const nodes = [
    node({
      id: 'database.template', engine: 'database', kind: 'source', group: '定义层', label: '数据库表格模板',
      description: '以 mate、sheet_*、content 与 sourceData 定义表格；它不是 MVU Schema。',
      state: hasTemplate ? 'ready' : 'missing', sourceRoute: 'state', simple: true,
      nodeLayout: layout(1, 1, 1, 1),
      outputs: [port('template', '模板', 'database.template'), port('contract', '表契约', 'database.contract')],
      checks: [
        check('database-route', '状态路线明确为数据库', source.state.kind === 'database' ? 'pass' : 'warning', source.state.kind === 'database' ? '当前工作台已选择数据库变量。' : '可自由浏览，但正式装配前需要明确选择数据库路线。'),
        check('template-source', '存在 mate + sheet_* 模板', hasTemplate ? 'pass' : 'missing', hasTemplate ? '在当前工作台文本中识别到表格模板外壳。' : '尚未发现 C4 表格模板结构。'),
        check('template-not-mvu', '不使用 stat_data / Zod / JSONPatch 解释数据库', 'pass', '数据库蓝图使用独立端口类型，不能与 MVU 节点连线。'),
      ],
    }),
    node({
      id: 'database.sheet', engine: 'database', kind: 'source', group: '定义层', label: 'Sheet / DDL / sourceData',
      description: '声明表头、业务键、Note、增删改触发条件与 SQLite DDL。',
      state: hasSourceData ? 'ready' : 'missing', sourceRoute: 'state',
      nodeLayout: layout(null, null, 1, 2),
      inputs: [port('template', '模板', 'database.template')], outputs: [port('sheet', 'Sheet 契约', 'database.sheet')],
      checks: [
        check('sheet-source', '每张表具备 sourceData', hasSourceData ? 'pass' : 'missing', hasSourceData ? '已检测到 sourceData 结构线索。' : '尚未发现 sourceData。'),
        check('sheet-business-key', '多行表具有业务 UNIQUE', 'planned', 'P2 解析表头、DDL 与业务键。'),
        check('sheet-trigger-boundary', '增删改触发条件含正反边界', 'planned', 'P2 把 sourceData 下级条目转为测试用例。'),
      ],
    }),
    node({
      id: 'database.rules', engine: 'database', kind: 'rule', group: '规则层', label: '填表规则与 Check',
      description: '把 insert/update/delete/ddl 规则转为可执行检查；不复用 MVU 字段五件套。',
      state: hasSourceData ? 'ready' : 'missing', sourceRoute: 'state', simple: true,
      nodeLayout: layout(2, 1, 2, 2),
      inputs: [port('contract', '表契约', 'database.contract'), port('sheet', 'Sheet 契约', 'database.sheet')],
      outputs: [port('rules', '填表契约', 'database.rules')],
      checks: [
        check('database-rules', '存在表格说明与触发规则', hasSourceData ? 'pass' : 'missing', hasSourceData ? 'sourceData 可进入后续解析。' : '需要先建立表格模板。'),
        check('database-delete-update', 'UPDATE / DELETE 必须带 WHERE', 'planned', 'P2 对 SQL 与原生操作分别检查。'),
      ],
    }),
    node({
      id: 'database.provider', engine: 'database', kind: 'runtime', group: '运行层', label: '存储 Provider',
      description: '原生 DSL 与 SQLite 共享上层契约，但必须使用各自解析与执行路径。',
      state: providerHint ? 'warning' : 'missing', simple: true,
      nodeLayout: layout(3, 1, 3, 2),
      inputs: [port('rules', '填表契约', 'database.rules')], outputs: [port('provider', 'Provider 能力', 'database.provider')],
      checks: [
        check('provider-choice', '主 Provider 已声明', providerHint ? 'warning' : 'missing', providerHint ? `仅从文本识别到 ${providerHint === 'sqlite' ? 'SQLite' : '原生 DSL'} 线索，仍需显式确认。` : '尚未声明原生 DSL 或 SQLite。'),
        check('provider-capability', '运行时能力检测', 'needs_real', '不能写死插件最新版；需在真实宿主中做只读能力探针。'),
      ],
    }),
    node({
      id: 'database.operation', engine: 'database', kind: 'runtime', group: '运行层', label: '候选填表操作',
      description: '接收原生 DSL、严格 JSON 或 SQL 操作；P0 不模拟插件持久化。',
      phase: 'P2', state: 'planned', simple: true,
      nodeLayout: layout(4, 1, 3, 1),
      inputs: [port('provider', 'Provider 能力', 'database.provider')], outputs: [port('operation', '候选操作', 'database.operation')],
      checks: [
        check('operation-dialect', '填表协议不混写', 'planned', '严格 JSON、tableEdit 与 SQL 分开解析。'),
        check('operation-transaction', '失败可见且不静默覆盖', 'planned', 'P2 记录返回值、冲突与重读结果。'),
      ],
    }),
    node({
      id: 'database.snapshot', engine: 'database', kind: 'runtime', group: '运行层', label: 'Checkpoint / Log / 快照',
      description: '区分全量 checkpoint、真实 operation log 与只读克隆快照。',
      phase: 'P2', state: 'planned',
      nodeLayout: layout(null, null, 4, 1),
      inputs: [port('operation', '候选操作', 'database.operation')], outputs: [port('snapshot', '表格快照', 'database.snapshot')],
      checks: [
        check('snapshot-readonly', '读取使用不可变克隆', 'planned', 'P2 禁止直接修改 export 返回对象。'),
        check('snapshot-persistence', '真实聊天保存与 V2 恢复链', 'needs_real', '本地模拟不能证明插件 saveChat、checkpoint 或 log 时序。'),
      ],
    }),
    node({
      id: 'database.adapter', engine: 'database', kind: 'consumer', group: '消费层', label: 'Adapter / Domain / Store',
      description: '把二维表归一化为业务模型，并管理加载、刷新、冲突、填表和过期结果。',
      phase: 'P2', state: 'planned',
      nodeLayout: layout(null, null, 4, 2),
      inputs: [port('snapshot', '表格快照', 'database.snapshot')], outputs: [port('domain', '领域状态', 'database.domain')],
      checks: [
        check('adapter-contract', '表契约显式声明', 'planned', 'P2 为每张表声明表头、业务键和字段类型。'),
        check('adapter-row-index', '业务逻辑不长期缓存 rowIndex', 'planned', '写入前用业务键重新定位。'),
      ],
    }),
    node({
      id: 'database.frontend', engine: 'database', kind: 'consumer', group: '显示层', label: '数据库二创前端',
      description: '正常多楼层角色卡中的数据库状态栏、控制中心和数据面板。',
      state: databaseComponentCount ? 'ready' : hasBuilderDraft ? 'warning' : 'missing', sourceRoute: databaseComponentCount ? 'frontend' : 'design', simple: true,
      nodeLayout: layout(5, 1, 5, 2),
      inputs: [port('preview-operation', '简化预览', 'database.operation'), port('domain', '领域状态', 'database.domain')],
      outputs: [port('binding', '数据库显示绑定', 'database.binding')],
      checks: [
        check('database-frontend', '存在数据库前端消费者', databaseComponentCount ? 'pass' : hasBuilderDraft ? 'warning' : 'missing', databaseComponentCount ? `识别到 ${databaseComponentCount} 个数据库相关组件。` : hasBuilderDraft ? '存在 UI Builder 视觉稿，但尚未证明它绑定数据库表契约。' : '尚未选择数据库前端或建立视觉稿。'),
        check('frontend-direction', '写入走意图 → Adapter → API → 重读', 'planned', 'P2 不允许组件直接修改二维 content。'),
      ],
    }),
    node({
      id: 'database.lifecycle', engine: 'database', kind: 'consumer', group: '生命周期', label: '多楼层生命周期',
      description: '处理聊天切换、Swipe、删楼、填表中、陈旧结果与宿主级回调。',
      phase: 'P2', state: 'needs_real',
      nodeLayout: layout(null, null, 6, 2),
      inputs: [port('binding', '数据库显示绑定', 'database.binding')], outputs: [port('evidence', '生命周期证据', 'evidence.report')],
      checks: [
        check('lifecycle-normal', '默认按正常多楼层运行', 'pass', '数据库常规路线不要求同层输出契约。'),
        check('lifecycle-runtime', '回调、填表结束与切聊天', 'needs_real', '需要真实插件与聊天链验证。'),
      ],
    }),
    node({
      id: 'database.report', engine: 'database', kind: 'evidence', group: '证据层', label: '蓝图诊断',
      description: '汇总表契约、Provider、前端绑定和必须留到真实插件的验收项。',
      state: 'ready', simple: true,
      nodeLayout: layout(6, 1, 6, 1),
      inputs: [port('binding', '数据库显示绑定', 'database.binding'), port('evidence', '生命周期证据', 'evidence.report')],
      checks: [
        check('graph-contract', '节点和端口经过类型校验', 'pass', '数据库节点只能连接 database.* 或 evidence.* 端口。'),
        check('real-plugin', '真实 Provider 与持久化', 'needs_real', '本地蓝图不能代替插件 API、V2 日志和聊天保存验收。'),
      ],
    }),
    node({
      id: 'database.c8', engine: 'database', kind: 'boundary', group: '实验边界', label: '同层兼容（C8）',
      description: '独立消息 / 楼层桥的待验证实验路线，不属于数据库常规前端主链。',
      phase: 'P4+', state: 'needs_real',
      nodeLayout: layout(null, null, 7, 1),
      checks: [
        check('c8-separated', '与稳定数据库蓝图保持断开', 'pass', '本节点故意没有接入主链。'),
        check('c8-status', '仍标注待验证', 'needs_real', '未通过 C8 转正门槛前禁止作为成熟能力。'),
      ],
    }),
  ];
  const edges = [
    edge('database.simple.template-rules', 'database', 'simple', 'database.template', 'contract', 'database.rules', 'contract'),
    edge('database.simple.rules-provider', 'database', 'simple', 'database.rules', 'rules', 'database.provider', 'rules'),
    edge('database.simple.provider-operation', 'database', 'simple', 'database.provider', 'provider', 'database.operation', 'provider'),
    edge('database.simple.operation-frontend', 'database', 'simple', 'database.operation', 'operation', 'database.frontend', 'preview-operation'),
    edge('database.simple.frontend-report', 'database', 'simple', 'database.frontend', 'binding', 'database.report', 'binding', 'evidence'),
    edge('database.advanced.template-sheet', 'database', 'advanced', 'database.template', 'template', 'database.sheet', 'template'),
    edge('database.advanced.sheet-rules', 'database', 'advanced', 'database.sheet', 'sheet', 'database.rules', 'sheet'),
    edge('database.advanced.rules-provider', 'database', 'advanced', 'database.rules', 'rules', 'database.provider', 'rules'),
    edge('database.advanced.provider-operation', 'database', 'advanced', 'database.provider', 'provider', 'database.operation', 'provider'),
    edge('database.advanced.operation-snapshot', 'database', 'advanced', 'database.operation', 'operation', 'database.snapshot', 'operation'),
    edge('database.advanced.snapshot-adapter', 'database', 'advanced', 'database.snapshot', 'snapshot', 'database.adapter', 'snapshot'),
    edge('database.advanced.adapter-frontend', 'database', 'advanced', 'database.adapter', 'domain', 'database.frontend', 'domain'),
    edge('database.advanced.frontend-lifecycle', 'database', 'advanced', 'database.frontend', 'binding', 'database.lifecycle', 'binding'),
    edge('database.advanced.lifecycle-report', 'database', 'advanced', 'database.lifecycle', 'evidence', 'database.report', 'evidence', 'evidence'),
  ];
  return {
    format: WORKFLOW_BLUEPRINT_FORMAT,
    schemaVersion: WORKFLOW_BLUEPRINT_VERSION,
    id: `database-${hashText(`${generatedAt}:${workflowSourceSignature(source, 'database')}`)}`,
    engine: 'database',
    title: '数据库变量系统蓝图',
    generatedAt,
    sourceSignature: workflowSourceSignature(source, 'database'),
    nodes,
    edges,
  };
}

export function generateWorkflowDocument({ engine, workspace = {}, generatedAt = new Date().toISOString() } = {}) {
  if (!ENGINES.has(engine)) throw new Error(`不支持的蓝图引擎：${engine}`);
  const document = engine === 'mvu' ? mvuDocument(workspace, generatedAt) : databaseDocument(workspace, generatedAt);
  const validation = validateWorkflowDocument(document);
  if (!validation.valid) throw new Error(`蓝图生成失败：${validation.errors.join('；')}`);
  return document;
}

function normalizePort(raw, label) {
  if (!isRecord(raw)) throw new Error(`${label} 必须是对象。`);
  const id = text(raw.id).trim();
  const name = text(raw.label).trim();
  const type = text(raw.type).trim();
  if (!id || !name || !type) throw new Error(`${label} 缺少 id、label 或 type。`);
  return { id, label: name, type };
}

function normalizeCheck(raw, label) {
  if (!isRecord(raw)) throw new Error(`${label} 必须是对象。`);
  const status = text(raw.status);
  if (!CHECK_STATES.has(status)) throw new Error(`${label}.status 不受支持。`);
  const id = text(raw.id).trim();
  const name = text(raw.label).trim();
  if (!id || !name) throw new Error(`${label} 缺少 id 或 label。`);
  return { id, label: name, status, detail: text(raw.detail) };
}

function normalizeLayout(raw, label) {
  if (!isRecord(raw)) throw new Error(`${label} 必须是对象。`);
  const readPosition = (value, positionLabel, optional = false) => {
    if (value == null && optional) return null;
    if (!isRecord(value)) throw new Error(`${positionLabel} 必须是对象。`);
    return {
      column: finiteInteger(value.column),
      row: finiteInteger(value.row),
    };
  };
  return {
    simple: readPosition(raw.simple, `${label}.simple`, true),
    advanced: readPosition(raw.advanced, `${label}.advanced`),
  };
}

export function normalizeWorkflowDocument(raw) {
  if (!isRecord(raw) || raw.format !== WORKFLOW_BLUEPRINT_FORMAT || Number(raw.schemaVersion) !== WORKFLOW_BLUEPRINT_VERSION) {
    throw new Error('工作流蓝图格式或版本不受支持。');
  }
  const engine = text(raw.engine);
  if (!ENGINES.has(engine)) throw new Error('工作流蓝图引擎不受支持。');
  if (!Array.isArray(raw.nodes) || raw.nodes.length > MAX_NODES) throw new Error('工作流蓝图节点数量无效。');
  if (!Array.isArray(raw.edges) || raw.edges.length > MAX_EDGES) throw new Error('工作流蓝图连线数量无效。');
  const nodes = raw.nodes.map((item, index) => {
    if (!isRecord(item)) throw new Error(`nodes[${index}] 必须是对象。`);
    const kind = text(item.kind);
    const state = text(item.state);
    if (!NODE_KINDS.has(kind)) throw new Error(`nodes[${index}].kind 不受支持。`);
    if (!NODE_STATES.has(state)) throw new Error(`nodes[${index}].state 不受支持。`);
    if (item.engine !== engine) throw new Error(`nodes[${index}] 引擎与文档不一致。`);
    const ports = isRecord(item.ports) ? item.ports : {};
    if (!Array.isArray(ports.inputs) || !Array.isArray(ports.outputs)) throw new Error(`nodes[${index}].ports 必须包含输入与输出数组。`);
    if (!Array.isArray(item.checks)) throw new Error(`nodes[${index}].checks 必须是数组。`);
    const id = text(item.id).trim();
    const label = text(item.label).trim();
    if (!id || !label) throw new Error(`nodes[${index}] 缺少 id 或 label。`);
    return {
      id,
      engine,
      kind,
      group: text(item.group),
      label,
      description: text(item.description),
      phase: text(item.phase) || 'P0',
      state,
      sourceRoute: text(item.sourceRoute),
      simple: Boolean(item.simple),
      layout: normalizeLayout(item.layout, `nodes[${index}].layout`),
      ports: {
        inputs: ports.inputs.map((portItem, portIndex) => normalizePort(portItem, `nodes[${index}].ports.inputs[${portIndex}]`)),
        outputs: ports.outputs.map((portItem, portIndex) => normalizePort(portItem, `nodes[${index}].ports.outputs[${portIndex}]`)),
      },
      checks: item.checks.map((checkItem, checkIndex) => normalizeCheck(checkItem, `nodes[${index}].checks[${checkIndex}]`)),
    };
  });
  const edges = raw.edges.map((item, index) => {
    if (!isRecord(item) || !isRecord(item.source) || !isRecord(item.target)) throw new Error(`edges[${index}] 结构无效。`);
    const level = text(item.level);
    const relation = text(item.relation);
    if (!EDGE_LEVELS.has(level) || !EDGE_RELATIONS.has(relation)) throw new Error(`edges[${index}] 类型无效。`);
    return {
      id: text(item.id).trim(),
      engine: text(item.engine),
      level,
      relation,
      source: { nodeId: text(item.source.nodeId).trim(), portId: text(item.source.portId).trim() },
      target: { nodeId: text(item.target.nodeId).trim(), portId: text(item.target.portId).trim() },
    };
  });
  const normalized = {
    format: WORKFLOW_BLUEPRINT_FORMAT,
    schemaVersion: WORKFLOW_BLUEPRINT_VERSION,
    id: text(raw.id).trim(),
    engine,
    title: text(raw.title).trim(),
    generatedAt: text(raw.generatedAt),
    sourceSignature: text(raw.sourceSignature),
    nodes,
    edges,
  };
  if (!normalized.id || !normalized.title || !normalized.generatedAt || !normalized.sourceSignature) throw new Error('工作流蓝图缺少元数据。');
  const validation = validateWorkflowDocument(normalized);
  if (!validation.valid) throw new Error(`工作流蓝图校验失败：${validation.errors.join('；')}`);
  return normalized;
}

export function createEmptyWorkflowState() {
  return {
    schemaVersion: WORKFLOW_BLUEPRINT_VERSION,
    activeEngine: 'mvu',
    viewMode: 'simple',
    selectedNodeId: '',
    documents: { mvu: null, database: null },
    nodeOverrides: { mvu: {}, database: {} },
    layoutOverrides: {
      mvu: { simple: {}, advanced: {} },
      database: { simple: {}, advanced: {} },
    },
  };
}

function normalizeLayoutOverrides(raw, documents) {
  const source = isRecord(raw) ? raw : {};
  return Object.fromEntries([...ENGINES].map((engine) => {
    const engineSource = isRecord(source[engine]) ? source[engine] : {};
    const document = documents[engine];
    return [engine, Object.fromEntries([...VIEW_MODES].map((mode) => {
      const modeSource = isRecord(engineSource[mode]) ? engineSource[mode] : {};
      const visibleIds = new Set((document?.nodes || [])
        .filter((item) => mode === 'advanced' || item.simple)
        .map((item) => item.id));
      const entries = Object.entries(modeSource).slice(0, MAX_NODES).flatMap(([nodeId, position]) => {
        const x = position?.x;
        const y = position?.y;
        if (!visibleIds.has(nodeId) || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return [];
        if (x < 0 || y < 0 || x > MAX_LAYOUT_COORDINATE || y > MAX_LAYOUT_COORDINATE) return [];
        return [[nodeId, { x: Math.round(x), y: Math.round(y) }]];
      });
      return [mode, Object.fromEntries(entries)];
    }))];
  }));
}

function normalizeNodeOverrides(raw, documents) {
  const source = isRecord(raw) ? raw : {};
  return Object.fromEntries([...ENGINES].map((engine) => {
    const engineSource = isRecord(source[engine]) ? source[engine] : {};
    const entries = (documents[engine]?.nodes || []).flatMap((nodeItem) => {
      const override = engineSource[nodeItem.id];
      if (!isRecord(override)) return [];
      const normalized = {};
      if (typeof override.label === 'string') {
        const label = override.label.trim().slice(0, MAX_NODE_LABEL_LENGTH).trim();
        if (label && label !== nodeItem.label) normalized.label = label;
      }
      if (typeof override.description === 'string') {
        const description = override.description.slice(0, MAX_NODE_DESCRIPTION_LENGTH);
        if (description !== nodeItem.description) normalized.description = description;
      }
      return Object.keys(normalized).length ? [[nodeItem.id, normalized]] : [];
    });
    return [engine, Object.fromEntries(entries)];
  }));
}

export function normalizeWorkflowState(raw) {
  if (raw == null) return createEmptyWorkflowState();
  if (!isRecord(raw) || Number(raw.schemaVersion) !== WORKFLOW_BLUEPRINT_VERSION) throw new Error('workflow 的版本不受支持。');
  const activeEngine = ENGINES.has(raw.activeEngine) ? raw.activeEngine : 'mvu';
  const viewMode = VIEW_MODES.has(raw.viewMode) ? raw.viewMode : 'simple';
  const rawDocuments = isRecord(raw.documents) ? raw.documents : {};
  const documents = {
    mvu: rawDocuments.mvu == null ? null : normalizeWorkflowDocument(rawDocuments.mvu),
    database: rawDocuments.database == null ? null : normalizeWorkflowDocument(rawDocuments.database),
  };
  if (documents.mvu && documents.mvu.engine !== 'mvu') throw new Error('workflow.documents.mvu 只能保存 MVU 蓝图。');
  if (documents.database && documents.database.engine !== 'database') throw new Error('workflow.documents.database 只能保存数据库蓝图。');
  const activeDocument = documents[activeEngine];
  const requestedNodeId = text(raw.selectedNodeId);
  const selectedNodeId = activeDocument?.nodes.some((item) => item.id === requestedNodeId)
    ? requestedNodeId
    : activeDocument?.nodes.find((item) => item.simple)?.id || activeDocument?.nodes[0]?.id || '';
  return {
    schemaVersion: WORKFLOW_BLUEPRINT_VERSION,
    activeEngine,
    viewMode,
    selectedNodeId,
    documents,
    nodeOverrides: normalizeNodeOverrides(raw.nodeOverrides, documents),
    layoutOverrides: normalizeLayoutOverrides(raw.layoutOverrides, documents),
  };
}

function portFor(nodeItem, direction, portId) {
  return nodeItem?.ports?.[direction]?.find((item) => item.id === portId) || null;
}

function detectCycle(document, level) {
  const edges = document.edges.filter((item) => item.level === level);
  const graph = new Map(document.nodes.map((item) => [item.id, []]));
  edges.forEach((item) => graph.get(item.source.nodeId)?.push(item.target.nodeId));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const target of graph.get(id) || []) if (visit(target)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
}

export function validateWorkflowDocument(document) {
  const errors = [];
  const warnings = [];
  if (!isRecord(document) || !ENGINES.has(document.engine)) return { valid: false, errors: ['document-engine-invalid'], warnings };
  if (!Array.isArray(document.nodes) || !Array.isArray(document.edges)) return { valid: false, errors: ['document-collections-invalid'], warnings };
  if (document.nodes.length === 0) errors.push('document-nodes-empty');
  if (document.edges.length === 0) errors.push('document-edges-empty');
  const nodeMap = new Map();
  document.nodes.forEach((nodeItem) => {
    if (!nodeItem?.id || nodeMap.has(nodeItem.id)) errors.push(`duplicate-or-empty-node:${nodeItem?.id || 'unknown'}`);
    else nodeMap.set(nodeItem.id, nodeItem);
    if (nodeItem?.engine !== document.engine) errors.push(`node-engine-mismatch:${nodeItem?.id || 'unknown'}`);
    const prefixOk = (type) => type.startsWith(`${document.engine}.`) || type.startsWith('evidence.');
    const ids = new Set();
    [...(nodeItem?.ports?.inputs || []), ...(nodeItem?.ports?.outputs || [])].forEach((item) => {
      if (!item.id || ids.has(item.id)) errors.push(`duplicate-or-empty-port:${nodeItem?.id || 'unknown'}:${item.id || 'unknown'}`);
      ids.add(item.id);
      if (!prefixOk(item.type)) errors.push(`cross-engine-port:${nodeItem?.id || 'unknown'}:${item.type}`);
    });
  });
  const edgeIds = new Set();
  document.edges.forEach((edgeItem) => {
    if (!edgeItem?.id || edgeIds.has(edgeItem.id)) errors.push(`duplicate-or-empty-edge:${edgeItem?.id || 'unknown'}`);
    edgeIds.add(edgeItem?.id);
    if (edgeItem?.engine !== document.engine) errors.push(`edge-engine-mismatch:${edgeItem?.id || 'unknown'}`);
    if (!EDGE_LEVELS.has(edgeItem?.level)) errors.push(`edge-level-invalid:${edgeItem?.id || 'unknown'}`);
    const sourceNode = nodeMap.get(edgeItem?.source?.nodeId);
    const targetNode = nodeMap.get(edgeItem?.target?.nodeId);
    if (!sourceNode || !targetNode) {
      errors.push(`edge-endpoint-missing:${edgeItem?.id || 'unknown'}`);
      return;
    }
    const output = portFor(sourceNode, 'outputs', edgeItem.source.portId);
    const input = portFor(targetNode, 'inputs', edgeItem.target.portId);
    if (!output || !input) {
      errors.push(`edge-port-missing:${edgeItem.id}`);
      return;
    }
    if (output.type !== input.type) errors.push(`port-type-mismatch:${edgeItem.id}:${output.type}->${input.type}`);
    if (edgeItem.level === 'simple' && (!sourceNode.simple || !targetNode.simple)) errors.push(`simple-edge-hidden-node:${edgeItem.id}`);
  });
  if (document.engine === 'database') {
    const c8 = nodeMap.get('database.c8');
    if (!c8) errors.push('database-c8-missing');
    else {
      if (c8.kind !== 'boundary') errors.push('database-c8-kind-invalid');
      if (c8.phase !== 'P4+') errors.push('database-c8-phase-invalid');
      if (c8.state !== 'needs_real') errors.push('database-c8-state-invalid');
      if ((c8.ports?.inputs?.length || 0) !== 0 || (c8.ports?.outputs?.length || 0) !== 0) errors.push('database-c8-ports-forbidden');
      if (document.edges.some((edgeItem) => edgeItem.source.nodeId === c8.id || edgeItem.target.nodeId === c8.id)) errors.push('database-c8-edge-forbidden');
    }
  }
  EDGE_LEVELS.forEach((level) => {
    if (detectCycle(document, level)) errors.push(`cycle-detected:${level}`);
  });
  document.nodes.forEach((nodeItem) => {
    if (nodeItem.kind === 'boundary') return;
    const connected = document.edges.some((edgeItem) => edgeItem.source.nodeId === nodeItem.id || edgeItem.target.nodeId === nodeItem.id);
    if (!connected) warnings.push(`orphan-node:${nodeItem.id}`);
  });
  return { valid: errors.length === 0, errors, warnings };
}

export function summarizeWorkflowDocument(document) {
  if (!document) return { nodes: 0, edges: 0, pass: 0, missing: 0, warning: 0, planned: 0, needsReal: 0 };
  const checks = document.nodes.flatMap((item) => item.checks || []);
  const count = (status) => checks.filter((item) => item.status === status).length;
  return {
    nodes: document.nodes.length,
    edges: document.edges.length,
    pass: count('pass'),
    missing: count('missing'),
    warning: count('warning'),
    planned: count('planned'),
    needsReal: count('needs_real'),
  };
}

export function workflowExportFile(document, exportedAt = new Date().toISOString()) {
  const normalized = normalizeWorkflowDocument(clone(document));
  return {
    format: WORKFLOW_BLUEPRINT_FORMAT,
    schemaVersion: WORKFLOW_BLUEPRINT_VERSION,
    exportedAt,
    document: normalized,
  };
}
