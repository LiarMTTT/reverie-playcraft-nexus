import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const portalScript = await readFile(new URL('../portal/assets/card-studio.js', import.meta.url), 'utf8');
const portalHtml = await readFile(new URL('../portal/index.html', import.meta.url), 'utf8');

const blockStart = portalScript.indexOf('function resetMvuSimulationSession');
const blockEnd = portalScript.indexOf('function setWorkflowEngine');
assert.ok(blockStart > 0 && blockEnd > blockStart, 'MVU simulator UI block is missing');
const simulatorUiBlock = portalScript.slice(blockStart, blockEnd);

for (const forbidden of ['markDirty(', 'saveProjectNow(', 'persistWorkspaceAtomic(', 'localStorage', 'indexedDB', 'ensureUiBuilderHost(']) {
  assert.equal(simulatorUiBlock.includes(forbidden), false, `simulator UI must not call ${forbidden}`);
}
for (const forbiddenSource of ['selectedComponents', 'frontend.builder', 'builderRevision', 'builderNodeCount']) {
  assert.equal(simulatorUiBlock.includes(forbiddenSource), false, `simulator source must exclude ${forbiddenSource}`);
}
assert.doesNotMatch(portalScript, /project(?:\.|\[['"])(?:mvuSimulation|simulationSession)/);
assert.ok((portalScript.match(/resetMvuSimulationSession\(\);/g) || []).length >= 5, 'workspace swaps must clear the in-memory simulation session');
for (const requiredBoundary of [
  'const normalizedBeforeText = JSON.stringify(before, null, 2);',
  'resultEvidenceKey !== currentMvuSimulationEvidenceKey()',
  'evidenceKey: currentMvuSimulationEvidenceKey()',
  'function focusCurrentMvuSimulationError()',
  "label = 'Patch 通过 · Schema 未验证';",
]) {
  assert.ok(simulatorUiBlock.includes(requiredBoundary), `simulator UI boundary missing: ${requiredBoundary}`);
}
const renderStart = simulatorUiBlock.indexOf('function renderMvuSimulation()');
const unavailableBranch = simulatorUiBlock.indexOf('if (!availability.available) {', renderStart);
const currentErrorBranch = simulatorUiBlock.indexOf('} else if (currentError) {', renderStart);
assert.ok(renderStart > 0 && unavailableBranch > renderStart && currentErrorBranch > unavailableBranch, 'availability must override stale MVU evidence');

for (const marker of [
  'data-rcs-mvu-simulator',
  'data-rcs-sim-before',
  'data-rcs-sim-operation',
  'data-rcs-sim-contract',
  'data-rcs-sim-run',
  'data-rcs-sim-diff',
  'data-rcs-sim-trace-json',
]) {
  assert.ok(portalHtml.includes(marker), `simulator UI marker missing: ${marker}`);
}

console.log('[ok] MVU simulator portal isolation contract verified');
