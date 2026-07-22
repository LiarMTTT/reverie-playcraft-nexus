import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MvuSimulationError,
  buildMvuSafeContract,
  createMvuSimulationSeed,
  mvuSimulationSourceSignature,
  normalizeMvuSafeContract,
  parseMvuOperationInput,
  parseMvuStateText,
  replayMvuTurn,
  simulateMvuTurn,
} from '../portal/assets/mvu-turn-simulator.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof MvuSimulationError && error.code === code);
}

const simulatorSource = await readFile(new URL('../portal/assets/mvu-turn-simulator.js', import.meta.url), 'utf8');
for (const forbidden of [/\beval\s*\(/, /new\s+Function\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /indexedDB/, /Math\.random/, /Date\.now/]) {
  assert.doesNotMatch(simulatorSource, forbidden);
}

const yamlSource = [
  '玩家:',
  '  生命值: 80',
  '  在线: true',
  '  标签:',
  '    - 学生',
  '    - 调查员',
  '角色:',
  '  - 名称: 林澈',
  '    好感度: 12',
].join('\n');

const parsedYaml = parseMvuStateText(yamlSource);
assert.deepEqual(parsedYaml, {
  玩家: { 生命值: 80, 在线: true, 标签: ['学生', '调查员'] },
  角色: [{ 名称: '林澈', 好感度: 12 }],
});
assert.deepEqual(parseMvuStateText('{"玩家":{"生命值":80}}'), { 玩家: { 生命值: 80 } });
expectCode(() => parseMvuStateText('危险: !!js/function >\n  return 1'), 'E_YAML_UNSAFE');
expectCode(() => parseMvuStateText('{"__proto__":{"polluted":true}}'), 'E_PATH_POISON');
expectCode(() => parseMvuStateText('{"危险.键":1}'), 'E_PATH_KEY');
expectCode(() => parseMvuStateText('{"obj":{"*":1}}'), 'E_PATH_KEY');

const initialVariables = JSON.stringify({ 玩家: { 生命值: 80, 状态: '正常' }, 任务: [] });
const updateRules = [
  '生命值:',
  '  path: /玩家/生命值',
  '  type: number',
  '  range: 0 ~ 100',
  '  check:',
  '    - 受到伤害: 减少相应数值',
  '    - 治疗恢复: 增加但不超过上限',
  '状态:',
  '  path: /玩家/状态',
  '  type: string',
  '  enum: [正常, 受伤]',
].join('\n');
const schemaSource = 'globalThis.__schemaExecuted = true; const Schema = z.object({});';
const sourceSignature = mvuSimulationSourceSignature({ dialect: 'rfc6902', initialVariables, updateRules, schema: schemaSource });
const before = parseMvuStateText(initialVariables);
const contract = buildMvuSafeContract({ before, updateRules, schema: schemaSource, sourceSignature });
assert.equal(contract.source.zodExecuted, false);
assert.equal(contract.source.zodStatus, 'source_only');
assert.ok(contract.fields.some((field) => field.path === '/玩家/生命值' && field.minimum === 0 && field.maximum === 100 && field.rangeMode === 'clamp'));
assert.equal(contract.ruleChecks.length, 2);
assert.deepEqual(normalizeMvuSafeContract(JSON.stringify(contract)), contract);
assert.deepEqual(
  buildMvuSafeContract({ before: { 中: 1, a: 1, A: 1, '😀': 1 } }).fields.map((field) => field.path),
  ['/A', '/a', '/中', '/😀'],
);

globalThis.__schemaExecuted = false;
const frozenBefore = deepFreeze(before);
const beforeCopy = structuredClone(before);
const rfcInput = '[{"op":"replace","path":"/玩家/生命值","value":"120"}]';
const first = simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature,
  currentSourceSignature: sourceSignature,
  dialect: 'rfc6902',
  before: frozenBefore,
  operationInput: rfcInput,
  contract,
});
const second = simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature,
  currentSourceSignature: sourceSignature,
  dialect: 'rfc6902',
  before: frozenBefore,
  operationInput: rfcInput,
  contract,
});
assert.deepEqual(frozenBefore, beforeCopy);
assert.deepEqual(first, second);
assert.notStrictEqual(first.before, frozenBefore);
assert.equal(first.patched.玩家.生命值, '120');
assert.equal(first.after.玩家.生命值, 100);
assert.ok(first.schemaDiff.some((item) => item.path === '/玩家/生命值'));
assert.ok(first.diff.some((item) => item.path === '/玩家/生命值'));
assert.equal(first.schema.zodExecuted, false);
assert.equal(globalThis.__schemaExecuted, false);
assert.deepEqual(replayMvuTurn(first), first);

first.after.玩家.生命值 = -999;
first.operation.operations[0].value = -999;
const isolatedReplay = simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature,
  dialect: 'rfc6902',
  before,
  operationInput: rfcInput,
  contract,
});
assert.equal(isolatedReplay.after.玩家.生命值, 100);
assert.equal(before.玩家.生命值, 80);

