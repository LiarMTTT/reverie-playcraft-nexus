import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontendSource = readFileSync(path.join(root, 'portal', 'assets', 'component-workshop.js'), 'utf8');
const cssSource = readFileSync(path.join(root, 'portal', 'assets', 'component-workshop.css'), 'utf8');
const contractSource = readFileSync(path.join(root, 'shared', 'component-workshop-contract.js'), 'utf8');
const studioSource = readFileSync(path.join(root, 'portal', 'assets', 'card-studio.js'), 'utf8');
const studioCssSource = readFileSync(path.join(root, 'portal', 'assets', 'card-studio.css'), 'utf8');
const portalSource = readFileSync(path.join(root, 'portal', 'index.html'), 'utf8');
const catalog = JSON.parse(readFileSync(path.join(root, 'portal', 'assets', 'card-component-catalog.json'), 'utf8'));

assert.match(frontendSource, /const componentWorkshopRoots = \[\.\.\.document\.querySelectorAll\('\[data-cws-root\]'\)\];/);
assert.match(frontendSource, /portal:routechange/);
assert.match(frontendSource, /event\.detail\?\.route === 'workshop'/);
assert.doesNotMatch(frontendSource, /querySelectorAll\('\[data-cws-root\]'\)\.forEach\(initComponentWorkshop\)/);
for (const view of ['discover', 'local', 'mine']) {
  assert.match(frontendSource, new RegExp(`data-cws-view="${view}"`), `缺少 ${view} 页面`);
  assert.match(frontendSource, new RegExp(`data-cws-view-link="${view}"`), `缺少 ${view} 导航`);
}
for (const hook of [
  'data-cws-discover-list',
  'data-cws-local-text',
  'data-cws-local-validate',
  'data-cws-file-select',
  'data-cws-preview',
  'data-cws-local-publish',
  'data-cws-mine-list',
  'data-cws-withdraw',
  'data-cws-profile-open',
  'data-cws-profile-name',
  'data-cws-profile-avatar-file',
  'data-cws-profile-save',
  'data-cws-profile-delete',
]) {
  assert.ok(frontendSource.includes(hook), `缺少 DOM 数据钩子 ${hook}`);
}

assert.doesNotMatch(frontendSource, /card-component-catalog\.json|官方验证快照|official-registry/);
assert.match(studioSource, /card-component-catalog\.json/);
assert.match(frontendSource, /创意工坊/);
assert.match(frontendSource, /社区发现/);
assert.match(frontendSource, /格式与安全检查/);
assert.match(frontendSource, /检查通过不代表官方背书或审核通过/);
assert.match(frontendSource, /data-cws-discover-status role="status" aria-live="polite" aria-atomic="true"/);
assert.match(frontendSource, /else if \(state\.discoveryError\) setMessage\(dom\.discoverStatus/);
assert.match(frontendSource, /没有匹配当前搜索的组件/);
assert.match(frontendSource, /社区暂时还没有已发布组件/);
assert.doesNotMatch(frontendSource, /没有符合条件的组件/);
assert.match(frontendSource, /function closeDetail\(\)[\s\S]{0,360}state\.detailSequence \+= 1[\s\S]{0,260}dom\.detail\.hidden = true/);
assert.match(frontendSource, /async function loadDiscovery\(\)[\s\S]{0,180}closeDetail\(\)[\s\S]{0,120}state\.discoveryBusy = true/, '刷新发现列表时必须使旧详情和迟到请求失效');
assert.match(frontendSource, /href="#studio\/remix"/);
assert.match(portalSource, /data-route-link="workshop">创意工坊<\/a>/);
assert.match(portalSource, /data-rcs-route-link="frontend"[\s\S]{0,100}<strong>组件工坊<\/strong>/);
assert.equal(catalog.format, 'rolecard-component-catalog');
assert.equal(catalog.schemaVersion, 1);
assert.equal(catalog.libraryVersion, '0.3.0');
assert.equal(catalog.sourceCardVersion, '3.9.6');
assert.equal(catalog.modules.length, 94);
assert.ok(catalog.modules.every((module) => (
  typeof module.id === 'string'
  && Array.isArray(module.dependsOn)
  && Array.isArray(module.conflictsWith)
)), '内置组件目录必须保留 registry 依赖/冲突元数据');

assert.deepEqual(
  Object.fromEntries(['shared', 'variables', 'status_bar', 'control_center', 'regex_suite'].map((category) => [
    category,
    catalog.modules.filter((module) => module.category === category).length,
  ])),
  { shared: 6, variables: 45, status_bar: 23, control_center: 14, regex_suite: 6 },
  '内置组件树的五类数量必须与 registry 快照一致',
);
for (const componentId of [
  'control_center.xingyue_3_9_6_release',
  'control_center.media_library.xingyue_3_9_6',
  'regex_suite.xingyue_3_9_6_release',
  'mvu_runtime.dual_zod_scripts.xingyue_3_9_6',
]) {
  assert.ok(catalog.modules.some((module) => module.id === componentId), `内置组件目录缺少 ${componentId}`);
}
assert.ok(
  catalog.recipes.some((recipe) => recipe.id === 'xingyue-academy-v3.9.6'),
  '内置组件目录缺少星月 3.9.6 release recipe',
);
assert.match(studioSource, /const componentTreeGroups = \[/);
for (const label of ['基础与运行时', '变量系统', '状态栏', '控制中心', '正则套件']) {
  assert.ok(studioSource.includes(`label: '${label}'`), `组件树缺少一级分组 ${label}`);
}
for (const label of ['星月发布组件', '星月开局与气泡适配']) {
  assert.ok(studioSource.includes(`label: '${label}'`), `星月 3.9.6 组件缺少明确树分组 ${label}`);
}
assert.match(studioSource, /document\.createElement\('details'\)/);
assert.match(studioSource, /document\.createElement\('summary'\)/);
assert.match(studioSource, /groupDetails\.open = Boolean\(query\) \|\| componentOpenBranches\.has/);
assert.match(studioSource, /branchDetails\.open = Boolean\(query\) \|\| componentOpenBranches\.has/);
assert.match(studioCssSource, /\.rcs-component-tree-group:not\(\[open\]\) > \.rcs-component-tree-branches/);
assert.match(studioCssSource, /\.rcs-component-tree-branch:not\(\[open\]\) > \.rcs-component-tree-leaves/);
assert.doesNotMatch(studioSource, /componentCategory|data-rcs-component-category/);
assert.doesNotMatch(portalSource, /data-rcs-component-category/);

assert.match(frontendSource, /const tokenStorageKey = 'xingyue-workshop-token';/);
assert.match(frontendSource, /publisherProfile/);
for (const field of ['displayName', 'avatarUrl', 'publisherId']) assert.match(frontendSource, new RegExp(field));
assert.match(frontendSource, /profile\.displayName \|\| item\.authorName|item\.publisherProfile\?\.displayName \|\| item\.authorName/);
for (const storageCall of frontendSource.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(([^)]+)\)/g)) {
  assert.equal(storageCall[1].split(',')[0].trim(), 'tokenStorageKey', '组件域只允许复用既有共享 Discord 身份 token');
}

