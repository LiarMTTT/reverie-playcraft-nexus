import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createRolecardExportPlan,
  ROLECARD_EXPORT_PLAN_FORMAT,
  ROLECARD_EXPORT_PLAN_VERSION,
} from '../portal/assets/rolecard-export-plan.js';

function fixture({ draftMatches = true, binding = '玩家.生命', ruleType = 'number' } = {}) {
  const initialVariables = JSON.stringify({ 玩家: { 生命: 10, 名称: '旅人' } }, null, 2);
  const updateRules = `生命规则:\n  path: /玩家/生命\n  type: ${ruleType}\n  required: true`;
  const worldbookInitial = draftMatches ? initialVariables : JSON.stringify({ 玩家: { 生命: 5 } });
  const rawCard = {
    spec: 'chara_card_v3',
    spec_version: '3.0',
    untouched_root: { keep: true },
    data: {
      name: '旧名称',
      description: '',
      extensions: { regex_scripts: [{ id: 'keep-me' }], custom_flag: true },
      character_book: { name: '旧世界书', entries: [], custom_book_flag: 'keep' },
    },
  };
  const candidateCard = {
    ...rawCard,
    data: {
      ...rawCard.data,
      name: '新名称',
      personality: '',
      scenario: '',
      system_prompt: '',
      post_history_instructions: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      tags: [],
      creator: '',
      character_version: '0.1.0',
      alternate_greetings: [],
      group_only_greetings: [],
      character_book: {
        name: '测试世界书',
        custom_book_flag: 'keep',
        entries: [
          { id: 0, comment: '[InitVar] 状态', content: worldbookInitial, enabled: false },
          { id: 1, comment: '[mvu_update] 规则', content: updateRules, enabled: true },
        ],
      },
    },
  };
  const project = {
    state: { kind: 'mvu', initialVariables, updateRules, schema: 'z.object({})', outputFormat: '' },
    worldbook: { entries: [
      { uid: 0, name: '[InitVar] 状态', content: worldbookInitial, enabled: false },
      { uid: 1, name: '[mvu_update] 规则', content: updateRules, enabled: true },
    ] },
    frontend: {
      selectedComponents: ['status-bar'],
      builder: { project: { nodes: [{ id: 'n1', componentId: 'Text', hidden: false, props: { bindTextPath: binding } }] } },
      simulationPreview: {},
    },
    workflowBlueprint: { documents: { mvu: { id: 'mvu' }, database: null } },
  };
  return { candidateCard, rawCard, project };
}

{
  const input = fixture();
  const before = JSON.stringify(input);
  const plan = createRolecardExportPlan(input);
  assert.equal(plan.format, ROLECARD_EXPORT_PLAN_FORMAT);
  assert.equal(plan.schemaVersion, ROLECARD_EXPORT_PLAN_VERSION);
  assert.equal(plan.status, 'ready');
  assert.match(plan.fingerprint, /^fnv1a:[0-9a-f]{8}$/);
  assert.equal(JSON.stringify(input), before, '纯计划不得修改任何输入');
  assert.ok(plan.included.some((entry) => entry.path === '/data/character_book'));
  assert.ok(plan.preserved.some((entry) => entry.path === '/data/extensions/regex_scripts'));
  assert.ok(plan.preserved.some((entry) => entry.path === '/untouched_root'));
  assert.ok(plan.normalized.some((entry) => entry.path === '/data/name'));
  assert.ok(plan.projectOnly.some((entry) => entry.id === 'project-only-components'));
  assert.ok(plan.projectOnly.some((entry) => entry.id === 'project-only-schema'));
  assert.equal(plan.variableReferences.summary.definitions, 3);
  assert.equal(plan.variableReferences.summary.rules, 1);
  assert.equal(plan.variableReferences.summary.consumers, 1);
  assert.ok(plan.diff.items.some((entry) => entry.path === '/data/name' && entry.kind === 'changed'));
  assert.deepEqual(plan.card, input.candidateCard);
}

