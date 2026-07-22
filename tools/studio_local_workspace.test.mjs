import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assertSafeStudioLocalEntryName,
  createStudioLocalJsonBlob,
  createStudioLocalWorkspaceHandleStore,
  detectStudioLocalWorkspaceCapabilities,
  emptyStudioLocalWorkspaceHandles,
  ensureStudioLocalWorkspacePermission,
  pickStudioLocalWorkspaceDirectory,
  queryStudioLocalWorkspacePermission,
  requestStudioLocalWorkspacePermission,
  resolveStudioLocalWorkspaceHandles,
  STUDIO_LOCAL_WORKSPACE_HANDLE_KEY,
  writeStudioLocalBlob,
  writeStudioLocalJson,
} from '../portal/assets/studio-local-workspace.js';

function fakeDirectory(name, { permission = 'granted' } = {}) {
  const directories = new Map();
  const files = new Map();
  const calls = [];
  const handle = {
    kind: 'directory',
    name,
    permission,
    calls,
    directories,
    files,
    async queryPermission(options) {
      calls.push(['queryPermission', options]);
      return this.permission;
    },
    async requestPermission(options) {
      calls.push(['requestPermission', options]);
      if (this.permission === 'prompt') this.permission = 'granted';
      return this.permission;
    },
    async getDirectoryHandle(childName, options) {
      calls.push(['getDirectoryHandle', childName, options]);
      if (!directories.has(childName)) directories.set(childName, fakeDirectory(childName));
      return directories.get(childName);
    },
    async getFileHandle(fileName, options) {
      calls.push(['getFileHandle', fileName, options]);
      if (!files.has(fileName)) {
        const writes = [];
        files.set(fileName, {
          kind: 'file',
          name: fileName,
          writes,
          async createWritable() {
            return {
              async write(value) { writes.push(value); },
              async close() { writes.push('closed'); },
              async abort() { writes.push('aborted'); },
            };
          },
        });
      }
      return files.get(fileName);
    },
  };
  return handle;
}

for (const name of ['project.json', '.rpn-cache', 'output', '空 格.json']) {
  assert.equal(assertSafeStudioLocalEntryName(name), name);
}
for (const name of ['', '.', '..', '../output', 'a/b', 'a\\b', 'bad\0name', `bad\nname`]) {
  assert.throws(() => assertSafeStudioLocalEntryName(name), /单个安全名称/);
}

const noApi = detectStudioLocalWorkspaceCapabilities({ scope: {} });
assert.deepEqual(noApi, {
  supported: false,
  directoryPicker: false,
  handlePersistence: false,
  fallback: 'download',
});

const pickedHandle = fakeDirectory('workspace');
let pickerOptions;
const picked = await pickStudioLocalWorkspaceDirectory('workspace', {
  scope: {},
  showDirectoryPicker: async (options) => {
    pickerOptions = options;
    return pickedHandle;
  },
});
assert.equal(picked.status, 'selected');
assert.equal(picked.handle, pickedHandle);
assert.deepEqual(pickerOptions, { id: 'rpn-studio-workspace', mode: 'readwrite' });
assert.deepEqual(await pickStudioLocalWorkspaceDirectory('output', { scope: {} }), {
  status: 'unsupported',
  role: 'output',
  handle: null,
  fallback: 'download',
});
const cancelled = await pickStudioLocalWorkspaceDirectory('cache', {
  showDirectoryPicker: async () => { throw new DOMException('cancelled', 'AbortError'); },
});
assert.equal(cancelled.status, 'cancelled');
await assert.rejects(() => pickStudioLocalWorkspaceDirectory('other'), /未知目录角色/);

const workspace = fakeDirectory('workspace');
const resolved = await resolveStudioLocalWorkspaceHandles({ workspace });
assert.equal(resolved.workspace, workspace);
assert.equal(resolved.cache.name, '.rpn-cache');
assert.equal(resolved.output.name, 'output');
assert.deepEqual(resolved.derived, { cache: true, output: true });
assert.deepEqual(
  workspace.calls.filter(([name]) => name === 'getDirectoryHandle'),
  [
    ['getDirectoryHandle', '.rpn-cache', { create: true }],
    ['getDirectoryHandle', 'output', { create: true }],
  ],
);

