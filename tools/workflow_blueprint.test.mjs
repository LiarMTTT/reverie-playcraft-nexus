import assert from 'node:assert/strict';
import {
  createEmptyWorkflowState,
  generateWorkflowDocument,
  normalizeWorkflowDocument,
  normalizeWorkflowState,
  summarizeWorkflowDocument,
  validateWorkflowDocument,
  workflowExportFile,
  WORKFLOW_BLUEPRINT_GENERATOR_VERSION,
  workflowSourceSignature,
} from '../portal/assets/workflow-blueprint.js';

const generatedAt = '2026-07-16T12:00:00.000Z';
const mvuWorkspace = {
  state: {
    kind: 'mvu',
    updateDialect: 'rfc6902',
    initialVariables: '玩家:\n  生命值: 100',
    schema: 'const Schema = z.object({ 玩家: z.object({ 生命值: z.number() }) });',
    updateRules: '生命值:\n  path: /玩家/生命值\n  check:\n    - 受到伤害: 减少',
    outputFormat: '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>',
  },
  worldbookEntries: [
    { name: '[InitVar]初始变量', enabled: false, content: '玩家:\n  生命值: 100' },
    { name: '[mvu_update]变量更新规则', enabled: true, content: '生命值规则' },
    { name: '读取变量', enabled: true, content: '<%= stat_data %>' },
  ],
  selectedComponents: [{ id: 'status_bar.core', label: '状态栏核心', category: 'status_bar' }],
  builder: { revision: 3, nodeCount: 4 },
};

const mvu = generateWorkflowDocument({ engine: 'mvu', workspace: mvuWorkspace, generatedAt });
assert.equal(WORKFLOW_BLUEPRINT_GENERATOR_VERSION, 'p1-v2');
assert.equal(mvu.engine, 'mvu');
assert.equal(validateWorkflowDocument(mvu).valid, true);
assert.ok(mvu.nodes.every((item) => item.engine === 'mvu'));
assert.ok(mvu.nodes.some((item) => item.id === 'mvu.rules' && item.checks.some((check) => check.id === 'rules-check' && check.status === 'pass')));
assert.equal(mvu.nodes.find((item) => item.id === 'mvu.operation').state, 'ready');
assert.equal(mvu.nodes.find((item) => item.id === 'mvu.operation').checks.find((item) => item.id === 'operation-dialect').status, 'pass');
assert.equal(mvu.nodes.find((item) => item.id === 'mvu.validator').label, 'Schema 安全契约');
assert.equal(mvu.nodes.find((item) => item.id === 'mvu.validator').checks.find((item) => item.id === 'validator-runtime').status, 'pass');
assert.equal(mvu.nodes.find((item) => item.id === 'mvu.snapshot').state, 'ready');
assert.equal(mvu.nodes.find((item) => item.id === 'mvu.snapshot').checks.find((item) => item.id === 'snapshot-evidence').status, 'pass');
assert.ok(summarizeWorkflowDocument(mvu).pass > 0);
assert.deepEqual(normalizeWorkflowDocument(JSON.parse(JSON.stringify(mvu))), mvu);

const databaseWorkspace = {
  state: {
    kind: 'database',
    updateDialect: 'native',
    initialVariables: '',
    schema: '',
    updateRules: '{ "mate": {"name":"demo"}, "sheet_people": {"sourceData": {"updateNode":"..."}} }',
    outputFormat: '<tableEdit>updateRow(0, 1, {"状态":"在线"})</tableEdit>',
  },
  worldbookEntries: [],
  selectedComponents: [{ id: 'database-status-panel', label: '数据库状态面板', category: 'status_bar' }],
  builder: { revision: 1, nodeCount: 2 },
};

const database = generateWorkflowDocument({ engine: 'database', workspace: databaseWorkspace, generatedAt });
assert.equal(database.engine, 'database');
assert.equal(validateWorkflowDocument(database).valid, true);
assert.ok(database.nodes.every((item) => item.engine === 'database'));
assert.ok(database.nodes.some((item) => item.id === 'database.c8' && item.kind === 'boundary'));
assert.equal(database.edges.some((item) => item.source.nodeId === 'database.c8' || item.target.nodeId === 'database.c8'), false);
assert.equal(database.nodes.some((item) => item.ports.inputs.some((port) => port.type.startsWith('mvu.'))), false);
assert.equal(database.nodes.some((item) => item.sourceRoute === 'mvu'), false);
assert.ok(database.nodes.some((item) => item.id === 'database.template' && item.sourceRoute === 'state'));

