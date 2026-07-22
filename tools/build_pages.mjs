import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_ASSET_EXTENSIONS = new Set(['.css', '.html', '.js', '.mjs']);
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const LOCAL_RELATIVE_REFERENCE_PATTERN = /(?<![\w/:?#=&%.-])(?:\.{1,2}\/)[^\s"'`<>),;]+/gu;
const LOCAL_RESOURCE_CONTEXT_PATTERNS = [
  /\b(?:src|href|poster|srcset)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/giu,
  /\bfrom\s*(?:"[^"]*"|'[^']*')/gu,
  /\bimport\s*(?:\(\s*)?(?:"[^"]*"|'[^']*')/gu,
  /\b(?:fetch|importScripts|new\s+(?:URL|Worker|SharedWorker))\s*\(\s*(?:"[^"]*"|'[^']*')/gu,
  /\burl\s*\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\)/giu,
  /@import\s+(?:"[^"]*"|'[^']*')/giu,
];
const entries = [
  ['portal/index.html', 'index.html'],
  ['portal/assets', 'assets'],
  ['portal/ui-builder', 'ui-builder'],
  ['shared', 'shared'],
  ['examples', 'examples'],
];

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function readBatchMetadata(packageJson, version) {
  const metadata = packageJson?.rpnBatch;
  if (metadata == null) return null;
  if (metadata.version !== version) throw new Error('package.json rpnBatch.version must match version');
  if (!['patch', 'minor', 'major'].includes(metadata.level)) throw new Error('Invalid package.json rpnBatch.level');
  if (typeof metadata.label !== 'string' || !metadata.label.trim()) throw new Error('Invalid package.json rpnBatch.label');
  if (typeof metadata.startedAt !== 'string' || Number.isNaN(Date.parse(metadata.startedAt))) {
    throw new Error('Invalid package.json rpnBatch.startedAt');
  }
  return metadata;
}

async function copyEntry(root, outDir, sourcePath, targetPath) {
  const source = path.join(root, sourcePath);
  const target = path.join(outDir, targetPath);
  const stat = await fs.stat(source);
  if (stat.isDirectory()) {
    await fs.cp(source, target, { recursive: true });
    return;
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function listTextAssets(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listTextAssets(entryPath));
    else if (TEXT_ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(entryPath);
  }
  return files;
}

function versionLocalReference(reference, version) {
  const hashIndex = reference.indexOf('#');
  const resource = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
  const hash = hashIndex >= 0 ? reference.slice(hashIndex) : '';
  if (/([?&])v=/u.test(resource)) {
    return `${resource.replace(/([?&])v=[^&#]*/g, `$1v=${version}`)}${hash}`;
  }
  const separator = resource.includes('?') ? (/[?&]$/u.test(resource) ? '' : '&') : '?';
  return `${resource}${separator}v=${version}${hash}`;
}

export function injectLocalAssetVersion(source, version) {
  let output = source.replace(LOCAL_RELATIVE_REFERENCE_PATTERN, (reference) => {
    const query = reference.split('#', 1)[0].split('?', 2)[1] || '';
    return /(?:^|&)v=/u.test(query) ? versionLocalReference(reference, version) : reference;
  });
  for (const pattern of LOCAL_RESOURCE_CONTEXT_PATTERNS) {
    output = output.replace(pattern, (context) => context.replace(
      LOCAL_RELATIVE_REFERENCE_PATTERN,
      (reference) => versionLocalReference(reference, version),
    ));
  }
  return output;
}

export function injectVisibleVersion(source, version, releaseDate) {
  if (!/RPN v\d+\.\d+\.\d+/.test(source)) throw new Error('Missing visible RPN version marker');
  if (!/Reverie Playcraft Nexus · v\d+\.\d+\.\d+ · 更新于 \d{4}-\d{2}-\d{2}/.test(source)) {
    throw new Error('Missing footer version/date marker');
  }
  return source
    .replace(/RPN v\d+\.\d+\.\d+/g, `RPN v${version}`)
    .replace(
      /Reverie Playcraft Nexus · v\d+\.\d+\.\d+ · 更新于 \d{4}-\d{2}-\d{2}/g,
      `Reverie Playcraft Nexus · v${version} · 更新于 ${releaseDate}`,
    );
}

export async function buildPages({ root = DEFAULT_ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const outDir = path.join(resolvedRoot, 'dist-pages');
  const packageJson = await readJson(path.join(resolvedRoot, 'package.json'));
  const version = packageJson?.version;
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new Error(`package.json version must be x.y.z semver, received: ${String(version)}`);
  }

  const sourceIndex = await fs.readFile(path.join(resolvedRoot, 'portal/index.html'), 'utf8');
  const sourceDate = sourceIndex.match(/Reverie Playcraft Nexus · v\d+\.\d+\.\d+ · 更新于 (\d{4}-\d{2}-\d{2})/)?.[1];
  if (!sourceDate) throw new Error('Unable to read the existing footer release date');

  const batch = readBatchMetadata(packageJson, version);
  const releaseDate = batch ? batch.startedAt.slice(0, 10) : sourceDate;

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  for (const [source, target] of entries) await copyEntry(resolvedRoot, outDir, source, target);

  for (const filePath of await listTextAssets(outDir)) {
    let source = await fs.readFile(filePath, 'utf8');
    source = injectLocalAssetVersion(source, version);
    if (filePath === path.join(outDir, 'index.html')) {
      source = injectVisibleVersion(source, version, releaseDate);
    }
    await fs.writeFile(filePath, source, 'utf8');
  }

  const versionMetadata = {
    version,
    label: batch?.label ?? null,
    level: batch?.level ?? null,
    startedAt: batch?.startedAt ?? null,
    releaseDate,
  };
  await fs.writeFile(path.join(outDir, 'version.json'), `${JSON.stringify(versionMetadata, null, 2)}\n`, 'utf8');
  console.log(`[ok] RPN pages artifact built at ${outDir} (v${version}, ${releaseDate})`);
  return { outDir, ...versionMetadata };
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) await buildPages();
