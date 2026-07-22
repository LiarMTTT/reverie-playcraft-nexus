export const ROLECARD_IMPORT_ANALYSIS_FORMAT = 'rpn-rolecard-import-analysis';
export const ROLECARD_IMPORT_ANALYSIS_VERSION = 1;

const ROUTE_IDS = Object.freeze(['initvar', 'mvu_update', 'mvu_plot', 'plain']);
const STATE_SOURCE_IDS = Object.freeze(['initialVariables', 'updateRules', 'plotInstructions']);

const CARD_FIELDS = Object.freeze([
  { key: 'name', label: '名称' },
  { key: 'description', label: '角色简介' },
  { key: 'personality', label: '性格' },
  { key: 'scenario', label: '场景' },
  { key: 'system_prompt', label: '系统提示词' },
  { key: 'post_history_instructions', label: '历史后指令' },
  { key: 'first_mes', label: '主开场' },
  { key: 'alternate_greetings', label: '候选开场' },
  { key: 'group_only_greetings', label: '群聊开场（兼容透传）', boundary: 'preserved' },
  { key: 'mes_example', label: '示例对话' },
  { key: 'creator_notes', label: '作者注释' },
  { key: 'tags', label: '标签' },
  { key: 'creator', label: '作者' },
  { key: 'character_version', label: '角色版本' },
]);

const KNOWN_DATA_FIELDS = new Set([
  ...CARD_FIELDS.map((field) => field.key),
  'character_book', 'characterBook', 'extensions', 'spec', 'spec_version',
]);

const KNOWN_TOP_LEVEL_FIELDS = new Set([
  'spec', 'spec_version', 'data', 'name', 'description', 'personality', 'scenario',
  'first_mes', 'mes_example', 'tags', 'creatorcomment',
]);

const KNOWN_CONTAINERS = Object.freeze([
  { kind: 'scripts', path: ['tavern_helper', 'scripts'] },
  { kind: 'scripts', path: ['tavernHelper', 'scripts'] },
  { kind: 'scripts', path: ['TavernHelper', 'scripts'] },
  { kind: 'scripts', path: ['tavern_helper_scripts'] },
  { kind: 'regex', path: ['regex_scripts'] },
  { kind: 'regex', path: ['regexScripts'] },
]);

const EXPLICIT_COMPONENT_CONTAINERS = Object.freeze([
  ['componentIds'],
  ['component_ids'],
  ['components'],
  ['rpn', 'componentIds'],
  ['rpn', 'component_ids'],
  ['rpn', 'components'],
  ['rolecard_studio', 'componentIds'],
  ['rolecard_studio', 'component_ids'],
  ['rolecard_studio', 'components'],
  ['rolecardStudio', 'componentIds'],
  ['rolecardStudio', 'components'],
  ['mttt', 'componentIds'],
  ['mttt', 'component_ids'],
  ['mttt', 'components'],
]);

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function own(value, key) {
  return isPlainRecord(value) && Object.hasOwn(value, key);
}

function pathJoin(base, parts) {
  return [base, ...parts].filter(Boolean).join('.');
}

function readPath(root, parts) {
  let value = root;
  for (const part of parts) {
    if (!isPlainRecord(value) || !Object.hasOwn(value, part)) return { present: false, value: undefined };
    value = value[part];
  }
  return { present: true, value };
}

function summarizeValue(value) {
  return {
    valueType: valueType(value),
    charCount: typeof value === 'string' ? value.length : 0,
    itemCount: Array.isArray(value) ? value.length : 0,
  };
}

function emptyRouteCounts() {
  return Object.fromEntries(ROUTE_IDS.map((route) => [route, 0]));
}

function emptySourceCounts() {
  return Object.fromEntries(STATE_SOURCE_IDS.map((kind) => [kind, 0]));
}

