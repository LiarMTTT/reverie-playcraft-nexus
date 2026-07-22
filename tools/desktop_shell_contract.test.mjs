import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');

const [
  packageJson,
  tauriConfig,
  releaseConfig,
  capability,
  cargo,
  buildScript,
  releaseBuildScript,
  rust,
  portal,
  cardStudio,
  chineseInstaller,
] = await Promise.all([
  read('package.json').then(JSON.parse),
  read('src-tauri/tauri.conf.json').then(JSON.parse),
  read('src-tauri/tauri.release.conf.json').then(JSON.parse),
  read('src-tauri/capabilities/rpn.json').then(JSON.parse),
  read('src-tauri/Cargo.toml'),
  read('src-tauri/build.rs'),
  read('tools/build_desktop_release.mjs'),
  read('src-tauri/src/main.rs'),
  read('portal/assets/portal.js'),
  read('portal/assets/card-studio.js'),
  read('src-tauri/windows/SimpChinese.nsh'),
]);

assert.equal(packageJson.version, packageJson.rpnBatch.version, '桌面版本必须沿用 package.json 单一真相源');
assert.equal(tauriConfig.version, '../package.json');
assert.deepEqual(tauriConfig.app.windows, [], 'RPN 与 ST 窗口必须由受控 Rust 构建器创建');
assert.equal(tauriConfig.bundle.targets.length, 1);
assert.equal(tauriConfig.bundle.targets[0], 'nsis');
assert.equal(tauriConfig.bundle.windows.nsis.installMode, 'currentUser');
assert.equal(tauriConfig.bundle.createUpdaterArtifacts, false, '未签名 RC 不得生成可发布更新产物');
assert.equal(releaseConfig.bundle.createUpdaterArtifacts, true);
assert.match(releaseConfig.plugins.updater.pubkey, /^[A-Za-z0-9+/=]{100,}$/u);
assert.deepEqual(releaseConfig.plugins.updater.endpoints, [
  'https://github.com/LiarMTTT/reverie-playcraft-nexus/releases/latest/download/latest.json',
]);
assert.match(tauriConfig.app.security.csp, /object-src 'none'/);
assert.match(tauriConfig.app.security.csp, /base-uri 'none'/);
assert.match(tauriConfig.app.security.csp, /frame-ancestors 'self'/);

assert.deepEqual(capability.windows, ['rpn'], 'ST 和 OAuth 窗口不得继承 RPN capability');
assert.ok(capability.permissions.every((permission) => !permission.includes('updater:')));
assert.match(cargo, /tauri-plugin-updater\s*=\s*\{[^}]*optional\s*=\s*true/u);
assert.match(buildScript, /TAURI_SIGNING_PRIVATE_KEY/);
assert.match(buildScript, /RPN_UPDATER_ENDPOINT must use HTTPS/);
assert.match(releaseBuildScript, /RPN_UPDATER_PUBLIC_KEY must match tauri\.release\.conf\.json/);
assert.match(releaseBuildScript, /RPN_UPDATER_ENDPOINT must match tauri\.release\.conf\.json/);
assert.match(rust, /join\(DATA_ROOT_NAME\)\.join\("data-v1"\)/);
assert.match(rust, /webview_profile\(app, "rpn"\)/);
assert.match(rust, /webview_profile\(app, "st"\)/);
assert.match(rust, /initialization_script\(REMOVE_TAURI_BRIDGE\)/);

function rustSection(startMarker, endMarker, label) {
  const start = rust.indexOf(startMarker);
  const end = rust.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `缺少 ${label} 源码边界`);
  return rust.slice(start, end);
}

const rpnWindowSource = rustSection('fn build_rpn_window(', '\nfn current_st_url(', 'RPN WebView 构建器');
assert.match(rpnWindowSource, /WebviewUrl::App\("index\.html"\.into\(\)\)/);
assert.match(rpnWindowSource, /\.inner_size\(1440\.0,\s*900\.0\)/);
assert.match(rpnWindowSource, /\.min_inner_size\(1024\.0,\s*700\.0\)/);
assert.match(rpnWindowSource, /\.data_directory\(rpn_profile\)/, 'RPN 必须固定使用独立 WebView 资料目录');

const stWindowSource = rustSection('fn build_st_window(', '\nfn copy_window_bounds(', 'ST WebView 构建器');
for (const contract of [
  /WebviewWindowBuilder::new\(app,\s*ST_LABEL,\s*WebviewUrl::External\(url\)\)/,
  /\.title\("SillyTavern · RPN 内置测试页"\)/,
  /\.inner_size\(1440\.0,\s*900\.0\)/,
  /\.min_inner_size\(1024\.0,\s*700\.0\)/,
  /\.visible\(false\)/,
  /\.data_directory\(webview_profile\(app, "st"\)\?\)/,
  /\.initialization_script\(REMOVE_TAURI_BRIDGE\)/,
  /\.on_navigation\(\|url\| normalize_st_url\(url\.as_str\(\)\)\.is_ok\(\)\)/,
  /\.on_new_window\(\|_, _\| NewWindowResponse::Deny\)/,
]) {
  assert.match(stWindowSource, contract, `ST WebView 安全契约缺失：${contract}`);
}