{
  const input = fixture();
  const first = createRolecardExportPlan(input);
  const second = createRolecardExportPlan(JSON.parse(JSON.stringify(input)));
  assert.equal(first.fingerprint, second.fingerprint, '相同输入必须生成稳定指纹');
  const checked = createRolecardExportPlan({ ...input, checkResult: { counts: { error: 2 } } });
  assert.equal(checked.status, 'blocked');
  assert.equal(checked.compatibility.checkErrors, 2);
  assert.equal(first.fingerprint, checked.fingerprint, '检查时间与检查计数不得改变候选装配指纹');
}

{
  const plan = createRolecardExportPlan(fixture({ draftMatches: false }));
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.blockers.some((entry) => entry.id.includes('unbound-state-draft')));
  assert.ok(plan.projectOnly.some((entry) => entry.id === 'project-only-initial-variables'));
}

{
  const plan = createRolecardExportPlan(fixture({ ruleType: 'boolean' }));
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.blockers.some((entry) => entry.id.includes('rule-type-conflict')));
}

{
  const plan = createRolecardExportPlan(fixture({ binding: 'stat_data.玩家.生命' }));
  assert.equal(plan.status, 'ready');
  assert.ok(plan.variableReferences.issues.some((entry) => entry.code === 'runtime-path-mismatch'));
  assert.equal(plan.variableReferences.consumers[0].canonicalPath, '/玩家/生命');
}

{
  const plan = createRolecardExportPlan(fixture({ binding: '玩家[0].生命' }));
  assert.equal(plan.status, 'blocked');
  assert.ok(plan.variableReferences.issues.some((entry) => entry.code === 'invalid-ui-binding'));
}

{
  const rawCard = {
    spec: 'chara_card_v3',
    data: {
      description: '旧文四字',
      system_prompt: '<%= getvar("safe") %>',
      alternate_greetings: ['甲乙丙丁'],
      extensions: {
        regex_scripts: [{ findRegex: '/<tag>/giu', replaceString: '</script>' }],
        unknown_vendor: { opaque: true },
      },
      character_book: {
        entries: [
          { id: 10, comment: '[mvu_plot] 剧情', content: '原剧情' },
          { id: 11, comment: '[InitVar] 状态', content: '{"hp":10}' },
          { id: 12, comment: '普通世界书', content: '原设定' },
        ],
      },
    },
  };
  const candidateCard = {
    ...rawCard,
    data: {
      ...rawCard.data,
      description: '新文四字',
      alternate_greetings: ['戊己庚辛'],
      character_book: {
        entries: [
          { id: 10, comment: '[mvu_plot] 剧情', content: '新剧情' },
          { id: 11, comment: '[InitVar] 状态', content: '{"hp":11}' },
          { id: 12, comment: '普通世界书', content: '新设定' },
        ],
      },
    },
  };
  const plan = createRolecardExportPlan({ candidateCard, rawCard, project: {} });
  assert.equal(plan.review.status, 'ready');
  assert.equal(plan.review.safety.executesContent, false);
  assert.match(plan.review.fingerprint, /^fnv1a:[0-9a-f]{8}$/);
  const description = plan.review.text.find((entry) => entry.id === 'card-text-description');
  assert.equal(description.change, 'changed', '同长度更改不得被摘要或长度判定吞掉');
  assert.equal(description.original, '旧文四字');
  assert.equal(description.current, '新文四字');
  assert.equal(plan.review.text.find((entry) => entry.id === 'card-text-alternate_greetings-0')?.change, 'changed');
  assert.ok(plan.review.text.some((entry) => entry.label.includes('[mvu_plot]')));
  assert.ok(plan.review.text.some((entry) => entry.label.includes('普通世界书')));
  assert.ok(plan.review.code.some((entry) => entry.label.includes('[InitVar]') && entry.language === 'json'));
  assert.ok(plan.review.code.some((entry) => entry.label.includes('regex_scripts') && entry.boundary === 'opaque-extension'));
  assert.ok(plan.review.code.some((entry) => entry.label.includes('unknown_vendor') && entry.boundary === 'opaque-extension'));
  assert.equal(plan.review.text.find((entry) => entry.id === 'card-text-system_prompt')?.current, '<%= getvar("safe") %>');
}