const emptyRun = simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature,
  dialect: 'rfc6902',
  before,
  operationInput: '[]',
  contract,
});
assert.deepEqual(emptyRun.after, before);
assert.deepEqual(emptyRun.diff, []);
const tamperedTrace = structuredClone(emptyRun);
tamperedTrace.checks[0].detail = 'tampered';
expectCode(() => replayMvuTurn(tamperedTrace), 'E_TRACE_REPLAY');
const tamperedKernelTrace = structuredClone(emptyRun);
tamperedKernelTrace.kernelVersion = 'mvu-turn-v0';
expectCode(() => replayMvuTurn(tamperedKernelTrace), 'E_TRACE_VERSION');
const traceWithSidecar = structuredClone(emptyRun);
traceWithSidecar.sidecar = true;
expectCode(() => replayMvuTurn(traceWithSidecar), 'E_TRACE_FIELD');

const atomicBefore = { 玩家: { 生命值: 80, 状态: '正常' }, 任务: [] };
const atomicSnapshot = structuredClone(atomicBefore);
expectCode(() => simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature,
  dialect: 'rfc6902',
  before: atomicBefore,
  operationInput: JSON.stringify([
    { op: 'replace', path: '/玩家/生命值', value: 20 },
    { op: 'replace', path: '/玩家/不存在', value: 1 },
  ]),
  contract,
}), 'E_REPLACE_MISSING');
assert.deepEqual(atomicBefore, atomicSnapshot);

expectCode(() => simulateMvuTurn({
  engine: 'database',
  stateKind: 'database',
  sourceSignature,
  dialect: 'rfc6902',
  before,
  operationInput: '[]',
  contract,
}), 'E_ENGINE');
expectCode(() => simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature,
  currentSourceSignature: 'fnv1a:stale',
  dialect: 'rfc6902',
  before,
  operationInput: '[]',
  contract,
}), 'E_SOURCE_STALE');
expectCode(() => parseMvuOperationInput("_.set('玩家.生命值', 80, 20);", 'native'), 'E_DIALECT_UNSUPPORTED');
expectCode(() => parseMvuOperationInput('[{"op":"delta","path":"/玩家/生命值","value":1}]', 'rfc6902'), 'E_OPERATION_OP');
expectCode(() => parseMvuOperationInput('[{"op":"add","path":"/玩家/新字段","value":1}]', 'official_jsonpatch'), 'E_OPERATION_OP');
expectCode(() => parseMvuOperationInput('[{"op":"move","from":"/玩家/生命值","to":"/玩家/迁移值"}]', 'rfc6902'), 'E_OPERATION_FIELD');
assert.deepEqual(parseMvuOperationInput({ format: 'mvu-operations-v1', dialect: 'rfc6902', operations: [] }, 'rfc6902'), []);
expectCode(() => parseMvuOperationInput({ format: 'mvu-operations-v1', dialect: 'rfc6902', operations: [], native: '_.set("x",1)' }, 'rfc6902'), 'E_OPERATION_FIELD');
expectCode(() => parseMvuOperationInput('{"format":"mvu-operations-v1","dialect":"rfc6902","operations":[],"sidecar":true}', 'rfc6902'), 'E_OPERATION_FIELD');
expectCode(() => parseMvuOperationInput('<JSONPatch>[]</JSONPatch><JSONPatch>[]</JSONPatch>', 'rfc6902'), 'E_OPERATION_BLOCKS');
assert.deepEqual(parseMvuOperationInput('<JSONPatch>[]</JSONPatch>', 'rfc6902'), []);
assert.deepEqual(parseMvuOperationInput('<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>', 'rfc6902'), []);
assert.deepEqual(parseMvuOperationInput('<UpdateVariable><analysis>state changed</analysis><JSONPatch>[]</JSONPatch></UpdateVariable>', 'rfc6902'), []);
assert.deepEqual(parseMvuOperationInput('<VariableUpdate><JSONPatch>[]</JSONPatch></VariableUpdate>', 'rfc6902'), []);
expectCode(() => parseMvuOperationInput('_.assign({}); <JSONPatch>[]</JSONPatch>', 'rfc6902'), 'E_OPERATION_BLOCK');
expectCode(() => parseMvuOperationInput("_.set('玩家.生命值', 80, 20);", 'rfc6902'), 'E_NATIVE_UNSUPPORTED');
expectCode(() => parseMvuOperationInput('<UpdateVariable><JSONPatch>[]</JSONPatch>', 'rfc6902'), 'E_OPERATION_BLOCK');
expectCode(() => parseMvuOperationInput('<UpdateVariable><analysis>a</analysis><analysis>b</analysis><JSONPatch>[]</JSONPatch></UpdateVariable>', 'rfc6902'), 'E_OPERATION_BLOCK');
expectCode(() => parseMvuOperationInput('<JSONPatch>[]</JSONPatch> trailing', 'rfc6902'), 'E_OPERATION_BLOCK');
assert.equal(
  parseMvuOperationInput('[{"op":"replace","path":"/玩家/状态","value":"<JSONPatch>not a wrapper</JSONPatch>"}]', 'rfc6902')[0].value,
  '<JSONPatch>not a wrapper</JSONPatch>',
);
const nativeLookingValue = [{ op: 'replace', path: '/玩家/状态', value: 'example: _.set("a",1)' }];
assert.deepEqual(parseMvuOperationInput(JSON.stringify(nativeLookingValue), 'rfc6902'), nativeLookingValue);
assert.deepEqual(parseMvuOperationInput(`<JSONPatch>${JSON.stringify(nativeLookingValue)}</JSONPatch>`, 'rfc6902'), nativeLookingValue);
assert.deepEqual(parseMvuOperationInput(`<UpdateVariable><JSONPatch>${JSON.stringify(nativeLookingValue)}</JSONPatch></UpdateVariable>`, 'rfc6902'), nativeLookingValue);
const tagLookingValue = [{ op: 'replace', path: '/玩家/状态', value: '<JSONPatch>not a wrapper</JSONPatch>' }];
assert.deepEqual(parseMvuOperationInput(`<JSONPatch>${JSON.stringify(tagLookingValue)}</JSONPatch>`, 'rfc6902'), tagLookingValue);
assert.deepEqual(parseMvuOperationInput(`<UpdateVariable><JSONPatch>${JSON.stringify(tagLookingValue)}</JSONPatch></UpdateVariable>`, 'rfc6902'), tagLookingValue);
const sparseOperations = [];
sparseOperations.length = 1;
expectCode(() => parseMvuOperationInput(sparseOperations, 'rfc6902'), 'E_DATA_ARRAY');

