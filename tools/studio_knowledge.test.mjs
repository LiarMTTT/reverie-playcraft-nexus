import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createStudioAgentContextStore,
  createStudioKnowledgeIndex,
  emptyStudioAgentPaths,
  ensureStudioKnowledgeSourcePermission,
  inspectStudioSkillDirectory,
  normalizeStudioAgentPaths,
  parseStudioKnowledgeMarkdown,
  pickStudioKnowledgeSourceDirectory,
  readStudioKnowledgeDocuments,
  searchStudioKnowledge,
  STUDIO_KNOWLEDGE_INDEX_VERSION,
  STUDIO_KNOWLEDGE_LIMITS,
} from '../portal/assets/studio-knowledge.js';

function notFoundError() {
  const error = new Error('not found');
  error.name = 'NotFoundError';
  return error;
}

function fileHandle(name, text) {
  return {
    kind: 'file',
    name,
    async getFile() {
      return {
        name,
        size: Buffer.byteLength(text, 'utf8'),
        async text() { return text; },
      };
    },
  };
}

function directoryHandle(name, sourceEntries = {}, permission = 'granted') {
  const entries = new Map(Object.entries(sourceEntries));
  return {
    kind: 'directory',
    name,
    async *entries() { yield* entries.entries(); },
    async getFileHandle(fileName) {
      const entry = entries.get(fileName);
      if (!entry || entry.kind !== 'file') throw notFoundError();
      return entry;
    },
    async queryPermission(options) {
      assert.deepEqual(options, { mode: 'read' });
      return permission;
    },
    async requestPermission(options) {
      assert.deepEqual(options, { mode: 'read' });
      return 'granted';
    },
  };
}

const apiGuide = `---
title: API 指南
---
# API 接入指南

面向制卡工作台的连接说明。

## 模型列表

填写 Base URL 后刷新模型列表，且只能同时启用一个 API。

### 密钥安全

API Key 只保留在当前浏览器本机，不应写入项目导出。

## 原始 HTML

<img src=x onerror="globalThis.compromised=true">
<script>globalThis.compromised = true</script>
这里仍是可检索文字。

\`\`\`md
# 代码围栏里的标题不是章节
\`\`\`
`;

const worldbookGuide = `世界书说明
============

世界书用于组织设定。

条目激活
--------

关键词命中后，条目会根据位置与顺序进入上下文。
`;

const parsed = parseStudioKnowledgeMarkdown('A3/API指南.md', apiGuide);
assert.equal(parsed[0].fileName, 'A3/API指南.md');
assert.equal(parsed[0].title, 'API 接入指南');
assert.ok(parsed.some((chunk) => chunk.heading === '模型列表'));
assert.ok(parsed.some((chunk) => chunk.heading === '模型列表 › 密钥安全'));
assert.equal(parsed.some((chunk) => chunk.heading.includes('title: API')), false);
assert.equal(parsed.some((chunk) => chunk.heading.includes('代码围栏')), false);
assert.equal(parsed.every((chunk) => !/[<>]/.test(chunk.text)), true);
assert.equal(parsed.some((chunk) => chunk.text.includes('globalThis.compromised = true')), true);
assert.equal(globalThis.compromised, undefined);
assert.doesNotThrow(() => structuredClone(parsed));

const setextParsed = parseStudioKnowledgeMarkdown('世界书.md', worldbookGuide);
assert.equal(setextParsed[0].title, '世界书说明');
assert.ok(setextParsed.some((chunk) => chunk.heading === '条目激活'));

const index = createStudioKnowledgeIndex([
  { fileName: 'A3/API指南.md', text: apiGuide },
  { fileName: 'A4/世界书.md', text: worldbookGuide },
  {
    fileName: '杂项.md',
    text: '# 杂项\n\n这里顺带提到 API，但没有模型列表的具体说明。',
  },
]);
assert.equal(index.version, STUDIO_KNOWLEDGE_INDEX_VERSION);
assert.equal(index.documentCount, 3);
assert.equal(index.chunkCount > 3, true);
assert.doesNotThrow(() => structuredClone(index));

const exactChinese = searchStudioKnowledge(index, '模型列表');
assert.equal(exactChinese[0].fileName, 'A3/API指南.md');
assert.equal(exactChinese[0].heading, '模型列表');
assert.match(exactChinese[0].excerpt, /刷新模型列表/);
assert.equal(typeof exactChinese[0].score, 'number');
assert.deepEqual(Object.keys(exactChinese[0]), ['fileName', 'heading', 'excerpt', 'score']);

const tokenSearch = searchStudioKnowledge(index, '关键词 上下文');
assert.equal(tokenSearch[0].fileName, 'A4/世界书.md');
assert.equal(tokenSearch[0].heading, '条目激活');