{
  const rawCard = {
    spec: 'chara_card_v3',
    data: {
      character_book: {
        entries: [
          { id: 20, comment: '条目 A', content: 'raw-A' },
          { id: 21, comment: '条目 B', content: 'raw-B-stale' },
        ],
      },
    },
  };
  const candidateCard = {
    spec: 'chara_card_v3',
    data: {
      character_book: {
        entries: [
          { id: 21, comment: '条目 B', content: 'current-B' },
          { id: 20, comment: '条目 A', content: 'current-A' },
        ],
      },
    },
  };
  const project = {
    worldbook: {
      entries: [
        { uid: 21, name: '条目 B', content: 'current-B', meta: { studioPassthrough: { surface: 'character_book', raw: { id: 21, comment: '条目 B', content: 'passthrough-B' } } } },
        { uid: 20, name: '条目 A', content: 'current-A', meta: { studioPassthrough: { surface: 'character_book', raw: { id: 20, comment: '条目 A', content: 'passthrough-A' } } } },
      ],
    },
  };
  const plan = createRolecardExportPlan({ candidateCard, rawCard, project });
  const itemB = plan.review.text.find((entry) => entry.id === 'worldbook-text-21');
  assert.equal(itemB.original, 'passthrough-B', '世界书原文必须优先取 studioPassthrough.raw');
  assert.equal(itemB.current, 'current-B');
  assert.equal(itemB.path, '/data/character_book/entries/0/content', 'UID 重排后仍应按 UID 配对');
  assert.equal(plan.review.text.filter((entry) => entry.id === 'worldbook-text-21').length, 1);
}

{
  const rawEntries = [
    { id: 0, comment: '重复 UID A', content: 'raw-A' },
    { id: 0, comment: '重复 UID B', content: 'raw-B' },
  ];
  const rawCard = { spec: 'chara_card_v3', data: { character_book: { entries: rawEntries } } };
  const candidateCard = {
    spec: 'chara_card_v3',
    data: { character_book: { entries: [{ id: 0, comment: '重复 UID A', content: 'current-A' }] } },
  };
  const project = { worldbook: { entries: [{
    uid: 0,
    name: '重复 UID A',
    content: 'current-A',
    meta: { studioPassthrough: { surface: 'character_book', raw: rawEntries[0] } },
  }] } };
  const input = { candidateCard, rawCard, project };
  const before = JSON.stringify(input);
  const plan = createRolecardExportPlan(input);
  const contentItems = [...plan.review.text, ...plan.review.code]
    .filter((entry) => entry.boundary === 'worldbook-text' || entry.boundary === 'worldbook-code');
  assert.equal(contentItems.length, 2, '重复 UID 不得让删除的原条目消失');
  assert.equal(contentItems.find((entry) => entry.label.includes('UID A'))?.change, 'changed');
  assert.equal(contentItems.find((entry) => entry.label.includes('UID B'))?.change, 'removed');
  const worldbookIds = [...plan.review.text, ...plan.review.code]
    .filter((entry) => entry.id.startsWith('worldbook-'))
    .map((entry) => entry.id);
  assert.equal(new Set(worldbookIds).size, worldbookIds.length, '重复 UID 的 content / structure item id 仍必须唯一');
  assert.equal(JSON.stringify(input), before, '重复 UID 配对不得修改输入');

  const duplicateCandidates = [
    { id: 0, comment: '重复 UID A', content: 'current-A' },
    { id: 0, comment: '重复 UID B', content: 'current-B' },
  ];
  const duplicateProjects = duplicateCandidates.map((entry, index) => ({
    uid: 0,
    name: entry.comment,
    content: entry.content,
    meta: { studioPassthrough: { surface: 'character_book', raw: rawEntries[index] } },
  }));
  [[0, 1], [1, 0]].forEach((order) => {
    const duplicateInput = {
      candidateCard: {
        spec: 'chara_card_v3',
        data: { character_book: { entries: order.map((index) => duplicateCandidates[index]) } },
      },
      rawCard,
      project: { worldbook: { entries: order.map((index) => duplicateProjects[index]) } },
    };
    const duplicateBefore = JSON.stringify(duplicateInput);
    const duplicatePlan = createRolecardExportPlan(duplicateInput);
    const duplicateContent = [...duplicatePlan.review.text, ...duplicatePlan.review.code]
      .filter((entry) => ['worldbook-text', 'worldbook-code'].includes(entry.boundary));
    assert.equal(duplicateContent.length, 2, '重复 current/project UID 必须逐项配对，不得制造伪新增或伪删除');
    ['A', 'B'].forEach((suffix) => {
      const reviewEntry = duplicateContent.find((entry) => entry.label.includes(`UID ${suffix}`));
      assert.equal(reviewEntry?.original, `raw-${suffix}`);
      assert.equal(reviewEntry?.current, `current-${suffix}`);
      assert.equal(reviewEntry?.change, 'changed');
    });
    assert.equal(new Set(duplicateContent.map((entry) => entry.id)).size, 2);
    assert.equal(JSON.stringify(duplicateInput), duplicateBefore, '重复 project UID 队列不得修改输入');
  });

  const removedPlan = createRolecardExportPlan({
    candidateCard: { spec: 'chara_card_v3', data: { character_book: { entries: [] } } },
    rawCard,
    project: {},
  });
  const removedContent = [...removedPlan.review.text, ...removedPlan.review.code]
    .filter((entry) => ['worldbook-text', 'worldbook-code'].includes(entry.boundary));
  assert.equal(removedContent.length, 2);
  assert.ok(removedContent.every((entry) => entry.change === 'removed'));
  const removedIds = [...removedPlan.review.text, ...removedPlan.review.code]
    .filter((entry) => entry.id.startsWith('worldbook-'))
    .map((entry) => entry.id);
  assert.equal(new Set(removedIds).size, removedIds.length, '全删除时每个原始索引仍要有唯一审查项');
}

