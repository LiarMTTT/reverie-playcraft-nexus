const HANDLE_RECORD_VERSION = 1;
const PERMISSION_STATES = new Set(['granted', 'denied', 'prompt']);
const ROLE_SET = new Set(['workspace', 'cache', 'output']);

export const STUDIO_LOCAL_WORKSPACE_HANDLE_KEY = 'studioLocalWorkspace:handles:v1';
export const STUDIO_LOCAL_WORKSPACE_ROLES = Object.freeze(['workspace', 'cache', 'output']);
export const STUDIO_LOCAL_WORKSPACE_SUBDIRECTORIES = Object.freeze({
  cache: '.rpn-cache',
  output: 'output',
});

function workspaceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isDirectoryHandle(value) {
  return Boolean(value && typeof value === 'object' && value.kind === 'directory');
}

function isBlobLike(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && Number.isFinite(value.size)
    && typeof value.type === 'string'
    && typeof value.arrayBuffer === 'function',
  );
}

function normalizeRole(role) {
  if (!ROLE_SET.has(role)) throw workspaceError('invalid-directory-role', `未知目录角色：${String(role)}`);
  return role;
}

function normalizeHandleSet(value, { ignoreInvalid = false } = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const result = emptyStudioLocalWorkspaceHandles();
  for (const role of STUDIO_LOCAL_WORKSPACE_ROLES) {
    const handle = source[role];
    if (handle == null) continue;
    if (!isDirectoryHandle(handle)) {
      if (ignoreInvalid) continue;
      throw workspaceError('invalid-directory-handle', `${role} 不是目录句柄`);
    }
    result[role] = handle;
  }
  return result;
}

function requireDirectoryMethod(handle, method) {
  if (!isDirectoryHandle(handle)) throw workspaceError('invalid-directory-handle', '需要有效的目录句柄');
  if (typeof handle[method] !== 'function') {
    throw workspaceError('directory-api-unavailable', `目录句柄不支持 ${method}`);
  }
}

function normalizePermissionState(value) {
  return PERMISSION_STATES.has(value) ? value : 'unsupported';
}

export function emptyStudioLocalWorkspaceHandles() {
  return { workspace: null, cache: null, output: null };
}

export function isSafeStudioLocalEntryName(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 255
    && value !== '.'
    && value !== '..'
    && !/[\\/]/.test(value)
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function assertSafeStudioLocalEntryName(value, label = '目录或文件名') {
  if (!isSafeStudioLocalEntryName(value)) {
    throw workspaceError('unsafe-local-entry-name', `${label} 必须是单个安全名称，不能包含路径或控制字符`);
  }
  return value;
}

export function detectStudioLocalWorkspaceCapabilities({ scope = globalThis, handleStore = null } = {}) {
  const directoryPicker = typeof scope?.showDirectoryPicker === 'function';
  return Object.freeze({
    supported: directoryPicker,
    directoryPicker,
    handlePersistence: Boolean(
      handleStore
      && typeof handleStore.load === 'function'
      && typeof handleStore.save === 'function'
      && typeof handleStore.clear === 'function',
    ),
    fallback: directoryPicker ? null : 'download',
  });
}

export async function pickStudioLocalWorkspaceDirectory(role, {
  scope = globalThis,
  showDirectoryPicker = scope?.showDirectoryPicker,
  startIn,
} = {}) {
  const safeRole = normalizeRole(role);
  if (typeof showDirectoryPicker !== 'function') {
    return { status: 'unsupported', role: safeRole, handle: null, fallback: 'download' };
  }

  try {
    const handle = await showDirectoryPicker.call(scope, {
      id: `rpn-studio-${safeRole}`,
      mode: 'readwrite',
      ...(startIn ? { startIn } : {}),
    });
    if (!isDirectoryHandle(handle)) throw workspaceError('invalid-directory-handle', '目录选择器没有返回目录句柄');
    return { status: 'selected', role: safeRole, handle, fallback: null };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { status: 'cancelled', role: safeRole, handle: null, fallback: null };
    }
    throw error;
  }
}

export async function queryStudioLocalWorkspacePermission(handle, mode = 'readwrite') {
  if (!isDirectoryHandle(handle)) throw workspaceError('invalid-directory-handle', '需要有效的目录句柄');
  if (typeof handle.queryPermission !== 'function') return 'unsupported';
  return normalizePermissionState(await handle.queryPermission({ mode }));
}

export async function requestStudioLocalWorkspacePermission(handle, mode = 'readwrite') {
  if (!isDirectoryHandle(handle)) throw workspaceError('invalid-directory-handle', '需要有效的目录句柄');
  const current = await queryStudioLocalWorkspacePermission(handle, mode);
  if (current === 'granted' || current === 'denied') return current;
  if (typeof handle.requestPermission !== 'function') return 'unsupported';
  return normalizePermissionState(await handle.requestPermission({ mode }));
}