const naturalChineseQuestion = searchStudioKnowledge(index, '世界书条目如何激活');
assert.equal(naturalChineseQuestion[0].fileName, 'A4/世界书.md');
assert.equal(naturalChineseQuestion[0].heading, '条目激活');

const titleSearch = searchStudioKnowledge(index, 'API 接入指南', { topK: 1 });
assert.equal(titleSearch.length, 1);
assert.equal(titleSearch[0].fileName, 'A3/API指南.md');

const htmlAsText = searchStudioKnowledge(index, 'globalThis.compromised');
assert.equal(htmlAsText[0].heading, '原始 HTML');
assert.equal(htmlAsText[0].excerpt.includes('<script>'), false);
assert.equal(globalThis.compromised, undefined);

const bounded = searchStudioKnowledge(index, 'API', {
  topK: STUDIO_KNOWLEDGE_LIMITS.topK + 100,
  excerptCharacters: 24,
});
assert.ok(bounded.length <= STUDIO_KNOWLEDGE_LIMITS.topK);
assert.ok(bounded.every((result) => result.excerpt.length <= 26));
assert.deepEqual(searchStudioKnowledge(index, '   '), []);
assert.deepEqual(searchStudioKnowledge(index, '<>'), []);
assert.deepEqual(searchStudioKnowledge(index, '...'), []);

const safeName = parseStudioKnowledgeMarkdown('<img onerror=bad>.md', '# 标题\n正文');
assert.equal(safeName[0].fileName.includes('<'), false);

const limitedIndex = createStudioKnowledgeIndex([
  { fileName: 'one.md', text: '# 一\n\n一。二。三。四。五。六。七。八。九。十。' },
  { fileName: 'two.md', text: '# 二\n\n不会进入索引。' },
], {
  maxDocuments: 1,
  maxChunkCharacters: 5,
  maxChunks: 2,
});
assert.equal(limitedIndex.documentCount, 1);
assert.equal(limitedIndex.chunkCount, 2);
assert.ok(limitedIndex.chunks.every((chunk) => chunk.text.length <= 5));

assert.throws(() => createStudioKnowledgeIndex({}), /必须是数组/);
assert.throws(
  () => createStudioKnowledgeIndex([{ fileName: 'bad.md', text: null }]),
  /字符串 text/,
);
assert.throws(() => searchStudioKnowledge({}, 'API'), /索引无效/);

const skillRoot = directoryHandle('skills', {
  'tavern-card-builder': directoryHandle('tavern-card-builder', {
    'SKILL.md': fileHandle('SKILL.md', '---\nname: tavern-card-builder\ndescription: 制卡总控\n---\n\n# 制卡规范\n只读参考。'),
  }),
  'without-manifest': directoryHandle('without-manifest', {}),
  '.hidden': directoryHandle('.hidden', {
    'SKILL.md': fileHandle('SKILL.md', '---\nname: hidden\n---\n'),
  }),
});
const skills = await inspectStudioSkillDirectory(skillRoot);
assert.equal(skills.length, 1);
assert.equal(skills[0].name, 'tavern-card-builder');
assert.equal(skills[0].description, '制卡总控');
assert.match(skills[0].text, /只读参考/);

const tavernWeaveRoot = directoryHandle('TavernWeave', {
  skills: directoryHandle('skills', {
    'tavern-card-builder': directoryHandle('tavern-card-builder', {
      'SKILL.md': fileHandle('SKILL.md', '---\nname: tavern-card-builder\ndescription: 制卡入口\n---\n\n# Builder'),
      references: directoryHandle('references', {
        'secret.md': fileHandle('secret.md', '不应递归读取'),
      }),
    }),
    'sillytavern-card-components': directoryHandle('sillytavern-card-components', {
      'SKILL.md': fileHandle('SKILL.md', '---\nname: sillytavern-card-components\ndescription: >-\n  Safely disassemble rolecards,\n  preserve unknown fields, and verify round trips.\n---\n\n# Components'),
    }),
  }),
  README: fileHandle('README', '不是 Skill 入口'),
});
const tavernWeaveSkills = await inspectStudioSkillDirectory(tavernWeaveRoot);
assert.deepEqual(tavernWeaveSkills.map((skill) => skill.name), ['sillytavern-card-components', 'tavern-card-builder']);
assert.equal(
  tavernWeaveSkills.find((skill) => skill.name === 'sillytavern-card-components').description,
  'Safely disassemble rolecards, preserve unknown fields, and verify round trips.',
);
assert.equal(tavernWeaveSkills.some((skill) => skill.text.includes('不应递归读取')), false);