{
  const rawEntry = { id: 7, comment: '可复制条目', content: 'raw' };
  const rawCard = { spec: 'chara_card_v3', data: { character_book: { entries: [rawEntry] } } };
  const candidateCard = { spec: 'chara_card_v3', data: { character_book: { entries: [
    { id: 7, comment: '可复制条目', content: 'current' },
    { id: 8, comment: '可复制条目 · 副本', content: 'current' },
  ] } } };
  const passthrough = { surface: 'character_book', raw: rawEntry };
  const project = { worldbook: { entries: [
    { uid: 7, name: '可复制条目', content: 'current', meta: { studioPassthrough: passthrough } },
    { uid: 8, name: '可复制条目 · 副本', content: 'current', meta: { studioPassthrough: passthrough } },
  ] } };
  const plan = createRolecardExportPlan({ candidateCard, rawCard, project });
  assert.equal(plan.review.text.find((entry) => entry.id === 'worldbook-text-7')?.change, 'changed');
  const clone = plan.review.text.find((entry) => entry.id === 'worldbook-text-8');
  assert.equal(clone?.change, 'added', '同一 passthrough.raw 不得被消费两次');
  assert.equal(clone?.originalStatus, 'absent');
  assert.equal(plan.review.code.find((entry) => entry.id === 'worldbook-structure-8')?.change, 'added');

  const reversedPlan = createRolecardExportPlan({
    candidateCard: {
      spec: 'chara_card_v3',
      data: { character_book: { entries: [...candidateCard.data.character_book.entries].reverse() } },
    },
    rawCard,
    project: { worldbook: { entries: [...project.worldbook.entries].reverse() } },
  });
  const reversedClone = reversedPlan.review.text.find((entry) => entry.id === 'worldbook-text-8');
  const reversedOriginal = reversedPlan.review.text.find((entry) => entry.id === 'worldbook-text-7');
  assert.equal(reversedClone?.path, '/data/character_book/entries/0/content');
  assert.equal(reversedClone?.change, 'added', '副本排在原件前时不得抢占唯一 raw 身份');
  assert.equal(reversedClone?.originalStatus, 'absent');
  assert.equal(reversedOriginal?.path, '/data/character_book/entries/1/content');
  assert.equal(reversedOriginal?.change, 'changed', '原件必须先由 passthrough UID 锁定');
  assert.equal(reversedOriginal?.original, 'raw');
  assert.equal(reversedPlan.review.code.find((entry) => entry.id === 'worldbook-structure-8')?.change, 'added');
  assert.equal(reversedPlan.review.code.find((entry) => entry.id === 'worldbook-structure-7')?.change, 'unchanged');
}