const explicitCache = fakeDirectory('cache-explicit');
const explicitOutput = fakeDirectory('output-explicit');
const explicit = await resolveStudioLocalWorkspaceHandles({ workspace, cache: explicitCache, output: explicitOutput });
assert.equal(explicit.cache, explicitCache);
assert.equal(explicit.output, explicitOutput);
assert.deepEqual(explicit.derived, { cache: false, output: false });

const promptDirectory = fakeDirectory('prompt', { permission: 'prompt' });
assert.equal(await queryStudioLocalWorkspacePermission(promptDirectory), 'prompt');
assert.equal(await ensureStudioLocalWorkspacePermission(promptDirectory), 'prompt');
assert.equal(await requestStudioLocalWorkspacePermission(promptDirectory), 'granted');
assert.equal(await ensureStudioLocalWorkspacePermission(promptDirectory, { request: true }), 'granted');
assert.equal(await queryStudioLocalWorkspacePermission({ kind: 'directory' }), 'unsupported');

const records = new Map();
const handleStore = createStudioLocalWorkspaceHandleStore({
  get: async (key) => records.get(key),
  put: async (value, key) => records.set(key, value),
  remove: async (key) => records.delete(key),
});
assert.equal(handleStore.key, STUDIO_LOCAL_WORKSPACE_HANDLE_KEY);
assert.deepEqual(await handleStore.load(), emptyStudioLocalWorkspaceHandles());
await handleStore.save(resolved);
assert.equal(records.get(STUDIO_LOCAL_WORKSPACE_HANDLE_KEY).version, 1);
assert.equal((await handleStore.load()).workspace, workspace);
await handleStore.clear();
assert.deepEqual(await handleStore.load(), emptyStudioLocalWorkspaceHandles());
await handleStore.save(emptyStudioLocalWorkspaceHandles());
assert.equal(records.has(STUDIO_LOCAL_WORKSPACE_HANDLE_KEY), false);

const jsonBlob = createStudioLocalJsonBlob({ title: 'RPN' });
assert.equal(jsonBlob.type, 'application/json;charset=utf-8');
assert.equal(await jsonBlob.text(), '{\n  "title": "RPN"\n}\n');
assert.throws(() => createStudioLocalJsonBlob(undefined), /无法序列化/);

const fallbackBlob = new Blob(['offline'], { type: 'text/plain' });
const fallback = await writeStudioLocalBlob(null, 'offline.txt', fallbackBlob);
assert.deepEqual(fallback, { status: 'download', fileName: 'offline.txt', blob: fallbackBlob });

const output = fakeDirectory('output', { permission: 'prompt' });
const writeResult = await writeStudioLocalJson(output, 'project.json', { ok: true });
assert.equal(writeResult.status, 'written');
assert.equal(writeResult.fileName, 'project.json');
const writtenFile = output.files.get('project.json');
assert.equal(await writtenFile.writes[0].text(), '{\n  "ok": true\n}\n');
assert.equal(writtenFile.writes[1], 'closed');
assert.ok(output.calls.some(([name]) => name === 'requestPermission'));
await assert.rejects(
  () => writeStudioLocalBlob(fakeDirectory('denied', { permission: 'denied' }), 'blocked.json', jsonBlob),
  (error) => error?.code === 'directory-permission-required',
);
await assert.rejects(() => writeStudioLocalBlob(output, '../escape.json', jsonBlob), /单个安全名称/);

const moduleSource = await readFile(new URL('../portal/assets/studio-local-workspace.js', import.meta.url), 'utf8');
assert.doesNotMatch(moduleSource, /indexedDB\.open|createObjectStore/);

console.log('[ok] studio local workspace module validated');