const mvuFromDatabaseSources = generateWorkflowDocument({ engine: 'mvu', workspace: databaseWorkspace, generatedAt });
for (const id of ['mvu.schema', 'mvu.rules', 'mvu.display']) {
  assert.notEqual(mvuFromDatabaseSources.nodes.find((item) => item.id === id).state, 'ready');
}
const databaseFromMvuSources = generateWorkflowDocument({ engine: 'database', workspace: mvuWorkspace, generatedAt });
for (const id of ['database.template', 'database.rules', 'database.frontend']) {
  assert.notEqual(databaseFromMvuSources.nodes.find((item) => item.id === id).state, 'ready');
}
const nativeMvu = generateWorkflowDocument({
  engine: 'mvu',
  generatedAt,
  workspace: { ...mvuWorkspace, state: { ...mvuWorkspace.state, updateDialect: 'native' } },
});
assert.equal(nativeMvu.nodes.find((item) => item.id === 'mvu.operation').state, 'warning');
assert.equal(nativeMvu.nodes.find((item) => item.id === 'mvu.operation').checks.find((item) => item.id === 'operation-dialect').status, 'warning');
const builderOnlyMvu = generateWorkflowDocument({
  engine: 'mvu',
  generatedAt,
  workspace: {
    ...mvuWorkspace,
    selectedComponents: [],
    builder: { revision: 1, nodeCount: 3 },
  },
});
const builderOnlyDisplay = builderOnlyMvu.nodes.find((item) => item.id === 'mvu.display');
assert.equal(builderOnlyDisplay.state, 'warning');
assert.equal(builderOnlyDisplay.checks.find((item) => item.id === 'display-source').status, 'warning');

const invalid = JSON.parse(JSON.stringify(mvu));
invalid.nodes.find((item) => item.id === 'mvu.display').ports.inputs.find((port) => port.id === 'preview-operation').type = 'database.operation';
const invalidResult = validateWorkflowDocument(invalid);
assert.equal(invalidResult.valid, false);
assert.ok(invalidResult.errors.some((item) => item.startsWith('cross-engine-port:')));
assert.ok(invalidResult.errors.some((item) => item.startsWith('port-type-mismatch:')));

const connectedC8 = JSON.parse(JSON.stringify(database));
const connectedC8Node = connectedC8.nodes.find((item) => item.id === 'database.c8');
connectedC8Node.ports.outputs.push({ id: 'binding', label: '非法主链输出', type: 'database.binding' });
connectedC8.edges.push({
  id: 'database.advanced.c8-report',
  engine: 'database',
  level: 'advanced',
  relation: 'evidence',
  source: { nodeId: 'database.c8', portId: 'binding' },
  target: { nodeId: 'database.report', portId: 'binding' },
});
const connectedC8Result = validateWorkflowDocument(connectedC8);
assert.equal(connectedC8Result.valid, false);
assert.ok(connectedC8Result.errors.includes('database-c8-ports-forbidden'));
assert.ok(connectedC8Result.errors.includes('database-c8-edge-forbidden'));
assert.throws(() => normalizeWorkflowDocument(connectedC8), /database-c8/);

const emptyGraph = { ...JSON.parse(JSON.stringify(mvu)), nodes: [], edges: [] };
assert.equal(validateWorkflowDocument(emptyGraph).valid, false);
assert.throws(() => normalizeWorkflowDocument(emptyGraph), /document-nodes-empty/);
const disconnectedGraph = { ...JSON.parse(JSON.stringify(mvu)), edges: [] };
assert.equal(validateWorkflowDocument(disconnectedGraph).valid, false);
assert.throws(() => normalizeWorkflowDocument(disconnectedGraph), /document-edges-empty/);

const state = createEmptyWorkflowState();
state.documents.mvu = mvu;
state.selectedNodeId = 'mvu.schema';
const normalizedState = normalizeWorkflowState(JSON.parse(JSON.stringify(state)));
assert.equal(normalizedState.documents.mvu.id, mvu.id);
assert.equal(normalizedState.documents.database, null);
assert.equal(normalizedState.selectedNodeId, 'mvu.schema');
assert.deepEqual(normalizedState.nodeOverrides, { mvu: {}, database: {} });
assert.deepEqual(normalizedState.layoutOverrides, {
  mvu: { simple: {}, advanced: {} },
  database: { simple: {}, advanced: {} },
});

const positionedState = JSON.parse(JSON.stringify(state));
positionedState.layoutOverrides.mvu.simple = {
  'mvu.schema': { x: 126.4, y: 88.6 },
  'mvu.validator': { x: 320, y: 100 },
  'unknown.node': { x: 20, y: 20 },
};
positionedState.layoutOverrides.mvu.advanced = {
  'mvu.schema': { x: 8192, y: 0 },
  'mvu.rules': { x: -1, y: 24 },
  'mvu.display': { x: '180', y: 240 },
};
const normalizedPositionedState = normalizeWorkflowState(positionedState);
assert.deepEqual(normalizedPositionedState.layoutOverrides.mvu.simple, {
  'mvu.schema': { x: 126, y: 89 },
});
assert.deepEqual(normalizedPositionedState.layoutOverrides.mvu.advanced, {
  'mvu.schema': { x: 8192, y: 0 },
});
assert.deepEqual(normalizedPositionedState.layoutOverrides.database, { simple: {}, advanced: {} });

