import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  UI_SIMULATION_PACKAGE_FORMAT,
  UI_SIMULATION_PACKAGE_LIMITS,
  UI_SIMULATION_PACKAGE_VERSION,
  UI_SIMULATION_PREVIEW_BRIDGE,
  UI_SIMULATION_PREVIEW_PROTOCOL,
  UiSimulationPackageError,
  createUiSimulationPreviewDocument,
  fingerprintUiSimulationPackage,
  normalizeUiSimulationPackage,
  serializeUiSimulationPackage,
} from '../portal/assets/ui-simulation-package.js';

function makePackage(overrides = {}) {
  return {
    format: UI_SIMULATION_PACKAGE_FORMAT,
    schemaVersion: UI_SIMULATION_PACKAGE_VERSION,
    engine: 'mvu',
    title: '星月状态栏联调包',
    description: '由 MVU 模拟器生成，用于 UI Builder 数据注入测试。',
    sourceFingerprint: 'fnv1a:source-demo',
    initialState: {
      玩家: { 生命值: 100, 状态: '正常' },
      任务: [{ id: 'intro', 完成: false }],
    },
    scenarios: [
      {
        id: 'damage-preview',
        title: '受伤状态预览',
        steps: [
          {
            actionId: 'player.take-damage',
            state: {
              玩家: { 生命值: 72, 状态: '受伤' },
              任务: [{ id: 'intro', 完成: false }],
            },
            diff: [{ path: '/玩家/生命值', before: 100, after: 72 }],
            events: [{ type: 'state.changed', path: '/玩家/生命值' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof UiSimulationPackageError && error.code === code, `expected ${code}`);
}

const sourceText = await readFile(new URL('../portal/assets/ui-simulation-package.js', import.meta.url), 'utf8');
for (const forbidden of [/\beval\s*\(/, /new\s+Function\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /localStorage/, /indexedDB/, /Math\.random/, /Date\.now/]) {
  assert.doesNotMatch(sourceText, forbidden);
}

const source = makePackage();
const sourceCopy = structuredClone(source);
const normalized = normalizeUiSimulationPackage(source);
assert.deepEqual(source, sourceCopy, 'normalization must not mutate caller data');
assert.equal(normalized.format, UI_SIMULATION_PACKAGE_FORMAT);
assert.equal(normalized.schemaVersion, 1);
assert.equal(normalized.engine, 'mvu');
assert.equal(normalized.title, '星月状态栏联调包');
assert.equal(normalized.description, '由 MVU 模拟器生成，用于 UI Builder 数据注入测试。');
assert.equal(normalized.sourceFingerprint, 'fnv1a:source-demo');
assert.equal(normalized.initialState.任务[0].id, 'intro');
assert.match(normalized.scenarios[0].steps[0].id, /^step-[0-9a-f]{8}$/);
assert.match(normalized.fingerprint, /^fnv1a:[0-9a-f]{8}$/);
assert.deepEqual(normalizeUiSimulationPackage(JSON.stringify(normalized)), normalized);
assert.deepEqual(JSON.parse(serializeUiSimulationPackage(source)), normalized);

const reordered = {
  scenarios: source.scenarios,
  initialState: source.initialState,
  sourceFingerprint: source.sourceFingerprint,
  description: source.description,
  title: source.title,
  engine: source.engine,
  schemaVersion: source.schemaVersion,
  format: source.format,
};
assert.equal(fingerprintUiSimulationPackage(reordered), normalized.fingerprint, 'fingerprint must ignore object key order');
assert.notEqual(
  fingerprintUiSimulationPackage(makePackage({ engine: 'database' })),
  normalized.fingerprint,
  'fingerprint must cover engine and package data',
);
assert.notEqual(
  fingerprintUiSimulationPackage(makePackage({ sourceFingerprint: 'fnv1a:different-source' })),
  normalized.fingerprint,
  'fingerprint must cover source metadata',
);

const packageWithoutMetadata = makePackage();
delete packageWithoutMetadata.title;
delete packageWithoutMetadata.description;
delete packageWithoutMetadata.sourceFingerprint;
const metadataDefaults = normalizeUiSimulationPackage(packageWithoutMetadata);
assert.equal(metadataDefaults.title, '');
assert.equal(metadataDefaults.description, '');
assert.equal(metadataDefaults.sourceFingerprint, '');

for (const engine of ['mvu', 'database', 'other']) {
  assert.equal(normalizeUiSimulationPackage(makePackage({ engine })).engine, engine);
}
assert.equal(normalizeUiSimulationPackage(makePackage({
  scenarios: [{ id: 'action-limit', steps: [{ actionId: 'x'.repeat(128), state: {} }] }],
})).scenarios[0].steps[0].actionId.length, 128);
expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{ id: 'action-over-limit', steps: [{ actionId: 'x'.repeat(129), state: {} }] }],
})), 'E_TEXT_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({ execute: true })), 'E_PACKAGE_FIELD');
expectCode(() => normalizeUiSimulationPackage(makePackage({ format: 'other-format' })), 'E_PACKAGE_VERSION');
expectCode(() => normalizeUiSimulationPackage(makePackage({ schemaVersion: '1' })), 'E_PACKAGE_VERSION');
expectCode(() => normalizeUiSimulationPackage(makePackage({ engine: 'runtime' })), 'E_ENGINE');
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: [] })), 'E_STATE_ROOT');
expectCode(() => normalizeUiSimulationPackage(makePackage({ scenarios: [] })), 'E_SCENARIO_LIMIT');
expectCode(() => normalizeUiSimulationPackage(makePackage({ fingerprint: 'fnv1a:00000000' })), 'E_FINGERPRINT');
expectCode(() => normalizeUiSimulationPackage(makePackage({ title: 42 })), 'E_TEXT_TYPE');
expectCode(() => normalizeUiSimulationPackage(makePackage({
  sourceFingerprint: 'x'.repeat(UI_SIMULATION_PACKAGE_LIMITS.maxSourceFingerprintLength + 1),
})), 'E_TEXT_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{ title: 'bad', steps: [{ actionId: 'x', state: {}, sideEffect: true }] }],
})), 'E_STEP_FIELD');
expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{ title: 'bad', steps: [{ state: {} }] }],
})), 'E_TEXT_TYPE');
expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{ title: 'bad', steps: [{ actionId: 'x' }] }],
})), 'E_STEP_STATE');
expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{ title: 'bad', steps: [{ actionId: 'x', state: {}, diff: {} }] }],
})), 'E_DIFF_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: { value: () => 1 } })), 'E_NON_JSON_VALUE');
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: { script: 'alert(1)' } })), 'E_EXECUTABLE_FIELD');
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: { markup: '<script>alert(1)</script>' } })), 'E_SCRIPT_TEXT');
expectCode(
  () => normalizeUiSimulationPackage('{"format":"rpn-ui-simulation-package","schemaVersion":1,"engine":"mvu","initialState":{"__proto__":{"polluted":true}},"scenarios":[]}'),
  'E_POISON_KEY',
);
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: { value: Number.POSITIVE_INFINITY } })), 'E_NONFINITE_NUMBER');

