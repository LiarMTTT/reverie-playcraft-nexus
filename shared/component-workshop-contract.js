const FORMAT = 'rpn-component-package';
const SCHEMA_VERSION = 1;
const WORKFLOW_STAGES = new Set(['variable_core', 'component_assembly', 'release']);
const MAX_FILES = 48;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_FILE_BYTES = 1024 * 1024;
const MAX_PACKAGE_BYTES = 1152 * 1024;

const MEDIA_BY_EXTENSION = Object.freeze({
  '.css': new Set(['text/css']),
  '.ejs': new Set(['text/plain', 'text/x-ejs']),
  '.html': new Set(['text/html']),
  '.js': new Set(['text/javascript', 'application/javascript']),
  '.json': new Set(['application/json']),
  '.md': new Set(['text/markdown', 'text/plain']),
  '.txt': new Set(['text/plain']),
});

const PACKAGE_FIELDS = Object.freeze([
  'format',
  'schemaVersion',
  'id',
  'title',
  'summary',
  'version',
  'authorName',
  'tags',
  'license',
  'compatibility',
  'dependencies',
  'conflicts',
  'replaces',
  'replacedBy',
  'workflowStage',
  'files',
]);

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function utf8ByteLength(value) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(value)).byteLength;
  if (typeof Buffer !== 'undefined') return Buffer.byteLength(String(value), 'utf8');
  return unescape(encodeURIComponent(String(value))).length;
}

function cleanString(value, maxLength, code, { required = false } = {}) {
  if (typeof value !== 'string') fail(code);
  const text = value.trim();
  if (required && !text) fail(code);
  if (text.length > maxLength || /[\u0000-\u001f\u007f]/.test(text)) fail(code);
  return text;
}

function cleanSemver(value, code) {
  const text = cleanString(value, 40, code, { required: true });
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(text)) fail(code);
  return text;
}

function cleanComponentId(value, code = 'invalid-component-id') {
  const text = cleanString(value, 120, code, { required: true });
  if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(text)) fail(code, text);
  return text;
}

function normalizeTags(value) {
  if (!Array.isArray(value) || value.length > 16) fail('invalid-component-tags');
  const tags = value.map((tag) => cleanString(tag, 40, 'invalid-component-tag', { required: true }));
  if (new Set(tags).size !== tags.length) fail('duplicate-component-tag');
  return tags;
}

function normalizeIdList(value, code, packageId) {
  if (!Array.isArray(value) || value.length > 64) fail(code);
  const ids = value.map((item) => cleanComponentId(item, code));
  if (new Set(ids).size !== ids.length) fail(code, 'duplicate');
  if (ids.includes(packageId)) fail(code, 'self-reference');
  return ids;
}

function normalizeCompatibility(value) {
  if (!isObject(value)) fail('invalid-component-compatibility');
  for (const key of Object.keys(value)) {
    if (key !== 'libraryVersion' && key !== 'sourceCardVersion') {
      fail('unknown-component-compatibility-field', key);
    }
  }
  const compatibility = {
    libraryVersion: cleanSemver(value.libraryVersion, 'invalid-library-version'),
  };
  if (value.sourceCardVersion !== undefined) {
    compatibility.sourceCardVersion = cleanSemver(value.sourceCardVersion, 'invalid-source-card-version');
  }
  return compatibility;
}

function normalizeFilePath(value) {
  const text = cleanString(value, 240, 'invalid-component-file-path', { required: true });
  if (text !== text.normalize('NFC')) fail('noncanonical-component-file-path', text);
  if (
    text.startsWith('/')
    || text.endsWith('/')
    || text.includes('\\')
    || text.includes('//')
    || /[<>:"|?*%]/.test(text)
  ) fail('invalid-component-file-path', text);

  const segments = text.split('/');
  if (!segments.length || segments.length > 12) fail('invalid-component-file-path', text);
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.startsWith('.') || /[. ]$/.test(segment)) {
      fail('invalid-component-file-path', text);
    }
    const stem = segment.split('.')[0].toUpperCase();
    if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) fail('reserved-component-file-path', text);
  }
  return text;
}

function normalizeFile(value) {
  if (!isObject(value)) fail('invalid-component-file');
  for (const key of Object.keys(value)) {
    if (key !== 'path' && key !== 'mediaType' && key !== 'text' && key !== 'sha256') {
      fail('unknown-component-file-field', key);
    }
  }

  const path = normalizeFilePath(value.path);
  const extensionIndex = path.lastIndexOf('.');
  const extension = extensionIndex >= 0 ? path.slice(extensionIndex).toLowerCase() : '';
  const allowedMediaTypes = MEDIA_BY_EXTENSION[extension];
  if (!allowedMediaTypes) fail('unsupported-component-file-type', extension || path);

  const mediaType = cleanString(value.mediaType, 80, 'invalid-component-file-media-type', { required: true }).toLowerCase();
  if (!allowedMediaTypes.has(mediaType)) fail('component-file-media-type-mismatch', `${path}:${mediaType}`);
  if (typeof value.text !== 'string' || value.text.includes('\0')) fail('invalid-component-file-text', path);
  const byteLength = utf8ByteLength(value.text);
  if (byteLength > MAX_FILE_BYTES) fail('component-file-too-large', path);

  const file = { path, mediaType, text: value.text };
  if (value.sha256 !== undefined) {
    const sha256 = cleanString(value.sha256, 64, 'invalid-component-file-sha256', { required: true }).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) fail('invalid-component-file-sha256', path);
    file.sha256 = sha256;
  }
  if (extension === '.json') {
    try { JSON.parse(value.text); } catch (_) { fail('invalid-component-json-file', path); }
  }
  return { file, byteLength };
}

