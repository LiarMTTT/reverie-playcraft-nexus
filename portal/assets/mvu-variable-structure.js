import { cloneMvuStateData, MvuSimulationError, parseMvuStateText } from './mvu-turn-simulator.js?v=0721m3i2';

const VALUE_TYPES = new Set(['string', 'number', 'boolean', 'object', 'array', 'null']);

export class MvuVariableStructureError extends Error {
  constructor(code, message, detail = '') {
    super(message);
    this.name = 'MvuVariableStructureError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = '') {
  throw new MvuVariableStructureError(code, message, detail);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneAndValidate(value) {
  try {
    return cloneMvuStateData(value);
  } catch (error) {
    if (error instanceof MvuSimulationError) {
      throw new MvuVariableStructureError(error.code, error.message, error.detail);
    }
    throw error;
  }
}

function normalizePath(path) {
  if (!Array.isArray(path)) fail('E_EDIT_PATH', '变量节点路径必须使用路径段数组。');
  return path.map((segment) => {
    if (typeof segment === 'string' && segment) return segment;
    if (Number.isInteger(segment) && segment >= 0) return segment;
    fail('E_EDIT_PATH', '变量节点路径包含无效路径段。');
  });
}

function displayPath(path) {
  return path.reduce((output, segment) => {
    if (Number.isInteger(segment)) return `${output}[${segment}]`;
    if (/^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(segment)) return `${output}.${segment}`;
    return `${output}[${JSON.stringify(segment)}]`;
  }, 'stat_data');
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (isPlainRecord(value)) return 'object';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

function treeNode(key, path, value) {
  const type = valueType(value);
  const entries = type === 'object'
    ? Object.entries(value)
    : type === 'array'
      ? value.map((child, index) => [index, child])
      : [];
  return {
    id: path.length ? `variable:${path.map((segment) => encodeURIComponent(String(segment))).join('/')}` : 'variable:root',
    key,
    path: [...path],
    pathText: displayPath(path),
    valueType: type,
    value: type === 'object' || type === 'array' ? null : value,
    childCount: entries.length,
    children: entries.map(([childKey, child]) => treeNode(childKey, [...path, childKey], child)),
  };
}

function resolveAtPath(root, path) {
  let current = root;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!Number.isInteger(segment) || segment < 0 || segment >= current.length) fail('E_EDIT_PATH', '变量节点路径指向不存在的数组项。');
    } else if (isPlainRecord(current)) {
      if (typeof segment !== 'string' || !Object.hasOwn(current, segment)) fail('E_EDIT_PATH', '变量节点路径指向不存在的对象字段。');
    } else {
      fail('E_EDIT_PATH', '变量节点路径穿过了标量值。');
    }
    current = current[segment];
  }
  return current;
}

function resolveParent(root, path) {
  if (!path.length) fail('E_EDIT_ROOT', '根对象不能被重命名或删除。');
  const parentPath = path.slice(0, -1);
  return { parent: resolveAtPath(root, parentPath), segment: path.at(-1) };
}

function parseTypedValue(type, rawValue, { preserveContainer = false } = {}) {
  if (!VALUE_TYPES.has(type)) fail('E_EDIT_TYPE', `不支持变量类型“${type}”。`);
  if (type === 'null') return null;
  if (type === 'string') return rawValue == null ? '' : String(rawValue);
  if (type === 'number') {
    const number = typeof rawValue === 'number' ? rawValue : Number(String(rawValue ?? '').trim());
    if (!Number.isFinite(number)) fail('E_EDIT_VALUE', 'number 类型必须填写有限数字。');
    return number;
  }
  if (type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue;
    const normalized = String(rawValue ?? '').trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    fail('E_EDIT_VALUE', 'boolean 类型只能填写 true 或 false。');
  }
  if (preserveContainer && type === 'object' && isPlainRecord(rawValue)) return rawValue;
  if (preserveContainer && type === 'array' && Array.isArray(rawValue)) return rawValue;
  if (rawValue != null && String(rawValue).trim()) {
    let parsed;
    try { parsed = JSON.parse(String(rawValue)); } catch (error) { fail('E_EDIT_VALUE', `${type} 类型必须填写合法 JSON。`, error.message); }
    if (type === 'object' && !isPlainRecord(parsed)) fail('E_EDIT_VALUE', 'object 类型的值必须是 JSON 对象。');
    if (type === 'array' && !Array.isArray(parsed)) fail('E_EDIT_VALUE', 'array 类型的值必须是 JSON 数组。');
    return parsed;
  }
  return type === 'object' ? {} : [];
}

