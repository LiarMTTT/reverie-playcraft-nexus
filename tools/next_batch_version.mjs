import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEVELS = new Set(['patch', 'minor', 'major']);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function takeValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

export function parseBatchArguments(argv) {
  let label = '';
  let root = DEFAULT_ROOT;
  let level = 'patch';
  let explicitLevel = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else if (argument === '--label') {
      label = takeValue(argv, index, '--label');
      index += 1;
    } else if (argument.startsWith('--label=')) {
      label = argument.slice('--label='.length);
    } else if (argument === '--root') {
      root = takeValue(argv, index, '--root');
      index += 1;
    } else if (argument.startsWith('--root=')) {
      root = argument.slice('--root='.length);
    } else if (argument === '--level') {
      if (explicitLevel) throw new Error('Version level may only be provided once');
      level = takeValue(argv, index, '--level');
      explicitLevel = true;
      index += 1;
    } else if (argument.startsWith('--level=')) {
      if (explicitLevel) throw new Error('Version level may only be provided once');
      level = argument.slice('--level='.length);
      explicitLevel = true;
    } else if (['--patch', '--minor', '--major'].includes(argument)) {
      if (explicitLevel) throw new Error('Version level may only be provided once');
      level = argument.slice(2);
      explicitLevel = true;
    } else if (LEVELS.has(argument)) {
      if (explicitLevel) throw new Error('Version level may only be provided once');
      level = argument;
      explicitLevel = true;
    } else if (!argument.startsWith('--') && !label) {
      label = argument;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!help && !label.trim()) throw new Error('--label is required');
  if (!LEVELS.has(level)) throw new Error(`Invalid version level: ${level}`);
  return { label: label.trim(), level, root: path.resolve(root), help };
}

export function bumpSemver(version, level = 'patch') {
  const match = SEMVER_PATTERN.exec(version);
  if (!match) throw new Error(`Invalid package semver: ${String(version)}`);
  if (!LEVELS.has(level)) throw new Error(`Invalid version level: ${String(level)}`);

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);
  if (level === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (level === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeJsonAtomically(filePath, value) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle = null;
  try {
    handle = await fs.open(temporaryPath, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
  } finally {
    if (handle) await handle.close();
    await fs.rm(temporaryPath, { force: true });
  }
}

function normalizeStartedAt(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid batch start time: ${String(now)}`);
  return date.toISOString();
}

export async function runBatchVersion({ root = DEFAULT_ROOT, label, level = 'patch', now = new Date() }) {
  const resolvedRoot = path.resolve(root);
  const normalizedLabel = String(label ?? '').trim();
  if (!normalizedLabel) throw new Error('Batch label is required');
  if (normalizedLabel.length > 160 || /[\u0000-\u001f]/.test(normalizedLabel)) {
    throw new Error('Batch label must be a single printable line of at most 160 characters');
  }
  if (!LEVELS.has(level)) throw new Error(`Invalid version level: ${String(level)}`);

  const packagePath = path.join(resolvedRoot, 'package.json');
  const packageJson = await readJson(packagePath);
  const currentVersion = packageJson?.version;
  if (typeof currentVersion !== 'string' || !SEMVER_PATTERN.test(currentVersion)) {
    throw new Error(`package.json version must be x.y.z semver, received: ${String(currentVersion)}`);
  }

  const previous = packageJson.rpnBatch ?? null;

  if (previous?.label === normalizedLabel) {
    if (previous.version !== currentVersion) {
      throw new Error(`Batch metadata version ${String(previous.version)} does not match package.json ${currentVersion}`);
    }
    return { changed: false, ...previous };
  }

  const version = bumpSemver(currentVersion, level);
  const metadata = {
    label: normalizedLabel,
    version,
    level,
    startedAt: normalizeStartedAt(now),
  };
  packageJson.version = version;
  packageJson.rpnBatch = metadata;
  await writeJsonAtomically(packagePath, packageJson);
  return { changed: true, ...metadata };
}

function printHelp() {
  console.log('Usage: npm run batch:next -- <label> [patch|minor|major]');
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const options = parseBatchArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    const result = await runBatchVersion(options);
    const state = result.changed ? 'next' : 'same';
    console.log(`[${state}] ${result.label} -> v${result.version} (${result.level})`);
  }
}
