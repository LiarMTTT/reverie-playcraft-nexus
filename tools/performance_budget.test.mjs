import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portalRoot = path.join(root, 'portal');
const assetRoot = path.join(portalRoot, 'assets');

function sourcePath(relativePath) {
  return path.join(relativePath.startsWith('shared/') ? root : portalRoot, relativePath);
}

async function bytes(relativePath) {
  return (await fs.stat(sourcePath(relativePath))).size;
}

const shellAssets = [
  'index.html',
  'assets/splash.html',
  'assets/portal.css',
  'assets/portal.js',
  'assets/favicon.svg',
];
const shellBytes = (await Promise.all(shellAssets.map(bytes))).reduce((sum, size) => sum + size, 0);
assert.ok(
  shellBytes <= 320 * 1024,
  `入口壳未压缩资源 ${Math.ceil(shellBytes / 1024)} KiB 超过 320 KiB 预算`,
);

const studioAssets = [
  'assets/card-studio.js',
  'assets/card-studio.css',
  'assets/card-component-catalog.json',
];

async function collectStaticModuleGraph(entryRelativePath) {
  const visited = new Set();
  const visit = async (relativePath) => {
    const normalized = relativePath.replaceAll('\\', '/');
    if (visited.has(normalized)) return;
    visited.add(normalized);
    const source = await fs.readFile(sourcePath(normalized), 'utf8');
    const importPattern = /^\s*(?:import\s+(?:[^'"]*?\sfrom\s+)?|export\s+(?:\*[^'"]*?|\{[^}]*\})\s+from\s+)['"]([^'"]+)['"]/gmu;
    for (const match of source.matchAll(importPattern)) {
      const reference = match[1].split(/[?#]/u, 1)[0];
      if (!reference.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(path.join(portalRoot, normalized)), reference);
      const relative = path.relative(portalRoot, resolved).replaceAll('\\', '/');
      assert.ok(!relative.startsWith('../'), `静态 import 不得逃出 portal：${reference}`);
      await visit(relative);
    }
  };
  await visit(entryRelativePath);
  return [...visited].sort();
}

const studioModuleGraph = await collectStaticModuleGraph('assets/card-studio.js');
const studioMeasuredAssets = [...new Set([...studioAssets, ...studioModuleGraph])];
const studioBytes = (await Promise.all(studioMeasuredAssets.map(bytes))).reduce((sum, size) => sum + size, 0);
assert.ok(
  studioBytes <= 1296 * 1024,
  `工作台静态 import 图与核心数据 ${Math.ceil(studioBytes / 1024)} KiB 超过 1296 KiB 预算：${studioMeasuredAssets.join(', ')}`,
);

const startupStyles = [
  'assets/component-preview.css',
  'assets/card-studio.css',
  'assets/workshop-studio.css',
  'assets/component-workshop.css',
];
const startupModuleGraphs = await Promise.all([
  collectStaticModuleGraph('assets/card-studio.js'),
  collectStaticModuleGraph('assets/workshop-studio.js'),
  collectStaticModuleGraph('assets/component-workshop.js'),
]);
const startupMeasuredAssets = [...new Set([
  ...shellAssets,
  ...startupStyles,
  ...startupModuleGraphs.flat(),
])];
const startupBytes = (await Promise.all(startupMeasuredAssets.map(bytes))).reduce((sum, size) => sum + size, 0);
assert.ok(
  startupBytes <= 2048 * 1024,
  `桌面兼容启动资源 ${Math.ceil(startupBytes / 1024)} KiB 超过 2048 KiB 预算`,
);

const [indexSource, portalSource] = await Promise.all([
  fs.readFile(path.join(portalRoot, 'index.html'), 'utf8'),
  fs.readFile(path.join(assetRoot, 'portal.js'), 'utf8'),
]);
const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
assert.ok(
  indexSource.includes(`RPN v${packageJson.version}`),
  `源码预览版本必须与 package.json 一致：${packageJson.version}`,
);
assert.ok(
  indexSource.includes(`Reverie Playcraft Nexus · v${packageJson.version}`),
  `源码页脚版本必须与 package.json 一致：${packageJson.version}`,
);
for (const name of ['component-preview', 'card-studio', 'workshop-studio', 'component-workshop']) {
  assert.match(
    indexSource,
    new RegExp(`<link[^>]+${name}\\.css\\?v=[^"]+`, 'iu'),
    `${name}.css 必须由入口静态加载，避免 release WebView2 路由门悬挂`,
  );
}
for (const name of ['card-studio', 'workshop-studio', 'component-workshop']) {
  assert.match(
    indexSource,
    new RegExp(`<script type="module" src="\\.\\/assets\\/${name}\\.js\\?v=[^"]+"><\\/script>`, 'iu'),
    `${name}.js 必须由入口静态加载，避免运行时 import Promise 阻塞路由`,
  );
}
assert.doesNotMatch(portalSource, /routeModuleLoaders|loadRouteStyle|loadActiveRouteModules/u, '路由入口不得恢复运行时资源等待门');

console.log(
  `[ok] performance budgets passed (shell ${Math.ceil(shellBytes / 1024)} KiB, startup ${Math.ceil(startupBytes / 1024)} KiB, studio graph ${Math.ceil(studioBytes / 1024)} KiB across ${studioMeasuredAssets.length} assets)`,
);
