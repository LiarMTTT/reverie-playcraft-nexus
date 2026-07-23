#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_transport;
mod mcp_host;

use ai_transport::{desktop_ai_cancel, desktop_ai_request, AiTransportState};
use mcp_host::{desktop_mcp_cancel, desktop_mcp_execute, desktop_mcp_prepare, McpHostState};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::SyncSender,
        Arc, Mutex, MutexGuard,
    },
};
use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    webview::{Color, NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, State, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[cfg(feature = "release-updater")]
use std::{
    sync::mpsc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(feature = "release-updater")]
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

const RPN_LABEL: &str = "rpn";
const ST_LABEL: &str = "st";
const DEFAULT_ST_URL: &str = "http://127.0.0.1:8000/";
const DATA_ROOT_NAME: &str = "ReveriePlaycraftNexus";
const REMOVE_TAURI_BRIDGE: &str = r#"
try { delete globalThis.__TAURI__; } catch (_) { globalThis.__TAURI__ = undefined; }
try { delete globalThis.__TAURI_INTERNALS__; } catch (_) { globalThis.__TAURI_INTERNALS__ = undefined; }
"#;

static OAUTH_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static FLUSH_TOKEN_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    st_url: String,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            st_url: DEFAULT_ST_URL.to_string(),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopUpdateStatus {
    enabled: bool,
    phase: String,
    current_version: String,
    version: Option<String>,
    notes: Option<String>,
    downloaded: bool,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSnapshot {
    desktop: bool,
    app_version: String,
    st_url: String,
    data_root: String,
    update: DesktopUpdateStatus,
}

#[derive(Debug)]
struct FlushAck {
    ok: bool,
    error: String,
    project_id: String,
    revision: u64,
}

struct FlushWaiter {
    token: String,
    sender: SyncSender<FlushAck>,
}

#[cfg(feature = "release-updater")]
struct PendingUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

struct DesktopState {
    settings: Mutex<DesktopSettings>,
    config_path: PathBuf,
    update_message: Mutex<String>,
    update_busy: Arc<AtomicBool>,
    flush_waiter: Mutex<Option<FlushWaiter>>,
    #[cfg(feature = "release-updater")]
    pending_update: Mutex<Option<PendingUpdate>>,
}

impl DesktopState {
    fn new(settings: DesktopSettings, config_path: PathBuf) -> Self {
        Self {
            settings: Mutex::new(settings),
            config_path,
            update_message: Mutex::new(String::new()),
            update_busy: Arc::new(AtomicBool::new(false)),
            flush_waiter: Mutex::new(None),
            #[cfg(feature = "release-updater")]
            pending_update: Mutex::new(None),
        }
    }
}

struct BusyGuard(Arc<AtomicBool>);

impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn lock<'a, T>(mutex: &'a Mutex<T>, name: &str) -> Result<MutexGuard<'a, T>, String> {
    mutex
        .lock()
        .map_err(|_| format!("{name} state is unavailable"))
}

fn begin_update_operation(state: &DesktopState) -> Result<BusyGuard, String> {
    state
        .update_busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "已有桌面更新操作正在进行".to_string())?;
    Ok(BusyGuard(state.update_busy.clone()))
}

fn ensure_rpn(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == RPN_LABEL {
        Ok(())
    } else {
        Err("此桌面命令只允许由内置 RPN 页面调用".to_string())
    }
}

fn persistent_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .local_data_dir()
        .map(|path| path.join(DATA_ROOT_NAME).join("data-v1"))
        .map_err(|error| format!("无法解析永久数据目录：{error}"))
}

fn webview_profile(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let path = persistent_data_root(app)?.join("webview").join(name);
    fs::create_dir_all(&path)
        .map_err(|error| format!("无法创建 {name} WebView 数据目录：{error}"))?;
    Ok(path)
}