function analysisShell() {
  return {
    format: ROLECARD_IMPORT_ANALYSIS_FORMAT,
    schemaVersion: ROLECARD_IMPORT_ANALYSIS_VERSION,
    status: 'ready',
    errors: [],
    warnings: [],
    summary: {
      cardFieldCount: 0,
      worldbookEntryCount: 0,
      mvuSourceCount: 0,
      scriptContainerCount: 0,
      scriptItemCount: 0,
      regexContainerCount: 0,
      regexItemCount: 0,
      unknownFieldCount: 0,
      unknownExtensionCount: 0,
      componentCandidateCount: 0,
    },
    card: { fields: [] },
    worldbook: {
      present: false,
      path: '',
      name: '',
      descriptionLength: 0,
      entryCount: 0,
      routeCounts: emptyRouteCounts(),
      entries: [],
      boundary: 'editable',
    },
    state: {
      detected: false,
      strategy: 'undetermined',
      sourceCounts: emptySourceCounts(),
      sources: [],
      boundary: 'editable',
    },
    extensions: { scripts: [], regex: [], boundary: 'preserved' },
    unknown: { fields: [], extensions: [], boundary: 'preserved' },
    componentCandidates: [],
    boundaries: {
      editable: {
        id: 'editable',
        description: '已拆入工作台结构，可以通过后续编辑器修改。',
      },
      preserved: {
        id: 'preserved',
        description: '仅记录容器与原样保留边界，分析器不解析、修改或执行正文。',
      },
      candidate: {
        id: 'candidate',
        description: '只记录卡内显式声明的组件 ID；命中目录也不代表已拆分或已装配。',
      },
      safety: {
        executesScripts: false,
        executesRegex: false,
        executesZod: false,
        parsesVariableValues: false,
        fuzzyComponentMatching: false,
        mutatesInput: false,
      },
    },
  };
}

function invalidAnalysis(code, message, path = 'rawCard') {
  const result = analysisShell();
  result.status = 'invalid';
  result.errors.push({ code, message, path });
  return result;
}

function routeFromEntryName(value) {
  const name = String(value || '').trim();
  if (/^\[InitVar\]/i.test(name)) return 'initvar';
  if (/^\[mvu_update\]/i.test(name)) return 'mvu_update';
  if (/^\[mvu_plot\]/i.test(name)) return 'mvu_plot';
  return 'plain';
}

function stateKindForRoute(route) {
  if (route === 'initvar') return 'initialVariables';
  if (route === 'mvu_update') return 'updateRules';
  if (route === 'mvu_plot') return 'plotInstructions';
  return '';
}

function normalizedPrimitive(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
}

function inspectWorldbook(data, dataPath, result) {
  const bookKey = own(data, 'character_book') ? 'character_book' : own(data, 'characterBook') ? 'characterBook' : '';
  if (!bookKey) return;
  const book = data[bookKey];
  const bookPath = pathJoin(dataPath, [bookKey]);
  result.worldbook.present = true;
  result.worldbook.path = bookPath;
  if (!isPlainRecord(book)) {
    result.warnings.push({ code: 'W_WORLDBOOK_CONTAINER', message: '角色卡中的世界书容器不是对象，未继续分析。', path: bookPath });
    return;
  }
  result.worldbook.name = typeof book.name === 'string' ? book.name : '';
  result.worldbook.descriptionLength = typeof book.description === 'string' ? book.description.length : 0;
  if (book.entries == null) return;
  if (!Array.isArray(book.entries)) {
    result.warnings.push({ code: 'W_WORLDBOOK_ENTRIES', message: '世界书 entries 不是数组，未继续分析条目。', path: `${bookPath}.entries` });
    return;
  }

  book.entries.forEach((entry, index) => {
    const entryPath = `${bookPath}.entries[${index}]`;
    if (!isPlainRecord(entry)) {
      result.warnings.push({ code: 'W_WORLDBOOK_ENTRY', message: `第 ${index + 1} 条世界书不是对象，已跳过。`, path: entryPath });
      return;
    }
    const name = String(entry.comment ?? entry.name ?? `条目 ${index + 1}`);
    const route = routeFromEntryName(name);
    const content = typeof entry.content === 'string' ? entry.content : '';
    const item = {
      index,
      uid: normalizedPrimitive(entry.uid ?? entry.id),
      name,
      route,
      enabled: entry.disable !== true && entry.enabled !== false,
      contentLength: content.length,
      path: entryPath,
      contentPath: `${entryPath}.content`,
      boundary: 'editable',
    };
    result.worldbook.entries.push(item);
    result.worldbook.routeCounts[route] += 1;
    const sourceKind = stateKindForRoute(route);
    if (sourceKind) {
      result.state.sources.push({
        kind: sourceKind,
        route,
        entryIndex: index,
        name,
        enabled: item.enabled,
        contentLength: content.length,
        path: item.contentPath,
        boundary: 'editable',
      });
      result.state.sourceCounts[sourceKind] += 1;
    }
  });
  result.worldbook.entryCount = result.worldbook.entries.length;
  result.state.detected = result.state.sources.length > 0;
  result.state.strategy = result.state.detected ? 'mvu' : 'undetermined';
}