{
  const standaloneRaw = {
    uid: 55,
    comment: 'standalone 原件',
    content: 'standalone raw',
    disable: false,
    position: 0,
    key: ['alpha'],
    keysecondary: ['beta'],
  };
  const original = {
    id: 55,
    comment: 'standalone 原件',
    content: 'standalone current',
    enabled: true,
    position: 'before_char',
    keys: ['alpha'],
    secondary_keys: ['beta'],
  };
  const clone = { ...original, id: 56, comment: 'standalone 原件 · 副本' };
  const passthrough = { surface: 'standalone', raw: standaloneRaw };
  const originalProject = { uid: 55, name: original.comment, content: original.content, meta: { studioPassthrough: passthrough } };
  const cloneProject = { uid: 56, name: clone.comment, content: clone.content, meta: { studioPassthrough: passthrough } };
  const createPlan = (entries, projectEntries, rawCard) => createRolecardExportPlan({
    candidateCard: { spec: 'chara_card_v3', data: { character_book: { entries } } },
    rawCard,
    project: { worldbook: { entries: projectEntries } },
  });

  const plan = createPlan([original, clone], [originalProject, cloneProject], {});
  const originalContent = plan.review.text.find((entry) => entry.id === 'worldbook-text-55');
  const cloneContent = plan.review.text.find((entry) => entry.id === 'worldbook-text-56');
  assert.equal(originalContent?.change, 'changed', 'standalone passthrough 原文应先被原件认领');
  assert.equal(originalContent?.original, 'standalone raw');
  assert.equal(cloneContent?.change, 'added', 'rawCard 不可用时副本仍不得复用 passthrough 原文');
  assert.equal(cloneContent?.originalStatus, 'absent');
  const originalStructure = plan.review.code.find((entry) => entry.id === 'worldbook-structure-55');
  assert.equal(originalStructure?.change, 'unchanged', 'standalone position 0 与 embedded before_char 必须语义等价');
  assert.equal(JSON.parse(originalStructure.current).position, 'before_character_definition');
  assert.equal(JSON.parse(originalStructure.original).position, 'before_character_definition');
  assert.equal(plan.review.code.find((entry) => entry.id === 'worldbook-structure-56')?.change, 'added');

  const reversedPlan = createPlan(
    [clone, original],
    [cloneProject, originalProject],
    { spec: 'chara_card_v3', data: { description: '有原卡字段但无 character_book' } },
  );
  const reversedClone = reversedPlan.review.text.find((entry) => entry.id === 'worldbook-text-56');
  const reversedOriginal = reversedPlan.review.text.find((entry) => entry.id === 'worldbook-text-55');
  assert.equal(reversedClone?.path, '/data/character_book/entries/0/content');
  assert.equal(reversedClone?.change, 'added', 'standalone 副本反序时不得抢占 passthrough-only 身份');
  assert.equal(reversedClone?.originalStatus, 'absent');
  assert.equal(reversedOriginal?.path, '/data/character_book/entries/1/content');
  assert.equal(reversedOriginal?.change, 'changed');
  assert.equal(reversedOriginal?.original, 'standalone raw');
  assert.equal(reversedPlan.review.code.find((entry) => entry.id === 'worldbook-structure-55')?.change, 'unchanged');
  assert.equal(reversedPlan.review.code.find((entry) => entry.id === 'worldbook-structure-56')?.change, 'added');
}