const standaloneSkill = directoryHandle('tavern-card-builder', {
  'SKILL.md': fileHandle('SKILL.md', '---\nname: tavern-card-builder\ndescription: 旧版单 Skill\n---\n\n# Standalone'),
});
const standaloneSkills = await inspectStudioSkillDirectory(standaloneSkill);
assert.equal(standaloneSkills.length, 1);
assert.equal(standaloneSkills[0].description, '旧版单 Skill');

const duplicateManifestNames = directoryHandle('duplicate-manifest-names', {
  alpha: directoryHandle('alpha', {
    'SKILL.md': fileHandle('SKILL.md', '---\nname: shared-skill\n---\n\n# Alpha'),
  }),
  beta: directoryHandle('beta', {
    'SKILL.md': fileHandle('SKILL.md', '---\nname: SHARED-SKILL\n---\n\n# Beta'),
  }),
});
await assert.rejects(
  () => inspectStudioSkillDirectory(duplicateManifestNames),
  (error) => error?.code === 'duplicate-skill-alias',
);

const duplicateDirectoryAlias = directoryHandle('duplicate-directory-alias', {
  alpha: directoryHandle('alpha', {
    'SKILL.md': fileHandle('SKILL.md', '---\nname: first-skill\n---\n\n# First'),
  }),
  beta: directoryHandle('beta', {
    'SKILL.md': fileHandle('SKILL.md', '---\nname: Ａｌｐｈａ\n---\n\n# Second'),
  }),
});
await assert.rejects(
  () => inspectStudioSkillDirectory(duplicateDirectoryAlias),
  (error) => error?.code === 'duplicate-skill-alias',
);

const guideRoot = directoryHandle('ST开发指南DB', {
  'A3.md': fileHandle('A3.md', '# 世界书\n\n关键词激活。'),
  'A4.markdown': fileHandle('A4.markdown', '# MVU\n\n变量更新。'),
  'script.html': fileHandle('script.html', '<script>bad()</script>'),
  '本地证据': directoryHandle('本地证据', {
    'secret.md': fileHandle('secret.md', '# 不应递归读取'),
  }),
});
const documents = await readStudioKnowledgeDocuments(guideRoot);
assert.deepEqual(documents.documents.map((item) => item.fileName), ['A3.md', 'A4.markdown']);
assert.equal(documents.totalBytes > 0, true);

assert.equal(await ensureStudioKnowledgeSourcePermission(guideRoot), 'granted');
const promptHandle = directoryHandle('prompt', {}, 'prompt');
assert.equal(await ensureStudioKnowledgeSourcePermission(promptHandle), 'prompt');
assert.equal(await ensureStudioKnowledgeSourcePermission(promptHandle, { request: true }), 'granted');

let pickerOptions = null;
const picked = await pickStudioKnowledgeSourceDirectory('guideDb', {
  scope: {},
  showDirectoryPicker: async (options) => {
    pickerOptions = options;
    return guideRoot;
  },
});
assert.equal(picked.status, 'selected');
assert.equal(pickerOptions.mode, 'read');
assert.match(pickerOptions.id, /guideDb/);
await assert.rejects(() => pickStudioKnowledgeSourceDirectory('unknown', {}), /未知知识源角色/);

assert.deepEqual(normalizeStudioAgentPaths({ workspaceDirectory: ' C:\\work ' }), {
  ...emptyStudioAgentPaths(),
  workspaceDirectory: 'C:\\work',
});
assert.throws(() => normalizeStudioAgentPaths({ guideDbDirectory: 'bad\npath' }), /控制字符/);

const records = new Map();
const contextStore = createStudioAgentContextStore({
  get: async (key) => records.get(key),
  put: async (value, key) => records.set(key, value),
  remove: async (key) => records.delete(key),
});
await contextStore.save({
  paths: { workspaceDirectory: 'C:\\work', guideDbDirectory: 'C:\\db' },
  handles: { skill: skillRoot, guideDb: guideRoot },
});
const restoredContext = await contextStore.load();
assert.equal(restoredContext.paths.workspaceDirectory, 'C:\\work');
assert.equal(restoredContext.handles.skill, skillRoot);
await contextStore.clear();
assert.deepEqual(await contextStore.load(), {
  paths: emptyStudioAgentPaths(),
  handles: { skill: null, guideDb: null },
});

const moduleSource = await readFile(new URL('../portal/assets/studio-knowledge.js', import.meta.url), 'utf8');
assert.doesNotMatch(moduleSource, /\b(?:document|window)\s*(?:\.|\[)|innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(|new Function|fetch\s*\(/);
assert.doesNotMatch(moduleSource, /createWritable|removeEntry|mode:\s*['"]readwrite['"]/);

console.log('[ok] studio knowledge index and search validated');
