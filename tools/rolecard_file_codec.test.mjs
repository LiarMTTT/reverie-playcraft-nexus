import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyRolecardExtensionAssets,
  base64ToBytes,
  backfillRolecardV2,
  bytesToBase64,
  canonicalPositionType,
  decodeRolecardPng,
  embedRolecardPng,
  encodePngTextChunk,
  extractRolecardExtensionAssets,
  isLikelyRolecardObject,
  mergeRolecardExtensionAssetItems,
  mergeRolecardData,
  parseRolecardExtensionAssetPayload,
  readPngChunks,
  resolveCharacterBookPositionType,
  semanticJsonEqual,
} from '../portal/assets/rolecard-file-codec.js';

const onePixelPng = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=');
const insertBeforeIend = (png, chunk) => {
  const chunks = readPngChunks(png);
  return new Uint8Array(Buffer.concat([
    Buffer.from(png.slice(0, 8)),
    ...chunks.filter((item) => item.type !== 'IEND').map((item) => Buffer.from(item.raw)),
    Buffer.from(chunk),
    Buffer.from(chunks.find((item) => item.type === 'IEND').raw),
  ]));
};
const source = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  custom_top_level: { keep: true },
  data: {
    name: '原卡',
    description: '原简介',
    extensions: {
      regex_scripts: [{ id: 'regex-1', findRegex: 'x' }],
      tavern_helper: { scripts: [{ id: 'script-1', content: 'return 1' }] },
      private_extension: { keep: true },
    },
    character_book: {
      name: '原世界书',
      extensions: { book_unknown: true },
      entries: [{ id: 7, comment: '原条目', content: '旧', unknown_entry_field: 'keep' }],
    },
  },
};

assert.deepEqual(readPngChunks(onePixelPng).map((chunk) => chunk.type), ['IHDR', 'IDAT', 'IEND']);
assert.equal(bytesToBase64(base64ToBytes('5Lit5paH')), '5Lit5paH');
assert.equal(canonicalPositionType('before_char'), 'before_character_definition');
assert.equal(canonicalPositionType('before_example'), 'before_example_messages');
assert.equal(canonicalPositionType('at_depth'), 'at_depth');
assert.equal(canonicalPositionType(0), 'before_character_definition');
assert.equal(canonicalPositionType({ type: 'after_an' }), 'after_author_note');
assert.equal(resolveCharacterBookPositionType('after_char', 4), 'at_depth');
assert.equal(resolveCharacterBookPositionType('after_char', undefined), 'after_character_definition');
assert.equal(resolveCharacterBookPositionType(undefined, 99), 'after_character_definition');
assert.equal(isLikelyRolecardObject(source), true);
assert.equal(isLikelyRolecardObject({ name: '普通世界书', entries: [] }), false);
assert.equal(isLikelyRolecardObject({ arbitrary: true }), false);

const extractedAssets = extractRolecardExtensionAssets(source);
assert.equal(extractedAssets.regexManaged, true);
assert.equal(extractedAssets.tavernHelperManaged, true);
assert.equal(extractedAssets.regexSourcePath, 'regex_scripts');
assert.equal(extractedAssets.tavernHelperSourcePath, 'tavern_helper.scripts');
assert.equal(extractedAssets.regexScripts[0].id, 'regex-1');
assert.equal(extractedAssets.tavernHelperScripts[0].id, 'script-1');

const replacementRegex = {
  id: 'regex-1',
  scriptName: '替换正则',
  findRegex: '/old/g',
  replaceString: 'new',
  minDepth: 2,
  futureField: { keep: true },
};
const replacementScript = {
  type: 'folder',
  id: 'folder-1',
  name: '脚本文件夹',
  scripts: [{ type: 'script', id: 'nested-1', name: '内层脚本', content: 'return 2', futureField: true }],
};
const sourceBeforeExtensionApply = structuredClone(source);
const withManagedAssets = applyRolecardExtensionAssets(source, {
  regexManaged: true,
  regexSourcePath: 'regex_scripts',
  regexScripts: [replacementRegex],
  tavernHelperManaged: true,
  tavernHelperSourcePath: 'tavern_helper.scripts',
  tavernHelperScripts: [replacementScript],
});
assert.deepEqual(source, sourceBeforeExtensionApply, '扩展资源装配不得修改原卡证据');
assert.deepEqual(withManagedAssets.data.extensions.regex_scripts, [replacementRegex]);
assert.deepEqual(withManagedAssets.data.extensions.tavern_helper.scripts, [replacementScript]);
assert.equal(withManagedAssets.data.extensions.private_extension.keep, true);
const managedV2 = backfillRolecardV2(withManagedAssets);
assert.deepEqual(managedV2.data.extensions.regex_scripts, [replacementRegex]);
assert.deepEqual(managedV2.data.extensions.tavern_helper.scripts, [replacementScript]);
const managedPacked = embedRolecardPng(onePixelPng, withManagedAssets, {
  keywords: ['ccv3', 'chara'],
  payloadByKeyword: { ccv3: withManagedAssets, chara: managedV2 },
});
const managedDecoded = decodeRolecardPng(managedPacked);
assert.deepEqual(managedDecoded.card.data.extensions.regex_scripts, [replacementRegex]);
assert.deepEqual(managedDecoded.payloads.get('chara').card.data.extensions.tavern_helper.scripts, [replacementScript]);