const copyBoundsSource = rustSection('fn copy_window_bounds(', '\nfn switch_page(', '窗口尺寸复制器');
assert.match(copyBoundsSource, /from\.outer_position\(\)[\s\S]*to\.set_position\(position\)/);
assert.match(copyBoundsSource, /from\.outer_size\(\)[\s\S]*to\.set_size\(size\)/);
assert.match(copyBoundsSource, /from\.is_maximized\(\)[\s\S]*if maximized[\s\S]*to\.maximize\(\)[\s\S]*to\.unmaximize\(\)/);
assert.doesNotMatch(copyBoundsSource, /set_maximized\(/, 'Tauri 2.11 WebviewWindow 不提供 set_maximized(bool)');

const switchPageSource = rustSection('fn switch_page(', '\nfn active_window(', 'RPN/ST 切页器');
assert.match(switchPageSource, /target == ST_LABEL[\s\S]*build_st_window\(app, &state\)\?[\s\S]*build_rpn_window\(app\)\?/);
assert.match(switchPageSource, /source_label = if target == ST_LABEL[\s\S]*RPN_LABEL[\s\S]*ST_LABEL/);
const copyIndex = switchPageSource.indexOf('copy_window_bounds(&source, &target_window)');
const hideIndex = switchPageSource.indexOf('.hide()');
const showIndex = switchPageSource.indexOf('.show()');
const focusIndex = switchPageSource.indexOf('.set_focus()');
assert.ok(
  copyIndex >= 0 && copyIndex < hideIndex && hideIndex < showIndex && showIndex < focusIndex,
  '切页必须先复制窗口尺寸、隐藏来源页，再显示并聚焦目标页',
);

assert.match(rust, /with_id\("page_rpn", "RPN 工作台"\)[\s\S]{0,120}\.accelerator\("Ctrl\+1"\)/);
assert.match(rust, /with_id\("page_st", "本机 ST 测试页"\)[\s\S]{0,120}\.accelerator\("Ctrl\+2"\)/);
assert.match(rust, /"page_rpn"\s*=>\s*\{[\s\S]{0,120}switch_page\(app, RPN_LABEL\)/);
assert.match(rust, /"page_st"\s*=>\s*\{[\s\S]{0,120}switch_page\(app, ST_LABEL\)/);
assert.match(rust, /fn desktop_open_rpn\([\s\S]{0,320}switch_page\(&app, RPN_LABEL\)\?/);
assert.match(rust, /fn desktop_open_st\([\s\S]{0,320}switch_page\(&app, ST_LABEL\)\?/);

const setStUrlSource = rustSection('fn desktop_set_st_url(', '\n#[tauri::command]\nasync fn desktop_check_update(', 'ST 地址更新命令');
assert.match(setStUrlSource, /let normalized = normalize_st_url\(&url\)\?/);
assert.match(setStUrlSource, /save_settings\(&state\.config_path, &settings\)\?/);
assert.match(setStUrlSource, /if let Some\(st\) = app\.get_webview_window\(ST_LABEL\)[\s\S]*st\.navigate\(normalized\)/);
assert.match(chineseInstaller, /清理桌面程序配置（工作区、历史与缓存保留）/);

const installUpdateSource = rustSection(
  'async fn desktop_install_update(',
  '\n#[tauri::command]\nfn desktop_rpn_flush_complete(',
  '签名更新安装命令',
);
assert.match(
  installUpdateSource,
  /if let Err\(error\) = window\.eval[\s\S]*state\.flush_waiter[\s\S]*pending\.token == token[\s\S]*waiter\.take\(\)[\s\S]*return Err\(format!\("无法请求工作区保存：\{error\}"\)\)/,
  '保存事件派发失败后必须释放等待器，允许用户直接重试',
);

const declaredCommands = new Set(
  [...rust.matchAll(/#\[tauri::command\]\s+(?:async\s+)?fn\s+(desktop_[a-z_]+)/gu)]
    .map((match) => match[1]),
);
const buildCommands = new Set(
  [...buildScript.matchAll(/"(desktop_[a-z_]+)"/gu)].map((match) => match[1]),
);
const invokedCommands = new Set([
  ...[...portal.matchAll(/(?:desktopInvoke|runDesktopCommand)\(\s*['"](desktop_[a-z_]+)['"]/gu)]
    .map((match) => match[1]),
  ...[...cardStudio.matchAll(/invoke\(\s*['"](desktop_[a-z_]+)['"]/gu)]
    .map((match) => match[1]),
]);

assert.ok(invokedCommands.size >= 8, '桌面前端命令抽取异常');
for (const command of invokedCommands) {
  assert.ok(declaredCommands.has(command), `前端命令 ${command} 未由 Rust 声明`);
  assert.ok(buildCommands.has(command), `前端命令 ${command} 未进入 Tauri ACL manifest`);
  assert.ok(
    capability.permissions.includes(`allow-${command.replaceAll('_', '-')}`),
    `前端命令 ${command} 未进入 RPN capability`,
  );
}

assert.match(cardStudio, /await queueWorkspaceContinuityFlush\(\)/);
assert.match(cardStudio, /invoke\('desktop_rpn_flush_complete', completion\)/);
assert.doesNotMatch(JSON.stringify(tauriConfig), /RPN_UPDATER_PUBLIC_KEY|TAURI_SIGNING_PRIVATE_KEY/);

console.log('[ok] desktop shell security, persistence, command, and updater contracts passed');
