import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPages, injectLocalAssetVersion } from './build_pages.mjs';
import { bumpSemver, parseBatchArguments, runBatchVersion } from './next_batch_version.mjs';

assert.equal(bumpSemver('1.2.3', 'patch'), '1.2.4');
assert.equal(bumpSemver('1.2.3', 'minor'), '1.3.0');
assert.equal(bumpSemver('1.2.3', 'major'), '2.0.0');
assert.throws(() => bumpSemver('1.2', 'patch'), /Invalid package semver/);
assert.throws(() => bumpSemver('01.2.3', 'patch'), /Invalid package semver/);
assert.throws(() => bumpSemver('1.2.3', 'prerelease'), /Invalid version level/);

assert.deepEqual(
  parseBatchArguments(['--label', 'm3-k', '--minor', '--root', '.']).level,
  'minor',
);
assert.equal(parseBatchArguments(['m3-k']).label, 'm3-k');
assert.equal(parseBatchArguments(['m3-k', '--minor']).level, 'minor');
assert.equal(parseBatchArguments(['--label=m3-k', 'major']).level, 'major');
assert.throws(() => parseBatchArguments([]), /--label is required/);
assert.throws(() => parseBatchArguments(['--label']), /requires a value/);
assert.throws(() => parseBatchArguments(['--label', 'x', '--level', 'prerelease']), /Invalid version level/);
assert.throws(() => parseBatchArguments(['--label', 'x', '--minor', '--major']), /only be provided once/);
assert.throws(() => parseBatchArguments(['--label', 'x', '--wat']), /Unknown argument/);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rpn-batch-version-'));
try {
  await fs.writeFile(
    path.join(tempRoot, 'package.json'),
    `${JSON.stringify({ name: 'test-rpn', version: '1.2.3', private: true }, null, 2)}\n`,
    'utf8',
  );

  const first = await runBatchVersion({
    root: tempRoot,
    label: 'm3-k',
    now: '2026-07-22T01:02:03.000Z',
  });
  assert.equal(first.changed, true);
  assert.equal(first.version, '1.2.4');
  assert.equal(first.level, 'patch');
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(tempRoot, 'package.json'), 'utf8')).rpnBatch,
    {
      label: 'm3-k',
      version: '1.2.4',
      level: 'patch',
      startedAt: '2026-07-22T01:02:03.000Z',
    },
  );
  await assert.rejects(fs.access(path.join(tempRoot, 'version-batch.json')), { code: 'ENOENT' });

  const same = await runBatchVersion({
    root: tempRoot,
    label: 'm3-k',
    level: 'major',
    now: '2026-07-23T00:00:00.000Z',
  });
  assert.equal(same.changed, false, '同一批次重跑不得升版');
  assert.equal(same.version, '1.2.4');
  assert.equal(same.level, 'patch', '同一批次必须保留首次采用的版本级别');
  assert.equal(same.startedAt, '2026-07-22T01:02:03.000Z');

  const second = await runBatchVersion({
    root: tempRoot,
    label: 'm3-l',
    level: 'minor',
    now: '2026-07-24T01:02:03.000Z',
  });
  assert.equal(second.changed, true);
  assert.equal(second.version, '1.3.0', '不同批次只升一次指定级别');
  const secondPackage = JSON.parse(await fs.readFile(path.join(tempRoot, 'package.json'), 'utf8'));
  assert.equal(secondPackage.version, '1.3.0');
  assert.deepEqual(secondPackage.rpnBatch, {
    label: 'm3-l',
    version: '1.3.0',
    level: 'minor',
    startedAt: '2026-07-24T01:02:03.000Z',
  });
  assert.equal(
    (await fs.readdir(tempRoot)).some((name) => name.includes('.package.json.') && name.endsWith('.tmp')),
    false,
    '原子写入不得遗留临时文件',
  );

  await assert.rejects(
    runBatchVersion({ root: tempRoot, label: 'bad\nlabel' }),
    /single printable line/,
  );
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

assert.equal(
  injectLocalAssetVersion(
    `import './local.js'; import '../shared/x.js?mode=dark&v=old#module'; const lazy = import('./lazy.mjs?mode=dark#chunk'); const image = new URL('./image.svg#mark', import.meta.url); const css = 'url("../styles/main.css?theme=dark#top")'; const remote = 'https://example.com/../x.js?v=keep&next=../y.css';`,
    '2.4.6',
  ),
  `import './local.js?v=2.4.6'; import '../shared/x.js?mode=dark&v=2.4.6#module'; const lazy = import('./lazy.mjs?mode=dark&v=2.4.6#chunk'); const image = new URL('./image.svg?v=2.4.6#mark', import.meta.url); const css = 'url("../styles/main.css?theme=dark&v=2.4.6#top")'; const remote = 'https://example.com/../x.js?v=keep&next=../y.css';`,
);

async function listBuiltTextAssets(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listBuiltTextAssets(entryPath));
    else if (/\.(?:css|html|js|mjs)$/iu.test(entry.name)) files.push(entryPath);
  }
  return files;
}