const editedState = JSON.parse(JSON.stringify(state));
editedState.documents.database = database;
const mvuSchemaNode = mvu.nodes.find((item) => item.id === 'mvu.schema');
const mvuRulesNode = mvu.nodes.find((item) => item.id === 'mvu.rules');
const mvuDisplayNode = mvu.nodes.find((item) => item.id === 'mvu.display');
editedState.nodeOverrides = {
  mvu: {
    'mvu.schema': {
      label: '  自定义 Schema  ',
      description: mvuSchemaNode.description,
      state: 'warning',
    },
    'mvu.rules': {
      label: mvuRulesNode.label,
      description: '由用户补充的规则说明',
    },
    'mvu.display': {
      label: mvuDisplayNode.label,
      description: mvuDisplayNode.description,
    },
    'mvu.operation': { label: '   ', description: 42 },
    'database.template': { label: '错误引擎节点' },
    'unknown.node': { label: '未知节点' },
  },
  database: {
    'database.template': { label: '数据库模板（编辑）', description: '' },
    'mvu.schema': { label: '错误引擎节点' },
  },
};
const normalizedEditedState = normalizeWorkflowState(editedState);
assert.deepEqual(normalizedEditedState.nodeOverrides, {
  mvu: {
    'mvu.schema': { label: '自定义 Schema' },
    'mvu.rules': { description: '由用户补充的规则说明' },
  },
  database: {
    'database.template': { label: '数据库模板（编辑）', description: '' },
  },
});

const limitedEditedState = JSON.parse(JSON.stringify(editedState));
limitedEditedState.nodeOverrides.mvu['mvu.schema'] = {
  label: `  ${'节'.repeat(100)}  `,
  description: '文'.repeat(1400),
};
const normalizedLimitedEditedState = normalizeWorkflowState(limitedEditedState);
assert.equal(normalizedLimitedEditedState.nodeOverrides.mvu['mvu.schema'].label.length, 80);
assert.equal(normalizedLimitedEditedState.nodeOverrides.mvu['mvu.schema'].description.length, 1200);

const regeneratedState = JSON.parse(JSON.stringify(editedState));
regeneratedState.documents.mvu = generateWorkflowDocument({
  engine: 'mvu',
  workspace: mvuWorkspace,
  generatedAt: '2026-07-16T12:10:00.000Z',
});
assert.deepEqual(normalizeWorkflowState(regeneratedState).nodeOverrides.mvu, {
  'mvu.schema': { label: '自定义 Schema' },
  'mvu.rules': { description: '由用户补充的规则说明' },
});

const invalidSelectionState = JSON.parse(JSON.stringify(state));
invalidSelectionState.selectedNodeId = 'database.template';
assert.equal(normalizeWorkflowState(invalidSelectionState).selectedNodeId, 'mvu.schema');

const swappedState = createEmptyWorkflowState();
swappedState.documents.mvu = database;
assert.throws(() => normalizeWorkflowState(swappedState), /documents\.mvu/);

const originalSignature = workflowSourceSignature(mvuWorkspace, 'mvu');
const changedSignature = workflowSourceSignature({
  ...mvuWorkspace,
  state: { ...mvuWorkspace.state, schema: `${mvuWorkspace.state.schema}\n// changed` },
}, 'mvu');
assert.notEqual(originalSignature, changedSignature);

const databaseSignatureBase = workflowSourceSignature({
  ...databaseWorkspace,
  worldbookEntries: [],
  selectedComponents: [{ id: 'same-panel', label: '普通面板', scenarios: [] }],
}, 'database');
const databaseSignatureWithSql = workflowSourceSignature({
  ...databaseWorkspace,
  worldbookEntries: [{ name: '查询规则', enabled: true, content: 'SELECT * FROM sheet_people' }],
  selectedComponents: [{ id: 'same-panel', label: '普通面板', scenarios: [] }],
}, 'database');
const databaseSignatureWithRelabeledComponent = workflowSourceSignature({
  ...databaseWorkspace,
  worldbookEntries: [],
  selectedComponents: [{ id: 'same-panel', label: 'Database panel', scenarios: [] }],
}, 'database');
const databaseSignatureWithEditedSource = workflowSourceSignature({
  ...databaseWorkspace,
  worldbookEntries: [{ name: '数据库备注', enabled: true, content: 'a: 2' }],
  selectedComponents: [{ id: 'same-panel', label: '普通面板', scenarios: [] }],
}, 'database');
assert.notEqual(databaseSignatureBase, databaseSignatureWithSql);
assert.notEqual(databaseSignatureBase, databaseSignatureWithRelabeledComponent);
assert.notEqual(workflowSourceSignature({
  ...databaseWorkspace,
  worldbookEntries: [{ name: '数据库备注', enabled: true, content: 'a: 1' }],
  selectedComponents: [{ id: 'same-panel', label: '普通面板', scenarios: [] }],
}, 'database'), databaseSignatureWithEditedSource);

const exported = workflowExportFile(mvu, '2026-07-16T12:30:00.000Z');
assert.equal(exported.document.id, mvu.id);
assert.equal(exported.exportedAt, '2026-07-16T12:30:00.000Z');

console.log('[ok] workflow blueprint contract validated');
