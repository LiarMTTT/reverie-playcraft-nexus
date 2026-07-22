import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MvuVariableStructureError,
  applyMvuVariableEdit,
  buildMvuVariableTree,
  parseMvuVariableState,
  serializeMvuVariableState,
} from '../portal/assets/mvu-variable-structure.js';

const json = parseMvuVariableState('{"玩家":{"生命":100,"启用":false,"备注":""},"列表":[1,{"名称":"测试"}]}');
assert.equal(json.sourceFormat, 'json');
assert.equal(json.tree.children[0].pathText, 'stat_data.玩家');
assert.equal(json.tree.children[1].children[1].children[0].pathText, 'stat_data.列表[1].名称');
assert.deepEqual(json.data.玩家, { 生命: 100, 启用: false, 备注: '' });

const yaml = parseMvuVariableState('玩家:\n  生命: 100\n  启用: false\n列表:\n  - one\n  - two');
assert.equal(yaml.sourceFormat, 'yaml');
assert.deepEqual(yaml.data, { 玩家: { 生命: 100, 启用: false }, 列表: ['one', 'two'] });

const original = { 玩家: { 生命: 100 }, 标签: [] };
const added = applyMvuVariableEdit(original, { type: 'add', path: ['玩家'], key: '名称', valueType: 'string', value: '星月' });
assert.deepEqual(original, { 玩家: { 生命: 100 }, 标签: [] }, '编辑不得原地修改来源');
assert.equal(added.玩家.名称, '星月');

const renamed = applyMvuVariableEdit(added, { type: 'rename', path: ['玩家', '生命'], key: '体力' });
assert.deepEqual(Object.keys(renamed.玩家), ['体力', '名称'], '改名保持原字段顺序');
const updated = applyMvuVariableEdit(renamed, { type: 'update', path: ['玩家', '体力'], valueType: 'number', value: '72' });
assert.equal(updated.玩家.体力, 72);
const arrayAdded = applyMvuVariableEdit(updated, { type: 'add', path: ['标签'], key: '', valueType: 'string', value: '主线' });
assert.deepEqual(arrayAdded.标签, ['主线']);
const removed = applyMvuVariableEdit(arrayAdded, { type: 'remove', path: ['玩家', '名称'] });
assert.equal(Object.hasOwn(removed.玩家, '名称'), false);

assert.equal(
  serializeMvuVariableState({ z: 0, a: false, empty: '' }),
  '{\n  "z": 0,\n  "a": false,\n  "empty": ""\n}\n',
);
assert.equal(buildMvuVariableTree({ 空: null }).children[0].valueType, 'null');

for (const key of ['a.b', 'a/b', 'a~b', '__proto__', 'constructor']) {
  assert.throws(
    () => applyMvuVariableEdit({}, { type: 'add', path: [], key, valueType: 'string', value: '' }),
    (error) => error instanceof MvuVariableStructureError && /^E_PATH_/.test(error.code),
  );
}
assert.throws(
  () => applyMvuVariableEdit({ 玩家: { 生命: 100, 体力: 50 } }, { type: 'rename', path: ['玩家', '生命'], key: '体力' }),
  (error) => error.code === 'E_EDIT_DUPLICATE',
);
assert.throws(
  () => parseMvuVariableState('[1,2,3]'),
  (error) => error.code === 'E_STATE_ROOT',
);
assert.throws(
  () => parseMvuVariableState('玩家:\n\t生命: 100'),
  (error) => error.code === 'E_YAML_TAB',
);
assert.throws(
  () => applyMvuVariableEdit({ 玩家: 1 }, { type: 'update', path: ['玩家'], valueType: 'number', value: 'NaN' }),
  (error) => error.code === 'E_EDIT_VALUE',
);
for (const source of [
  '{"玩家":1,"玩家":2}',
  '玩家:\n  生命: 100\n  生命: 72',
  '玩家: {"生命":100,"生命":72}',
]) {
  assert.throws(
    () => parseMvuVariableState(source),
    (error) => ['E_JSON_DUPLICATE', 'E_YAML_DUPLICATE'].includes(error.code),
    'JSON 与 YAML 重复键必须被拒绝，不能静默覆盖',
  );
}
const tooDeepJson = `${'{"层":'.repeat(34)}0${'}'.repeat(34)}`;
assert.throws(
  () => parseMvuVariableState(tooDeepJson),
  (error) => error.code === 'E_DATA_DEPTH',
  '重复键扫描也必须遵守状态深度上限，不能先溢出调用栈',
);
for (const invalidValue of [
  { 玩家: undefined },
  { 玩家: () => true },
  { 玩家: Number.NaN },
  { 玩家: Number.POSITIVE_INFINITY },
  { 玩家: Array(1) },
]) {
  assert.throws(
    () => buildMvuVariableTree(invalidValue),
    (error) => error instanceof MvuVariableStructureError && /^E_DATA_/.test(error.code),
    '非 JSON 值必须在克隆前被拒绝，不能静默丢失或转成 null',
  );
}
for (const edit of [
  { type: 'remove', path: ['玩家', '不存在'] },
  { type: 'rename', path: ['玩家', '不存在'], key: '新字段' },
  { type: 'remove', path: ['标签', 1] },
]) {
  assert.throws(
    () => applyMvuVariableEdit({ 玩家: { 生命: 100 }, 标签: ['主线'] }, edit),
    (error) => error.code === 'E_EDIT_PATH',
    '缺失节点和越界数组项不能被当作编辑成功',
  );
}

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(toolsDir, '..');
const moduleSource = readFileSync(path.join(root, 'portal', 'assets', 'mvu-variable-structure.js'), 'utf8');
const studioSource = readFileSync(path.join(root, 'portal', 'assets', 'card-studio.js'), 'utf8');
const portalSource = readFileSync(path.join(root, 'portal', 'index.html'), 'utf8');