const aliasCard = {
  data: {
    extensions: {
      regexScripts: [replacementRegex],
      TavernHelper: { scripts: [replacementScript], variables: { keep: true } },
    },
  },
};
const aliasAssets = extractRolecardExtensionAssets(aliasCard);
assert.equal(aliasAssets.regexSourcePath, 'regexScripts');
assert.equal(aliasAssets.tavernHelperSourcePath, 'TavernHelper.scripts');
const aliasApplied = applyRolecardExtensionAssets(aliasCard, {
  ...aliasAssets,
  tavernHelperScripts: [{ type: 'script', id: 'direct-1', name: '直接脚本', content: 'return 3' }],
});
assert.equal(aliasApplied.data.extensions.TavernHelper.variables.keep, true);
assert.equal(aliasApplied.data.extensions.TavernHelper.scripts[0].id, 'direct-1');
assert.equal(Object.hasOwn(aliasApplied.data.extensions, 'tavern_helper'), false);

const ambiguousExtensionCard = {
  data: {
    name: '双容器样卡',
    extensions: {
      regex_scripts: [],
      regexScripts: [{ id: 'hidden-regex', findRegex: 'hidden' }],
      tavern_helper: { scripts: [] },
      TavernHelper: { scripts: [{ type: 'script', id: 'hidden-script', content: 'return 4' }] },
    },
  },
};
const ambiguousAssets = extractRolecardExtensionAssets(ambiguousExtensionCard);
assert.equal(ambiguousAssets.regexAmbiguous, true);
assert.equal(ambiguousAssets.tavernHelperAmbiguous, true);
assert.deepEqual(ambiguousAssets.regexSourcePaths, ['regex_scripts', 'regexScripts']);
assert.deepEqual(ambiguousAssets.tavernHelperSourcePaths, ['tavern_helper.scripts', 'TavernHelper.scripts']);
assert.throws(
  () => parseRolecardExtensionAssetPayload(ambiguousExtensionCard, 'regex'),
  /regex-asset-containers-ambiguous:regex_scripts,regexScripts/,
);
assert.throws(
  () => parseRolecardExtensionAssetPayload(ambiguousExtensionCard, 'tavern-helper'),
  /tavern-helper-asset-containers-ambiguous:tavern_helper\.scripts,TavernHelper\.scripts/,
);

assert.deepEqual(parseRolecardExtensionAssetPayload(replacementRegex, 'regex'), [replacementRegex]);
assert.deepEqual(parseRolecardExtensionAssetPayload([replacementRegex], 'regex'), [replacementRegex]);
assert.deepEqual(parseRolecardExtensionAssetPayload(replacementScript, 'tavern-helper'), [replacementScript]);
assert.deepEqual(parseRolecardExtensionAssetPayload(source, 'tavern-helper')[0].id, 'script-1');
assert.throws(() => parseRolecardExtensionAssetPayload({ id: 'bad-regex' }, 'regex'), /missing-findRegex/);
assert.throws(() => parseRolecardExtensionAssetPayload({ type: 'script', id: 'bad-script' }, 'tavern-helper'), /invalid-script-tree/);
assert.throws(
  () => parseRolecardExtensionAssetPayload({ type: 'folder', scripts: [{ type: 'script', content: 42 }] }, 'tavern-helper'),
  /scripts\[0\]-invalid-script-tree/,
  'ScriptTree 文件夹中的脚本也必须递归校验',
);
let tooDeepScriptTree = { type: 'script', content: 'return true' };
for (let depth = 0; depth < 66; depth += 1) tooDeepScriptTree = { type: 'folder', scripts: [tooDeepScriptTree] };
assert.throws(
  () => parseRolecardExtensionAssetPayload(tooDeepScriptTree, 'tavern-helper'),
  /script-tree-limit/,
  'ScriptTree 必须限制递归深度',
);
const tooManyTopLevelScripts = Array.from({ length: 10_001 }, (_, index) => ({ type: 'script', id: `script-${index}`, content: '' }));
assert.throws(
  () => parseRolecardExtensionAssetPayload(tooManyTopLevelScripts, 'tavern-helper'),
  /script-tree-limit/,
  '整份 ScriptTree 导入必须共享节点预算',
);

const exactDuplicateMerge = mergeRolecardExtensionAssetItems([replacementRegex], [structuredClone(replacementRegex)]);
assert.equal(exactDuplicateMerge.skipped, 1);
assert.equal(exactDuplicateMerge.items.length, 1);
const conflictMerge = mergeRolecardExtensionAssetItems([replacementRegex], [{ ...replacementRegex, replaceString: 'other' }]);
assert.equal(conflictMerge.conflicts.length, 1);
assert.equal(conflictMerge.items[0].replaceString, 'new');
const replacedMerge = mergeRolecardExtensionAssetItems(
  [replacementRegex],
  [{ ...replacementRegex, replaceString: 'other' }],
  { replaceConflicts: true },
);
assert.equal(replacedMerge.replaced, 1);
assert.equal(replacedMerge.items[0].replaceString, 'other');

