/**
 * RPN Web 世界书工作台纯模型。
 *
 * 只负责 Canonical 条目默认值、角色卡 v2 转换、静态校验与近似激活预览。
 * 本模块不得探测 SillyTavern/Tavern Helper、写入真实世界书、访问父窗口或挂载全局 API。
 */

'use strict';

const POSITION_NUM_TO_TYPE = Object.freeze({
  0: 'before_character_definition',
  1: 'after_character_definition',
  2: 'before_author_note',
  3: 'after_author_note',
  4: 'at_depth',
  5: 'before_example_messages',
  6: 'after_example_messages',
  7: 'outlet',
});
const ROLE_NUM_TO_STR = Object.freeze({ 0: 'system', 1: 'user', 2: 'assistant' });
const SELECTIVE_LOGIC_NUM_TO_STR = Object.freeze({ 0: 'and_any', 1: 'not_all', 2: 'not_any', 3: 'and_all' });

function invertNumKeyed(map) {
  const out = {};
  for (const key of Object.keys(map)) out[map[key]] = Number(key);
  return out;
}

const POSITION_TYPE_TO_NUM = Object.freeze(invertNumKeyed(POSITION_NUM_TO_TYPE));
const ROLE_STR_TO_NUM = Object.freeze(invertNumKeyed(ROLE_NUM_TO_STR));
const SELECTIVE_LOGIC_STR_TO_NUM = Object.freeze(invertNumKeyed(SELECTIVE_LOGIC_NUM_TO_STR));
const VALID_POSITION_TYPES = new Set(Object.values(POSITION_NUM_TO_TYPE));
const VALID_SECONDARY_LOGIC = new Set(Object.values(SELECTIVE_LOGIC_NUM_TO_STR));
const VALID_STRATEGY_TYPES = new Set(['constant', 'selective', 'vectorized']);
const VALID_ROLES = new Set(Object.values(ROLE_NUM_TO_STR));
const AN_POSITIONS = new Set(['before_author_note', 'after_author_note']);
const WORKSHOP_PACKAGE_KIND = 'workshop_package';

function makeCanonical(overrides = {}) {
  return {
    name: '',
    enabled: true,
    strategyType: 'constant',
    keys: [],
    secondaryKeys: [],
    secondaryLogic: 'and_any',
    selective: false,
    scanDepth: 'same_as_global',
    caseSensitive: null,
    matchWholeWords: null,
    positionType: 'before_character_definition',
    role: 'system',
    depth: 4,
    order: 100,
    content: '',
    probability: 100,
    group: '',
    groupOverride: false,
    groupWeight: 100,
    useGroupScoring: false,
    sticky: null,
    cooldown: null,
    delay: null,
    recursion: { prevent_incoming: true, prevent_outgoing: true, delay_until: null },
    vectorized: false,
    meta: {},
    ...overrides,
  };
}