assert.match(moduleSource, /from '\.\/mvu-turn-simulator\.js\?v=[^']+'/, '变量结构必须复用并显式升版既有安全解析器');
for (const forbidden of [
  /\bdocument\b/,
  /\bwindow\b/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /\beval\s*\(/,
  /new Function/,
  /TavernHelper/,
]) assert.doesNotMatch(moduleSource, forbidden, `变量结构纯模块包含越界能力：${forbidden}`);

assert.match(studioSource, /from '\.\/mvu-variable-structure\.js\?v=[^']+';/, '工作台必须通过独立纯模块编辑变量结构');
const editorStart = studioSource.indexOf('function createEmptyMvuVariableEditorSession');
const editorEnd = studioSource.indexOf('function renderCoverState', editorStart);
assert.ok(editorStart >= 0 && editorEnd > editorStart, '无法提取变量编辑器接线边界');
const editorSource = studioSource.slice(editorStart, editorEnd);
assert.equal((editorSource.match(/updateStateField\('initialVariables',\s*json\)/g) || []).length, 1, '变量工作副本必须只有一个显式应用写点');
for (const forbidden of [
  /project\.state\.initialVariables\s*=/,
  /project\.worldbook\.entries\s*=/,
  /selectedComponents\.(?:push|splice|add|delete)\s*\(/,
  /workflowBlueprint\.documents\s*=/,
  /rawCard\s*=/,
  /\beval\s*\(/,
  /new Function/,
]) assert.doesNotMatch(editorSource, forbidden, `变量编辑器包含越界写入：${forbidden}`);
assert.match(editorSource, /mvuVariableSession\.workingText/, '可视编辑必须使用内存工作副本');
assert.match(
  editorSource,
  /function applyMvuVariableOperation[\s\S]*?catch \(error\)[\s\S]*?renderMvuVariableDetail\(\)/,
  '节点编辑失败后必须恢复详情中的已提交值',
);
assert.match(editorSource, /window\.confirm\('当前工作副本来自 YAML/, 'YAML 写入规范 JSON 前必须显式确认');
assert.match(editorSource, /mvuVariableEntries\(\)[\s\S]*project\.worldbook\.entries/, '来源选择必须读取当前工作区世界书，而非第二份分析缓存');

for (const hook of [
  'data-rcs-variable-source-select',
  'data-rcs-variable-mode="visual"',
  'data-rcs-variable-mode="source"',
  'data-rcs-variable-tree',
  'data-rcs-variable-detail',
  'data-rcs-variable-discard',
  'data-rcs-variable-apply',
]) assert.ok(portalSource.includes(hook), `变量编辑器缺少 DOM hook：${hook}`);
for (const field of ['updateDialect', 'initialVariables', 'schema', 'updateRules', 'outputFormat']) {
  assert.equal((portalSource.match(new RegExp(`data-rcs-state-field="${field}"`, 'g')) || []).length, 1, `状态字段 ${field} 必须保持唯一`);
}
for (const field of ['required', 'openness']) {
  assert.match(portalSource, new RegExp(`data-rcs-variable-field="${field}"[^>]*disabled`), `${field} 首版必须明确只读`);
}
assert.match(portalSource, /data-rcs-variable-field="schemaDefault"[^>]*readonly/, 'Schema 默认值不得伪装为可写配置');
for (const step of ['schema', 'initvar', 'rules', 'consumers', 'check']) {
  assert.match(portalSource, new RegExp(`data-rcs-variable-chain-step="${step}"`), `变量编辑器缺少链路状态：${step}`);
}
for (const route of ['worldbook', 'mvu', 'workflow', 'design', 'check']) {
  assert.match(portalSource, new RegExp(`href="#studio/${route}"`), `变量指南缺少工作台链接：${route}`);
}

console.log('mvu_variable_structure.test: ok');