function inspectKnownContainers(extensions, extensionsPath, result, recognizedTopKeys) {
  KNOWN_CONTAINERS.forEach((definition) => {
    const found = readPath(extensions, definition.path);
    if (!found.present) return;
    recognizedTopKeys.add(definition.path[0]);
    const path = pathJoin(extensionsPath, definition.path);
    const arrayValue = Array.isArray(found.value);
    const container = {
      path,
      valueType: valueType(found.value),
      itemCount: arrayValue ? found.value.length : 0,
      validArray: arrayValue,
      executed: false,
      boundary: 'preserved',
    };
    result.extensions[definition.kind].push(container);
    if (!arrayValue) {
      result.warnings.push({
        code: definition.kind === 'scripts' ? 'W_SCRIPT_CONTAINER' : 'W_REGEX_CONTAINER',
        message: `${definition.kind === 'scripts' ? '脚本' : '正则'}容器不是数组，已按原样保留。`,
        path,
      });
    }
  });
}

function explicitIdsFromValue(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) => {
    if (typeof item === 'string' && item.trim()) return [item.trim()];
    if (isPlainRecord(item) && typeof item.id === 'string' && item.id.trim()) return [item.id.trim()];
    return [];
  });
}

function catalogIndex(componentCatalog) {
  if (!isPlainRecord(componentCatalog) || !Array.isArray(componentCatalog.modules)) {
    return { available: false, libraryVersion: '', modules: new Map() };
  }
  const modules = new Map();
  componentCatalog.modules.forEach((module) => {
    if (!isPlainRecord(module) || typeof module.id !== 'string' || !module.id) return;
    if (!modules.has(module.id)) modules.set(module.id, module);
  });
  return {
    available: true,
    libraryVersion: typeof componentCatalog.libraryVersion === 'string' ? componentCatalog.libraryVersion : '',
    modules,
  };
}

function inspectComponentCandidates(extensions, extensionsPath, catalog, result, recognizedTopKeys) {
  const byId = new Map();
  EXPLICIT_COMPONENT_CONTAINERS.forEach((parts) => {
    const found = readPath(extensions, parts);
    if (!found.present) return;
    recognizedTopKeys.add(parts[0]);
    const sourcePath = pathJoin(extensionsPath, parts);
    const ids = explicitIdsFromValue(found.value);
    if (!ids.length && found.value != null) {
      result.warnings.push({ code: 'W_COMPONENT_IDS', message: '显式组件 ID 容器中没有可读取的 ID。', path: sourcePath });
    }
    ids.forEach((id) => {
      const current = byId.get(id) || { id, sourcePaths: [] };
      if (!current.sourcePaths.includes(sourcePath)) current.sourcePaths.push(sourcePath);
      byId.set(id, current);
    });
  });

  result.componentCandidates = [...byId.values()]
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
    .map((candidate) => {
      const module = catalog.modules.get(candidate.id);
      return {
        id: candidate.id,
        sourcePath: candidate.sourcePaths[0],
        sourcePaths: candidate.sourcePaths,
        explicit: true,
        matchMode: 'exact',
        catalogMatch: catalog.available ? Boolean(module) : null,
        label: module ? String(module.commonName || module.title || module.id) : '',
        category: module && typeof module.category === 'string' ? module.category : '',
        boundary: 'candidate',
      };
    });
}

function inspectUnknownFields(rawCard, data, dataPath, extensions, extensionsPath, recognizedTopKeys, result) {
  const fields = [];
  if (own(rawCard, 'data')) {
    Object.keys(rawCard).sort().forEach((key) => {
      if (KNOWN_TOP_LEVEL_FIELDS.has(key)) return;
      fields.push({ scope: 'card', key, path: key, ...summarizeValue(rawCard[key]), boundary: 'preserved' });
    });
  }
  Object.keys(data).sort().forEach((key) => {
    if (KNOWN_DATA_FIELDS.has(key)) return;
    fields.push({ scope: 'data', key, path: pathJoin(dataPath, [key]), ...summarizeValue(data[key]), boundary: 'preserved' });
  });
  result.unknown.fields = fields;

  if (!isPlainRecord(extensions)) return;
  result.unknown.extensions = Object.keys(extensions)
    .filter((key) => !recognizedTopKeys.has(key))
    .sort()
    .map((key) => ({
      key,
      path: pathJoin(extensionsPath, [key]),
      ...summarizeValue(extensions[key]),
      boundary: 'preserved',
    }));
}

