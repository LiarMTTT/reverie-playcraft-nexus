import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../portal/assets/card-studio.js', import.meta.url), 'utf8');

assert.match(source, /let saveQueue = Promise\.resolve\(\);/);
assert.match(source, /let saveRequestSequence = 0;/);
assert.match(source, /let workspaceChangeSequence = 0;/);
assert.match(source, /const runSave = \(\) => persistProjectNow\(saveRequest\);/);
assert.match(source, /function queueWorkspaceWrite\(writeOperation\)/);
assert.match(source, /const queuedWrite = saveQueue\.then\(writeOperation, writeOperation\);/);
assert.match(source, /saveQueue = queuedWrite\.catch\(\(\) => \{\}\);/);

const queueFunctionSource = source.match(/function queueWorkspaceWrite\(writeOperation\) \{[\s\S]*?\n  \}/)?.[0];
assert.ok(queueFunctionSource, '应能抽取唯一工作区写入队列');
const createQueueHarness = new Function(`
  let saveQueue = Promise.resolve();
  ${queueFunctionSource}
  return { queueWorkspaceWrite };
`);
const { queueWorkspaceWrite } = createQueueHarness();
let releaseOldWrite;
const oldWriteGate = new Promise((resolve) => { releaseOldWrite = resolve; });
const writeOrder = [];
const oldWrite = queueWorkspaceWrite(async () => {
  writeOrder.push('old-start');
  await oldWriteGate;
  writeOrder.push('old-finish');
});
await Promise.resolve();
const replacementWrite = queueWorkspaceWrite(async () => { writeOrder.push('replacement'); });
releaseOldWrite();
await Promise.all([oldWrite, replacementWrite]);
assert.deepEqual(writeOrder, ['old-start', 'old-finish', 'replacement'], '替换、恢复和导入写入必须在旧自动保存之后成为最终现场');
const rejectedWrite = queueWorkspaceWrite(async () => { throw new Error('expected-write-failure'); });
const writeAfterFailure = queueWorkspaceWrite(async () => { writeOrder.push('after-failure'); });
await assert.rejects(rejectedWrite, /expected-write-failure/);
await writeAfterFailure;
assert.equal(writeOrder.at(-1), 'after-failure', '单次写入失败不得阻塞后续工作区保存');

let releaseCandidateWrite;
const candidateWriteGate = new Promise((resolve) => { releaseCandidateWrite = resolve; });
let persistedWorkspace = 'old';
const candidatePrecommit = queueWorkspaceWrite(async () => {
  await candidateWriteGate;
  persistedWorkspace = 'candidate-precommit';
});
await Promise.resolve();
const staleSaveDuringTransition = queueWorkspaceWrite(async () => { persistedWorkspace = 'stale-old-project'; });
releaseCandidateWrite();
await candidatePrecommit;
const canonicalCandidateSave = queueWorkspaceWrite(async () => { persistedWorkspace = 'candidate-final'; });
await Promise.all([staleSaveDuringTransition, canonicalCandidateSave]);
assert.equal(persistedWorkspace, 'candidate-final', '候选落盘期间排入的旧项目保存必须被候选切换后的规范保存覆盖');

let releaseMultiKeyCandidate;
const multiKeyCandidateGate = new Promise((resolve) => { releaseMultiKeyCandidate = resolve; });
let persistedMultiKey = { workspace: 'old', raw: 'old-raw', cover: 'old-cover' };
const multiKeyCandidatePrecommit = queueWorkspaceWrite(async () => {
  await multiKeyCandidateGate;
  persistedMultiKey = { workspace: 'candidate-precommit', raw: 'candidate-raw', cover: 'candidate-cover' };
});
await Promise.resolve();
const staleCoverDuringTransition = queueWorkspaceWrite(async () => { persistedMultiKey.cover = 'stale-user-cover'; });
releaseMultiKeyCandidate();
await multiKeyCandidatePrecommit;
const canonicalFullCandidateSave = queueWorkspaceWrite(async () => {
  persistedMultiKey = { workspace: 'candidate-final', raw: 'candidate-raw', cover: 'candidate-cover' };
});
await Promise.all([staleCoverDuringTransition, canonicalFullCandidateSave]);
assert.deepEqual(
  persistedMultiKey,
  { workspace: 'candidate-final', raw: 'candidate-raw', cover: 'candidate-cover' },
  '规范最终保存必须同时恢复候选主记录、原卡与封面 sidecar',
);