function normKeys(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

const cardAdapter = {
  toCanonical(entry) {
    const ext = entry.extensions || {};
    const posNum = typeof ext.position === 'number' ? ext.position : 1;
    return makeCanonical({
      name: entry.comment || '',
      enabled: entry.disable !== true && entry.enabled !== false,
      strategyType: entry.constant ? 'constant' : entry.vectorized ? 'vectorized' : 'selective',
      keys: normKeys(entry.key ?? entry.keys),
      secondaryKeys: normKeys(entry.keysecondary ?? entry.secondary_keys),
      secondaryLogic: SELECTIVE_LOGIC_NUM_TO_STR[Number(entry.selectiveLogic ?? 0)] || 'and_any',
      selective: Boolean(entry.selective),
      scanDepth: entry.scanDepth ?? ext.scan_depth ?? 'same_as_global',
      caseSensitive: entry.caseSensitive ?? ext.case_sensitive ?? null,
      matchWholeWords: entry.matchWholeWords ?? ext.match_whole_words ?? null,
      positionType: POSITION_NUM_TO_TYPE[posNum] || 'after_character_definition',
      role: ROLE_NUM_TO_STR[Number(ext.role) || 0] || 'system',
      depth: typeof ext.depth === 'number' ? ext.depth : 4,
      order: typeof entry.order === 'number' ? entry.order : 100,
      content: entry.content || '',
      probability: typeof entry.probability === 'number' ? entry.probability : 100,
      group: entry.group ?? ext.group ?? '',
      groupOverride: Boolean(entry.groupOverride ?? ext.group_override),
      groupWeight: typeof (entry.groupWeight ?? ext.group_weight) === 'number'
        ? (entry.groupWeight ?? ext.group_weight)
        : 100,
      useGroupScoring: Boolean(entry.useGroupScoring ?? ext.use_group_scoring),
      sticky: entry.sticky ?? null,
      cooldown: entry.cooldown ?? null,
      delay: entry.delay ?? null,
      vectorized: Boolean(entry.vectorized),
      meta: { ...(ext.worldbookManager || {}) },
      ...(entry.uid != null ? { uid: entry.uid } : {}),
    });
  },

  fromCanonical(canonical) {
    const entry = {
      comment: canonical.name,
      key: [...canonical.keys],
      keysecondary: [...canonical.secondaryKeys],
      selective: canonical.selective,
      selectiveLogic: SELECTIVE_LOGIC_STR_TO_NUM[canonical.secondaryLogic] ?? 0,
      content: canonical.content,
      constant: canonical.strategyType === 'constant',
      vectorized: canonical.strategyType === 'vectorized',
      disable: !canonical.enabled,
      order: canonical.order,
      group: canonical.group,
      groupOverride: canonical.groupOverride,
      groupWeight: canonical.groupWeight,
      useGroupScoring: canonical.useGroupScoring,
      probability: canonical.probability,
      sticky: canonical.sticky ?? null,
      cooldown: canonical.cooldown ?? null,
      delay: canonical.delay ?? null,
      extensions: {
        position: POSITION_TYPE_TO_NUM[canonical.positionType] ?? 1,
        depth: canonical.depth,
        role: ROLE_STR_TO_NUM[canonical.role] ?? 0,
        group: canonical.group,
        group_override: canonical.groupOverride,
        group_weight: canonical.groupWeight,
        use_group_scoring: canonical.useGroupScoring,
        case_sensitive: canonical.caseSensitive,
        match_whole_words: canonical.matchWholeWords,
        worldbookManager: { ...canonical.meta },
      },
    };
    if (canonical.uid != null) entry.uid = canonical.uid;
    return entry;
  },
};

function fromRuntimeEntry(entry) {
  const position = entry.position || {};
  const strategy = entry.strategy || {};
  const secondary = strategy.keys_secondary || {};
  const effect = entry.effect || {};
  return makeCanonical({
    name: entry.name || '',
    enabled: entry.enabled !== false,
    strategyType: VALID_STRATEGY_TYPES.has(strategy.type) ? strategy.type : 'constant',
    keys: Array.isArray(strategy.keys) ? [...strategy.keys] : [],
    secondaryKeys: Array.isArray(secondary.keys) ? [...secondary.keys] : [],
    secondaryLogic: VALID_SECONDARY_LOGIC.has(secondary.logic) ? secondary.logic : 'and_any',
    selective: strategy.type === 'selective',
    scanDepth: strategy.scan_depth ?? 'same_as_global',
    positionType: VALID_POSITION_TYPES.has(position.type)
      ? position.type
      : 'before_character_definition',
    role: VALID_ROLES.has(position.role) ? position.role : 'system',
    depth: typeof position.depth === 'number' ? position.depth : 4,
    order: typeof position.order === 'number' ? position.order : 100,
    content: entry.content || '',
    probability: typeof entry.probability === 'number' ? entry.probability : 100,
    recursion: {
      prevent_incoming: Boolean(entry.recursion?.prevent_incoming),
      prevent_outgoing: Boolean(entry.recursion?.prevent_outgoing),
      delay_until: entry.recursion?.delay_until ?? null,
    },
    sticky: effect.sticky ?? null,
    cooldown: effect.cooldown ?? null,
    delay: effect.delay ?? null,
    meta: { ...(entry.extra || {}) },
    ...(entry.uid != null ? { uid: entry.uid } : {}),
  });
}

function hasCjkKey(keys) {
  return (keys || []).some((key) => /[一-鿿぀-ヿ]/.test(String(key)));
}

function validateCanonical(entries, options = {}) {
  const errors = [];
  const warnings = [];
  const seenNames = new Map();
  const list = Array.isArray(entries) ? entries : [];

  for (const canonical of list) {
    const tag = canonical?.name ? '「' + canonical.name + '」' : '(无名条目)';
    if (!VALID_POSITION_TYPES.has(canonical.positionType)) {
      errors.push({ rule: 'V1', message: tag + ' position.type 非法：' + canonical.positionType });
    }
    if (POSITION_TYPE_TO_NUM[canonical.positionType] == null) {
      errors.push({ rule: 'V2', message: tag + ' position 越界（须 0-7）' });
    }
    if (canonical.strategyType !== 'constant' && hasCjkKey(canonical.keys) && canonical.matchWholeWords !== false) {
      const finding = {
        rule: 'V3',
        message: tag + ' 含中文 key 但 matchWholeWords 未显式 false（当前='
          + String(canonical.matchWholeWords) + '），中文将匹配不上',
      };
      if (options.surface === 'runtime') warnings.push(finding);
      else errors.push(finding);
    }
    if (canonical.positionType === 'at_depth'
      && !(Number.isInteger(canonical.depth) && canonical.depth >= 0)) {
      errors.push({
        rule: 'V6',
        message: tag + ' position=at_depth 但 depth 非非负整数：' + canonical.depth,
      });
    }

    const meta = canonical && canonical.meta && typeof canonical.meta === 'object'
      && !Array.isArray(canonical.meta) ? canonical.meta : {};
    const managedIdentity = meta.kind === WORKSHOP_PACKAGE_KIND
      ? [meta.source, meta.kind, meta.packageId, meta.packageType, meta.packageTarget]
        .map((value) => String(value || '')).join('|')
      : (meta.source && meta.kind ? [meta.source, meta.kind].join('|') : String(canonical.name || ''));
    if (managedIdentity) {
      if (seenNames.has(managedIdentity)) {
        errors.push({ rule: 'V5', message: tag + ' 业务主键在本批次内重复' });
      } else {
        seenNames.set(managedIdentity, true);
      }
    }

    ['source', 'kind', 'packageId', 'packageType', 'packageTarget'].forEach((key) => {
      if (meta[key] !== undefined && (typeof meta[key] !== 'string' || !meta[key].trim())) {
        errors.push({ rule: 'V8', message: tag + ' extra.' + key + ' 必须是非空字符串' });
      }
    });
    if (meta.kind === WORKSHOP_PACKAGE_KIND) {
      ['source', 'packageId', 'packageType', 'packageTarget'].forEach((key) => {
        if (typeof meta[key] !== 'string' || !meta[key].trim()) {
          errors.push({ rule: 'V8', message: tag + ' 工坊条目缺少 extra.' + key });
        }
      });
    }
    if (meta.programOnly !== undefined && typeof meta.programOnly !== 'boolean') {
      errors.push({ rule: 'V8', message: tag + ' extra.programOnly 必须是 boolean' });
    }
    if (meta.programOnly === true) {
      ['source', 'kind', 'packageId', 'packageType', 'packageTarget'].forEach((key) => {
        if (typeof meta[key] !== 'string' || !meta[key].trim()) {
          errors.push({ rule: 'V9', message: tag + ' programOnly 条目缺少 extra.' + key });
        }
      });
      if (meta.kind !== WORKSHOP_PACKAGE_KIND) {
        errors.push({ rule: 'V9', message: tag + ' programOnly 条目 kind 必须是 ' + WORKSHOP_PACKAGE_KIND });
      }
      if (canonical.strategyType !== 'constant') {
        errors.push({ rule: 'V9', message: tag + ' programOnly 条目 strategy 必须是 constant' });
      }
      if (canonical.enabled !== false
        || canonical.recursion?.prevent_incoming !== true
        || canonical.recursion?.prevent_outgoing !== true
        || canonical.recursion?.delay_until !== null) {
        errors.push({ rule: 'V9', message: tag + ' programOnly 条目必须 enabled=false 且递归双禁' });
      }
      if (!/^[a-f0-9]{64}$/.test(String(meta.contentHash || ''))) {
        errors.push({ rule: 'V9', message: tag + ' programOnly 条目 contentHash 必须是 64 位小写 SHA-256' });
      }
      if (meta.revision === undefined || meta.revision === null || !String(meta.revision).trim()) {
        errors.push({ rule: 'V9', message: tag + ' programOnly 条目缺少 extra.revision' });
      }
      if (typeof meta.installedAt !== 'string'
        || !meta.installedAt.trim()
        || Number.isNaN(Date.parse(meta.installedAt))) {
        errors.push({ rule: 'V9', message: tag + ' programOnly 条目 installedAt 必须是合法时间' });
      }
    }
    if (AN_POSITIONS.has(canonical.positionType)) {
      warnings.push({
        rule: 'V7',
        message: tag + ' 位于 ' + canonical.positionType + '(AN)，AN 频率=0 时将被静默跳过、不注入 prompt',
      });
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

function entryUid(entry) {
  return Number.isInteger(entry?.uid) && entry.uid >= 0 ? entry.uid : null;
}

function previewActivation(entries = [], context = {}) {
  const initialText = String(context.text || '');
  const maxDepth = Math.max(
    0,
    Math.min(16, Number.isInteger(context.maxRecursionDepth) ? context.maxRecursionDepth : 4),
  );
  const active = [];
  const inactive = [];
  const indeterminate = [];
  const pending = [];

  const matches = (key, text, caseSensitive, wholeWords) => {
    if (key instanceof RegExp) {
      try {
        return new RegExp(key.source, key.flags.replace(/[gy]/g, '')).test(text);
      } catch (_) {
        return false;
      }
    }
    const needle = String(key || '');
    if (!needle) return false;
    if (!wholeWords) {
      return caseSensitive
        ? text.includes(needle)
        : text.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
    }
    const haystack = caseSensitive ? text : text.toLocaleLowerCase();
    const token = caseSensitive ? needle : needle.toLocaleLowerCase();
    const isWord = (character) => Boolean(character) && /[0-9A-Za-z_]/.test(character);
    let offset = 0;
    while (offset <= haystack.length) {
      const index = haystack.indexOf(token, offset);
      if (index < 0) return false;
      if (!isWord(haystack[index - 1]) && !isWord(haystack[index + token.length])) return true;
      offset = index + Math.max(1, token.length);
    }
    return false;
  };

  const eligibleIn = (canonical, text) => {
    if (canonical.strategyType === 'constant') return true;
    if (canonical.strategyType !== 'selective') return false;
    const primary = (canonical.keys || []).some((key) => matches(
      key,
      text,
      canonical.caseSensitive === true,
      canonical.matchWholeWords === true,
    ));
    const secondary = (canonical.secondaryKeys || []).map((key) => matches(
      key,
      text,
      canonical.caseSensitive === true,
      canonical.matchWholeWords === true,
    ));
    const logic = canonical.secondaryLogic || 'and_any';
    const secondaryOk = !secondary.length
      || (logic === 'and_any'
        ? secondary.some(Boolean)
        : logic === 'and_all'
          ? secondary.every(Boolean)
          : logic === 'not_any'
            ? secondary.every((value) => !value)
            : !secondary.every(Boolean));
    return primary && secondaryOk;
  };

  (Array.isArray(entries) ? entries : []).forEach((raw, index) => {
    const canonical = raw?.strategyType ? raw : fromRuntimeEntry(raw || {});
    const item = {
      entry: canonical,
      uid: entryUid(canonical),
      name: canonical.name,
      reason: '',
      depth: null,
      inputIndex: index,
    };
    if (canonical.meta?.programOnly === true) {
      item.reason = 'program_only';
      inactive.push(item);
      return;
    }
    if (canonical.enabled === false) {
      item.reason = 'disabled';
      inactive.push(item);
      return;
    }
    if (canonical.strategyType === 'vectorized') {
      item.reason = 'vectorized_requires_st';
      indeterminate.push(item);
      return;
    }
    if (Number(canonical.probability) <= 0) {
      item.reason = 'probability_zero';
      inactive.push(item);
      return;
    }
    pending.push({ canonical, item, done: false });
  });

  let scanText = initialText;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    let propagated = '';
    pending.forEach((candidate) => {
      if (candidate.done) return;
      const delay = Number.isInteger(candidate.canonical.recursion?.delay_until)
        ? candidate.canonical.recursion.delay_until
        : 0;
      if (depth < delay) return;
      const basis = depth > 0 && candidate.canonical.recursion?.prevent_incoming === true
        ? initialText
        : scanText;
      if (!eligibleIn(candidate.canonical, basis)) return;
      candidate.done = true;
      candidate.item.depth = depth;
      if (Number(candidate.canonical.probability) < 100) {
        candidate.item.reason = 'probabilistic';
        indeterminate.push(candidate.item);
        return;
      }
      candidate.item.reason = depth === 0 ? 'eligible' : 'eligible_recursive';
      active.push(candidate.item);
      if (candidate.canonical.recursion?.prevent_outgoing !== true
        && String(candidate.canonical.content || '').trim()) {
        propagated += '\n' + candidate.canonical.content;
      }
    });
    if (propagated) scanText += propagated;
    const waitingForDelay = pending.some((candidate) => !candidate.done
      && Number.isInteger(candidate.canonical.recursion?.delay_until)
      && candidate.canonical.recursion.delay_until > depth
      && candidate.canonical.recursion.delay_until <= maxDepth);
    if (!propagated && !waitingForDelay) break;
  }

  pending.filter((candidate) => !candidate.done).forEach((candidate) => {
    const delay = Number.isInteger(candidate.canonical.recursion?.delay_until)
      ? candidate.canonical.recursion.delay_until
      : 0;
    candidate.item.reason = delay > maxDepth ? 'recursion_delay' : 'keys_not_matched';
    inactive.push(candidate.item);
  });
  const byInputOrder = (left, right) => left.inputIndex - right.inputIndex;
  active.sort(byInputOrder);
  inactive.sort(byInputOrder);
  indeterminate.sort(byInputOrder);
  return { active, inactive, indeterminate, approximate: true, maxRecursionDepth: maxDepth };
}

export {
  makeCanonical,
  cardAdapter,
  validateCanonical,
  previewActivation,
};