{
  const rawEntries = [
    { uid: 57, comment: '缺省位置 source alias', content: 'same' },
    { uid: 58, comment: '缺省位置 extension number', content: 'same' },
  ];
  const candidateEntries = [
    { id: 57, comment: rawEntries[0].comment, content: 'same', position: 'after_char' },
    { id: 58, comment: rawEntries[1].comment, content: 'same', extensions: { position: 1 } },
  ];
  const projectEntries = candidateEntries.map((entry, index) => ({
    uid: entry.id,
    name: entry.comment,
    content: entry.content,
    meta: { studioPassthrough: { surface: 'standalone', raw: rawEntries[index] } },
  }));
  const plan = createRolecardExportPlan({
    candidateCard: { spec: 'chara_card_v3', data: { character_book: { entries: candidateEntries } } },
    rawCard: {},
    project: { worldbook: { entries: projectEntries } },
  });
  [57, 58].forEach((uid) => {
    const structure = plan.review.code.find((entry) => entry.id === `worldbook-structure-${uid}`);
    assert.equal(structure?.change, 'unchanged', '缺省 position 与显式默认位置必须语义等价');
    assert.equal(JSON.parse(structure.original).position, 'after_character_definition');
    assert.equal(JSON.parse(structure.current).position, 'after_character_definition');
  });
}

{
  const rawEntries = [
    { comment: '无 UID A', content: 'raw-A' },
    { comment: '无 UID B', content: 'raw-B' },
  ];
  const rawCard = { spec: 'chara_card_v3', data: { character_book: { entries: rawEntries } } };
  const candidateCard = { spec: 'chara_card_v3', data: { character_book: { entries: [
    { id: 1, comment: '无 UID B', content: 'current-B' },
    { id: 0, comment: '无 UID A', content: 'current-A' },
  ] } } };
  const project = { worldbook: { entries: [
    { uid: 1, name: '无 UID B', content: 'current-B', meta: { studioPassthrough: { raw: rawEntries[1] } } },
    { uid: 0, name: '无 UID A', content: 'current-A', meta: { studioPassthrough: { raw: rawEntries[0] } } },
  ] } };
  const plan = createRolecardExportPlan({ candidateCard, rawCard, project });
  const itemB = plan.review.text.find((entry) => entry.id === 'worldbook-text-1');
  assert.equal(itemB?.original, 'raw-B');
  assert.equal(itemB?.current, 'current-B');
  assert.equal(itemB?.path, '/data/character_book/entries/0/content');
  assert.equal(plan.review.text.filter((entry) => entry.boundary === 'worldbook-text').length, 2);
}

{
  const rawEntry = {
    id: 31,
    comment: '[InitVar] state',
    content: '{"hp":10}',
    enabled: true,
    constant: false,
    selective: false,
    position: 'before_char',
    insertion_order: 1,
    depth: 2,
    probability: 100,
    use_probability: true,
    keys: ['hp'],
    secondary_keys: ['state'],
  };
  const currentEntry = {
    id: 31,
    comment: 'state',
    content: '{"hp":10}',
    enabled: false,
    constant: true,
    selective: true,
    position: 'after_char',
    insertion_order: 2,
    depth: 3,
    probability: 50,
    use_probability: false,
    keys: ['health'],
    secondary_keys: ['runtime'],
  };
  const rawCard = { spec: 'chara_card_v3', data: { character_book: { entries: [rawEntry] } } };
  const candidateCard = { spec: 'chara_card_v3', data: { character_book: { entries: [currentEntry] } } };
  const project = { worldbook: { entries: [{ uid: 31, name: 'state', content: currentEntry.content, meta: { studioPassthrough: { raw: rawEntry } } }] } };
  const plan = createRolecardExportPlan({ candidateCard, rawCard, project });
  const content = plan.review.code.find((entry) => entry.id === 'worldbook-code-31');
  assert.equal(content?.change, 'unchanged', '正文未变时仍应保持完整正文对照');
  assert.equal(plan.review.text.some((entry) => entry.id.includes('worldbook-text-31')), false, '原名为代码路由时不得因改名落入 text');
  const structure = plan.review.code.find((entry) => entry.id === 'worldbook-structure-31');
  assert.equal(structure?.change, 'changed');
  assert.deepEqual(JSON.parse(structure.original), {
    constant: false,
    depth: 2,
    enabled: true,
    keys: ['hp'],
    name: '[InitVar] state',
    order: 1,
    position: 'before_character_definition',
    probability: 100,
    secondary_keys: ['state'],
    selective: false,
    use_probability: true,
  });
  assert.deepEqual(JSON.parse(structure.current), {
    constant: true,
    depth: 3,
    enabled: false,
    keys: ['health'],
    name: 'state',
    order: 2,
    position: 'after_character_definition',
    probability: 50,
    secondary_keys: ['runtime'],
    selective: true,
    use_probability: false,
  });
}