const closedBefore = { obj: { known: 1 }, items: [{ name: '已知', qty: 1 }] };
const closedInitial = JSON.stringify(closedBefore);
const closedSignature = mvuSimulationSourceSignature({ dialect: 'rfc6902', initialVariables: closedInitial });
const closedContract = buildMvuSafeContract({ before: closedBefore, sourceSignature: closedSignature });
const validClosedInsert = simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature: closedSignature,
  dialect: 'rfc6902',
  before: closedBefore,
  operationInput: '[{"op":"add","path":"/items/-","value":{"name":"新增","qty":2}}]',
  contract: closedContract,
});
assert.deepEqual(validClosedInsert.after.items[1], { name: '新增', qty: 2 });
for (const operationInput of [
  '[{"op":"replace","path":"/obj","value":{"evil":2}}]',
  '[{"op":"replace","path":"/items","value":[{"evil":"x"}]}]',
  '[{"op":"add","path":"/items/-","value":{"evil":"x"}}]',
]) {
  expectCode(() => simulateMvuTurn({
    engine: 'mvu',
    stateKind: 'mvu',
    sourceSignature: closedSignature,
    dialect: 'rfc6902',
    before: closedBefore,
    operationInput,
    contract: closedContract,
  }), 'E_CONTRACT_CLOSED');
}

const officialBefore = { 玩家: { 生命值: 10, 备用值: 2 }, 技能: ['观察'] };
const officialSignature = mvuSimulationSourceSignature({ dialect: 'official_jsonpatch', initialVariables: JSON.stringify(officialBefore) });
const officialContract = buildMvuSafeContract({ before: officialBefore, sourceSignature: officialSignature });
officialContract.fields.push({
  path: '/玩家/迁移值', label: '迁移值', type: 'integer', required: false, coerce: false, rangeMode: 'reject',
});
const normalizedOfficialContract = normalizeMvuSafeContract({ ...officialContract, fingerprint: undefined });
const official = simulateMvuTurn({
  engine: 'mvu',
  stateKind: 'mvu',
  sourceSignature: officialSignature,
  dialect: 'official_jsonpatch',
  before: officialBefore,
  operationInput: JSON.stringify([
    { op: 'delta', path: '/玩家/生命值', value: 5 },
    { op: 'insert', path: '/技能/-', value: '洞察' },
    { op: 'move', from: '/玩家/备用值', to: '/玩家/迁移值' },
  ]),
  contract: normalizedOfficialContract,
});
assert.equal(official.after.玩家.生命值, 15);
assert.equal(official.after.玩家.迁移值, 2);
assert.equal(Object.hasOwn(official.after.玩家, '备用值'), false);
assert.deepEqual(official.after.技能, ['观察', '洞察']);

const seed = createMvuSimulationSeed({ initialVariables: yamlSource, updateRules, schema: schemaSource, dialect: 'rfc6902' });
assert.equal(seed.before.玩家.生命值, 80);
assert.equal(seed.operationText, '[]');
assert.equal(seed.contract.source.sourceSignature, seed.sourceSignature);

let externalCalls = 0;
const originalFetch = globalThis.fetch;
const originalRandom = Math.random;
globalThis.fetch = () => { externalCalls += 1; throw new Error('fetch forbidden'); };
Math.random = () => { externalCalls += 1; throw new Error('random forbidden'); };
try {
  simulateMvuTurn({
    engine: 'mvu', stateKind: 'mvu', sourceSignature, dialect: 'rfc6902', before,
    operationInput: '[]', contract,
  });
} finally {
  globalThis.fetch = originalFetch;
  Math.random = originalRandom;
}
assert.equal(externalCalls, 0);

console.log('[ok] deterministic MVU turn simulator validated');