function looksLikeRolecard(rawCard, data) {
  const spec = String(rawCard.spec || data.spec || '').toLowerCase();
  if (spec.startsWith('chara_card_')) return true;
  if (typeof data.name === 'string') return true;
  return ['description', 'personality', 'scenario', 'first_mes', 'character_book', 'extensions']
    .some((key) => Object.hasOwn(data, key));
}

export function analyzeRolecardImport(input = {}) {
  if (!isPlainRecord(input)) return invalidAnalysis('E_ANALYSIS_INPUT', '分析参数必须是对象。', 'input');
  const { rawCard, componentCatalog } = input;
  if (!isPlainRecord(rawCard)) return invalidAnalysis('E_RAW_CARD', '角色卡必须是可读取的 JSON 对象。');
  if (Object.hasOwn(rawCard, 'data') && !isPlainRecord(rawCard.data)) {
    return invalidAnalysis('E_CARD_DATA', '角色卡 data 必须是对象。', 'rawCard.data');
  }
  const data = isPlainRecord(rawCard.data) ? rawCard.data : rawCard;
  if (!looksLikeRolecard(rawCard, data)) {
    return invalidAnalysis('E_ROLECARD_SHAPE', '输入中没有可识别的角色卡字段。');
  }

  const result = analysisShell();
  const dataPath = data === rawCard ? '' : 'data';
  result.card.fields = CARD_FIELDS.map((definition) => {
    const present = own(data, definition.key);
    const value = present ? data[definition.key] : undefined;
    return {
      key: definition.key,
      label: definition.label,
      path: pathJoin(dataPath, [definition.key]),
      present,
      ...(present ? summarizeValue(value) : { valueType: 'missing', charCount: 0, itemCount: 0 }),
      boundary: definition.boundary || 'editable',
    };
  });

  inspectWorldbook(data, dataPath, result);

  const extensionsPath = pathJoin(dataPath, ['extensions']);
  const extensions = own(data, 'extensions') ? data.extensions : {};
  const recognizedTopKeys = new Set();
  if (own(data, 'extensions') && !isPlainRecord(extensions)) {
    result.warnings.push({ code: 'W_EXTENSIONS_CONTAINER', message: '角色卡 extensions 不是对象，已按未知字段记录。', path: extensionsPath });
  }
  const readableExtensions = isPlainRecord(extensions) ? extensions : {};
  inspectKnownContainers(readableExtensions, extensionsPath, result, recognizedTopKeys);

  const catalog = catalogIndex(componentCatalog);
  if (!catalog.available) {
    result.warnings.push({ code: 'W_COMPONENT_CATALOG_UNAVAILABLE', message: '没有可用的组件目录；显式 ID 仍会列为未校验候选项。', path: 'componentCatalog' });
  }
  inspectComponentCandidates(readableExtensions, extensionsPath, catalog, result, recognizedTopKeys);
  inspectUnknownFields(rawCard, data, dataPath, extensions, extensionsPath, recognizedTopKeys, result);

  result.summary.cardFieldCount = result.card.fields.filter((field) => field.present).length;
  result.summary.worldbookEntryCount = result.worldbook.entryCount;
  result.summary.mvuSourceCount = result.state.sources.length;
  result.summary.scriptContainerCount = result.extensions.scripts.length;
  result.summary.scriptItemCount = result.extensions.scripts.reduce((sum, container) => sum + container.itemCount, 0);
  result.summary.regexContainerCount = result.extensions.regex.length;
  result.summary.regexItemCount = result.extensions.regex.reduce((sum, container) => sum + container.itemCount, 0);
  result.summary.unknownFieldCount = result.unknown.fields.length;
  result.summary.unknownExtensionCount = result.unknown.extensions.length;
  result.summary.componentCandidateCount = result.componentCandidates.length;
  return result;
}
