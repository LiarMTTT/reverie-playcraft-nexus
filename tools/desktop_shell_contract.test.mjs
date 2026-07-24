import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFile(path.join(root, relativePath), 'utf8');
const readBinary = (relativePath) => fs.readFile(path.join(root, relativePath));

const [
  packageJson,
  tauriConfig,
  releaseConfig,
  capability,
  cargo,
  buildScript,
  releaseBuildScript,
  rust,
  aiTransport,
  mcpHost,
  portal,
  cardStudio,
  splash,
  chineseInstaller,
  favicon,
  windowsIcon,
] = await Promise.all([
  read('package.json').then(JSON.parse),
  read('src-tauri/tauri.conf.json').then(JSON.parse),
  read('src-tauri/tauri.release.conf.json').then(JSON.parse),
  read('src-tauri/capabilities/rpn.json').then(JSON.parse),
  read('src-tauri/Cargo.toml'),
  read('src-tauri/build.rs'),
  read('tools/build_desktop_release.mjs'),
  read('src-tauri/src/main.rs'),
  read('src-tauri/src/ai_transport.rs'),
  read('src-tauri/src/mcp_host.rs'),
  read('portal/assets/portal.js'),
  read('portal/assets/card-studio.js'),
  read('portal/assets/splash.html'),
  read('src-tauri/windows/SimpChinese.nsh'),
  read('portal/assets/favicon.svg'),
  readBinary('src-tauri/icons/icon.ico'),
]);

