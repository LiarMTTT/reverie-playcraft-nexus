import assert from 'node:assert/strict';
import componentContract from '../shared/component-workshop-contract.js';

function makePackage(overrides = {}) {
  return {
    format: 'rpn-component-package',
    schemaVersion: 1,
    id: 'variables.demo.core',
    title: '示例变量组件',
    summary: '只作为文本分发与静态预览的组件包。',
    version: '1.0.0',
    authorName: 'RPN test',
    tags: ['变量', '测试'],
    license: 'UNLICENSED',
    compatibility: {
      libraryVersion: '0.2.7',
      sourceCardVersion: '2.1.5',
    },
    dependencies: ['variables.base_schema'],
    conflicts: [],
    replaces: [],
    replacedBy: [],
    workflowStage: 'variable_core',
    files: [
      {
        path: 'variables/示例/component.json',
        mediaType: 'application/json',
        text: '{"id":"variables.demo.core"}',
      },
      {
        path: 'variables/示例/preview.html',
        mediaType: 'text/html',
        text: '<section><h1>静态预览</h1><script>throw new Error("must not run")</script></section>',
      },
    ],
    ...overrides,
  };
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => error?.code === code, `expected ${code}`);
}

const normalized = componentContract.normalizePackage(makePackage());
assert.equal(normalized.format, 'rpn-component-package');
assert.equal(normalized.schemaVersion, 1);
assert.equal(normalized.files.length, 2);
assert.deepEqual(normalized.dependencies, ['variables.base_schema']);
assert.deepEqual(componentContract.workflowStages, ['variable_core', 'component_assembly', 'release']);

expectCode('unknown-component-package-field', () => componentContract.normalizePackage(makePackage({ command: 'run-me' })));
expectCode('invalid-component-workflow-stage', () => componentContract.normalizePackage(makePackage({ workflowStage: 'runtime' })));
expectCode('unknown-component-compatibility-field', () => componentContract.normalizePackage(makePackage({
  compatibility: { libraryVersion: '0.2.7', executable: true },
})));
expectCode('component-dependency-conflict-overlap', () => componentContract.normalizePackage(makePackage({
  conflicts: ['variables.base_schema'],
})));
expectCode('invalid-component-dependencies', () => componentContract.normalizePackage(makePackage({
  dependencies: ['variables.demo.core'],
})));

for (const path of [
  '../escape.js',
  '/absolute/file.js',
  'C:/drive/file.js',
  'nested\\file.js',
  'nested/%2e%2e/file.js',
  '.hidden/file.js',
  'nested/CON.txt',
]) {
  expectCode(
    path.includes('CON') ? 'reserved-component-file-path' : 'invalid-component-file-path',
    () => componentContract.normalizePackage(makePackage({
      files: [{ path, mediaType: 'text/javascript', text: 'export default 1;' }],
    })),
  );
}

expectCode('duplicate-component-file-path', () => componentContract.normalizePackage(makePackage({
  files: [
    { path: 'module/Preview.html', mediaType: 'text/html', text: '<p>one</p>' },
    { path: 'module/preview.html', mediaType: 'text/html', text: '<p>two</p>' },
  ],
})));
expectCode('component-file-media-type-mismatch', () => componentContract.normalizePackage(makePackage({
  files: [{ path: 'module/file.js', mediaType: 'text/html', text: 'alert(1)' }],
})));
expectCode('unsupported-component-file-type', () => componentContract.normalizePackage(makePackage({
  files: [{ path: 'module/archive.zip', mediaType: 'application/zip', text: 'not an archive' }],
})));
expectCode('invalid-component-json-file', () => componentContract.normalizePackage(makePackage({
  files: [{ path: 'module/component.json', mediaType: 'application/json', text: '{invalid}' }],
})));
expectCode('component-file-too-large', () => componentContract.normalizePackage(makePackage({
  files: [{ path: 'module/large.txt', mediaType: 'text/plain', text: 'x'.repeat(256 * 1024 + 1) }],
})));
expectCode('invalid-component-file-sha256', () => componentContract.normalizePackage(makePackage({
  files: [{ path: 'module/readme.md', mediaType: 'text/markdown', text: '# demo', sha256: 'bad' }],
})));

const digest = await componentContract.sha256Text('hello');
assert.equal(digest, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
const hashed = makePackage({
  files: [{ path: 'module/readme.txt', mediaType: 'text/plain', text: 'hello', sha256: digest }],
});
assert.equal((await componentContract.verifyPackageHashes(hashed)).files[0].sha256, digest);
await assert.rejects(
  componentContract.verifyPackageHashes({
    ...hashed,
    files: [{ ...hashed.files[0], sha256: '0'.repeat(64) }],
  }),
  (error) => error?.code === 'component-file-sha256-mismatch',
);

console.log('[ok] RPN component package v1 contract verified');
