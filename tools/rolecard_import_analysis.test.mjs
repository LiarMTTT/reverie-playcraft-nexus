import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ROLECARD_IMPORT_ANALYSIS_FORMAT,
  ROLECARD_IMPORT_ANALYSIS_VERSION,
  analyzeRolecardImport,
} from '../portal/assets/rolecard-import-analysis.js';

const rawCard = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  custom_top_level: { keep: true },
  data: {
    name: '分析样卡',
    description: '只读导入分析。',
    first_mes: '开场',
    alternate_greetings: ['候选一', '候选二'],
    custom_data_field: { keep: true },
    extensions: {
      regex_scripts: [{ id: 'regex-1', findRegex: '/x/g' }],
      tavern_helper: { scripts: [{ id: 'script-1', content: 'return 1' }] },
      private_extension: { keep: true },
      rpn: {
        component_ids: [
          'variables.base_schema',
          'status_bar.core',
          'variables.base_schema',
          { id: 'registry.missing.explicit' },
        ],
      },
    },
    character_book: {
      name: '内嵌世界书',
      description: '路由测试',
      entries: [
        { id: 1, comment: '[InitVar] 初始变量', content: '玩家:\n  生命: 100', disable: true },
        { id: 2, comment: '[mvu_update] 更新规则', content: '只允许写入已知路径' },
        { id: 3, name: '[mvu_plot] 剧情约束', content: '不要输出变量指令' },
        { id: 4, comment: '普通设定', content: '可见正文', enabled: false },
      ],
    },
  },
};

const componentCatalog = {
  format: 'rolecard-component-catalog',
  schemaVersion: 1,
  libraryVersion: 'test-catalog',
  modules: [
    { id: 'variables.base_schema', commonName: '变量基线', category: 'variables' },
    { id: 'status_bar.core', title: '状态栏核心', category: 'status_bar' },
  ],
};

const rawBefore = structuredClone(rawCard);
const catalogBefore = structuredClone(componentCatalog);
const result = analyzeRolecardImport({ rawCard, componentCatalog });

assert.deepEqual(rawCard, rawBefore, '分析不得修改原始角色卡');
assert.deepEqual(componentCatalog, catalogBefore, '分析不得修改组件目录');
assert.equal(result.format, ROLECARD_IMPORT_ANALYSIS_FORMAT);
assert.equal(result.schemaVersion, ROLECARD_IMPORT_ANALYSIS_VERSION);
assert.equal(result.status, 'ready');

assert.equal(result.summary.cardFieldCount, 4);
assert.equal(result.card.fields.find((field) => field.key === 'name')?.boundary, 'editable');
assert.equal(result.card.fields.find((field) => field.key === 'alternate_greetings')?.itemCount, 2);

const legacyGroupOpening = analyzeRolecardImport({
  rawCard: {
    spec: 'chara_card_v3',
    data: { name: '兼容字段', group_only_greetings: ['旧群聊开场'] },
  },
  componentCatalog,
});
assert.equal(legacyGroupOpening.card.fields.find((field) => field.key === 'group_only_greetings')?.boundary, 'preserved');

assert.equal(result.worldbook.entryCount, 4);
assert.deepEqual(result.worldbook.routeCounts, {
  initvar: 1,
  mvu_update: 1,
  mvu_plot: 1,
  plain: 1,
});
assert.equal(result.worldbook.entries[0].enabled, false);
assert.equal(result.worldbook.entries[3].route, 'plain');
assert.equal(result.state.detected, true);
assert.equal(result.state.strategy, 'mvu');
assert.deepEqual(result.state.sourceCounts, {
  initialVariables: 1,
  updateRules: 1,
  plotInstructions: 1,
});
assert.equal(result.state.sources.every((source) => source.boundary === 'editable'), true);

assert.equal(result.extensions.scripts.length, 1);
assert.equal(result.extensions.scripts[0].path, 'data.extensions.tavern_helper.scripts');
assert.equal(result.extensions.scripts[0].itemCount, 1);
assert.equal(result.extensions.scripts[0].executed, false);
assert.equal(result.extensions.regex.length, 1);
assert.equal(result.extensions.regex[0].path, 'data.extensions.regex_scripts');
assert.equal(result.extensions.regex[0].itemCount, 1);
assert.equal(result.extensions.regex[0].boundary, 'preserved');