fn normalize_st_url(value: &str) -> Result<Url, String> {
    let mut url = Url::parse(value.trim()).map_err(|_| "ST 地址不是有效 URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("ST 地址只允许 http 或 https".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("ST 地址不能包含用户名或密码".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "ST 地址缺少主机名".to_string())?;
    if !matches!(host, "localhost" | "127.0.0.1" | "::1") {
        return Err("ST 顶层页面只允许 localhost、127.0.0.1 或 ::1".to_string());
    }
    if host == "localhost" {
        url.set_host(Some("127.0.0.1"))
            .map_err(|_| "无法规范化 ST 地址".to_string())?;
    }
    Ok(url)
}

fn load_settings(path: &Path) -> DesktopSettings {
    let fallback = DesktopSettings::default();
    let Ok(source) = fs::read_to_string(path) else {
        return fallback;
    };
    let Ok(mut settings) = serde_json::from_str::<DesktopSettings>(&source) else {
        return fallback;
    };
    let Ok(url) = normalize_st_url(&settings.st_url) else {
        return fallback;
    };
    settings.st_url = url.to_string();
    settings
}

fn save_settings(path: &Path, settings: &DesktopSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建桌面配置目录：{error}"))?;
    }
    let bytes = serde_json::to_vec_pretty(settings)
        .map_err(|error| format!("无法序列化桌面配置：{error}"))?;
    fs::write(path, bytes).map_err(|error| format!("无法保存桌面配置：{error}"))
}

fn is_rpn_navigation(url: &Url) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    matches!(url.scheme(), "tauri" | "http" | "https")
        && matches!(url.host_str(), Some("localhost" | "tauri.localhost"))
}

fn is_oauth_navigation(url: &Url) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    if url.scheme() != "https" {
        return false;
    }
    matches!(url.host_str(), Some("43-132-171-157.sslip.io"))
        || url.host_str().is_some_and(|host| {
            host == "discord.com"
                || host.ends_with(".discord.com")
                || host == "discordapp.com"
                || host.ends_with(".discordapp.com")
        })
}

fn build_rpn_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(RPN_LABEL) {
        return Ok(window);
    }

    let app_for_popup = app.clone();
    let rpn_profile = webview_profile(app, "rpn")?;
    let popup_profile = rpn_profile.clone();
    WebviewWindowBuilder::new(app, RPN_LABEL, WebviewUrl::App("assets/splash.html".into()))
        .title(format!(
            "Reverie Playcraft Nexus · {}",
            app.package_info().version
        ))
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 700.0)
        .visible(false)
        .background_color(Color(2, 6, 23, 255))
        .on_page_load(|window, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished)
                && payload.url().path().ends_with("/assets/splash.html")
            {
                let _ = window.show();
                let _ = window.set_focus();
            }
        })
        .data_directory(rpn_profile)
        .on_navigation(is_rpn_navigation)
        .on_new_window(move |url, features| {
            if !is_oauth_navigation(&url) {
                return NewWindowResponse::Deny;
            }
            let sequence = OAUTH_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let label = format!("oauth-{sequence}");
            let initial_url = Url::parse("about:blank").expect("about:blank must be a valid URL");
            let builder =
                WebviewWindowBuilder::new(&app_for_popup, label, WebviewUrl::External(initial_url))
                    .title("RPN · 安全登录")
                    .window_features(features)
                    .data_directory(popup_profile.clone())
                    .initialization_script(REMOVE_TAURI_BRIDGE)
                    .on_navigation(is_oauth_navigation)
                    .on_new_window(|_, _| NewWindowResponse::Deny)
                    .on_document_title_changed(|window, title| {
                        let _ = window.set_title(&format!("RPN 登录 · {title}"));
                    });
            match builder.build() {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        })
        .build()
        .map_err(|error| format!("无法创建 RPN 窗口：{error}"))
}

fn current_st_url(state: &DesktopState) -> Result<Url, String> {
    let settings = lock(&state.settings, "desktop settings")?;
    normalize_st_url(&settings.st_url)
}