const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rpn-build-version-'));
try {
  await fs.mkdir(path.join(buildRoot, 'portal', 'assets'), { recursive: true });
  await fs.mkdir(path.join(buildRoot, 'portal', 'ui-builder', 'assets'), { recursive: true });
  await fs.mkdir(path.join(buildRoot, 'shared'), { recursive: true });
  await fs.mkdir(path.join(buildRoot, 'examples'), { recursive: true });
  await fs.writeFile(
    path.join(buildRoot, 'package.json'),
    `${JSON.stringify({
      version: '2.4.6',
      rpnBatch: {
        label: 'test-build',
        version: '2.4.6',
        level: 'minor',
        startedAt: '2026-07-22T12:34:56.000Z',
      },
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(buildRoot, 'portal', 'index.html'),
    '<span>RPN v0.1.0</span><link rel="stylesheet" href="./assets/theme.css#palette"><script src="./assets/app.js"></script><img src="./assets/logo.svg?mode=dark#mark"><footer>Reverie Playcraft Nexus · v0.1.0 · 更新于 2020-01-01</footer>',
    'utf8',
  );
  await fs.writeFile(
    path.join(buildRoot, 'portal', 'assets', 'app.js'),
    `import './dep.js'; import contract from '../shared/contract.js#api'; const image = new URL('./logo.svg?mode=dark#mark', import.meta.url); const remote = 'https://example.com/x.js?v=keep';`,
    'utf8',
  );
  await fs.writeFile(path.join(buildRoot, 'portal', 'assets', 'dep.js'), 'export default true;\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'portal', 'assets', 'theme.css'), 'body{background-image:url("./logo.svg#background")}\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'portal', 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n', 'utf8');
  const untouchedJson = '{"local":"./asset.js?v=old","text":"更新于"}\n';
  await fs.writeFile(path.join(buildRoot, 'portal', 'assets', 'data.json'), untouchedJson, 'utf8');
  await fs.writeFile(path.join(buildRoot, 'portal', 'ui-builder', 'index.html'), '<script src="./assets/builder.js"></script><link rel="stylesheet" href="./assets/builder.css">\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'portal', 'ui-builder', 'assets', 'builder.js'), 'export default true;\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'portal', 'ui-builder', 'assets', 'builder.css'), 'body{}\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'shared', 'contract.js'), 'export default {};\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'shared', 'empty.json'), '{}\n', 'utf8');
  await fs.writeFile(path.join(buildRoot, 'examples', 'empty.json'), '{}\n', 'utf8');

  await buildPages({ root: buildRoot });
  const firstIndex = await fs.readFile(path.join(buildRoot, 'dist-pages', 'index.html'), 'utf8');
  const firstApp = await fs.readFile(path.join(buildRoot, 'dist-pages', 'assets', 'app.js'), 'utf8');
  const firstCss = await fs.readFile(path.join(buildRoot, 'dist-pages', 'assets', 'theme.css'), 'utf8');
  const firstBuilderIndex = await fs.readFile(path.join(buildRoot, 'dist-pages', 'ui-builder', 'index.html'), 'utf8');
  const firstData = await fs.readFile(path.join(buildRoot, 'dist-pages', 'assets', 'data.json'), 'utf8');
  const firstMetadata = await fs.readFile(path.join(buildRoot, 'dist-pages', 'version.json'), 'utf8');
  assert.match(firstIndex, /RPN v2\.4\.6/);
  assert.match(firstIndex, /app\.js\?v=2\.4\.6/);
  assert.match(firstIndex, /theme\.css\?v=2\.4\.6#palette/);
  assert.match(firstIndex, /logo\.svg\?mode=dark&v=2\.4\.6#mark/);
  assert.match(firstIndex, /v2\.4\.6 · 更新于 2026-07-22/);
  assert.match(firstApp, /\.\/dep\.js\?v=2\.4\.6/);
  assert.match(firstApp, /\.\.\/shared\/contract\.js\?v=2\.4\.6#api/);
  assert.match(firstApp, /\.\/logo\.svg\?mode=dark&v=2\.4\.6#mark/);
  assert.match(firstApp, /https:\/\/example\.com\/x\.js\?v=keep/);
  assert.match(firstCss, /\.\/logo\.svg\?v=2\.4\.6#background/);
  assert.match(firstBuilderIndex, /\.\/assets\/builder\.js\?v=2\.4\.6/);
  assert.match(firstBuilderIndex, /\.\/assets\/builder\.css\?v=2\.4\.6/);
  assert.equal(firstData, untouchedJson, 'JSON 业务数据必须原样复制，不参与缓存版本改写');
  assert.ok(firstIndex.includes('· 更新于 2026-07-22'), '页脚必须保留真实 UTF-8 中文');
  assert.deepEqual(JSON.parse(firstMetadata), {
    version: '2.4.6',
    releaseDate: '2026-07-22',
  });
  const unversionedLocalReferences = [];
  for (const filePath of await listBuiltTextAssets(path.join(buildRoot, 'dist-pages'))) {
    const builtSource = await fs.readFile(filePath, 'utf8');
    assert.equal(
      injectLocalAssetVersion(builtSource, '2.4.6'),
      builtSource,
      `${path.relative(buildRoot, filePath)} 不得保留未版本化或旧版本的本地资源引用`,
    );
    for (const match of builtSource.matchAll(/(?:\.{1,2}\/)[^\s"'`<>),;]+/g)) {
      const reference = match[0];
      const query = reference.split('#', 1)[0].split('?', 2)[1] || '';
      if (!/(?:^|&)v=2\.4\.6(?:&|$)/u.test(query)) {
        unversionedLocalReferences.push(`${path.relative(buildRoot, filePath)}: ${reference}`);
      }
    }
  }
  assert.deepEqual(unversionedLocalReferences, [], '构建产物不得保留未版本化的本地相对资源');

  await buildPages({ root: buildRoot });
  assert.equal(await fs.readFile(path.join(buildRoot, 'dist-pages', 'index.html'), 'utf8'), firstIndex);
  assert.equal(await fs.readFile(path.join(buildRoot, 'dist-pages', 'assets', 'app.js'), 'utf8'), firstApp);
  assert.equal(await fs.readFile(path.join(buildRoot, 'dist-pages', 'version.json'), 'utf8'), firstMetadata);
} finally {
  await fs.rm(buildRoot, { recursive: true, force: true });
}

console.log('[ok] batch version and deterministic build contract passed');