assert.deepEqual(result.unknown.fields.map((item) => item.path), [
  'custom_top_level',
  'data.custom_data_field',
]);
assert.deepEqual(result.unknown.extensions.map((item) => item.path), [
  'data.extensions.private_extension',
]);
assert.equal(result.unknown.fields.every((item) => item.boundary === 'preserved'), true);

assert.deepEqual(result.componentCandidates.map((item) => item.id), [
  'registry.missing.explicit',
  'status_bar.core',
  'variables.base_schema',
]);
assert.equal(result.componentCandidates.find((item) => item.id === 'variables.base_schema')?.catalogMatch, true);
assert.equal(result.componentCandidates.find((item) => item.id === 'variables.base_schema')?.label, '变量基线');
assert.equal(result.componentCandidates.find((item) => item.id === 'registry.missing.explicit')?.catalogMatch, false);
assert.equal(result.componentCandidates.every((item) => item.boundary === 'candidate'), true);
assert.equal(result.componentCandidates.every((item) => item.explicit && item.matchMode === 'exact'), true);
assert.equal(result.boundaries.safety.executesScripts, false);
assert.equal(result.boundaries.safety.executesRegex, false);
assert.equal(result.boundaries.safety.executesZod, false);
assert.equal(result.boundaries.safety.parsesVariableValues, false);
assert.equal(result.boundaries.safety.fuzzyComponentMatching, false);
assert.equal(result.boundaries.safety.mutatesInput, false);

const noCatalog = analyzeRolecardImport({ rawCard });
assert.equal(noCatalog.status, 'ready');
assert.equal(noCatalog.componentCandidates.length, 3);
assert.equal(noCatalog.componentCandidates.every((item) => item.catalogMatch === null), true);
assert.equal(noCatalog.warnings.some((warning) => warning.code === 'W_COMPONENT_CATALOG_UNAVAILABLE'), true);
assert.deepEqual(analyzeRolecardImport({ rawCard, componentCatalog }), result, '相同输入必须得到稳定结果');

for (const [input, code] of [
  [null, 'E_ANALYSIS_INPUT'],
  [[], 'E_ANALYSIS_INPUT'],
  [{}, 'E_RAW_CARD'],
  [{ rawCard: null }, 'E_RAW_CARD'],
  [{ rawCard: [] }, 'E_RAW_CARD'],
  [{ rawCard: { data: [] } }, 'E_CARD_DATA'],
  [{ rawCard: { arbitrary: true } }, 'E_ROLECARD_SHAPE'],
]) {
  const invalid = analyzeRolecardImport(input);
  assert.equal(invalid.status, 'invalid');
  assert.equal(invalid.errors[0]?.code, code);
  assert.deepEqual(invalid.worldbook.routeCounts, { initvar: 0, mvu_update: 0, mvu_plot: 0, plain: 0 });
  assert.equal(Array.isArray(invalid.componentCandidates), true);
}

const malformedContainers = analyzeRolecardImport({
  rawCard: {
    spec: 'chara_card_v3',
    data: {
      name: '异常容器',
      extensions: { regex_scripts: {}, tavern_helper: { scripts: 'not-an-array' }, componentIds: 42 },
      character_book: { entries: {} },
    },
  },
  componentCatalog: { modules: [] },
});
assert.equal(malformedContainers.status, 'ready');
assert.equal(malformedContainers.extensions.regex[0].validArray, false);
assert.equal(malformedContainers.extensions.scripts[0].validArray, false);
assert.equal(malformedContainers.warnings.some((warning) => warning.code === 'W_WORLDBOOK_ENTRIES'), true);
assert.equal(malformedContainers.warnings.some((warning) => warning.code === 'W_COMPONENT_IDS'), true);

const sourceText = await readFile(new URL('../portal/assets/rolecard-import-analysis.js', import.meta.url), 'utf8');
for (const forbidden of [
  /\beval\s*\(/,
  /new\s+Function\b/,
  /\bfetch\s*\(/,
  /XMLHttpRequest/,
  /WebSocket/,
  /localStorage/,
  /sessionStorage/,
  /indexedDB/,
  /document\./,
  /window\./,
]) assert.doesNotMatch(sourceText, forbidden);

console.log('[ok] rolecard import analysis is pure, explicit, and renderable');