fn build_st_window(app: &AppHandle, state: &DesktopState) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(ST_LABEL) {
        return Ok(window);
    }
    let url = current_st_url(state)?;
    WebviewWindowBuilder::new(app, ST_LABEL, WebviewUrl::External(url))
        .title("SillyTavern · RPN 内置测试页")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 700.0)
        .visible(false)
        .data_directory(webview_profile(app, "st")?)
        .initialization_script(REMOVE_TAURI_BRIDGE)
        .on_navigation(|url| normalize_st_url(url.as_str()).is_ok())
        .on_new_window(|_, _| NewWindowResponse::Deny)
        .build()
        .map_err(|error| format!("无法创建 ST 窗口：{error}"))
}

fn copy_window_bounds(from: &WebviewWindow, to: &WebviewWindow) {
    if let Ok(position) = from.outer_position() {
        let _ = to.set_position(position);
    }
    if let Ok(size) = from.outer_size() {
        let _ = to.set_size(size);
    }
    if let Ok(maximized) = from.is_maximized() {
        let _ = if maximized {
            to.maximize()
        } else {
            to.unmaximize()
        };
    }
}

fn switch_page(app: &AppHandle, target: &str) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let target_window = if target == ST_LABEL {
        build_st_window(app, &state)?
    } else {
        build_rpn_window(app)?
    };
    let source_label = if target == ST_LABEL {
        RPN_LABEL
    } else {
        ST_LABEL
    };
    if let Some(source) = app.get_webview_window(source_label) {
        copy_window_bounds(&source, &target_window);
        source
            .hide()
            .map_err(|error| format!("无法隐藏 {source_label} 页面：{error}"))?;
    }
    target_window
        .show()
        .map_err(|error| format!("无法显示 {target} 页面：{error}"))?;
    target_window
        .set_focus()
        .map_err(|error| format!("无法聚焦 {target} 页面：{error}"))
}

fn active_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(st) = app.get_webview_window(ST_LABEL) {
        if st.is_visible().unwrap_or(false) {
            return Ok(st);
        }
    }
    app.get_webview_window(RPN_LABEL)
        .ok_or_else(|| "RPN 窗口尚未创建".to_string())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let rpn = MenuItemBuilder::with_id("page_rpn", "RPN 工作台")
        .accelerator("Ctrl+1")
        .build(app)?;
    let st = MenuItemBuilder::with_id("page_st", "本机 ST 测试页")
        .accelerator("Ctrl+2")
        .build(app)?;
    let page_menu = SubmenuBuilder::new(app, "页面")
        .items(&[&rpn, &st])
        .build()?;

    let reload = MenuItemBuilder::with_id("reload_active", "重新加载当前页")
        .accelerator("Ctrl+R")
        .build(app)?;
    let devtools = MenuItemBuilder::with_id("open_devtools", "当前页开发者工具")
        .accelerator("F12")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(app, "视图")
        .items(&[&reload, &devtools])
        .build()?;

    let settings = MenuItemBuilder::with_id("desktop_settings", "ST 地址与版本更新").build(app)?;
    let desktop_menu = SubmenuBuilder::new(app, "桌面程序")
        .item(&settings)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&page_menu, &view_menu, &desktop_menu])
        .build()
}

fn open_desktop_settings(app: &AppHandle) -> Result<(), String> {
    switch_page(app, RPN_LABEL)?;
    let window = app
        .get_webview_window(RPN_LABEL)
        .ok_or_else(|| "RPN 窗口尚未创建".to_string())?;
    window
        .eval("window.dispatchEvent(new CustomEvent('rpn:desktop-open-settings')); ")
        .map_err(|error| format!("无法打开桌面设置：{error}"))
}

fn set_update_message(state: &DesktopState, message: impl Into<String>) {
    if let Ok(mut target) = state.update_message.lock() {
        *target = message.into();
    }
}