{
  const names = [
    '[变量更新规则] state',
    '[输出格式] state',
    '[UpdateVariable] state',
    '[script] runtime',
    'replace.regex',
    'status.html',
    'theme.css',
    'template.ejs',
  ];
  const entries = names.map((comment, id) => ({ id: id + 40, comment, content: `source-${id}` }));
  const rawCard = { spec: 'chara_card_v3', data: { character_book: { entries } } };
  const plan = createRolecardExportPlan({ candidateCard: structuredClone(rawCard), rawCard, project: {} });
  const codeLabels = plan.review.code
    .filter((entry) => entry.boundary === 'worldbook-code')
    .map((entry) => entry.label);
  names.forEach((name) => assert.ok(codeLabels.some((label) => label.includes(name)), `${name} 必须归入代码审查`));
  assert.equal(plan.review.text.filter((entry) => entry.boundary === 'worldbook-text').length, 0);
}

{
  const malicious = '</script><img src=x onerror="globalThis.pwned=1"><%= poison %>';
  const poison = JSON.parse('{"__proto__":{"polluted":true},"constructor":"still-data","pattern":"/(a+)+$/g"}');
  const candidateCard = {
    spec: 'chara_card_v3',
    data: {
      description: malicious,
      extensions: { dangerous_payload: poison },
      character_book: { entries: [] },
    },
  };
  const input = {
    candidateCard,
    rawCard: {},
    project: {
      state: { schema: `z.string().describe(${JSON.stringify(malicious)})` },
      frontend: { builder: {
        project: { nodes: [{ id: '__proto__', text: malicious }] },
        tokens: { schemaVersion: 1, overrides: { accent: malicious } },
        lastArtifact: { html: '<script>must-not-enter-review</script>' },
      } },
    },
  };
  const before = JSON.stringify(input);
  const plan = createRolecardExportPlan(input);
  assert.equal(plan.review.status, 'partial');
  assert.ok(plan.review.limitations.some((entry) => entry.includes('current-only')));
  assert.equal(plan.review.text.find((entry) => entry.id === 'card-text-description')?.change, 'current-only');
  assert.equal(plan.review.text.find((entry) => entry.id === 'card-text-description')?.originalStatus, 'missing');
  assert.equal(plan.review.text.find((entry) => entry.id === 'card-text-description')?.current, malicious);
  const opaque = plan.review.code.find((entry) => entry.id === 'extensions-dangerous_payload');
  assert.match(opaque.current, /"__proto__"/u);
  assert.match(opaque.current, /"constructor"/u);
  assert.equal({}.polluted, undefined, '危险键只能作为数据保留');
  assert.equal(JSON.stringify(input), before, '审查证据收集不得修改输入');
  assert.ok(plan.review.code.some((entry) => entry.id === 'project-schema' && entry.change === 'current-only'));
  assert.ok(plan.review.code.some((entry) => entry.id === 'project-ui-builder' && entry.change === 'current-only'));
  const tokens = plan.review.code.find((entry) => entry.id === 'project-ui-builder-tokens');
  assert.equal(tokens.change, 'current-only');
  assert.match(tokens.current, /"accent"/u);
  assert.match(tokens.current, /<%= poison %>/u);
  assert.ok(!plan.review.code.some((entry) => entry.current.includes('must-not-enter-review')), 'lastArtifact / generated HTML 不进入首版审查证据');
}