let getterRuns = 0;
const accessorState = {};
Object.defineProperty(accessorState, 'value', {
  enumerable: true,
  get() {
    getterRuns += 1;
    return 1;
  },
});
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: accessorState })), 'E_NON_JSON_PROPERTY');
assert.equal(getterRuns, 0, 'normalization must reject accessors without invoking them');

const cycle = {};
cycle.self = cycle;
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: cycle })), 'E_CYCLE');

let deep = {};
for (let index = 0; index <= UI_SIMULATION_PACKAGE_LIMITS.maxDepth; index += 1) deep = { value: deep };
expectCode(() => normalizeUiSimulationPackage(makePackage({ initialState: deep })), 'E_DEPTH_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: Array.from({ length: UI_SIMULATION_PACKAGE_LIMITS.maxScenarios + 1 }, (_, index) => ({
    id: `scenario-${index}`,
    steps: [{ actionId: 'noop', state: {} }],
  })),
})), 'E_SCENARIO_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{
    id: 'too-many-steps',
    steps: Array.from({ length: UI_SIMULATION_PACKAGE_LIMITS.maxStepsPerScenario + 1 }, () => ({ actionId: 'noop', state: {} })),
  }],
})), 'E_STEP_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: [{
    id: 'too-many-events',
    steps: [{
      actionId: 'noop',
      state: {},
      events: Array.from({ length: UI_SIMULATION_PACKAGE_LIMITS.maxEvents + 1 }, () => null),
    }],
  }],
})), 'E_EVENT_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  initialState: { values: Array.from({ length: UI_SIMULATION_PACKAGE_LIMITS.maxNodes + 1 }, () => null) },
})), 'E_NODE_LIMIT');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  initialState: {
    first: 'a'.repeat(UI_SIMULATION_PACKAGE_LIMITS.maxStringLength),
    second: 'b'.repeat(UI_SIMULATION_PACKAGE_LIMITS.maxStringLength),
  },
})), 'E_STATE_SIZE');