export async function ensureStudioLocalWorkspacePermission(handle, {
  mode = 'readwrite',
  request = false,
} = {}) {
  const current = await queryStudioLocalWorkspacePermission(handle, mode);
  if (current !== 'prompt' || !request) return current;
  return requestStudioLocalWorkspacePermission(handle, mode);
}

export async function resolveStudioLocalWorkspaceHandles(handles, { create = true } = {}) {
  const resolved = normalizeHandleSet(handles);
  const derived = { cache: false, output: false };
  if (!resolved.workspace) return { ...resolved, derived };

  requireDirectoryMethod(resolved.workspace, 'getDirectoryHandle');
  for (const role of ['cache', 'output']) {
    if (resolved[role]) continue;
    const name = assertSafeStudioLocalEntryName(STUDIO_LOCAL_WORKSPACE_SUBDIRECTORIES[role], `${role} 子目录名`);
    resolved[role] = await resolved.workspace.getDirectoryHandle(name, { create: Boolean(create) });
    if (!isDirectoryHandle(resolved[role])) {
      throw workspaceError('invalid-directory-handle', `${role} 子目录解析结果无效`);
    }
    derived[role] = true;
  }
  return { ...resolved, derived };
}

export function createStudioLocalWorkspaceHandleStore({
  get,
  put,
  remove,
  key = STUDIO_LOCAL_WORKSPACE_HANDLE_KEY,
}) {
  if (typeof get !== 'function' || typeof put !== 'function' || typeof remove !== 'function') {
    throw workspaceError('invalid-handle-store', '句柄存储需要 get、put、remove 三个函数');
  }
  assertSafeStudioLocalEntryName(key, 'IndexedDB 记录键');

  return Object.freeze({
    key,
    async load() {
      const record = await get(key);
      if (!record || record.version !== HANDLE_RECORD_VERSION) return emptyStudioLocalWorkspaceHandles();
      return normalizeHandleSet(record.handles, { ignoreInvalid: true });
    },
    async save(handles) {
      const normalized = normalizeHandleSet(handles);
      if (!STUDIO_LOCAL_WORKSPACE_ROLES.some((role) => normalized[role])) {
        await remove(key);
        return normalized;
      }
      await put({ version: HANDLE_RECORD_VERSION, handles: normalized }, key);
      return normalized;
    },
    async clear() {
      await remove(key);
    },
  });
}

export function createStudioLocalJsonBlob(value, { space = 2 } = {}) {
  const json = JSON.stringify(value, null, space);
  if (json === undefined) throw workspaceError('json-value-unsupported', '该值无法序列化为 JSON');
  return new Blob([`${json}\n`], { type: 'application/json;charset=utf-8' });
}

export async function writeStudioLocalBlob(directoryHandle, fileName, blob, {
  requestPermission = true,
} = {}) {
  const safeFileName = assertSafeStudioLocalEntryName(fileName, '文件名');
  if (!isBlobLike(blob)) throw workspaceError('invalid-blob', '写入内容必须是 Blob');
  if (!directoryHandle) {
    return { status: 'download', fileName: safeFileName, blob };
  }

  requireDirectoryMethod(directoryHandle, 'getFileHandle');
  const permission = await ensureStudioLocalWorkspacePermission(directoryHandle, {
    mode: 'readwrite',
    request: requestPermission,
  });
  if (permission === 'denied' || permission === 'prompt') {
    throw workspaceError('directory-permission-required', '目录没有读写权限');
  }

  const fileHandle = await directoryHandle.getFileHandle(safeFileName, { create: true });
  if (!fileHandle || fileHandle.kind !== 'file' || typeof fileHandle.createWritable !== 'function') {
    throw workspaceError('invalid-file-handle', '无法创建可写文件句柄');
  }
  const writable = await fileHandle.createWritable();
  let closed = false;
  try {
    await writable.write(blob);
    await writable.close();
    closed = true;
  } catch (error) {
    if (!closed && typeof writable?.abort === 'function') {
      try { await writable.abort(); } catch (_) {}
    }
    throw error;
  }

  return {
    status: 'written',
    fileName: safeFileName,
    size: blob.size,
    type: blob.type,
    directoryHandle,
    fileHandle,
  };
}

export async function writeStudioLocalJson(directoryHandle, fileName, value, options = {}) {
  const blob = createStudioLocalJsonBlob(value, options);
  return writeStudioLocalBlob(directoryHandle, fileName, blob, options);
}