{
  const loneSurrogate = String.fromCharCode(0xd800);
  const encodedLookalike = '%ud800';
  const inertPayload = 'globalThis.__rpnSurrogatePayloadExecuted = true';
  const rawCard = {
    spec: 'chara_card_v3',
    data: {
      extensions: {
        [loneSurrogate]: { payload: inertPayload },
        [encodedLookalike]: { payload: 'literal lookalike' },
      },
      character_book: { entries: [
        { id: loneSurrogate, comment: 'lone surrogate UID', content: 'raw lone' },
        { id: encodedLookalike, comment: 'encoded lookalike UID', content: 'raw literal' },
      ] },
    },
  };
  const input = {
    candidateCard: {
      ...structuredClone(rawCard),
      data: { ...structuredClone(rawCard.data), character_book: { entries: [] } },
    },
    rawCard,
    project: {},
  };
  const before = JSON.stringify(input);
  const plan = createRolecardExportPlan(input);
  const opaque = plan.review.code.filter((entry) => entry.boundary === 'opaque-extension');
  assert.equal(opaque.length, 2);
  assert.equal(new Set(opaque.map((entry) => entry.id)).size, 2, '孤立代理项与其编码外观不得生成冲突 ID');
  assert.ok(opaque.some((entry) => entry.id === 'extensions-%ud800'));
  assert.ok(opaque.some((entry) => entry.id === 'extensions-%u002500750064003800300030'));
  const removedWorldbook = [...plan.review.text, ...plan.review.code]
    .filter((entry) => ['worldbook-text', 'worldbook-code'].includes(entry.boundary));
  assert.equal(removedWorldbook.length, 2);
  assert.ok(removedWorldbook.every((entry) => entry.change === 'removed'));
  assert.equal(new Set(removedWorldbook.map((entry) => entry.id)).size, 2, '删除项的非良构 UTF-16 UID 仍必须生成唯一 ID');
  assert.equal(JSON.stringify(input), before, '非良构 UTF-16 审查不得修改输入');
  assert.equal(globalThis.__rpnSurrogatePayloadExecuted, undefined, '扩展 payload 只能作为惰性文本审查');
}

{
  const input = {
    candidateCard: { spec: 'chara_card_v3', data: { description: '内容 A', character_book: { entries: [] } } },
    rawCard: { spec: 'chara_card_v3', data: { description: '原文', character_book: { entries: [] } } },
    project: {},
  };
  const first = createRolecardExportPlan(input);
  const clone = createRolecardExportPlan(JSON.parse(JSON.stringify(input)));
  assert.equal(first.review.fingerprint, clone.review.fingerprint, '审查指纹必须稳定');
  const changed = createRolecardExportPlan({
    ...input,
    candidateCard: { ...input.candidateCard, data: { ...input.candidateCard.data, description: '内容 B' } },
  });
  assert.notEqual(first.review.fingerprint, changed.review.fingerprint, '审查指纹必须对完整内容敏感');
  assert.notEqual(first.fingerprint, changed.fingerprint, '装配指纹必须包含审查证据指纹');
}

{
  const source = await readFile(new URL('../portal/assets/rolecard-export-plan.js', import.meta.url), 'utf8');
  for (const forbidden of [/\bdocument\b/u, /\bwindow\b/u, /localStorage/u, /indexedDB/u, /fetch\s*\(/u, /eval\s*\(/u, /TavernHelper/u]) {
    assert.doesNotMatch(source, forbidden, `纯计划模块不得包含越界能力：${forbidden}`);
  }
}

console.log('rolecard export plan tests passed');