function assertKeyByValidation(key) {
  if (typeof key !== 'string' || !key) fail('E_EDIT_KEY', '对象字段名不能为空。');
  try {
    parseMvuStateText(JSON.stringify({ [key]: null }));
  } catch (error) {
    if (error instanceof MvuSimulationError) throw new MvuVariableStructureError(error.code, error.message, error.detail);
    throw error;
  }
}

export function parseMvuVariableState(source) {
  try {
    const data = parseMvuStateText(source);
    const trimmed = String(source ?? '').trim();
    return {
      sourceFormat: trimmed.startsWith('{') ? 'json' : 'yaml',
      data,
      tree: buildMvuVariableTree(data),
    };
  } catch (error) {
    if (error instanceof MvuSimulationError) throw new MvuVariableStructureError(error.code, error.message, error.detail);
    throw error;
  }
}

export function buildMvuVariableTree(value) {
  const data = cloneAndValidate(value);
  return treeNode('stat_data', [], data);
}

export function applyMvuVariableEdit(value, edit) {
  const draft = cloneAndValidate(value);
  if (!edit || typeof edit !== 'object') fail('E_EDIT', '变量编辑操作无效。');
  const type = String(edit.type || '');
  const path = normalizePath(edit.path || []);

  if (type === 'add') {
    const parent = resolveAtPath(draft, path);
    const nextValue = parseTypedValue(String(edit.valueType || 'string'), edit.value);
    if (Array.isArray(parent)) {
      const index = edit.key === '' || edit.key == null ? parent.length : Number(edit.key);
      if (!Number.isInteger(index) || index < 0 || index > parent.length) fail('E_EDIT_INDEX', '新增数组项的位置无效。');
      parent.splice(index, 0, nextValue);
    } else if (isPlainRecord(parent)) {
      const key = String(edit.key ?? '');
      assertKeyByValidation(key);
      if (Object.hasOwn(parent, key)) fail('E_EDIT_DUPLICATE', `同级已经存在字段“${key}”。`);
      parent[key] = nextValue;
    } else {
      fail('E_EDIT_PARENT', '只能向对象或数组新增子项。');
    }
    return cloneAndValidate(draft);
  }

  if (type === 'update') {
    if (!path.length) fail('E_EDIT_ROOT', '根对象类型不能修改。');
    const current = resolveAtPath(draft, path);
    const { parent, segment } = resolveParent(draft, path);
    const nextType = String(edit.valueType || valueType(current));
    parent[segment] = parseTypedValue(nextType, edit.value, { preserveContainer: nextType === valueType(current) });
    return cloneAndValidate(draft);
  }

  if (type === 'rename') {
    resolveAtPath(draft, path);
    const { parent, segment } = resolveParent(draft, path);
    if (!isPlainRecord(parent) || typeof segment !== 'string') fail('E_EDIT_RENAME', '只有对象字段可以改名。');
    const key = String(edit.key ?? '');
    assertKeyByValidation(key);
    if (key === segment) return draft;
    if (Object.hasOwn(parent, key)) fail('E_EDIT_DUPLICATE', `同级已经存在字段“${key}”。`);
    const entries = Object.entries(parent);
    Object.keys(parent).forEach((field) => { delete parent[field]; });
    entries.forEach(([field, fieldValue]) => { parent[field === segment ? key : field] = fieldValue; });
    return cloneAndValidate(draft);
  }

  if (type === 'remove') {
    resolveAtPath(draft, path);
    const { parent, segment } = resolveParent(draft, path);
    if (Array.isArray(parent)) parent.splice(segment, 1);
    else if (isPlainRecord(parent)) delete parent[segment];
    else fail('E_EDIT_PARENT', '变量节点的父级不是对象或数组。');
    return cloneAndValidate(draft);
  }

  fail('E_EDIT', `不支持变量编辑操作“${type || 'unknown'}”。`);
}

export function serializeMvuVariableState(value) {
  return `${JSON.stringify(cloneAndValidate(value), null, 2)}\n`;
}