expectCode(() => normalizeUiSimulationPackage(makePackage({
  scenarios: Array.from({ length: 5 }, (_, scenarioIndex) => ({
    id: `scenario-${scenarioIndex}`,
    steps: Array.from({ length: UI_SIMULATION_PACKAGE_LIMITS.maxStepsPerScenario }, (_, stepIndex) => ({
      id: `step-${stepIndex}`,
      actionId: 'noop',
      state: {},
    })),
  })),
})), 'E_TOTAL_STEP_LIMIT');

expectCode(
  () => normalizeUiSimulationPackage('x'.repeat(UI_SIMULATION_PACKAGE_LIMITS.packageBytes + 1)),
  'E_PACKAGE_SIZE',
);

const previewSource = '<!doctype html><html><body><article data-rpn-bind-text="玩家.状态"><strong data-rpn-bind-target="text">占位</strong></article><button data-rpn-action="player.take-damage">受伤</button></body></html>';
const previewDocument = createUiSimulationPreviewDocument(previewSource, {
  sessionId: 'preview-session</script>',
  nonce: 'nonce-123',
  parentOrigin: 'https://rpn.example.test/studio/design',
});
assert.equal(UI_SIMULATION_PREVIEW_BRIDGE, 'rpn.ui-simulation-preview');
assert.equal(UI_SIMULATION_PREVIEW_PROTOCOL, 1);
assert.match(previewDocument, /<script data-rpn-simulation-runtime nonce="[A-Za-z0-9_-]+">/);
assert.match(previewDocument, /const SOURCE_HTML = "/);
assert.match(previewDocument, /data-rpn-bind-text=\\"玩家\.状态\\"/);
assert.match(previewDocument, /host\.state\.replace/);
assert.match(previewDocument, /preview\.action/);
assert.match(previewDocument, /preview\.unloading/);
assert.match(previewDocument, /event\.source !== window\.parent/);
assert.match(previewDocument, /event\.origin !== PARENT_ORIGIN/);
assert.match(previewDocument, /Object\.prototype\.hasOwnProperty\.call/);
assert.match(previewDocument, /target\.textContent = textValue/);
assert.match(previewDocument, /node\.hidden = !visible/);
assert.match(previewDocument, /send\('preview\.action', \{ actionId, \.\.\.currentFrame \}\)/);
assert.match(previewDocument, /https:\/\/rpn\.example\.test/);
assert.doesNotMatch(previewDocument, /preview-session<\/script>/);
assert.doesNotMatch(previewDocument, /玩家.*生命值.*100/);
assert.doesNotMatch(previewDocument, /<article\b/i);
assert.equal((previewDocument.match(/\.innerHTML\s*=/g) || []).length, 1);
assert.match(previewDocument, /const template = document\.createElement\('template'\);\s+template\.innerHTML = SOURCE_HTML;/);
assert.doesNotMatch(previewDocument, /DOMParser|document\.body\.innerHTML\s*=/);
assert.ok(previewDocument.indexOf('data-rpn-simulation-runtime') < previewDocument.toLowerCase().lastIndexOf('</body>'));

const maliciousPreview = createUiSimulationPreviewDocument(`<!doctype html><html><head>
<meta content="0; url=https://attacker.example/?q=>refresh" http-equiv="&#114;efresh">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<script>window.__rpnOriginalScriptRan = true;</script>
<script src="https://attacker.example/payload.js"></script>
<link rel="stylesheet" href="https://attacker.example/theme.css">
</head><body onload="window.__rpnInlineHandlerRan = true">
<a href="https://attacker.example/navigation" onclick="window.__rpnInlineHandlerRan = true">离开预览</a>
<form id="danger-form" action="https://attacker.example/submit" method="post"><button type="submit" data-rpn-action="player.take-damage">提交</button></form>
<input type="image" form="danger-form" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-rpn-action="player.take-damage">
<iframe src="https://attacker.example/frame"></iframe>
<template><img src="https://attacker.example/template.png" onerror="window.__rpnTemplateRan=true"></template>
<img src="https://attacker.example/tracker.png" srcset="https://attacker.example/2x.png 2x" alt="">
<video autoplay poster="https://attacker.example/poster.png"></video>
</body></html>`, {
  sessionId: 'malicious-session',
  nonce: 'dangerous-"\'中文',
  parentOrigin: 'https://rpn.example.test/studio/check',
});
const runtimeNonceMatch = maliciousPreview.match(/<script data-rpn-simulation-runtime nonce="([A-Za-z0-9_-]+)">/);
assert.ok(runtimeNonceMatch, 'fixed preview runtime must carry the sole CSP nonce');
const runtimeNonce = runtimeNonceMatch[1];
assert.match(maliciousPreview, /^<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"/i);
assert.match(maliciousPreview, new RegExp(`script-src 'nonce-${runtimeNonce}'`));
assert.match(maliciousPreview, /script-src-attr 'none'/);
assert.match(maliciousPreview, /default-src 'none'/);
assert.match(maliciousPreview, /connect-src 'none'/);
assert.match(maliciousPreview, /frame-src 'none'/);
assert.match(maliciousPreview, /form-action 'none'/);
assert.doesNotMatch(maliciousPreview, /navigate-to/);
assert.doesNotMatch(maliciousPreview, /script-src 'unsafe-inline'/);
assert.equal((maliciousPreview.match(new RegExp(`nonce="${runtimeNonce}"`, 'g')) || []).length, 1);
assert.equal((maliciousPreview.match(/<script\b/gi) || []).length, 1);
assert.equal((maliciousPreview.match(/<meta\b/gi) || []).length, 2);
assert.doesNotMatch(maliciousPreview, /<(?:iframe|link|template)\b/i);
assert.match(maliciousPreview, /\\u003cscript\\u003ewindow\.__rpnOriginalScriptRan/);
assert.match(maliciousPreview, /BLOCKED_ELEMENTS = \[/);
for (const marker of [
  "'script'", "'iframe'", "'object'", "'embed'", "'portal'", "'meta'", "'base'", "'link'", "'template'",
  "'http-equiv'", "'href'", "'xlink:href'", "'srcdoc'", "'srcset'", "'action'", "'formaction'", "'ping'", "'target'",
  "'background'", "'manifest'", "'codebase'", "'archive'", "'usemap'", "'attributionsrc'",
]) assert.ok(maliciousPreview.includes(marker), `preview sanitizer missing: ${marker}`);
assert.match(maliciousPreview, /const unsafeSource = \(name === 'src' \|\| name === 'poster'\) && !isDataUrl\(attribute\.value\)/);
assert.match(maliciousPreview, /name\.startsWith\('on'\) \|\| name === 'autoplay'/);
assert.match(maliciousPreview, /addEventListener\('submit', \(event\) => event\.preventDefault\(\), true\)/);
assert.match(maliciousPreview, /source\.closest\('button, input'\)/);
assert.match(maliciousPreview, /formSubmitControl\?\.form && \['submit', 'image'\]\.includes\(formSubmitControl\.type\)/);
assert.match(maliciousPreview, /closest\('a, area'\)/);
assert.match(maliciousPreview, /if \(navigationTarget\) event\.preventDefault\(\)/);
assert.ok(maliciousPreview.indexOf('formSubmitControl?.form') < maliciousPreview.indexOf("source.closest('[data-rpn-action]')"));
const parseIndex = maliciousPreview.indexOf("template.innerHTML = SOURCE_HTML");
const stripElementsIndex = maliciousPreview.indexOf("fragment.querySelectorAll(BLOCKED_ELEMENTS.join(','))");
const stripAttributesIndex = maliciousPreview.indexOf("fragment.querySelectorAll('*')");
const mountIndex = maliciousPreview.indexOf('document.body.replaceChildren(sanitizedSourceFragment())');
assert.ok(parseIndex >= 0 && parseIndex < stripElementsIndex && stripElementsIndex < stripAttributesIndex && stripAttributesIndex < mountIndex);

const fragmentPreview = createUiSimulationPreviewDocument('<main>fragment</main>', {
  sessionId: 'fragment-session',
  nonce: 'fragment-nonce',
  parentOrigin: 'http://127.0.0.1:4174',
});
assert.doesNotMatch(fragmentPreview, /<main>/);
assert.match(fragmentPreview, /\\u003cmain\\u003efragment\\u003c\/main\\u003e/);
expectCode(() => createUiSimulationPreviewDocument('', {
  sessionId: 'session', nonce: 'nonce', parentOrigin: 'https://example.test',
}), 'E_PREVIEW_HTML');
expectCode(() => createUiSimulationPreviewDocument('<main></main>', {
  sessionId: '', nonce: 'nonce', parentOrigin: 'https://example.test',
}), 'E_TEXT_EMPTY');
expectCode(() => createUiSimulationPreviewDocument('<main></main>', {
  sessionId: 'session', nonce: 'nonce', parentOrigin: 'file:///tmp/index.html',
}), 'E_PREVIEW_ORIGIN');
expectCode(() => createUiSimulationPreviewDocument('x'.repeat(UI_SIMULATION_PACKAGE_LIMITS.packageBytes + 1), {
  sessionId: 'session', nonce: 'nonce', parentOrigin: 'https://example.test',
}), 'E_PREVIEW_HTML_SIZE');

const portalScript = await readFile(new URL('../portal/assets/card-studio.js', import.meta.url), 'utf8');
const portalHtml = await readFile(new URL('../portal/index.html', import.meta.url), 'utf8');
for (const marker of [
  "DB_UI_SIMULATION_PREFIX = 'uiSimulationPackage:'",
  "event.origin !== 'null'",
  'message.sessionId !== session.sessionId',
  'message.nonce !== session.nonce',
  'nextStep.actionId !== actionId',
  'message.payload.revision === session.revision',
  "type: 'host.state.replace'",
]) {
  assert.match(portalScript, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
const contextStart = portalScript.indexOf('function uiBuilderContext()');
const contextEnd = portalScript.indexOf('function activeUiSimulationScenario()', contextStart);
assert.ok(contextStart >= 0 && contextEnd > contextStart, 'UI Builder context function boundary missing');
assert.doesNotMatch(portalScript.slice(contextStart, contextEnd), /uiSimulationPackage|simulationPreview/, 'full simulation package must not enter the UI Builder bridge context');
for (const marker of [
  'data-rcs-builder-simulation-summary',
  'data-rcs-builder-simulation-file',
  'data-rcs-simulation-scenario',
  'data-rcs-simulation-state',
  'data-rcs-builder-preview-frame title="UI Builder 导出 HTML 模拟预览" sandbox="allow-scripts"',
]) {
  assert.ok(portalHtml.includes(marker), `portal simulation control missing: ${marker}`);
}
const newWorkspaceStart = portalScript.indexOf('async function startNewWorkspace()');
const newWorkspaceEnd = portalScript.indexOf('function startNewProject()', newWorkspaceStart);
const newWorkspaceSource = portalScript.slice(newWorkspaceStart, newWorkspaceEnd);
assert.match(newWorkspaceSource, /supersededRecoveryProjectId/);
assert.doesNotMatch(newWorkspaceSource, /uiSimulationStorageKey\(currentProjectId\)/, 'current simulation package must remain available to the recovery point');

console.log('[ok] RPN UI simulation package v1 contract verified');