for (const identityPath of [
  '/api/identity/me',
  '/api/identity/login-handoff/start',
  '/api/identity/login-handoff',
  '/api/identity/logout',
  '/api/identity/publisher-profile',
  '/auth/identity/discord/login',
]) {
  assert.ok(frontendSource.includes(identityPath), `缺少共享身份中性路由 ${identityPath}`);
}
assert.equal(frontendSource.includes('/api/workshop/'), false, '组件域不得调用旧星月作品域 API');
assert.equal(frontendSource.includes('/auth/discord/login'), false, '组件域不得调用旧作品域登录入口');
assert.match(frontendSource, /X-Publisher-Profile-Revision/);
assert.match(frontendSource, /profile\.displayName/);

for (const pathFragment of [
  '/api/component-workshop/packages',
  '/api/component-workshop/me/packages',
]) {
  assert.ok(frontendSource.includes(pathFragment), `缺少独立组件 API ${pathFragment}`);
}
assert.equal(frontendSource.includes('/api/workshop/packages'), false, '组件工坊不得调用旧创意工坊作品 API');
assert.equal(frontendSource.includes('workshop-package-contract'), false, '组件工坊不得导入旧作品包契约');
assert.match(frontendSource, /component-workshop-contract\.js/);
assert.match(frontendSource, /state\.minePackages\.find\(\(item\) => item\.id === candidate\.id\)/);
assert.doesNotMatch(
  frontendSource,
  /state\.minePackages\.find\(\(item\) => item\.id === candidate\.id && item\.reviewStatus !== 'withdrawn'\)/,
  '已撤回组件必须携带 revision 走 PUT 重新提交',
);

assert.match(frontendSource, /frame\.setAttribute\('sandbox', ''\)/);
assert.match(frontendSource, /default-src 'none'/);
assert.match(frontendSource, /form-action 'none'/);
assert.match(frontendSource, /const forbidden = new Set\(\['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED'/);
for (const forbidden of [
  'allow-scripts',
  'allow-same-origin',
  'TavernHelper',
  'executeSlashCommands',
  'window.parent',
  'postMessage(',
  'eval(',
  'new Function',
]) {
  assert.equal(frontendSource.includes(forbidden), false, `组件工坊包含禁止执行能力：${forbidden}`);
}

assert.match(contractSource, /const FORMAT = 'rpn-component-package';/);
for (const field of [
  'id', 'title', 'summary', 'version', 'authorName', 'tags', 'license', 'compatibility',
  'dependencies', 'conflicts', 'replaces', 'replacedBy', 'workflowStage', 'files',
]) {
  assert.match(contractSource, new RegExp(`'${field}'`), `组件包 v1 缺少 ${field}`);
}
assert.match(contractSource, /MAX_FILE_BYTES = 256 \* 1024/);
assert.match(contractSource, /MAX_TOTAL_FILE_BYTES = 1024 \* 1024/);
assert.match(contractSource, /duplicate-component-file-path/);
assert.match(contractSource, /component-file-media-type-mismatch/);

assert.match(cssSource, /^\[data-cws-root\]/);
assert.match(cssSource, /\.cws-shell \{/);
assert.doesNotMatch(cssSource, /@media\s*\(\s*max-width:/, '组件工坊按桌面端交付，不新增窄屏适配');
assert.match(cssSource, /@media \(min-width:\s*1800px\)[\s\S]*\.cws-card-list\s*\{[^}]*repeat\(3,/, '组件工坊必须在 2K 宽度增加卡片列');
assert.match(cssSource, /@media \(min-width:\s*2800px\)[\s\S]*\.cws-card-list\s*\{[^}]*repeat\(4,/, '组件工坊必须在超宽桌面增加第四列');

console.log('[ok] RPN independent component workshop frontend boundaries verified');