fn desktop_snapshot(app: &AppHandle, state: &DesktopState) -> Result<DesktopSnapshot, String> {
    let settings = lock(&state.settings, "desktop settings")?.clone();
    let message = lock(&state.update_message, "desktop update message")?.clone();
    let current_version = app.package_info().version.to_string();

    #[cfg(not(feature = "release-updater"))]
    let update = DesktopUpdateStatus {
        enabled: false,
        phase: "unconfigured".to_string(),
        current_version: current_version.clone(),
        version: None,
        notes: None,
        downloaded: false,
        message: if message.is_empty() {
            "当前为未签名 RC；正式版注入签名公钥和 HTTPS 更新源后启用在线更新。".to_string()
        } else {
            message
        },
    };

    #[cfg(feature = "release-updater")]
    let update = {
        let pending = lock(&state.pending_update, "pending update")?;
        if let Some(pending) = pending.as_ref() {
            let downloaded = pending.bytes.is_some();
            DesktopUpdateStatus {
                enabled: true,
                phase: if downloaded { "ready" } else { "available" }.to_string(),
                current_version: current_version.clone(),
                version: Some(pending.update.version.clone()),
                notes: pending.update.body.clone(),
                downloaded,
                message: if message.is_empty() {
                    if downloaded {
                        "更新包已完成签名校验，可以安装并重启。"
                    } else {
                        "发现新版本，可以下载。"
                    }
                    .to_string()
                } else {
                    message
                },
            }
        } else {
            DesktopUpdateStatus {
                enabled: true,
                phase: "idle".to_string(),
                current_version: current_version.clone(),
                version: None,
                notes: None,
                downloaded: false,
                message,
            }
        }
    };

    Ok(DesktopSnapshot {
        desktop: true,
        app_version: current_version,
        st_url: settings.st_url,
        data_root: persistent_data_root(app)?.to_string_lossy().into_owned(),
        update,
    })
}

fn dispatch_snapshot(app: &AppHandle, state: &DesktopState) {
    let Some(window) = app.get_webview_window(RPN_LABEL) else {
        return;
    };
    let Ok(snapshot) = desktop_snapshot(app, state) else {
        return;
    };
    let Ok(detail) = serde_json::to_string(&snapshot) else {
        return;
    };
    let _ = window.eval(format!(
        "window.dispatchEvent(new CustomEvent('rpn:desktop-state', {{ detail: {detail} }}));"
    ));
}

#[cfg(feature = "release-updater")]
fn configured_updater(app: &AppHandle) -> Result<Updater, String> {
    let endpoint = Url::parse(env!("RPN_UPDATER_ENDPOINT"))
        .map_err(|error| format!("更新端点无效：{error}"))?;
    app.updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| format!("无法配置更新端点：{error}"))?
        .build()
        .map_err(|error| format!("无法初始化更新器：{error}"))
}