assert.equal(packageJson.version, packageJson.rpnBatch.version, '桌面版本必须沿用 package.json 单一真相源');
assert.equal(tauriConfig.version, '../package.json');
assert.deepEqual(tauriConfig.app.windows, [], 'RPN 与 ST 窗口必须由受控 Rust 构建器创建');
assert.equal(tauriConfig.bundle.targets.length, 1);
assert.equal(tauriConfig.bundle.targets[0], 'nsis');
assert.deepEqual(tauriConfig.bundle.icon, ['icons/icon.ico']);
assert.match(favicon, /aria-label="RPN"/u, '网页与桌面图标必须使用 RPN 品牌标识');
assert.doesNotMatch(favicon, /aria-label="(?:ST|ET)"/u, '不得恢复遗留 ST/ET 占位图标');
assert.deepEqual([...windowsIcon.subarray(0, 4)], [0, 0, 1, 0], 'Windows 图标必须是有效 ICO');
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
assert.match(buildScript, /cargo:rerun-if-changed=icons\/icon\.ico/, 'Windows 图标变化必须触发桌面资源重建');
assert.match(buildScript, /cargo:rerun-if-changed=\.\.\/package\.json/, '版本真相源变化必须触发 Windows 文件资源重建');
assert.match(buildScript, /RPN_UPDATER_ENDPOINT must use HTTPS/);
assert.match(releaseBuildScript, /RPN_UPDATER_PUBLIC_KEY must match tauri\.release\.conf\.json/);
assert.match(releaseBuildScript, /RPN_UPDATER_ENDPOINT must match tauri\.release\.conf\.json/);
assert.match(releaseBuildScript, /CI:\s*process\.env\.CI\s*\|\|\s*'true'/, '正式构建必须禁用交互式签名等待，并允许既有空密码密钥快速失败或完成');
assert.match(releaseBuildScript, /CARGO_ENCODED_RUSTFLAGS/, '正式构建必须使用可承载空格路径的 Rust 参数通道');
assert.match(releaseBuildScript, /--remap-path-prefix=/, '正式构建不得把本机源码与工具链路径写入公开二进制');
assert.match(releaseBuildScript, /release-assets/, '正式构建必须把 Release 白名单附件集中到独立生成目录');
assert.match(releaseBuildScript, /latest\.json/, '正式构建必须生成与 updater 附件一致的更新清单');
assert.match(rust, /join\(DATA_ROOT_NAME\)\.join\("data-v1"\)/);
assert.match(rust, /webview_profile\(app, "rpn"\)/);
assert.match(rust, /webview_profile\(app, "st"\)/);
assert.match(rust, /initialization_script\(REMOVE_TAURI_BRIDGE\)/);
assert.match(
  rust,
  /WebviewWindowBuilder::new\(\s*app,\s*RPN_LABEL,\s*WebviewUrl::App\("assets\/splash\.html"\.into\(\)\),?\s*\)/u,
  'RPN 必须由正式主窗口直接打开启动页',
);
for (const forbiddenStartupSymbol of [
  'SPLASH_LABEL',
  'STARTUP_REVEALED',
  'build_splash_window',
]) {
  assert.doesNotMatch(
    rust,
    new RegExp(forbiddenStartupSymbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    `启动流程不得保留双 WebView 协调逻辑：${forbiddenStartupSymbol}`,
  );
}
assert.match(rust, /\.visible\(false\)/u, '主窗口必须先隐藏，避免 WebView 初始化白帧暴露给用户');
assert.match(rust, /\.background_color\(Color\(2,\s*6,\s*23,\s*255\)\)/u, '原生窗口与启动页必须使用同一深色背景');
assert.match(
  rust,
  /\.on_page_load\(\|window,\s*payload\|[\s\S]*PageLoadEvent::Finished[\s\S]*assets\/splash\.html[\s\S]*window\.show\(\)[\s\S]*window\.set_focus\(\)/u,
  '同一主窗口必须在启动页完成后才显示并聚焦',
);
assert.match(
  splash,
  /window\.setTimeout\(\(\) => \{[\s\S]*window\.location\.replace\('\.\.\/index\.html'\);[\s\S]*\}, 720\);/u,
  '启动页必须在同一 RPN 窗口内切换到主页面',
);
assert.match(splash, /<img src="\.\/favicon\.svg"/u, '启动窗必须复用正式 RPN Logo');
assert.match(splash, /aria-label="正在启动 Reverie Playcraft Nexus"/u);
assert.match(rust, /mod ai_transport;/);
assert.match(rust, /app\.manage\(AiTransportState::new\(\)/);

for (const command of ['desktop_ai_request', 'desktop_ai_cancel']) {
  assert.match(rust, new RegExp(`\\b${command}\\b`), `AI 原生传输命令 ${command} 未接入 invoke handler`);
  assert.match(buildScript, new RegExp(`"${command}"`), `AI 原生传输命令 ${command} 未进入 Tauri ACL manifest`);
  assert.ok(
    capability.permissions.includes(`allow-${command.replaceAll('_', '-')}`),
    `AI 原生传输命令 ${command} 未进入 RPN capability`,
  );
}
assert.match(aiTransport, /window\.label\(\) != RPN_WINDOW_LABEL/);
assert.match(aiTransport, /window\s*\.url\(\)/, 'AI 原生传输必须同时校验 RPN 当前页面来源');
assert.match(aiTransport, /redirect\(Policy::none\(\)\)/, 'AI 原生传输不得自动跟随重定向');
const aiRequestFields = aiTransport.match(/struct AiTransportRequest \{(?<fields>[\s\S]*?)\n\}/u)?.groups?.fields || '';
assert.match(aiRequestFields, /\bbase_url:\s*String\b/u);
assert.match(aiRequestFields, /\boperation:\s*AiOperation\b/u);
assert.match(aiRequestFields, /\bmodel:\s*Option<String>/u);
assert.match(aiRequestFields, /\bnetwork_mode:\s*NetworkMode\b/u);
assert.match(aiRequestFields, /\bmax_response_bytes:\s*usize\b/u);
assert.doesNotMatch(aiRequestFields, /\burl:|\bmethod:/u, 'AI 原生传输不得退化为通用 fetch 接口');
for (const operation of [
  'Models',
  'ChatCompletions',
  'AnthropicModels',
  'AnthropicMessages',
  'GeminiModels',
  'GeminiGenerateContent',
  'OllamaTags',
  'OllamaChat',
]) {
  assert.match(aiTransport, new RegExp(`\\b${operation}\\b`), `AI 原生操作 ${operation} 未进入受限枚举`);
}
for (const endpoint of [
  '/models',
  '/chat/completions',
  '/messages',
  '/models/{model}:generateContent',
  '/api/tags',
  '/api/chat',
]) {
  assert.ok(aiTransport.includes(`"${endpoint}"`), `AI 原生 endpoint ${endpoint} 未固定在 Rust 侧`);
}
assert.match(aiTransport, /enum NetworkMode[\s\S]*\bDirect\b[\s\S]*\bSystemProxy\b/u);
assert.match(aiTransport, /\.dns_resolver\(GlobalDnsResolver\)/u, '公网域名必须在连接层过滤 DNS 结果');
assert.match(aiTransport, /filter\(\|address\| is_global_ip\(address\.ip\(\)\)\)/u);
const directClientSource = aiTransport.slice(
  aiTransport.indexOf('let direct_public_client ='),
  aiTransport.indexOf('let system_proxy_client ='),
);
const systemProxyClientSource = aiTransport.slice(
  aiTransport.indexOf('let system_proxy_client ='),
  aiTransport.indexOf('let loopback_client ='),
);
const loopbackClientSource = aiTransport.slice(
  aiTransport.indexOf('let loopback_client ='),
  aiTransport.indexOf('Ok(Self {'),
);
assert.match(directClientSource, /\.no_proxy\(\)[\s\S]*\.dns_resolver\(GlobalDnsResolver\)/u, 'direct 公网请求必须绕过代理并过滤 DNS');
assert.doesNotMatch(systemProxyClientSource, /\.no_proxy\(\)|\.dns_resolver\(/u, 'systemProxy 必须保留系统代理与默认解析器这一受信边界');
assert.match(loopbackClientSource, /\.no_proxy\(\)[\s\S]*\.resolve_to_addrs\(/u, 'loopback AI 请求必须绕过系统代理并固定 localhost');
assert.match(aiTransport, /TargetClass::Loopback => self\.loopback_client\.clone\(\)/u);
assert.match(aiTransport, /TargetClass::Public if network_mode == NetworkMode::SystemProxy[\s\S]*self\.system_proxy_client\.clone\(\)/u);
assert.match(aiTransport, /TargetClass::Public => self\.direct_public_client\.clone\(\)/u);
assert.equal((aiTransport.match(/\.send\(\)\.await/gu) || []).length, 1, 'AI 原生请求不得在 POST 失败后自动改通道重试');
assert.match(aiTransport, /MAX_REQUEST_BODY_BYTES/);
assert.match(aiTransport, /MAX_RESPONSE_BODY_BYTES/);
assert.match(aiTransport, /length > request\.max_response_bytes as u64/u);
assert.match(aiTransport, /saturating_add\(chunk\.len\(\)\) > request\.max_response_bytes/u);
assert.match(aiTransport, /run_until_cancelled/);
assert.match(aiTransport, /const PRE_CANCEL_TTL: Duration = Duration::from_secs\(5\)/u);
assert.match(aiTransport, /const MAX_PRE_CANCELLED_REQUESTS: usize = 64/u);
assert.match(aiTransport, /pub\(crate\) fn cancel_all\(&self\)/u,
  '桌面关闭必须能一次取消全部活动 AI 请求');
assert.match(aiTransport, /pre_cancelled\.remove\(request_id\)[\s\S]*token\.cancel\(\)/u,
  'AI cancel-before-register must be consumed before any request can run');
assert.match(aiTransport, /if token\.is_cancelled\(\)[\s\S]*let client = state\.client_for/u,
  'a pre-cancelled AI request must not reach the HTTP client');
assert.doesNotMatch(aiTransport, /(?:std::process::Command|Command::new|cmd\.exe|powershell)/i, 'AI 原生传输不得开放 Shell');

assert.match(rust, /mod mcp_host;/);
assert.match(rust, /app\.manage\(McpHostState::new\(\)\)/);
assert.match(rust, /\.plugin\(tauri_plugin_dialog::init\(\)\)/, 'MCP 原生审批必须初始化官方 Tauri dialog plugin');
assert.match(cargo, /tauri-plugin-dialog\s*=\s*"=2\.6\.0"/u, 'MCP 原生审批 plugin 必须固定兼容版本');
for (const command of ['desktop_mcp_prepare', 'desktop_mcp_execute', 'desktop_mcp_cancel']) {
  assert.match(rust, new RegExp(`\\b${command}\\b`), `MCP 原生命令 ${command} 未接入 invoke handler`);
  assert.match(buildScript, new RegExp(`"${command}"`), `MCP 原生命令 ${command} 未进入 Tauri ACL manifest`);
  assert.ok(
    capability.permissions.includes(`allow-${command.replaceAll('_', '-')}`),
    `MCP 原生命令 ${command} 未进入 RPN capability`,
  );
  assert.match(
    mcpHost,
    new RegExp(`fn ${command}\\([\\s\\S]{0,320}ensure_mcp_origin\\(&window\\)\\?`),
    `MCP 原生命令 ${command} 未复用 bundled RPN label + origin 校验`,
  );
}
assert.match(mcpHost, /use crate::ai_transport::ensure_bundled_rpn;/);
const mcpRequestFields = mcpHost.match(/struct McpPrepareRequest \{(?<fields>[\s\S]*?)\n\}/u)?.groups?.fields || '';
for (const field of ['executable', 'args', 'cwd', 'env', 'operation']) {
  assert.match(mcpRequestFields, new RegExp(`\\b${field}:`), `MCP prepare 缺少 ${field}`);
}
assert.doesNotMatch(mcpRequestFields, /\bcommand:/u, 'MCP stdio 不得接受 command string');
assert.match(mcpHost, /const INTENT_TTL: Duration = Duration::from_secs\(5 \* 60\)/);
assert.match(mcpHost, /const MAX_INTENTS: usize = 16/);
assert.match(mcpHost, /const MAX_NATIVE_APPROVALS: usize = 1/);
assert.match(mcpHost, /const MAX_EXECUTIONS: usize = 2/);
for (const lifecycle of ['Prepared', 'AwaitingApproval', 'Running', 'Finished', 'Cancelled']) {
  assert.match(mcpHost, new RegExp(`\\b${lifecycle}\\b`), `MCP intent 状态机缺少 ${lifecycle}`);
}
assert.match(mcpHost, /getrandom::fill\(&mut random\)/, 'MCP intentId 必须使用 OS CSPRNG');
assert.match(mcpHost, /let mut random = \[0u8; 16\]/, 'MCP intentId 必须至少 128-bit');
assert.match(mcpHost, /source:\s*IntentSource/u, 'MCP intent 必须绑定创建来源');
assert.match(mcpHost, /request_native_approval\(approval_window,\s*summary\)/u, '生产 execute 必须调用 Rust 原生审批');
assert.match(mcpHost, /request_approval_with[\s\S]*spawn_blocking\(decision\)/u, '原生审批不得阻塞 async runtime');
assert.match(
  mcpHost,
  /MessageDialogButtons::YesNoCancelCustom\([\s\S]*SAFE_REVIEW_BUTTON[\s\S]*APPROVE_BUTTON[\s\S]*CANCEL_BUTTON/u,
  'MCP 原生审批必须把安全返回动作放在批准动作之前，并保留显式取消',
);
assert.match(mcpHost, /\.blocking_show_with_result\(\)/u);
assert.match(
  mcpHost,
  /matches!\(result,\s*MessageDialogResult::Custom\(label\)\s*if\s*label\s*==\s*APPROVE_BUTTON\)/u,
  '只有原生对话框明确返回“批准并执行”才可授权',
);
assert.doesNotMatch(mcpRequestFields, /\bapproved:|\bapproval:/u, 'renderer 不得提交批准决定');
assert.match(mcpHost, /dunce::canonicalize/u);
assert.match(mcpHost, /FileIdentityHandle::from_path/u);
assert.match(mcpHost, /reject_nonlocal_path_input/u);
assert.match(
  mcpHost,
  /revalidate_executable\([\s\S]*&intent\.server\.executable_content_sha256/u,
  'MCP executable 必须在 spawn 前复验身份与内容 SHA-256',
);
assert.match(mcpHost, /revalidate_path_identity\(&intent\.server\.cwd,\s*false/u);
assert.match(mcpHost, /Command::new\(&intent\.server\.executable\.canonical\)/);
assert.match(mcpHost, /\.args\(&intent\.server\.args\)/);
assert.match(mcpHost, /command\.env_clear\(\)/u, 'MCP 子进程必须清空父进程环境');
for (const envName of ['PATH', 'PATHEXT', 'COMSPEC', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME', 'RUBYOPT', 'PERL5OPT', 'LD_PRELOAD']) {
  assert.match(mcpHost, new RegExp(`"${envName}"`), `MCP host 未拒绝危险环境变量 ${envName}`);
}
assert.match(mcpHost, /\.kill_on_drop\(true\)/);
assert.match(mcpHost, /child\.start_kill\(\)/u);
assert.match(mcpHost, /timeout\(CHILD_WAIT_TIMEOUT,\s*child\.wait\(\)\)/u);
assert.match(mcpHost, /pub\(crate\) fn cancel_all\(&self\)/u,
  '桌面关闭必须能一次取消全部待审批与运行中的 MCP intent');
for (const windowsProcessTreeContract of [
  'CreateJobObjectW',
  'SetInformationJobObject',
  'JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE',
  'AssignProcessToJobObject',
  'TerminateJobObject',
]) {
  assert.match(
    mcpHost,
    new RegExp(`\\b${windowsProcessTreeContract}\\b`, 'u'),
    `Windows MCP 进程树托管缺少 ${windowsProcessTreeContract}`,
  );
}
for (const windowsFeature of [
  'Win32_Foundation',
  'Win32_Security',
  'Win32_System_JobObjects',
  'Win32_System_Threading',
]) {
  assert.match(cargo, new RegExp(`"${windowsFeature}"`, 'u'), `windows-sys 缺少 ${windowsFeature} feature`);
}
assert.match(mcpHost, /cancel\.cancelled\(\)/u);
assert.match(mcpHost, /timeout\(EXECUTION_TIMEOUT,\s*session\)/u);
for (const method of ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']) {
  assert.ok(mcpHost.includes(`"${method}"`), `MCP stdio 握手缺少 ${method}`);
}
assert.match(mcpHost, /const MCP_PROTOCOL_VERSION: &str = "2025-11-25"/u);
for (const protocol of ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']) {
  assert.match(mcpHost, new RegExp(`"${protocol}"`), `MCP host 缺少受支持协议 ${protocol}`);
}
assert.match(mcpHost, /MAX_STDOUT_LINE_BYTES/);
assert.match(mcpHost, /MAX_STDOUT_TOTAL_BYTES/);
assert.match(mcpHost, /MAX_STDERR_BYTES/);
assert.match(mcpHost, /AbortOnDropHandle::new\(tokio::spawn\(drain_stderr\(stderr\)\)\)/u,
  'dropping MCP execution must abort its stderr monitor');
assert.match(mcpHost, /stderr_task\.abort\(\)[\s\S]*stderr_task\.await/u, 'MCP stderr 任务不得 detach');
assert.match(mcpHost, /annotations_trusted:\s*false/u, 'MCP tool annotations 必须显式标记为不可信');
assert.match(mcpHost, /approval_receipt:\s*ApprovalReceipt/u);
assert.match(mcpHost, /Sha256::digest/u);
assert.match(mcpHost, /env_names:[\s\S]*operation:[\s\S]*tool:[\s\S]*arguments:/u, 'MCP immutable digest 必须覆盖确认字段');
assert.match(mcpHost, /FORBIDDEN_EXECUTABLES/);
for (const shell of ['cmd', 'powershell', 'pwsh', 'bash', 'sh', 'wsl']) {
  assert.match(mcpHost, new RegExp(`"${shell}"`), `MCP host 未拒绝 Shell：${shell}`);
}
assert.doesNotMatch(mcpHost, /(?:\bprintln!|\beprintln!|\bdbg!|\btracing::|\blog::)/u, 'MCP 进程输出不得写入日志');

function rustSection(startMarker, endMarker, label) {
  const start = rust.indexOf(startMarker);
  const end = rust.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `缺少 ${label} 源码边界`);
  return rust.slice(start, end);
}

const rpnWindowSource = rustSection('fn build_rpn_window(', '\nfn current_st_url(', 'RPN WebView 构建器');
assert.match(rpnWindowSource, /WebviewUrl::App\("assets\/splash\.html"\.into\(\)\)/);
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
const shutdownSource = rustSection('fn begin_shutdown(', '\nstruct BusyGuard(', '桌面关闭协调器');
assert.match(shutdownSource, /state::<AiTransportState>\(\)/u);
assert.match(shutdownSource, /state::<McpHostState>\(\)/u);
assert.match(shutdownSource, /shutdown_started\.swap\(true,\s*Ordering::AcqRel\)/u,
  '重复关闭事件只能启动一次清理流程');
assert.match(shutdownSource, /ai\.cancel_all\(\)[\s\S]*mcp\.cancel_all\(\)/u,
  '桌面关闭入口必须先取消 AI 与 MCP 活动');
assert.equal((shutdownSource.match(/std::thread::spawn/gu) || []).length, 2,
  '正常退出与强退看门狗必须位于独立线程，避免 app.exit 阻塞兜底');
assert.match(shutdownSource, /ready_after_cleanup\.store\(true,\s*Ordering::Release\)[\s\S]*app\.exit\(0\)/u);
assert.match(shutdownSource, /FORCED_EXIT_GRACE[\s\S]*std::process::exit\(0\)/u,
  '正常退出失效时必须有宿主进程终止兜底');
assert.match(
  rust,
  /WindowEvent::CloseRequested\s*\{\s*api,\s*\.\.\s*\}[\s\S]*api\.prevent_close\(\)[\s\S]*begin_shutdown/u,
  '关闭窗口必须拦截默认销毁并进入有界清理流程',
);

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
  [...`${rust}\n${aiTransport}\n${mcpHost}`.matchAll(/#\[tauri::command\]\s+(?:pub\(crate\)\s+)?(?:async\s+)?fn\s+(desktop_[a-z_]+)/gu)]
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