const greetings = ['普通开场', '正文前\n---\n正文后', '\\---\n保留反斜杠', '  ---  '];

const merged = mergeRolecardData(source, {
  fields: {
    name: '修改后',
    description: '新简介',
    creator_notes: '注释',
    system_prompt: '系统提示',
    post_history_instructions: '历史后指令',
    group_only_greetings: greetings,
  },
  characterBook: {
    ...source.data.character_book,
    entries: [{ ...source.data.character_book.entries[0], content: '新正文' }],
  },
});
assert.equal(merged.spec, 'chara_card_v3');
assert.equal(merged.data.name, '修改后');
assert.equal(merged.name, '修改后');
assert.equal(merged.data.extensions.regex_scripts[0].id, 'regex-1');
assert.equal(merged.data.extensions.tavern_helper.scripts[0].id, 'script-1');
assert.equal(merged.custom_top_level.keep, true);
assert.equal(merged.data.character_book.entries[0].unknown_entry_field, 'keep');
assert.equal(merged.data.system_prompt, '系统提示');
assert.equal(merged.data.post_history_instructions, '历史后指令');
assert.deepEqual(merged.data.group_only_greetings, greetings);

const packed = embedRolecardPng(onePixelPng, merged, { keywords: ['ccv3', 'chara'] });
const decoded = decodeRolecardPng(packed);
assert.deepEqual(decoded.keywords.sort(), ['ccv3', 'chara']);
assert.equal(semanticJsonEqual(decoded.card, merged), true);
assert.equal(decoded.card.data.extensions.private_extension.keep, true);

const ccv3Only = embedRolecardPng(onePixelPng, merged, { keywords: ['ccv3'] });
assert.equal(decodeRolecardPng(ccv3Only).selectedKeyword, 'ccv3');
const invalidLegacy = insertBeforeIend(ccv3Only, encodePngTextChunk('chara', '{not json'));
assert.equal(decodeRolecardPng(invalidLegacy).selectedKeyword, 'ccv3');
assert.deepEqual(decodeRolecardPng(invalidLegacy).warnings, ['chara-invalid-ignored']);
const duplicateCcv3 = insertBeforeIend(ccv3Only, encodePngTextChunk('ccv3', JSON.stringify(merged)));
assert.throws(() => decodeRolecardPng(duplicateCcv3), /duplicate-rolecard-payload:ccv3/);
const legacyPayload = backfillRolecardV2(merged);
assert.equal(legacyPayload.spec, 'chara_card_v2');
assert.equal(legacyPayload.spec_version, '2.0');
assert.match(legacyPayload.data.creator_notes, /backfilled from Character Card V3/);
assert.equal(Object.hasOwn(legacyPayload.data, 'group_only_greetings'), false);
const mixedVersion = embedRolecardPng(onePixelPng, merged, {
  keywords: ['chara', 'ccv3'],
  payloadByKeyword: { chara: legacyPayload, ccv3: merged },
});
const mixedDecoded = decodeRolecardPng(mixedVersion);
assert.equal(mixedDecoded.selectedKeyword, 'ccv3');
assert.equal(mixedDecoded.card.data.name, '修改后');
assert.deepEqual(mixedDecoded.warnings, ['chara-v2-backfill-present']);

const defaultPacked = embedRolecardPng(onePixelPng, merged);
assert.deepEqual(decodeRolecardPng(defaultPacked).keywords, ['ccv3']);

const repacked = embedRolecardPng(packed, { ...merged, data: { ...merged.data, name: '二次修改' } }, { keywords: ['ccv3', 'chara'] });
const repackedChunks = readPngChunks(repacked);
const payloadKeywords = repackedChunks
  .filter((chunk) => chunk.type === 'tEXt')
  .map((chunk) => String.fromCharCode(...chunk.data.slice(0, chunk.data.indexOf(0))));
assert.deepEqual(payloadKeywords.sort(), ['ccv3', 'chara']);
assert.equal(decodeRolecardPng(repacked).card.data.name, '二次修改');

assert.throws(() => decodeRolecardPng(onePixelPng), /rolecard-payload-missing/);
const corrupted = onePixelPng.slice();
corrupted[corrupted.length - 1] ^= 0xff;
assert.throws(() => readPngChunks(corrupted), /png-crc-mismatch/);

const codecSource = readFileSync(new URL('../portal/assets/rolecard-file-codec.js', import.meta.url), 'utf8');
assert.doesNotMatch(codecSource, /\beval\s*\(|\bnew Function\b|\bfetch\s*\(|\bcreateWritable\s*\(|(?:window|globalThis)\.TavernHelper|\bTavernHelper\.\w+\s*\(/, '扩展 codec 必须保持纯数据边界');

console.log('rolecard file codec tests: passed');