#[tauri::command]
fn desktop_get_state(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<DesktopSnapshot, String> {
    ensure_rpn(&window)?;
    desktop_snapshot(&app, &state)
}

#[tauri::command]
fn desktop_open_rpn(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<DesktopSnapshot, String> {
    ensure_rpn(&window)?;
    switch_page(&app, RPN_LABEL)?;
    desktop_snapshot(&app, &state)
}

#[tauri::command]
fn desktop_open_st(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<DesktopSnapshot, String> {
    ensure_rpn(&window)?;
    switch_page(&app, ST_LABEL)?;
    desktop_snapshot(&app, &state)
}

#[tauri::command]
fn desktop_reload_active(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_rpn(&window)?;
    active_window(&app)?
        .reload()
        .map_err(|error| format!("无法重新加载当前页：{error}"))
}

#[tauri::command]
fn desktop_open_devtools(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_rpn(&window)?;
    active_window(&app)?.open_devtools();
    Ok(())
}

#[tauri::command]
fn desktop_set_st_url(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    url: String,
) -> Result<DesktopSnapshot, String> {
    ensure_rpn(&window)?;
    let normalized = normalize_st_url(&url)?;
    {
        let mut settings = lock(&state.settings, "desktop settings")?;
        settings.st_url = normalized.to_string();
        save_settings(&state.config_path, &settings)?;
    }
    if let Some(st) = app.get_webview_window(ST_LABEL) {
        st.navigate(normalized)
            .map_err(|error| format!("无法导航 ST 页面：{error}"))?;
    }
    desktop_snapshot(&app, &state)
}

#[tauri::command]
async fn desktop_check_update(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<DesktopSnapshot, String> {
    ensure_rpn(&window)?;

    #[cfg(not(feature = "release-updater"))]
    {
        set_update_message(&state, "此 RC 未配置签名更新源，不能联网检查更新。");
        return desktop_snapshot(&app, &state);
    }

    #[cfg(feature = "release-updater")]
    {
        let _busy = begin_update_operation(&state)?;
        set_update_message(&state, "正在检查更新…");
        let result = configured_updater(&app)?.check().await;
        match result {
            Ok(Some(update)) => {
                let version = update.version.clone();
                *lock(&state.pending_update, "pending update")? = Some(PendingUpdate {
                    update,
                    bytes: None,
                });
                set_update_message(&state, format!("发现版本 {version}。"));
            }
            Ok(None) => {
                *lock(&state.pending_update, "pending update")? = None;
                set_update_message(&state, "当前已是最新版本。");
            }
            Err(error) => {
                set_update_message(&state, format!("检查更新失败：{error}"));
                return Err(format!("检查更新失败：{error}"));
            }
        }
        let snapshot = desktop_snapshot(&app, &state)?;
        dispatch_snapshot(&app, &state);
        Ok(snapshot)
    }
}

#[tauri::command]
async fn desktop_download_update(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<DesktopSnapshot, String> {
    ensure_rpn(&window)?;

    #[cfg(not(feature = "release-updater"))]
    {
        set_update_message(&state, "此 RC 未配置签名更新源，不能下载更新。");
        return desktop_snapshot(&app, &state);
    }

    #[cfg(feature = "release-updater")]
    {
        let _busy = begin_update_operation(&state)?;
        let update = {
            let pending = lock(&state.pending_update, "pending update")?;
            pending
                .as_ref()
                .ok_or_else(|| "请先检查更新".to_string())?
                .update
                .clone()
        };
        set_update_message(&state, "正在下载并校验更新包…");
        let bytes = update
            .download(|_, _| {}, || {})
            .await
            .map_err(|error| format!("下载或签名校验失败：{error}"))?;
        let size = bytes.len();
        let mut pending = lock(&state.pending_update, "pending update")?;
        let target = pending
            .as_mut()
            .ok_or_else(|| "待下载更新已失效".to_string())?;
        if target.update.version != update.version {
            return Err("更新版本在下载期间发生变化，请重新检查".to_string());
        }
        target.bytes = Some(bytes);
        drop(pending);
        set_update_message(
            &state,
            format!("已下载并验证 {} MiB。", (size + 1_048_575) / 1_048_576),
        );
        let snapshot = desktop_snapshot(&app, &state)?;
        dispatch_snapshot(&app, &state);
        Ok(snapshot)
    }
}

#[tauri::command]
async fn desktop_install_update(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    ensure_rpn(&window)?;

    #[cfg(not(feature = "release-updater"))]
    {
        let _ = (app, state);
        return Err("此 RC 未配置签名更新源，不能安装在线更新".to_string());
    }

    #[cfg(feature = "release-updater")]
    {
        let _busy = begin_update_operation(&state)?;
        {
            let pending = lock(&state.pending_update, "pending update")?;
            if pending
                .as_ref()
                .and_then(|item| item.bytes.as_ref())
                .is_none()
            {
                return Err("更新包尚未完成下载和签名校验".to_string());
            }
        }

        let token = format!(
            "{}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            FLUSH_TOKEN_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let (sender, receiver) = mpsc::sync_channel(1);
        {
            let mut waiter = lock(&state.flush_waiter, "workspace flush")?;
            if waiter.is_some() {
                return Err("已有工作区保存确认正在等待".to_string());
            }
            *waiter = Some(FlushWaiter {
                token: token.clone(),
                sender,
            });
        }

        let detail = serde_json::json!({ "token": token.clone() });
        if let Err(error) = window.eval(format!(
            "window.dispatchEvent(new CustomEvent('rpn:desktop-prepare-update', {{ detail: {detail} }}));"
        )) {
            let mut waiter = lock(&state.flush_waiter, "workspace flush")?;
            if waiter
                .as_ref()
                .is_some_and(|pending| pending.token == token)
            {
                waiter.take();
            }
            return Err(format!("无法请求工作区保存：{error}"));
        }

        let ack = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(Duration::from_secs(30))
        })
        .await
        .map_err(|error| format!("等待工作区保存任务失败：{error}"))?
        .map_err(|_| "等待工作区保存确认超时；更新已取消".to_string());
        if ack.is_err() {
            if let Ok(mut waiter) = state.flush_waiter.lock() {
                *waiter = None;
            }
        }
        let ack = ack?;
        if !ack.ok {
            return Err(format!("工作区保存失败，更新已取消：{}", ack.error));
        }
        if ack.project_id.trim().is_empty() {
            return Err("工作区保存确认缺少项目标识，更新已取消".to_string());
        }
        set_update_message(
            &state,
            format!(
                "项目 {} 已保存至 revision {}，正在安装…",
                ack.project_id, ack.revision
            ),
        );

        let pending = lock(&state.pending_update, "pending update")?
            .take()
            .ok_or_else(|| "待安装更新已失效".to_string())?;
        let bytes = pending
            .bytes
            .as_ref()
            .ok_or_else(|| "待安装更新缺少已验证数据".to_string())?;
        match pending.update.install(bytes) {
            Ok(()) => app.restart(),
            Err(error) => {
                *lock(&state.pending_update, "pending update")? = Some(pending);
                Err(format!("启动更新安装器失败：{error}"))
            }
        }
    }
}

#[tauri::command]
fn desktop_rpn_flush_complete(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    token: String,
    ok: bool,
    error: String,
    project_id: String,
    revision: u64,
) -> Result<(), String> {
    ensure_rpn(&window)?;
    let waiter = {
        let mut slot = lock(&state.flush_waiter, "workspace flush")?;
        let Some(waiter) = slot.as_ref() else {
            return Err("没有等待中的工作区保存确认".to_string());
        };
        if waiter.token != token {
            return Err("工作区保存令牌不匹配".to_string());
        }
        slot.take().expect("flush waiter disappeared while locked")
    };
    waiter
        .sender
        .send(FlushAck {
            ok,
            error,
            project_id,
            revision,
        })
        .map_err(|_| "更新流程已停止等待保存确认".to_string())
}

fn main() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    #[cfg(feature = "release-updater")]
    let builder = builder.plugin(
        tauri_plugin_updater::Builder::new()
            .pubkey(env!("RPN_UPDATER_PUBLIC_KEY"))
            .build(),
    );

    builder
        .setup(|app| {
            let config_path = app.path().app_config_dir()?.join("desktop.json");
            let settings = load_settings(&config_path);
            app.manage(DesktopState::new(settings, config_path));
            app.manage(AiTransportState::new().map_err(std::io::Error::other)?);
            app.manage(McpHostState::new());
            app.set_menu(build_menu(app.handle())?)?;
            build_rpn_window(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "page_rpn" => {
                let _ = switch_page(app, RPN_LABEL);
            }
            "page_st" => {
                let _ = switch_page(app, ST_LABEL);
            }
            "reload_active" => {
                if let Ok(window) = active_window(app) {
                    let _ = window.reload();
                }
            }
            "open_devtools" => {
                if let Ok(window) = active_window(app) {
                    window.open_devtools();
                }
            }
            "desktop_settings" => {
                let _ = open_desktop_settings(app);
            }
            _ => {}
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. })
                && matches!(window.label(), RPN_LABEL | ST_LABEL)
            {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_get_state,
            desktop_open_rpn,
            desktop_open_st,
            desktop_reload_active,
            desktop_open_devtools,
            desktop_set_st_url,
            desktop_check_update,
            desktop_download_update,
            desktop_install_update,
            desktop_rpn_flush_complete,
            desktop_ai_request,
            desktop_ai_cancel,
            desktop_mcp_prepare,
            desktop_mcp_execute,
            desktop_mcp_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("RPN desktop shell failed to run");
}