const persistenceStart = source.indexOf('async function persistProjectNow(saveRequest)');
const persistenceEnd = source.indexOf('\n  function saveProjectNow(', persistenceStart);
assert.ok(persistenceStart >= 0 && persistenceEnd > persistenceStart, '应保留单一项目持久化实现');
const persistenceSource = source.slice(persistenceStart, persistenceEnd);
assert.match(persistenceSource, /persistWorkspaceAtomic\(projectSnapshot,/);
assert.match(persistenceSource, /requestSequence === saveRequestSequence/);
assert.match(persistenceSource, /targetChangeSequence === workspaceChangeSequence/);
assert.doesNotMatch(persistenceSource, /aiApiKey|apiKey|sessionKey|Authorization/i, '项目自动保存不得包含 API 密钥');

let atomicCallIndex = source.indexOf('persistWorkspaceAtomic(');
while (atomicCallIndex >= 0) {
  const prefix = source.slice(Math.max(0, atomicCallIndex - 96), atomicCallIndex);
  const isDeclaration = /async function\s*$/.test(prefix);
  const isQueuedSaveImplementation = atomicCallIndex >= persistenceStart && atomicCallIndex < persistenceEnd;
  if (!isDeclaration && !isQueuedSaveImplementation) {
    assert.match(prefix, /queueWorkspaceWrite\(\(\) =>\s*$/, '工作区原子写入不得绕过统一队列');
  }
  atomicCallIndex = source.indexOf('persistWorkspaceAtomic(', atomicCallIndex + 1);
}

const saveRequestStart = source.indexOf('function saveProjectNow(');
const saveRequestEnd = source.indexOf('\n  function coverStorageKey', saveRequestStart);
const saveRequestSource = source.slice(saveRequestStart, saveRequestEnd);
assert.match(saveRequestSource, /const projectSnapshot = safeJsonClone\(projectWithoutRawCard\(targetProject\)\);/);
assert.match(saveRequestSource, /const includeRaw = forceRaw \|\| rawCardDirty;/);
assert.match(saveRequestSource, /const includeCover = forceCover \|\| coverDirty;/);
assert.match(saveRequestSource, /coverBytesSnapshot: includeCover && coverPngBytes \? coverPngBytes\.slice\(\) : null/);
assert.match(saveRequestSource, /return queueWorkspaceWrite\(runSave\);/);

for (const queuedMutation of [
  /queueWorkspaceWrite\(\(\) => persistWorkspaceAtomic\(projectSnapshot,/,
  /queueWorkspaceWrite\(\(\) => persistWorkspaceAtomic\(candidateSnapshot,/,
  /queueWorkspaceWrite\(\(\) => idbBatch\(\[/,
  /queueWorkspaceWrite\(\(\) => idbBatch\(operations\)\)/,
  /queueWorkspaceWrite\(\(\) => idbDelete\(\)\)/,
]) assert.match(source, queuedMutation, `工作区写入未接入统一队列：${queuedMutation}`);
assert.match(source, /async function persistUiSimulationPackageChange[\s\S]{0,180}workspaceChangeSequence \+= 1;/, '模拟包元数据写入必须使旧自动保存失效');
assert.match(source, /const includeRawSnapshot = rawCardDirty;[\s\S]{0,120}const includeCoverSnapshot = coverDirty;/, '世界书导入必须在排队前冻结原卡与封面写入范围');
for (const transitionName of ['restoreRecoverySnapshot', 'commitWorkspaceCandidate', 'importWorldbook']) {
  const transitionStart = source.indexOf(`function ${transitionName}`);
  const transitionEnd = source.indexOf('\n  function ', transitionStart + 1);
  const transitionSource = source.slice(transitionStart, transitionEnd);
  assert.ok(transitionStart >= 0 && transitionEnd > transitionStart, `缺少工作区切换函数：${transitionName}`);
  assert.match(transitionSource, /project = candidate;[\s\S]*?await saveProjectNow\(\{ forceRaw: true, forceCover: true \}\);/, `${transitionName} 必须在切换内存现场后排入包含原卡与封面的规范最终保存`);
}

const continuityStart = source.indexOf('async function flushWorkspaceContinuity()');
const continuityEnd = source.indexOf('\n  function invalidateUiBuilderHost()', continuityStart);
assert.ok(continuityStart >= 0 && continuityEnd > continuityStart, '应存在工作区连续性刷新入口');
const continuitySource = source.slice(continuityStart, continuityEnd);
assert.match(continuitySource, /window\.clearTimeout\(saveTimer\);[\s\S]*saveTimer = 0;/);
assert.match(continuitySource, /await flushUiBuilderHost\(\);/);
assert.match(continuitySource, /await saveProjectNow\(\);/);
assert.match(continuitySource, /continuityFlushQueue\.then\(flushWorkspaceContinuity, flushWorkspaceContinuity\)/);

assert.match(source, /window\.addEventListener\('hashchange', \(event\) => \{[\s\S]*?isStudioHash\(previousHash\)[\s\S]*?queueWorkspaceContinuityFlush\(\)/);
assert.match(source, /document\.addEventListener\('visibilitychange', \(\) => \{[\s\S]*?document\.visibilityState !== 'hidden'[\s\S]*?queueWorkspaceContinuityFlush\(\)/);
assert.match(source, /window\.addEventListener\('pagehide', \(\) => \{[\s\S]*?queueWorkspaceContinuityFlush\(\)\.catch\(\(\) => \{\}\);/);

console.log('[ok] studio workspace persistence contract validated');