function normalizePackage(input) {
  if (!isObject(input)) fail('component-package-not-object');
  if (utf8ByteLength(JSON.stringify(input)) > MAX_PACKAGE_BYTES) fail('component-package-too-large');
  for (const key of Object.keys(input)) {
    if (!PACKAGE_FIELDS.includes(key)) fail('unknown-component-package-field', key);
  }
  if (input.format !== FORMAT) fail('invalid-component-package-format');
  if (input.schemaVersion !== SCHEMA_VERSION) fail('invalid-component-package-schema-version');

  const id = cleanComponentId(input.id);
  const dependencies = normalizeIdList(input.dependencies, 'invalid-component-dependencies', id);
  const conflicts = normalizeIdList(input.conflicts, 'invalid-component-conflicts', id);
  const replaces = normalizeIdList(input.replaces, 'invalid-component-replaces', id);
  const replacedBy = normalizeIdList(input.replacedBy, 'invalid-component-replaced-by', id);
  if (dependencies.some((item) => conflicts.includes(item))) fail('component-dependency-conflict-overlap');
  if (replaces.some((item) => replacedBy.includes(item))) fail('component-replacement-overlap');

  const workflowStage = cleanString(input.workflowStage, 40, 'invalid-component-workflow-stage', { required: true });
  if (!WORKFLOW_STAGES.has(workflowStage)) fail('invalid-component-workflow-stage');
  const license = cleanString(input.license, 80, 'invalid-component-license', { required: true });
  if (!/^(?:UNLICENSED|LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.+-]{1,79})$/.test(license)) {
    fail('invalid-component-license');
  }

  if (!Array.isArray(input.files) || !input.files.length || input.files.length > MAX_FILES) {
    fail('invalid-component-files');
  }
  let totalBytes = 0;
  const files = input.files.map((value) => {
    const normalized = normalizeFile(value);
    totalBytes += normalized.byteLength;
    if (totalBytes > MAX_TOTAL_FILE_BYTES) fail('component-files-too-large');
    return normalized.file;
  });
  const paths = files.map((file) => file.path.toLocaleLowerCase('en-US'));
  if (new Set(paths).size !== paths.length) fail('duplicate-component-file-path');

  return {
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id,
    title: cleanString(input.title, 120, 'invalid-component-title', { required: true }),
    summary: cleanString(input.summary, 1200, 'invalid-component-summary', { required: true }),
    version: cleanSemver(input.version, 'invalid-component-version'),
    authorName: cleanString(input.authorName, 80, 'invalid-component-author', { required: true }),
    tags: normalizeTags(input.tags),
    license,
    compatibility: normalizeCompatibility(input.compatibility),
    dependencies,
    conflicts,
    replaces,
    replacedBy,
    workflowStage,
    files,
  };
}

async function sha256Text(text) {
  if (typeof crypto?.subtle?.digest !== 'function' || typeof TextEncoder === 'undefined') {
    fail('sha256-unavailable');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function verifyPackageHashes(input) {
  const componentPackage = normalizePackage(input);
  for (const file of componentPackage.files) {
    if (!file.sha256) continue;
    if (await sha256Text(file.text) !== file.sha256) fail('component-file-sha256-mismatch', file.path);
  }
  return componentPackage;
}

const api = Object.freeze({
  version: '1.0.0',
  format: FORMAT,
  schemaVersion: SCHEMA_VERSION,
  workflowStages: Object.freeze([...WORKFLOW_STAGES]),
  limits: Object.freeze({
    maxFiles: MAX_FILES,
    maxFileBytes: MAX_FILE_BYTES,
    maxTotalFileBytes: MAX_TOTAL_FILE_BYTES,
    maxPackageBytes: MAX_PACKAGE_BYTES,
  }),
  packageFields: PACKAGE_FIELDS,
  normalizePackage,
  sha256Text,
  verifyPackageHashes,
});

try { globalThis.RpnComponentWorkshopContract = api; } catch (_) {}

export default api;
export {
  FORMAT,
  SCHEMA_VERSION,
  normalizePackage,
  sha256Text,
  verifyPackageHashes,
};
