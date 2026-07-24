use crate::ai_transport::ensure_bundled_rpn;
use same_file::Handle as FileIdentityHandle;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fmt::Write as _,
    fs::File,
    future::Future,
    io::Read,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{State, Url, WebviewWindow};
use tauri_plugin_dialog::{
    DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{OwnedSemaphorePermit, Semaphore},
    task::spawn_blocking,
    time::timeout,
};
use tokio_util::{sync::CancellationToken, task::AbortOnDropHandle};

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    },
};

const INTENT_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_INTENTS: usize = 16;
const MAX_NATIVE_APPROVALS: usize = 1;
const MAX_EXECUTIONS: usize = 2;
const EXECUTION_TIMEOUT: Duration = Duration::from_secs(20);
const CHILD_WAIT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_EXECUTABLE_BYTES: usize = 1024;
const MAX_EXECUTABLE_CONTENT_BYTES: u64 = 512 * 1024 * 1024;
const MAX_CWD_BYTES: usize = 4096;
const MAX_ARG_COUNT: usize = 64;
const MAX_ARG_BYTES: usize = 1024;
const MAX_TOTAL_ARG_BYTES: usize = 4 * 1024;
const MAX_ENV_COUNT: usize = 64;
const MAX_ENV_NAME_BYTES: usize = 128;
const MAX_ENV_VALUE_BYTES: usize = 16 * 1024;
const MAX_TOTAL_ENV_BYTES: usize = 128 * 1024;
const MAX_PINNED_ARGUMENT_FILES: usize = 16;
const MAX_PINNED_ARGUMENT_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_TOTAL_PINNED_ARGUMENT_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_TOOL_NAME_BYTES: usize = 256;
const MAX_TOOL_ARGUMENT_BYTES: usize = 256 * 1024;
const MAX_APPROVAL_SUMMARY_BYTES: usize = 8 * 1024;
const MAX_RPC_REQUEST_BYTES: usize = 512 * 1024;
const MAX_STDOUT_LINE_BYTES: usize = 1024 * 1024;
const MAX_STDOUT_TOTAL_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 256 * 1024;
const MAX_TOOL_ITEMS: usize = 1024;
const MCP_PROTOCOL_VERSION: &str = "2025-11-25";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] =
    &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

// This blacklist is only a guardrail against accidental shell configuration.
// The actual boundary is absolute executable identity + native per-run approval.
const FORBIDDEN_EXECUTABLES: &[&str] = &[
    "ash",
    "bash",
    "busybox",
    "cmd",
    "command",
    "csh",
    "dash",
    "elvish",
    "fish",
    "ion",
    "ksh",
    "mksh",
    "nu",
    "posh",
    "powershell",
    "pwsh",
    "rc",
    "sash",
    "sh",
    "tcsh",
    "wsl",
    "xonsh",
    "yash",
    "zsh",
];
const FORBIDDEN_SCRIPT_EXTENSIONS: &[&str] = &["bat", "cmd", "com", "ps1", "sh"];
const INTERPRETER_EXECUTABLES: &[&str] = &[
    "lua", "luajit", "node", "nodejs", "perl", "php", "php-cgi", "py", "python", "pythonw", "ruby",
];
const UNSUPPORTED_INTERPRETER_EXECUTABLES: &[&str] = &["bun", "deno", "java", "javaw"];
const FORBIDDEN_ENV_PREFIXES: &[&str] = &[
    "BUN_CONFIG_",
    "CARGO_",
    "GIT_CONFIG_",
    "NPM_CONFIG_",
    "PIP_CONFIG_",
    "PNPM_",
    "YARN_",
];
const SECRET_ENV_MARKERS: &[&str] = &[
    "AUTH",
    "CONNECTION",
    "CREDENTIAL",
    "DSN",
    "KEY",
    "PASSWORD",
    "SECRET",
    "TOKEN",
];
const SAFE_REVIEW_BUTTON: &str = "返回检查";
const APPROVE_BUTTON: &str = "批准并执行";
const CANCEL_BUTTON: &str = "取消";
const FORBIDDEN_ENV_NAMES: &[&str] = &[
    "BASH_ENV",
    "CLASSPATH",
    "COMSPEC",
    "DOTNET_ADDITIONAL_DEPS",
    "DOTNET_SHARED_STORE",
    "DOTNET_STARTUP_HOOKS",
    "ENV",
    "GEM_HOME",
    "GEM_PATH",
    "GCONV_PATH",
    "JAVA_TOOL_OPTIONS",
    "JDK_JAVA_OPTIONS",
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "NODE_PATH",
    "NODE_OPTIONS",
    "NODE_REPL_EXTERNAL_MODULE",
    "PATH",
    "PATHEXT",
    "PERLLIB",
    "PERL5LIB",
    "PERL5OPT",
    "PHPRC",
    "PHP_INI_SCAN_DIR",
    "PYTHONBREAKPOINT",
    "PYTHONHOME",
    "PYTHONINSPECT",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "PYTHONUSERBASE",
    "RUBYLIB",
    "RUBYOPT",
    "SSLKEYLOGFILE",
    "SYSTEMROOT",
    "WINDIR",
    "ZDOTDIR",
    "_JAVA_OPTIONS",
];
const MINIMUM_INHERITED_ENV: &[&str] = &[
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpHostError {
    code: &'static str,
    message: String,
    retryable: bool,
}

impl McpHostError {
    fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self::new("forbidden", message, false)
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid_request", message, false)
    }

    fn cancelled(message: impl Into<String>) -> Self {
        Self::new("cancelled", message, false)
    }

    fn protocol(message: impl Into<String>) -> Self {
        Self::new("mcp_protocol", message, false)
    }

    fn state_unavailable() -> Self {
        Self::new(
            "state_unavailable",
            "MCP 确认状态不可用，请重启桌面程序",
            false,
        )
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum McpOperationKind {
    ListTools,
    CallTool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct McpPrepareRequest {
    executable: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: String,
    #[serde(default)]
    env: BTreeMap<String, String>,
    operation: McpOperationKind,
    #[serde(default)]
    tool: Option<String>,
    #[serde(default)]
    arguments: Option<Map<String, Value>>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct IntentSource {
    window_label: String,
    origin: String,
}

#[derive(Clone)]
struct PathIdentity {
    canonical: PathBuf,
    handle: Arc<FileIdentityHandle>,
    file_size: Option<u64>,
    modified: Option<SystemTime>,
}

#[derive(Clone)]
struct PinnedArgumentFile {
    argument_index: usize,
    identity: PathIdentity,
    content_sha256: String,
}

#[derive(Clone)]
struct McpServerIntent {
    executable: PathIdentity,
    executable_content_sha256: String,
    args: Vec<String>,
    cwd: PathIdentity,
    env: BTreeMap<String, String>,
    pinned_argument_files: Vec<PinnedArgumentFile>,
}

#[derive(Clone)]
enum McpOperation {
    ListTools,
    CallTool {
        tool: String,
        arguments: Map<String, Value>,
    },
}

#[derive(Clone)]
struct PreparedIntent {
    server: McpServerIntent,
    operation: McpOperation,
    source: IntentSource,
    immutable_digest: String,
}

enum IntentLifecycle {
    Prepared,
    AwaitingApproval { cancel: CancellationToken },
    Running { cancel: CancellationToken },
    Finished,
    Cancelled,
}

struct IntentRecord {
    created_at: Instant,
    intent: Arc<PreparedIntent>,
    lifecycle: IntentLifecycle,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpIntentSummary {
    intent_id: String,
    executable: String,
    cwd: String,
    args_count: usize,
    env_names: Vec<String>,
    operation: McpOperationKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<String>,
    immutable_digest: String,
    expires_in_seconds: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApprovalReceipt {
    intent_id: String,
    approved_at: u64,
    immutable_digest: String,
}

struct McpProtocolResult {
    server_info: Value,
    protocol_version: String,
    tools: Option<Vec<Value>>,
    content: Option<Vec<Value>>,
    is_error: Option<bool>,
    annotations_trusted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpExecutionResult {
    server_info: Value,
    protocol_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    is_error: Option<bool>,
    annotations_trusted: bool,
    approval_receipt: ApprovalReceipt,
}

struct McpHostInner {
    intents: Mutex<HashMap<String, IntentRecord>>,
}

#[derive(Clone)]
pub(crate) struct McpHostState {
    inner: Arc<McpHostInner>,
    native_approval_gate: Arc<Semaphore>,
    execution_gate: Arc<Semaphore>,
}

impl McpHostState {
    pub(crate) fn new() -> Self {
        Self {
            inner: Arc::new(McpHostInner {
                intents: Mutex::new(HashMap::new()),
            }),
            native_approval_gate: Arc::new(Semaphore::new(MAX_NATIVE_APPROVALS)),
            execution_gate: Arc::new(Semaphore::new(MAX_EXECUTIONS)),
        }
    }

    fn prepare(
        &self,
        intent: PreparedIntent,
        now: Instant,
    ) -> Result<McpIntentSummary, McpHostError> {
        let mut intents = self
            .inner
            .intents
            .lock()
            .map_err(|_| McpHostError::state_unavailable())?;
        intents.retain(|_, record| match &record.lifecycle {
            IntentLifecycle::Prepared => now
                .checked_duration_since(record.created_at)
                .is_none_or(|age| age <= INTENT_TTL),
            IntentLifecycle::AwaitingApproval { .. } | IntentLifecycle::Running { .. } => true,
            IntentLifecycle::Finished | IntentLifecycle::Cancelled => false,
        });
        if intents.len() >= MAX_INTENTS {
            return Err(McpHostError::new(
                "busy",
                format!("待处理 MCP 操作已达到上限（{MAX_INTENTS}）"),
                true,
            ));
        }
        let intent_id = create_intent_id(&intents)?;
        let intent = Arc::new(intent);
        let summary = intent_summary(&intent_id, &intent);
        intents.insert(
            intent_id,
            IntentRecord {
                created_at: now,
                intent,
                lifecycle: IntentLifecycle::Prepared,
            },
        );
        Ok(summary)
    }

    fn begin_approval(
        &self,
        intent_id: &str,
        source: &IntentSource,
        now: Instant,
    ) -> Result<(Arc<PreparedIntent>, CancellationToken), McpHostError> {
        validate_intent_id(intent_id)?;
        let mut intents = self
            .inner
            .intents
            .lock()
            .map_err(|_| McpHostError::state_unavailable())?;
        let record = intents.get_mut(intent_id).ok_or_else(intent_not_found)?;
        if &record.intent.source != source {
            return Err(McpHostError::forbidden(
                "MCP intent 与当前 RPN 窗口来源不匹配",
            ));
        }
        if !matches!(record.lifecycle, IntentLifecycle::Prepared) {
            return Err(intent_not_found());
        }
        if now
            .checked_duration_since(record.created_at)
            .is_some_and(|age| age > INTENT_TTL)
        {
            record.lifecycle = IntentLifecycle::Cancelled;
            return Err(McpHostError::new(
                "intent_expired",
                "MCP 操作确认已过期，请重新准备",
                false,
            ));
        }
        let cancel = CancellationToken::new();
        record.lifecycle = IntentLifecycle::AwaitingApproval {
            cancel: cancel.clone(),
        };
        Ok((record.intent.clone(), cancel))
    }

    fn begin_running(
        &self,
        intent_id: &str,
        source: &IntentSource,
        cancel: &CancellationToken,
    ) -> Result<(), McpHostError> {
        let mut intents = self
            .inner
            .intents
            .lock()
            .map_err(|_| McpHostError::state_unavailable())?;
        let record = intents.get_mut(intent_id).ok_or_else(intent_not_found)?;
        if &record.intent.source != source {
            return Err(McpHostError::forbidden(
                "MCP intent 与当前 RPN 窗口来源不匹配",
            ));
        }
        if cancel.is_cancelled()
            || !matches!(record.lifecycle, IntentLifecycle::AwaitingApproval { .. })
        {
            record.lifecycle = IntentLifecycle::Cancelled;
            return Err(McpHostError::cancelled("MCP 操作已取消"));
        }
        record.lifecycle = IntentLifecycle::Running {
            cancel: cancel.clone(),
        };
        Ok(())
    }

    fn finish(&self, intent_id: &str, cancelled: bool) -> bool {
        if let Ok(mut intents) = self.inner.intents.lock() {
            if let Some(record) = intents.get_mut(intent_id) {
                if cancelled {
                    record.lifecycle = IntentLifecycle::Cancelled;
                    return true;
                }
                if matches!(
                    &record.lifecycle,
                    IntentLifecycle::Running { cancel } if !cancel.is_cancelled()
                ) {
                    record.lifecycle = IntentLifecycle::Finished;
                    return true;
                }
            }
        }
        false
    }

    fn cancel(&self, intent_id: &str, source: &IntentSource) -> Result<bool, McpHostError> {
        validate_intent_id(intent_id)?;
        let mut intents = self
            .inner
            .intents
            .lock()
            .map_err(|_| McpHostError::state_unavailable())?;
        let Some(record) = intents.get_mut(intent_id) else {
            return Ok(false);
        };
        if &record.intent.source != source {
            return Err(McpHostError::forbidden(
                "MCP intent 与当前 RPN 窗口来源不匹配",
            ));
        }
        match &record.lifecycle {
            IntentLifecycle::Prepared => {
                intents.remove(intent_id);
                Ok(true)
            }
            IntentLifecycle::AwaitingApproval { cancel } | IntentLifecycle::Running { cancel } => {
                cancel.cancel();
                record.lifecycle = IntentLifecycle::Cancelled;
                Ok(true)
            }
            IntentLifecycle::Finished | IntentLifecycle::Cancelled => Ok(false),
        }
    }

    pub(crate) fn cancel_all(&self) -> usize {
        let Ok(mut intents) = self.inner.intents.lock() else {
            return 0;
        };
        let mut cancelled = 0;
        for record in intents.values_mut() {
            match &record.lifecycle {
                IntentLifecycle::Prepared => {
                    record.lifecycle = IntentLifecycle::Cancelled;
                    cancelled += 1;
                }
                IntentLifecycle::AwaitingApproval { cancel }
                | IntentLifecycle::Running { cancel } => {
                    cancel.cancel();
                    record.lifecycle = IntentLifecycle::Cancelled;
                    cancelled += 1;
                }
                IntentLifecycle::Finished | IntentLifecycle::Cancelled => {}
            }
        }
        cancelled
    }

    pub(crate) fn active_execution_count(&self) -> usize {
        MAX_EXECUTIONS.saturating_sub(self.execution_gate.available_permits())
    }

    fn reserve_execution(&self) -> Result<OwnedSemaphorePermit, McpHostError> {
        self.execution_gate
            .clone()
            .try_acquire_owned()
            .map_err(|_| {
                McpHostError::new(
                    "busy",
                    format!("并行 MCP 执行已达到上限（{MAX_EXECUTIONS}）"),
                    true,
                )
            })
    }

    fn reserve_native_approval(&self) -> Result<OwnedSemaphorePermit, McpHostError> {
        self.native_approval_gate
            .clone()
            .try_acquire_owned()
            .map_err(|_| McpHostError::new("approval_busy", "已有 MCP 原生审批窗口等待处理", true))
    }

    #[cfg(test)]
    fn lifecycle_name(&self, intent_id: &str) -> Option<&'static str> {
        let intents = self.inner.intents.lock().ok()?;
        let record = intents.get(intent_id)?;
        Some(match record.lifecycle {
            IntentLifecycle::Prepared => "prepared",
            IntentLifecycle::AwaitingApproval { .. } => "awaitingApproval",
            IntentLifecycle::Running { .. } => "running",
            IntentLifecycle::Finished => "finished",
            IntentLifecycle::Cancelled => "cancelled",
        })
    }
}

struct ExecutionLifecycleGuard {
    state: McpHostState,
    intent_id: String,
    cancel: CancellationToken,
    completed: bool,
}

impl ExecutionLifecycleGuard {
    fn new(state: McpHostState, intent_id: String, cancel: CancellationToken) -> Self {
        Self {
            state,
            intent_id,
            cancel,
            completed: false,
        }
    }

    fn complete(&mut self) {
        self.completed = true;
    }
}

impl Drop for ExecutionLifecycleGuard {
    fn drop(&mut self) {
        if !self.completed {
            self.cancel.cancel();
            self.state.finish(&self.intent_id, true);
        }
    }
}

fn intent_not_found() -> McpHostError {
    McpHostError::new(
        "intent_not_found",
        "MCP intent 不存在、已取消或已被消费",
        false,
    )
}

fn create_intent_id(existing: &HashMap<String, IntentRecord>) -> Result<String, McpHostError> {
    for _ in 0..8 {
        let mut random = [0u8; 16];
        getrandom::fill(&mut random).map_err(|_| {
            McpHostError::new("random_unavailable", "无法生成安全 MCP intentId", false)
        })?;
        let intent_id = format!("mcp-{}", hex_bytes(&random));
        if !existing.contains_key(&intent_id) {
            return Ok(intent_id);
        }
    }
    Err(McpHostError::new(
        "random_unavailable",
        "无法生成唯一 MCP intentId",
        false,
    ))
}

fn hex_bytes(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn ensure_mcp_origin(window: &WebviewWindow) -> Result<(), McpHostError> {
    ensure_bundled_rpn(window)
        .map_err(|_| McpHostError::forbidden("此命令只允许由受信任的内置 RPN 页面调用"))
}

fn intent_source(window: &WebviewWindow) -> Result<IntentSource, McpHostError> {
    let url = window
        .url()
        .map_err(|_| McpHostError::forbidden("无法确认 RPN 页面来源"))?;
    let host = url
        .host_str()
        .ok_or_else(|| McpHostError::forbidden("RPN 页面来源缺少主机名"))?;
    Ok(IntentSource {
        window_label: window.label().to_string(),
        origin: format!("{}://{}", url.scheme(), host.to_ascii_lowercase()),
    })
}

fn validate_intent_id(value: &str) -> Result<(), McpHostError> {
    if value.len() != 36
        || !value.starts_with("mcp-")
        || !value[4..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(McpHostError::invalid("intentId 格式无效"));
    }
    Ok(())
}

#[cfg(windows)]
fn reject_nonlocal_path_input(value: &str) -> Result<(), McpHostError> {
    let normalized = value.replace('/', "\\");
    if normalized.starts_with("\\\\")
        || normalized.starts_with("\\??\\")
        || normalized.starts_with("\\\\.\\")
    {
        return Err(McpHostError::invalid(
            "MCP 路径不得使用 UNC、设备或网络路径",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn reject_nonlocal_path_input(value: &str) -> Result<(), McpHostError> {
    if value.starts_with("//") {
        return Err(McpHostError::invalid("MCP 路径不得使用网络路径"));
    }
    Ok(())
}

#[cfg(windows)]
fn ensure_local_canonical_path(path: &Path) -> Result<(), McpHostError> {
    use std::path::{Component, Prefix};
    use windows_sys::Win32::Storage::FileSystem::GetDriveTypeW;

    let drive = match path.components().next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => drive,
            _ => {
                return Err(McpHostError::invalid(
                    "MCP 路径不得使用 UNC、设备或网络路径",
                ))
            }
        },
        _ => return Err(McpHostError::invalid("MCP 路径必须位于本机磁盘")),
    };
    let root = [drive as u16, b':' as u16, b'\\' as u16, 0];
    // SAFETY: root is a valid, NUL-terminated `X:\` UTF-16 string.
    let drive_type = unsafe { GetDriveTypeW(root.as_ptr()) };
    if !matches!(drive_type, 2 | 3 | 5 | 6) {
        return Err(McpHostError::invalid("MCP 路径必须位于本机磁盘"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn ensure_local_canonical_path(path: &Path) -> Result<(), McpHostError> {
    if !path.is_absolute() {
        return Err(McpHostError::invalid("MCP 路径必须是绝对路径"));
    }
    Ok(())
}

fn capture_path_identity(
    value: &str,
    expect_file: bool,
    max_bytes: usize,
    label: &str,
) -> Result<PathIdentity, McpHostError> {
    if value.is_empty() || value.trim() != value || value.len() > max_bytes || value.contains('\0')
    {
        return Err(McpHostError::invalid(format!("{label} 无效或过长")));
    }
    reject_nonlocal_path_input(value)?;
    let input = Path::new(value);
    if !input.is_absolute() {
        return Err(McpHostError::invalid(format!("{label} 必须是本机绝对路径")));
    }
    let canonical = dunce::canonicalize(input)
        .map_err(|_| McpHostError::invalid(format!("{label} 不存在或无法访问")))?;
    ensure_local_canonical_path(&canonical)?;
    let metadata = canonical
        .metadata()
        .map_err(|_| McpHostError::invalid(format!("{label} 无法读取 metadata")))?;
    if expect_file && !metadata.is_file() {
        return Err(McpHostError::invalid(format!("{label} 必须是普通文件")));
    }
    if !expect_file && !metadata.is_dir() {
        return Err(McpHostError::invalid(format!("{label} 必须是现有目录")));
    }
    let handle = FileIdentityHandle::from_path(&canonical)
        .map_err(|_| McpHostError::invalid(format!("{label} 无法建立身份快照")))?;
    Ok(PathIdentity {
        canonical,
        handle: Arc::new(handle),
        file_size: expect_file.then_some(metadata.len()),
        modified: metadata.modified().ok(),
    })
}

fn revalidate_path_identity(
    identity: &PathIdentity,
    expect_file: bool,
    label: &str,
) -> Result<(), McpHostError> {
    let canonical = dunce::canonicalize(&identity.canonical)
        .map_err(|_| McpHostError::invalid(format!("{label} 已不存在或无法访问")))?;
    ensure_local_canonical_path(&canonical)?;
    if canonical != identity.canonical {
        return Err(McpHostError::invalid(format!(
            "{label} canonical 路径已变化"
        )));
    }
    let metadata = canonical
        .metadata()
        .map_err(|_| McpHostError::invalid(format!("{label} metadata 已不可用")))?;
    if (expect_file && !metadata.is_file()) || (!expect_file && !metadata.is_dir()) {
        return Err(McpHostError::invalid(format!("{label} 类型已变化")));
    }
    let current = FileIdentityHandle::from_path(&canonical)
        .map_err(|_| McpHostError::invalid(format!("{label} 身份已不可用")))?;
    if current != *identity.handle {
        return Err(McpHostError::invalid(format!("{label} 文件身份已变化")));
    }
    if expect_file
        && (identity.file_size != Some(metadata.len())
            || identity.modified != metadata.modified().ok())
    {
        return Err(McpHostError::invalid(format!("{label} metadata 已变化")));
    }
    Ok(())
}

fn is_forbidden_executable(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(name)
        .to_ascii_lowercase();
    FORBIDDEN_EXECUTABLES.contains(&stem.as_str())
        || FORBIDDEN_SCRIPT_EXTENSIONS.contains(&extension.as_str())
}

fn executable_stem(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_unsupported_interpreter(path: &Path) -> bool {
    UNSUPPORTED_INTERPRETER_EXECUTABLES.contains(&executable_stem(path).as_str())
}

fn validate_executable(value: &str) -> Result<(PathIdentity, String), McpHostError> {
    let identity = capture_path_identity(value, true, MAX_EXECUTABLE_BYTES, "MCP executable")?;
    if is_forbidden_executable(&identity.canonical) {
        return Err(McpHostError::invalid(
            "MCP executable 不得是 Shell 或命令脚本",
        ));
    }
    if is_unsupported_interpreter(&identity.canonical) {
        return Err(McpHostError::invalid(
            "Java、Deno 与 Bun 解释器不在当前 MCP 安全允许列表",
        ));
    }
    let content_sha256 = file_content_sha256(
        &identity.canonical,
        MAX_EXECUTABLE_CONTENT_BYTES,
        "MCP executable",
    )?;
    revalidate_path_identity(&identity, true, "MCP executable")?;
    Ok((identity, content_sha256))
}

fn revalidate_executable(
    identity: &PathIdentity,
    expected_content_sha256: &str,
) -> Result<(), McpHostError> {
    revalidate_path_identity(identity, true, "MCP executable")?;
    if file_content_sha256(
        &identity.canonical,
        MAX_EXECUTABLE_CONTENT_BYTES,
        "MCP executable",
    )? != expected_content_sha256
    {
        return Err(McpHostError::invalid("MCP executable 内容已变化"));
    }
    Ok(())
}

fn normalized_sensitive_name(value: &str) -> bool {
    let upper = value.to_ascii_uppercase().replace('-', "_");
    let compact = upper.replace('_', "");
    upper
        .split(|character: char| !character.is_ascii_alphanumeric())
        .any(|part| SECRET_ENV_MARKERS.contains(&part))
        || [
            "ACCESSTOKEN",
            "APIKEY",
            "AUTHORIZATION",
            "AUTHTOKEN",
            "CLIENTSECRET",
            "CONNECTIONSTRING",
            "CREDENTIALS",
            "PRIVATEKEY",
        ]
        .iter()
        .any(|marker| compact.ends_with(marker))
}

fn contains_userinfo_url(value: &str) -> bool {
    let candidates =
        std::iter::once(value).chain(value.split_once('=').map(|(_, candidate)| candidate));
    candidates
        .filter_map(|candidate| Url::parse(candidate.trim_matches(['"', '\''])).ok())
        .any(|url| !url.username().is_empty() || url.password().is_some())
}

fn contains_file_url(value: &str) -> bool {
    std::iter::once(value)
        .chain(value.split_once('=').map(|(_, candidate)| candidate))
        .filter_map(|candidate| Url::parse(candidate.trim_matches(['"', '\''])).ok())
        .any(|url| url.scheme().eq_ignore_ascii_case("file"))
}

fn looks_like_obvious_credential_argument(value: &str) -> bool {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();
    let flag_or_assignment_name = if trimmed.starts_with('-') || trimmed.starts_with('/') {
        Some(
            trimmed
                .trim_start_matches(['-', '/'])
                .split(['=', ':'])
                .next()
                .unwrap_or_default(),
        )
    } else {
        trimmed.split_once(['=', ':']).map(|(name, _)| name.trim())
    };
    flag_or_assignment_name.is_some_and(normalized_sensitive_name)
        || lower.starts_with("authorization:")
        || lower.starts_with("proxy-authorization:")
        || lower.starts_with("x-api-key:")
        || lower.starts_with("api-key:")
        || lower.starts_with("bearer ")
        || lower.starts_with("basic ")
        || (trimmed.len() >= 12
            && ["sk-", "ghp_", "github_pat_", "xoxb-", "xoxp-"]
                .iter()
                .any(|prefix| lower.starts_with(prefix)))
}

fn validate_args(values: Vec<String>) -> Result<Vec<String>, McpHostError> {
    if values.len() > MAX_ARG_COUNT {
        return Err(McpHostError::invalid("MCP args 数量超过上限"));
    }
    let mut total = 0usize;
    for value in &values {
        if value.len() > MAX_ARG_BYTES || value.contains('\0') {
            return Err(McpHostError::invalid("MCP 参数无效或过长"));
        }
        if contains_userinfo_url(value) {
            return Err(McpHostError::invalid(
                "MCP 参数不得包含带 userinfo 的 URL；凭据只能通过受限 env 提供",
            ));
        }
        if contains_file_url(value) {
            return Err(McpHostError::invalid(
                "MCP 参数不得使用 file URL；请提供可固定身份的本机绝对或 cwd 相对路径",
            ));
        }
        if looks_like_obvious_credential_argument(value) {
            return Err(McpHostError::invalid(
                "MCP 参数不得携带明显凭据 flag 或值；凭据只能通过受限 env 提供",
            ));
        }
        total = total.saturating_add(value.len());
        if total > MAX_TOTAL_ARG_BYTES {
            return Err(McpHostError::invalid("MCP 参数总大小超过上限"));
        }
    }
    Ok(values)
}

fn validate_cwd(value: &str) -> Result<PathIdentity, McpHostError> {
    capture_path_identity(value, false, MAX_CWD_BYTES, "MCP cwd")
}

fn is_pinned_entry_interpreter(executable: &Path) -> bool {
    let stem = executable_stem(executable);
    INTERPRETER_EXECUTABLES.contains(&stem.as_str())
        || stem
            .strip_prefix("python")
            .is_some_and(|suffix| suffix.starts_with(|character: char| character.is_ascii_digit()))
        || stem
            .strip_prefix("php")
            .is_some_and(|suffix| suffix.starts_with(|character: char| character.is_ascii_digit()))
        || stem
            .strip_prefix("lua")
            .is_some_and(|suffix| suffix.starts_with(|character: char| character.is_ascii_digit()))
}

fn is_interpreter_entry_file(executable: &Path, candidate: &Path) -> bool {
    let stem = executable_stem(executable);
    let extension = candidate
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extensions: &[&str] = if matches!(stem.as_str(), "node" | "nodejs") {
        &["cjs", "cts", "js", "jsx", "mjs", "mts", "ts", "tsx"]
    } else if stem == "py" || stem.starts_with("python") {
        &["py", "pyw"]
    } else if stem.starts_with("php") {
        &["php"]
    } else if stem.starts_with("lua") {
        &["lua"]
    } else if stem == "ruby" {
        &["rb"]
    } else if stem == "perl" {
        &["pl", "pm"]
    } else {
        &[]
    };
    extensions.contains(&extension.as_str())
}

fn file_content_sha256(path: &Path, max_bytes: u64, label: &str) -> Result<String, McpHostError> {
    let mut file =
        File::open(path).map_err(|_| McpHostError::invalid(format!("{label} 无法读取内容")))?;
    let mut digest = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 16 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| McpHostError::invalid(format!("{label} 内容读取失败")))?;
        if read == 0 {
            break;
        }
        total = total.saturating_add(read as u64);
        if total > max_bytes {
            return Err(McpHostError::invalid(format!("{label} 内容超过固定上限")));
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex_bytes(&digest.finalize()))
}

fn pin_argument_files(
    executable: &PathIdentity,
    cwd: &PathIdentity,
    args: &[String],
) -> Result<Vec<PinnedArgumentFile>, McpHostError> {
    let mut pinned = Vec::new();
    let mut seen = HashSet::new();
    let mut total_bytes = 0u64;
    for (argument_index, argument) in args.iter().enumerate() {
        let mut candidates = Vec::with_capacity(3);
        if !argument.starts_with('-') {
            candidates.push(argument.as_str());
        }
        if let Some((_, candidate)) = argument.split_once('=') {
            candidates.push(candidate);
        }
        if let Some(candidate) = argument.strip_prefix('@') {
            candidates.push(candidate);
        }
        for candidate in candidates {
            if candidate.is_empty() || candidate.contains("://") {
                continue;
            }
            let candidate = Path::new(candidate);
            let resolved = if candidate.is_absolute() {
                candidate.to_path_buf()
            } else {
                cwd.canonical.join(candidate)
            };
            let resolved_text = resolved.to_string_lossy();
            reject_nonlocal_path_input(&resolved_text)?;
            match resolved.metadata() {
                Ok(metadata) if metadata.is_file() => {}
                Ok(_) => continue,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(_) => return Err(McpHostError::invalid("MCP 参数指向无法确认的本机路径")),
            }
            let identity = capture_path_identity(
                &resolved_text,
                true,
                MAX_CWD_BYTES + MAX_ARG_BYTES,
                "MCP argument file",
            )?;
            if !seen.insert(identity.canonical.clone()) {
                continue;
            }
            if pinned.len() >= MAX_PINNED_ARGUMENT_FILES {
                return Err(McpHostError::invalid(
                    "MCP 参数中的本机文件数量超过固定上限",
                ));
            }
            total_bytes = total_bytes.saturating_add(identity.file_size.unwrap_or(u64::MAX));
            if total_bytes > MAX_TOTAL_PINNED_ARGUMENT_FILE_BYTES {
                return Err(McpHostError::invalid(
                    "MCP 参数文件总大小超过 32 MiB 固定上限",
                ));
            }
            let content_sha256 = file_content_sha256(
                &identity.canonical,
                MAX_PINNED_ARGUMENT_FILE_BYTES,
                "MCP argument file",
            )?;
            revalidate_path_identity(&identity, true, "MCP argument file")?;
            pinned.push(PinnedArgumentFile {
                argument_index,
                identity,
                content_sha256,
            });
        }
    }
    if is_pinned_entry_interpreter(&executable.canonical) {
        let first_argument = args.first().filter(|argument| {
            !argument.starts_with('-')
                && !argument.starts_with('@')
                && !argument.contains('=')
                && !argument.contains("://")
        });
        let valid_entry = first_argument.is_some_and(|argument| {
            let path = Path::new(argument);
            let resolved = if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.canonical.join(path)
            };
            dunce::canonicalize(resolved).is_ok_and(|canonical| {
                pinned.iter().any(|file| {
                    file.argument_index == 0
                        && file.identity.canonical == canonical
                        && is_interpreter_entry_file(
                            &executable.canonical,
                            &file.identity.canonical,
                        )
                })
            })
        });
        if !valid_entry {
            return Err(McpHostError::invalid(
                "允许的脚本解释器要求第一个参数就是准备时已固定的本机入口文件；入口前不得使用 runtime flag",
            ));
        }
    }
    Ok(pinned)
}

fn revalidate_pinned_argument_files(pinned: &[PinnedArgumentFile]) -> Result<(), McpHostError> {
    for file in pinned {
        revalidate_path_identity(&file.identity, true, "MCP argument file")?;
        if file_content_sha256(
            &file.identity.canonical,
            MAX_PINNED_ARGUMENT_FILE_BYTES,
            "MCP argument file",
        )? != file.content_sha256
        {
            return Err(McpHostError::invalid("MCP 参数文件内容已变化"));
        }
    }
    Ok(())
}

fn is_forbidden_env_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    FORBIDDEN_ENV_NAMES.contains(&upper.as_str())
        || FORBIDDEN_ENV_PREFIXES
            .iter()
            .any(|prefix| upper.starts_with(prefix))
        || ["DYLD_", "LD_", "LUA_INIT", "LUA_PATH", "LUA_CPATH"]
            .iter()
            .any(|prefix| upper.starts_with(prefix))
}

fn is_allowed_secret_env_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    normalized_sensitive_name(&upper) || upper.ends_with("_URL")
}

fn validate_env(
    values: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, McpHostError> {
    if values.len() > MAX_ENV_COUNT {
        return Err(McpHostError::invalid("MCP env 数量超过上限"));
    }
    let mut total = 0usize;
    for (name, value) in &values {
        let mut bytes = name.bytes();
        let valid_name = bytes
            .next()
            .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_')
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
        if !valid_name || name.len() > MAX_ENV_NAME_BYTES {
            return Err(McpHostError::invalid(format!("MCP env 名称无效：{name}")));
        }
        if is_forbidden_env_name(name) {
            return Err(McpHostError::invalid(format!(
                "MCP env 不得覆盖加载、预载或路径变量：{name}"
            )));
        }
        if !is_allowed_secret_env_name(name) {
            return Err(McpHostError::invalid(format!(
                "MCP env 只允许明显凭据变量名（Key/Token/Secret/Password/Auth/Credential/Connection/DSN/*_URL）：{name}"
            )));
        }
        if value.len() > MAX_ENV_VALUE_BYTES || value.contains('\0') {
            return Err(McpHostError::invalid(format!(
                "MCP env 值无效或过长：{name}"
            )));
        }
        total = total.saturating_add(name.len() + value.len());
        if total > MAX_TOTAL_ENV_BYTES {
            return Err(McpHostError::invalid("MCP env 总大小超过上限"));
        }
    }
    Ok(values)
}

fn validate_tool_name(value: String) -> Result<String, McpHostError> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_TOOL_NAME_BYTES
        || value.chars().any(char::is_control)
    {
        return Err(McpHostError::invalid("MCP tool 名称无效或过长"));
    }
    Ok(value)
}

fn validate_prepare_request(
    request: McpPrepareRequest,
    source: IntentSource,
) -> Result<PreparedIntent, McpHostError> {
    let (executable, executable_content_sha256) = validate_executable(&request.executable)?;
    let args = validate_args(request.args)?;
    let cwd = validate_cwd(&request.cwd)?;
    let env = validate_env(request.env)?;
    let pinned_argument_files = pin_argument_files(&executable, &cwd, &args)?;
    let server = McpServerIntent {
        executable,
        executable_content_sha256,
        args,
        cwd,
        env,
        pinned_argument_files,
    };
    let operation = match request.operation {
        McpOperationKind::ListTools => {
            if request.tool.is_some() || request.arguments.is_some() {
                return Err(McpHostError::invalid(
                    "listTools 不得包含 tool 或 arguments",
                ));
            }
            McpOperation::ListTools
        }
        McpOperationKind::CallTool => {
            let tool = request
                .tool
                .ok_or_else(|| McpHostError::invalid("callTool 必须提供 tool"))?;
            let arguments = request.arguments.unwrap_or_default();
            let argument_bytes = serde_json::to_vec(&arguments)
                .map_err(|_| McpHostError::invalid("MCP tool arguments 无法序列化"))?
                .len();
            if argument_bytes > MAX_TOOL_ARGUMENT_BYTES {
                return Err(McpHostError::invalid("MCP tool arguments 超过大小上限"));
            }
            McpOperation::CallTool {
                tool: validate_tool_name(tool)?,
                arguments,
            }
        }
    };
    let mut intent = PreparedIntent {
        server,
        operation,
        source,
        immutable_digest: String::new(),
    };
    intent.immutable_digest = immutable_digest(&intent)?;
    let summary = approval_summary("mcp-00000000000000000000000000000000", &intent)?;
    if summary.len() > MAX_APPROVAL_SUMMARY_BYTES {
        return Err(McpHostError::invalid("MCP 原生审批摘要超过大小上限"));
    }
    Ok(intent)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvDigestMaterial<'a> {
    name: &'a str,
    value_sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PinnedArgumentDigestMaterial<'a> {
    argument_index: usize,
    canonical_path: String,
    content_sha256: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DigestMaterial<'a> {
    executable: &'a str,
    executable_content_sha256: &'a str,
    args: &'a [String],
    cwd: &'a str,
    env: Vec<EnvDigestMaterial<'a>>,
    pinned_argument_files: Vec<PinnedArgumentDigestMaterial<'a>>,
    operation: &'a str,
    tool: Option<&'a str>,
    arguments: Option<&'a Map<String, Value>>,
}

fn immutable_digest(intent: &PreparedIntent) -> Result<String, McpHostError> {
    let (operation, tool, arguments) = match &intent.operation {
        McpOperation::ListTools => ("listTools", None, None),
        McpOperation::CallTool { tool, arguments } => {
            ("callTool", Some(tool.as_str()), Some(arguments))
        }
    };
    let executable = intent.server.executable.canonical.to_string_lossy();
    let cwd = intent.server.cwd.canonical.to_string_lossy();
    let material = DigestMaterial {
        executable: &executable,
        executable_content_sha256: &intent.server.executable_content_sha256,
        args: &intent.server.args,
        cwd: &cwd,
        env: intent
            .server
            .env
            .iter()
            .map(|(name, value)| EnvDigestMaterial {
                name,
                value_sha256: hex_bytes(&Sha256::digest(value.as_bytes())),
            })
            .collect(),
        pinned_argument_files: intent
            .server
            .pinned_argument_files
            .iter()
            .map(|file| PinnedArgumentDigestMaterial {
                argument_index: file.argument_index,
                canonical_path: file.identity.canonical.to_string_lossy().into_owned(),
                content_sha256: &file.content_sha256,
            })
            .collect(),
        operation,
        tool,
        arguments,
    };
    let encoded = serde_json::to_vec(&material)
        .map_err(|_| McpHostError::invalid("无法计算 MCP intent 摘要"))?;
    Ok(hex_bytes(&Sha256::digest(encoded)))
}

fn intent_summary(intent_id: &str, intent: &PreparedIntent) -> McpIntentSummary {
    let (operation, tool) = match &intent.operation {
        McpOperation::ListTools => (McpOperationKind::ListTools, None),
        McpOperation::CallTool { tool, .. } => (McpOperationKind::CallTool, Some(tool.clone())),
    };
    McpIntentSummary {
        intent_id: intent_id.to_string(),
        executable: intent
            .server
            .executable
            .canonical
            .to_string_lossy()
            .into_owned(),
        cwd: intent.server.cwd.canonical.to_string_lossy().into_owned(),
        args_count: intent.server.args.len(),
        env_names: intent.server.env.keys().cloned().collect(),
        operation,
        tool,
        immutable_digest: intent.immutable_digest.clone(),
        expires_in_seconds: INTENT_TTL.as_secs(),
    }
}

fn is_approval_format_control(character: char) -> bool {
    matches!(
        character,
        '\u{061C}'
            | '\u{180E}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'
            | '\u{2066}'..='\u{206F}'
            | '\u{FEFF}'
    )
}

fn escape_approval_display(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if is_approval_format_control(character) {
            let _ = write!(escaped, "\\u{{{:04X}}}", character as u32);
        } else {
            escaped.push(character);
        }
    }
    escaped
}

fn approval_summary(intent_id: &str, intent: &PreparedIntent) -> Result<String, McpHostError> {
    let args = serde_json::to_string_pretty(&intent.server.args)
        .map_err(|_| McpHostError::invalid("无法生成 MCP args 审批摘要"))?;
    let env_hashes = serde_json::to_string_pretty(
        &intent
            .server
            .env
            .iter()
            .map(|(name, value)| {
                json!({
                    "name": name,
                    "valueSha256": hex_bytes(&Sha256::digest(value.as_bytes())),
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|_| McpHostError::invalid("无法生成 MCP env 审批摘要"))?;
    let pinned_argument_files = serde_json::to_string_pretty(
        &intent
            .server
            .pinned_argument_files
            .iter()
            .map(|file| {
                json!({
                    "argumentIndex": file.argument_index,
                    "canonicalPath": file.identity.canonical,
                    "contentSha256": file.content_sha256,
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|_| McpHostError::invalid("无法生成 MCP 参数文件审批摘要"))?;
    let (operation, tool, arguments) = match &intent.operation {
        McpOperation::ListTools => ("listTools", "（无）".to_string(), "（无）".to_string()),
        McpOperation::CallTool { tool, arguments } => (
            "callTool",
            tool.clone(),
            serde_json::to_string_pretty(arguments)
                .map_err(|_| McpHostError::invalid("无法生成 MCP arguments 审批摘要"))?,
        ),
    };
    let summary = escape_approval_display(&format!(
        "RPN 即将以当前用户权限启动一个本机 MCP 程序。\n\
         只有点击“批准并执行”才会启动；程序及其输出均不可信。\n\n\
         Intent ID:\n{intent_id}\n\n\
         Immutable SHA-256:\n{}\n\n\
         Canonical executable:\n{}\n\n\
         Executable content SHA-256:\n{}\n\n\
         完整参数（{} 个）:\n{args}\n\n\
         Canonical cwd:\n{}\n\n\
         环境变量名称与值 SHA-256（原值不会显示，父进程其他环境不会继承）:\n{env_hashes}\n\n\
         已固定的本机参数文件（路径、参数序号、内容 SHA-256）:\n{pinned_argument_files}\n\n\
         Operation:\n{operation}\n\n\
         Tool:\n{tool}\n\n\
         完整受限 tool arguments:\n{arguments}\n\n\
         警告：该程序拥有当前用户权限；MCP tool annotations 与所有进程输出都不可信，\
         不会因此获得额外能力。",
        intent.immutable_digest,
        intent.server.executable.canonical.display(),
        intent.server.executable_content_sha256,
        intent.server.args.len(),
        intent.server.cwd.canonical.display(),
    ));
    if summary.len() > MAX_APPROVAL_SUMMARY_BYTES {
        return Err(McpHostError::invalid("MCP 原生审批摘要超过大小上限"));
    }
    Ok(summary)
}

async fn request_approval_with<F>(decision: F) -> Result<bool, McpHostError>
where
    F: FnOnce() -> bool + Send + 'static,
{
    spawn_blocking(decision)
        .await
        .map_err(|_| McpHostError::new("approval_failed", "MCP 原生审批窗口异常终止", false))
}

fn is_explicit_native_approval(result: MessageDialogResult) -> bool {
    matches!(result, MessageDialogResult::Custom(label) if label == APPROVE_BUTTON)
}

async fn request_native_approval(
    window: WebviewWindow,
    summary: String,
) -> Result<bool, McpHostError> {
    request_approval_with(move || {
        let result = window
            .dialog()
            .message(summary)
            .title("RPN · MCP 原生执行审批")
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                SAFE_REVIEW_BUTTON.to_string(),
                APPROVE_BUTTON.to_string(),
                CANCEL_BUTTON.to_string(),
            ))
            .parent(&window)
            .blocking_show_with_result();
        is_explicit_native_approval(result)
    })
    .await
}

fn approval_receipt(intent_id: &str, intent: &PreparedIntent) -> ApprovalReceipt {
    let approved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    ApprovalReceipt {
        intent_id: intent_id.to_string(),
        approved_at,
        immutable_digest: intent.immutable_digest.clone(),
    }
}

async fn execute_intent_flow<A, ApprovalFuture, R, RunnerFuture>(
    state: &McpHostState,
    intent_id: &str,
    source: &IntentSource,
    approver: A,
    runner: R,
) -> Result<McpExecutionResult, McpHostError>
where
    A: FnOnce(String) -> ApprovalFuture,
    ApprovalFuture: Future<Output = Result<bool, McpHostError>>,
    R: FnOnce(Arc<PreparedIntent>, CancellationToken) -> RunnerFuture,
    RunnerFuture: Future<Output = Result<McpProtocolResult, McpHostError>>,
{
    let _execution_permit = state.reserve_execution()?;
    let approval_permit = state.reserve_native_approval()?;
    let (intent, cancel) = state.begin_approval(intent_id, source, Instant::now())?;
    let mut lifecycle_guard =
        ExecutionLifecycleGuard::new(state.clone(), intent_id.to_string(), cancel.clone());
    let summary = approval_summary(intent_id, &intent)?;
    let approved = match approver(summary).await {
        Ok(approved) => approved,
        Err(error) => {
            state.finish(intent_id, true);
            lifecycle_guard.complete();
            return Err(error);
        }
    };
    if !approved || cancel.is_cancelled() {
        state.finish(intent_id, true);
        lifecycle_guard.complete();
        return Err(McpHostError::cancelled("MCP 原生审批已取消，程序未启动"));
    }
    state.begin_running(intent_id, source, &cancel)?;
    let receipt = approval_receipt(intent_id, &intent);
    drop(approval_permit);

    let protocol_result = runner(intent, cancel.clone()).await;
    if cancel.is_cancelled() {
        state.finish(intent_id, true);
        lifecycle_guard.complete();
        return Err(McpHostError::cancelled("MCP 运行已取消"));
    }
    if !state.finish(intent_id, false) {
        lifecycle_guard.complete();
        return Err(McpHostError::cancelled("MCP 运行已取消"));
    }
    lifecycle_guard.complete();
    let protocol_result = protocol_result?;
    Ok(McpExecutionResult {
        server_info: protocol_result.server_info,
        protocol_version: protocol_result.protocol_version,
        tools: protocol_result.tools,
        content: protocol_result.content,
        is_error: protocol_result.is_error,
        annotations_trusted: protocol_result.annotations_trusted,
        approval_receipt: receipt,
    })
}

async fn write_json_line(stdin: &mut ChildStdin, value: &Value) -> Result<(), McpHostError> {
    let mut bytes = serde_json::to_vec(value)
        .map_err(|_| McpHostError::protocol("无法编码 MCP JSON-RPC 请求"))?;
    if bytes.len() > MAX_RPC_REQUEST_BYTES {
        return Err(McpHostError::invalid("MCP JSON-RPC 请求超过大小上限"));
    }
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|_| McpHostError::new("mcp_io", "无法写入 MCP stdio", true))?;
    stdin
        .flush()
        .await
        .map_err(|_| McpHostError::new("mcp_io", "无法刷新 MCP stdio", true))
}

async fn read_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    total_bytes: &mut usize,
) -> Result<Option<Vec<u8>>, McpHostError> {
    let mut line = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|_| McpHostError::new("mcp_io", "无法读取 MCP stdout", true))?;
        if available.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Ok(Some(line))
            };
        }
        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |index| index + 1);
        if line.len().saturating_add(take) > MAX_STDOUT_LINE_BYTES
            || total_bytes.saturating_add(take) > MAX_STDOUT_TOTAL_BYTES
        {
            return Err(McpHostError::new(
                "output_limit",
                "MCP stdout 超过安全上限",
                false,
            ));
        }
        line.extend_from_slice(&available[..take]);
        *total_bytes += take;
        reader.consume(take);
        if newline.is_some() {
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            return Ok(Some(line));
        }
    }
}

async fn read_rpc_response(
    stdout: &mut BufReader<ChildStdout>,
    expected_id: u64,
    total_bytes: &mut usize,
) -> Result<Value, McpHostError> {
    loop {
        let line = read_bounded_line(stdout, total_bytes)
            .await?
            .ok_or_else(|| McpHostError::protocol("MCP server 在响应前关闭了 stdout"))?;
        if line.is_empty() {
            continue;
        }
        let value: Value = serde_json::from_slice(&line)
            .map_err(|_| McpHostError::protocol("MCP stdout 包含无效 JSON-RPC 行"))?;
        if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
            return Err(McpHostError::protocol("MCP stdout 响应不是 JSON-RPC 2.0"));
        }
        match value.get("id") {
            None => continue,
            Some(id) if id == &Value::from(expected_id) => return Ok(value),
            Some(_) => {
                return Err(McpHostError::protocol(
                    "MCP server 返回了非预期 JSON-RPC id",
                ))
            }
        }
    }
}

fn take_rpc_result(response: Value) -> Result<Value, McpHostError> {
    if let Some(error) = response.get("error") {
        let code = error
            .get("code")
            .and_then(Value::as_i64)
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        return Err(McpHostError::protocol(format!(
            "MCP server 返回 JSON-RPC error（{code}）"
        )));
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| McpHostError::protocol("MCP JSON-RPC 响应缺少 result"))
}

async fn drain_stderr(mut stderr: tokio::process::ChildStderr) -> Result<(), McpHostError> {
    let mut total = 0usize;
    let mut buffer = [0u8; 8192];
    loop {
        let read = stderr
            .read(&mut buffer)
            .await
            .map_err(|_| McpHostError::new("mcp_io", "无法读取 MCP stderr", true))?;
        if read == 0 {
            return Ok(());
        }
        total = total.saturating_add(read);
        if total > MAX_STDERR_BYTES {
            return Err(McpHostError::new(
                "output_limit",
                "MCP stderr 超过安全上限",
                false,
            ));
        }
    }
}

fn parse_initialize_result(result: &Value) -> Result<(Value, String), McpHostError> {
    let server_info = result
        .get("serverInfo")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| McpHostError::protocol("MCP initialize 缺少 serverInfo"))?;
    let protocol_version = result
        .get("protocolVersion")
        .and_then(Value::as_str)
        .filter(|version| SUPPORTED_PROTOCOL_VERSIONS.contains(version))
        .ok_or_else(|| McpHostError::protocol("MCP server 返回了不支持的 protocolVersion"))?
        .to_string();
    Ok((server_info, protocol_version))
}

async fn run_mcp_session(
    stdin: &mut ChildStdin,
    stdout: &mut BufReader<ChildStdout>,
    intent: &PreparedIntent,
) -> Result<McpProtocolResult, McpHostError> {
    let mut stdout_bytes = 0usize;
    write_json_line(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "reverie-playcraft-nexus",
                    "version": env!("CARGO_PKG_VERSION")
                }
            }
        }),
    )
    .await?;
    let initialize = take_rpc_result(read_rpc_response(stdout, 1, &mut stdout_bytes).await?)?;
    let (server_info, protocol_version) = parse_initialize_result(&initialize)?;
    write_json_line(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }),
    )
    .await?;
    let operation_request = match &intent.operation {
        McpOperation::ListTools => json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }),
        McpOperation::CallTool { tool, arguments } => json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": tool,
                "arguments": arguments
            }
        }),
    };
    write_json_line(stdin, &operation_request).await?;
    let operation_result = take_rpc_result(read_rpc_response(stdout, 2, &mut stdout_bytes).await?)?;
    match &intent.operation {
        McpOperation::ListTools => {
            let tools = operation_result
                .get("tools")
                .and_then(Value::as_array)
                .filter(|tools| tools.len() <= MAX_TOOL_ITEMS)
                .cloned()
                .ok_or_else(|| McpHostError::protocol("tools/list 缺少有效 tools"))?;
            Ok(McpProtocolResult {
                server_info,
                protocol_version,
                tools: Some(tools),
                content: None,
                is_error: None,
                annotations_trusted: false,
            })
        }
        McpOperation::CallTool { .. } => {
            let content = operation_result
                .get("content")
                .and_then(Value::as_array)
                .filter(|content| content.len() <= MAX_TOOL_ITEMS)
                .cloned()
                .ok_or_else(|| McpHostError::protocol("tools/call 缺少有效 content"))?;
            let is_error = operation_result
                .get("isError")
                .map(|value| {
                    value
                        .as_bool()
                        .ok_or_else(|| McpHostError::protocol("tools/call isError 必须是布尔值"))
                })
                .transpose()?
                .unwrap_or(false);
            Ok(McpProtocolResult {
                server_info,
                protocol_version,
                tools: None,
                content: Some(content),
                is_error: Some(is_error),
                annotations_trusted: false,
            })
        }
    }
}

fn apply_clean_environment(command: &mut Command, explicit: &BTreeMap<String, String>) {
    command.env_clear();
    for name in MINIMUM_INHERITED_ENV {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command.envs(explicit);
}

#[cfg(windows)]
struct ProcessTreeJob(isize);

#[cfg(windows)]
impl ProcessTreeJob {
    fn new() -> Result<Self, McpHostError> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return Err(McpHostError::new(
                "spawn_failed",
                "无法初始化 Windows MCP 进程树托管",
                false,
            ));
        }
        let job = Self(handle as isize);
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                job.handle(),
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&limits).cast(),
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 {
            return Err(McpHostError::new(
                "spawn_failed",
                "无法配置 Windows MCP 进程树托管",
                false,
            ));
        }
        Ok(job)
    }

    fn handle(&self) -> HANDLE {
        self.0 as HANDLE
    }

    fn assign(&self, child: &Child) -> Result<(), McpHostError> {
        let process = child
            .raw_handle()
            .ok_or_else(|| McpHostError::new("spawn_failed", "无法取得 MCP 子进程句柄", false))?;
        if unsafe { AssignProcessToJobObject(self.handle(), process as HANDLE) } == 0 {
            return Err(McpHostError::new(
                "spawn_failed",
                "无法把 MCP 子进程加入 Windows 进程树托管",
                false,
            ));
        }
        Ok(())
    }

    fn terminate(&self) {
        unsafe {
            TerminateJobObject(self.handle(), 1);
        }
    }
}

#[cfg(windows)]
impl Drop for ProcessTreeJob {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.handle());
        }
    }
}

#[cfg(not(windows))]
struct ProcessTreeJob;

#[cfg(not(windows))]
impl ProcessTreeJob {
    fn new() -> Result<Self, McpHostError> {
        Ok(Self)
    }

    fn assign(&self, _child: &Child) -> Result<(), McpHostError> {
        Ok(())
    }

    fn terminate(&self) {}
}

async fn terminate_child(child: &mut Child, process_job: &ProcessTreeJob) {
    process_job.terminate();
    let _ = child.start_kill();
    let _ = timeout(CHILD_WAIT_TIMEOUT, child.wait()).await;
}

async fn execute_prepared_intent(
    intent: Arc<PreparedIntent>,
    cancel: CancellationToken,
) -> Result<McpProtocolResult, McpHostError> {
    if cancel.is_cancelled() {
        return Err(McpHostError::cancelled("MCP 运行已取消"));
    }

    let mut command = Command::new(&intent.server.executable.canonical);
    command
        .args(&intent.server.args)
        .current_dir(&intent.server.cwd.canonical)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    apply_clean_environment(&mut command, &intent.server.env);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);

    // Recheck the approved file identities at the last possible point before
    // the OS resolves the executable and cwd for process creation.
    revalidate_executable(
        &intent.server.executable,
        &intent.server.executable_content_sha256,
    )?;
    revalidate_path_identity(&intent.server.cwd, false, "MCP cwd")?;
    revalidate_pinned_argument_files(&intent.server.pinned_argument_files)?;
    if cancel.is_cancelled() {
        return Err(McpHostError::cancelled("MCP 运行已取消"));
    }
    let process_job = ProcessTreeJob::new()?;
    let mut child = command.spawn().map_err(|_| {
        McpHostError::new(
            "spawn_failed",
            "无法启动 MCP executable；请检查路径与权限",
            false,
        )
    })?;
    if let Err(error) = process_job.assign(&child) {
        terminate_child(&mut child, &process_job).await;
        return Err(error);
    }
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| McpHostError::new("mcp_io", "无法打开 MCP stdin", false))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| McpHostError::new("mcp_io", "无法打开 MCP stdout", false))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| McpHostError::new("mcp_io", "无法打开 MCP stderr", false))?;
    let mut stdout = BufReader::new(stdout);
    let mut stderr_task = AbortOnDropHandle::new(tokio::spawn(drain_stderr(stderr)));
    let mut stderr_finished = false;
    let result = {
        let operation = async {
            let session = run_mcp_session(&mut stdin, &mut stdout, &intent);
            tokio::select! {
                _ = cancel.cancelled() => Err(McpHostError::cancelled("MCP 运行已取消")),
                result = timeout(EXECUTION_TIMEOUT, session) => {
                    result.map_err(|_| McpHostError::new("timeout", "MCP 操作超过 20 秒限制", true))?
                }
            }
        };
        tokio::pin!(operation);
        tokio::select! {
            biased;
            stderr_result = &mut stderr_task => {
                stderr_finished = true;
                match stderr_result {
                    Ok(Ok(())) => operation.await,
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err(McpHostError::new("mcp_io", "MCP stderr 监控异常终止", false)),
                }
            }
            result = &mut operation => result,
        }
    };
    drop(stdin);
    drop(stdout);
    terminate_child(&mut child, &process_job).await;
    if !stderr_finished {
        match timeout(CHILD_WAIT_TIMEOUT, &mut stderr_task).await {
            Ok(Ok(Ok(()))) => {}
            Ok(Ok(Err(error))) => return Err(error),
            Ok(Err(_)) => {
                return Err(McpHostError::new(
                    "mcp_io",
                    "MCP stderr 监控异常终止",
                    false,
                ))
            }
            Err(_) => {
                stderr_task.abort();
                let _ = stderr_task.await;
                return Err(McpHostError::new(
                    "mcp_io",
                    "MCP stderr 未在进程终止后关闭",
                    false,
                ));
            }
        }
    }
    result
}

#[tauri::command]
pub(crate) fn desktop_mcp_prepare(
    window: WebviewWindow,
    state: State<'_, McpHostState>,
    request: McpPrepareRequest,
) -> Result<McpIntentSummary, McpHostError> {
    ensure_mcp_origin(&window)?;
    let source = intent_source(&window)?;
    let intent = validate_prepare_request(request, source)?;
    state.prepare(intent, Instant::now())
}

#[tauri::command]
pub(crate) async fn desktop_mcp_execute(
    window: WebviewWindow,
    state: State<'_, McpHostState>,
    intent_id: String,
) -> Result<McpExecutionResult, McpHostError> {
    ensure_mcp_origin(&window)?;
    let source = intent_source(&window)?;
    let approval_window = window.clone();
    execute_intent_flow(
        &state,
        &intent_id,
        &source,
        move |summary| request_native_approval(approval_window, summary),
        execute_prepared_intent,
    )
    .await
}

#[tauri::command]
pub(crate) fn desktop_mcp_cancel(
    window: WebviewWindow,
    state: State<'_, McpHostState>,
    intent_id: String,
) -> Result<bool, McpHostError> {
    ensure_mcp_origin(&window)?;
    let source = intent_source(&window)?;
    state.cancel(&intent_id, &source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs, process,
        sync::atomic::{AtomicBool, Ordering},
        sync::OnceLock,
    };
    use tokio::sync::Notify;

    fn temp_test_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("rpn-mcp-host-{}-{unique}", process::id()))
    }

    fn find_node() -> PathBuf {
        let path = std::env::var_os("PATH").expect("PATH is required for Node test");
        for directory in std::env::split_paths(&path) {
            #[cfg(windows)]
            let candidates = [directory.join("node.exe"), directory.join("node")];
            #[cfg(not(windows))]
            let candidates = [directory.join("node"), directory.join("node.exe")];
            for candidate in candidates {
                if candidate.is_file() {
                    return dunce::canonicalize(candidate).unwrap();
                }
            }
        }
        panic!("Node executable not found");
    }

    fn fake_node() -> PathBuf {
        static PATH: OnceLock<PathBuf> = OnceLock::new();
        PATH.get_or_init(|| {
            let directory =
                std::env::temp_dir().join(format!("rpn-mcp-host-test-node-{}", process::id()));
            fs::create_dir_all(&directory).unwrap();
            let executable = directory.join("node.exe");
            fs::write(&executable, b"test-only fake node executable").unwrap();
            dunce::canonicalize(executable).unwrap()
        })
        .clone()
    }

    fn source() -> IntentSource {
        IntentSource {
            window_label: "rpn".to_string(),
            origin: "tauri://localhost".to_string(),
        }
    }

    fn request(cwd: &Path, operation: McpOperationKind) -> McpPrepareRequest {
        let test_entry = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("portal")
            .join("assets")
            .join("studio-ai.js");
        McpPrepareRequest {
            executable: fake_node().to_string_lossy().into_owned(),
            args: vec![test_entry.to_string_lossy().into_owned()],
            cwd: cwd.to_string_lossy().into_owned(),
            env: BTreeMap::new(),
            operation,
            tool: None,
            arguments: None,
        }
    }

    fn runtime_request(cwd: &Path, operation: McpOperationKind) -> McpPrepareRequest {
        let mut request = request(cwd, operation);
        request.executable = find_node().to_string_lossy().into_owned();
        request
    }

    fn prepared(cwd: &Path, operation: McpOperationKind) -> PreparedIntent {
        validate_prepare_request(request(cwd, operation), source()).unwrap()
    }

    fn prepare_in_state(state: &McpHostState, intent: PreparedIntent) -> McpIntentSummary {
        state.prepare(intent, Instant::now()).unwrap()
    }

    #[test]
    fn executable_and_cwd_must_be_absolute_local_existing_paths() {
        let cwd = std::env::temp_dir();
        let mut relative_executable = request(&cwd, McpOperationKind::ListTools);
        relative_executable.executable = "node".to_string();
        assert!(validate_prepare_request(relative_executable, source()).is_err());

        let mut relative_cwd = request(&cwd, McpOperationKind::ListTools);
        relative_cwd.cwd = "relative/path".to_string();
        assert!(validate_prepare_request(relative_cwd, source()).is_err());

        for value in [
            r"\\server\share\server.exe",
            r"\\?\C:\server.exe",
            "//server/share",
        ] {
            assert!(reject_nonlocal_path_input(value).is_err(), "{value}");
        }
        for value in ["cmd.exe", "powershell.exe", "pwsh", "bash", "sh", "wsl.exe"] {
            assert!(is_forbidden_executable(Path::new(value)), "{value}");
        }
    }

    #[test]
    fn arguments_reject_credentials_userinfo_urls_and_excessive_sizes() {
        for values in [
            vec!["--api-key".to_string(), "value".to_string()],
            vec!["--token=value".to_string()],
            vec!["--authorization".to_string()],
            vec!["Authorization: Bearer value".to_string()],
            vec!["Bearer secret-value".to_string()],
            vec!["sk-1234567890".to_string()],
            vec!["https://user:password@example.com/mcp".to_string()],
            vec!["--endpoint=https://user@example.com/mcp".to_string()],
            vec!["file:///C:/mcp/server.mjs".to_string()],
        ] {
            assert!(validate_args(values).is_err());
        }
        assert!(validate_args(vec!["x".repeat(MAX_ARG_BYTES + 1)]).is_err());
        assert!(validate_args(vec!["x".repeat(900); 5]).is_err());
        assert!(validate_args(vec![
            "--endpoint=https://example.com/mcp".to_string(),
            "server.mjs".to_string(),
        ])
        .is_ok());
    }

    #[test]
    fn dangerous_environment_overrides_are_rejected() {
        let cwd = std::env::temp_dir();
        for name in [
            "PATH",
            "Path",
            "PATHEXT",
            "COMSPEC",
            "NODE_OPTIONS",
            "NODE_PATH",
            "PYTHONPATH",
            "PYTHONHOME",
            "PYTHONBREAKPOINT",
            "RUBYOPT",
            "GEM_HOME",
            "PERL5OPT",
            "PERLLIB",
            "LUA_INIT_5_4",
            "DOTNET_ADDITIONAL_DEPS",
            "PHP_INI_SCAN_DIR",
            "LD_PRELOAD",
            "LD_AUDIT",
            "DYLD_INSERT_LIBRARIES",
            "_JAVA_OPTIONS",
            "SSLKEYLOGFILE",
            "GIT_CONFIG_KEY_0",
            "NPM_CONFIG_TOKEN",
            "PIP_CONFIG_SECRET",
            "CARGO_AUTH_TOKEN",
            "YARN_AUTH_TOKEN",
        ] {
            let mut value = request(&cwd, McpOperationKind::ListTools);
            value.env.insert(name.to_string(), "unsafe".to_string());
            assert!(validate_prepare_request(value, source()).is_err(), "{name}");
        }
    }

    #[test]
    fn environment_names_are_limited_to_secret_or_connection_values() {
        for name in [
            "OPENAI_API_KEY",
            "MCP_ACCESS_TOKEN",
            "SERVICE_SECRET",
            "DB_PASSWORD",
            "SERVICE_AUTH",
            "CLIENT_CREDENTIALS",
            "DB_CONNECTION_STRING",
            "DATABASE_DSN",
            "DATABASE_URL",
        ] {
            let values = BTreeMap::from([(name.to_string(), "value".to_string())]);
            assert!(validate_env(values).is_ok(), "{name}");
        }
        for name in ["MCP_MODE", "DEBUG", "LOG_LEVEL", "HOME"] {
            let values = BTreeMap::from([(name.to_string(), "value".to_string())]);
            assert!(validate_env(values).is_err(), "{name}");
        }
    }

    #[test]
    fn digest_binds_environment_values_and_other_immutable_fields() {
        let cwd = std::env::temp_dir();
        let mut first = request(&cwd, McpOperationKind::CallTool);
        first.args.push("--same-argument".to_string());
        first
            .env
            .insert("MCP_KEY".to_string(), "first-secret".to_string());
        first.tool = Some("echo".to_string());
        first.arguments = Some(Map::from_iter([(
            "text".to_string(),
            Value::String("one".to_string()),
        )]));
        let first = validate_prepare_request(first, source()).unwrap();

        let mut same_names = request(&cwd, McpOperationKind::CallTool);
        same_names.args.push("--same-argument".to_string());
        same_names
            .env
            .insert("MCP_KEY".to_string(), "different-secret".to_string());
        same_names.tool = Some("echo".to_string());
        same_names.arguments = Some(Map::from_iter([(
            "text".to_string(),
            Value::String("one".to_string()),
        )]));
        let same_names = validate_prepare_request(same_names, source()).unwrap();
        assert_ne!(first.immutable_digest, same_names.immutable_digest);

        let mut changed = request(&cwd, McpOperationKind::CallTool);
        changed.args.push("--different-argument".to_string());
        changed
            .env
            .insert("MCP_KEY".to_string(), "first-secret".to_string());
        changed.tool = Some("echo".to_string());
        changed.arguments = Some(Map::from_iter([(
            "text".to_string(),
            Value::String("one".to_string()),
        )]));
        let changed = validate_prepare_request(changed, source()).unwrap();
        assert_ne!(first.immutable_digest, changed.immutable_digest);
    }

    #[test]
    fn native_approval_summary_shows_frozen_inputs_without_env_values() {
        let cwd = std::env::temp_dir();
        let mut value = request(&cwd, McpOperationKind::CallTool);
        value.args.push("--full-flag".to_string());
        value.env.insert(
            "MCP_TEST_SECRET".to_string(),
            "never-show-this-value".to_string(),
        );
        value.tool = Some("visible-tool".to_string());
        value.arguments = Some(Map::from_iter([(
            "nested".to_string(),
            json!({ "value": "visible-argument" }),
        )]));
        let intent = validate_prepare_request(value, source()).unwrap();
        let summary = approval_summary("mcp-00000000000000000000000000000000", &intent).unwrap();

        assert!(summary.contains("studio-ai.js"));
        assert!(summary.contains("--full-flag"));
        assert!(summary.contains("MCP_TEST_SECRET"));
        assert!(summary.contains(&hex_bytes(&Sha256::digest(b"never-show-this-value"))));
        assert!(summary.contains("visible-tool"));
        assert!(summary.contains("visible-argument"));
        assert!(summary.contains(&intent.immutable_digest));
        assert!(summary.contains(&intent.server.executable_content_sha256));
        assert!(!summary.contains("never-show-this-value"));
    }

    #[test]
    fn approval_summary_escapes_format_controls_and_enforces_eight_kib_limit() {
        assert_eq!(
            escape_approval_display("left\u{202e}right\u{200b}end"),
            r"left\u{202E}right\u{200B}end"
        );

        let cwd = std::env::temp_dir();
        let mut escaped = request(&cwd, McpOperationKind::CallTool);
        escaped.tool = Some("echo".to_string());
        escaped.arguments = Some(Map::from_iter([(
            "text".to_string(),
            Value::String("left\u{202e}right\u{200b}end".to_string()),
        )]));
        let escaped = validate_prepare_request(escaped, source()).unwrap();
        let summary = approval_summary("mcp-00000000000000000000000000000000", &escaped).unwrap();
        assert!(summary.contains(r"\u{202E}"));
        assert!(summary.contains(r"\u{200B}"));
        assert!(!summary.contains('\u{202e}'));
        assert!(summary.len() <= MAX_APPROVAL_SUMMARY_BYTES);

        let mut oversized = request(&cwd, McpOperationKind::CallTool);
        oversized.tool = Some("echo".to_string());
        oversized.arguments = Some(Map::from_iter([(
            "text".to_string(),
            Value::String("x".repeat(MAX_APPROVAL_SUMMARY_BYTES)),
        )]));
        assert!(validate_prepare_request(oversized, source()).is_err());
    }

    #[test]
    fn only_the_explicit_approve_button_is_authoritative() {
        assert!(is_explicit_native_approval(MessageDialogResult::Custom(
            APPROVE_BUTTON.to_string()
        )));
        for result in [
            MessageDialogResult::Custom(SAFE_REVIEW_BUTTON.to_string()),
            MessageDialogResult::Custom(CANCEL_BUTTON.to_string()),
            MessageDialogResult::Cancel,
            MessageDialogResult::Yes,
            MessageDialogResult::No,
            MessageDialogResult::Ok,
        ] {
            assert!(!is_explicit_native_approval(result));
        }
    }

    #[test]
    fn all_existing_argument_files_are_pinned_for_any_executable() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let executable = cwd.join("custom-mcp-server.exe");
        let argument_file = cwd.join("server-config.json");
        fs::write(&executable, b"test executable").unwrap();
        fs::write(&argument_file, br#"{"mode":"safe"}"#).unwrap();
        let request = McpPrepareRequest {
            executable: executable.to_string_lossy().into_owned(),
            args: vec!["server-config.json".to_string()],
            cwd: cwd.to_string_lossy().into_owned(),
            env: BTreeMap::new(),
            operation: McpOperationKind::ListTools,
            tool: None,
            arguments: None,
        };
        let intent = validate_prepare_request(request, source()).unwrap();
        assert_eq!(intent.server.pinned_argument_files.len(), 1);
        assert_eq!(
            intent.server.pinned_argument_files[0].identity.canonical,
            dunce::canonicalize(&argument_file).unwrap()
        );

        drop(intent);
        fs::remove_dir_all(&cwd).unwrap();
    }

    #[test]
    fn node_entry_content_and_identity_are_frozen_until_spawn() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let script = cwd.join("server.mjs");
        fs::write(&script, b"export const version = 1;").unwrap();
        let mut first = request(&cwd, McpOperationKind::ListTools);
        first.args = vec!["server.mjs".to_string()];
        let first = validate_prepare_request(first, source()).unwrap();
        assert_eq!(first.server.pinned_argument_files.len(), 1);
        let original_digest = first.immutable_digest.clone();

        fs::write(&script, b"export const version = 2;").unwrap();
        let error = revalidate_pinned_argument_files(&first.server.pinned_argument_files)
            .expect_err("changed Node entry must be rejected before spawn");
        assert_eq!(error.code, "invalid_request");

        let mut changed = request(&cwd, McpOperationKind::ListTools);
        changed.args = vec!["server.mjs".to_string()];
        let changed = validate_prepare_request(changed, source()).unwrap();
        assert_ne!(original_digest, changed.immutable_digest);

        drop(first);
        drop(changed);
        fs::remove_dir_all(&cwd).unwrap();
    }

    #[test]
    fn interpreter_allowlist_requires_a_known_local_entry_file() {
        let cwd = std::env::temp_dir();
        let mut no_entry = request(&cwd, McpOperationKind::ListTools);
        no_entry.args = vec!["--no-warnings".to_string()];
        assert!(validate_prepare_request(no_entry, source()).is_err());

        for executable in ["node.exe", "python3.13.exe", "php-cgi.exe", "lua5.4.exe"] {
            assert!(
                is_pinned_entry_interpreter(Path::new(executable)),
                "{executable}"
            );
        }
        for executable in ["java.exe", "javaw.exe", "deno.exe", "bun.exe"] {
            assert!(is_unsupported_interpreter(Path::new(executable)));
        }
    }

    #[test]
    fn interpreter_preload_and_module_flags_cannot_precede_the_entry() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("preload.js"), b"export {};").unwrap();
        fs::write(cwd.join("server.mjs"), b"export {};").unwrap();

        let mut node = request(&cwd, McpOperationKind::ListTools);
        node.args = vec![
            "--require".to_string(),
            "preload.js".to_string(),
            "server.mjs".to_string(),
        ];
        assert!(validate_prepare_request(node, source()).is_err());

        let python = cwd.join("python.exe");
        fs::write(&python, b"fake python").unwrap();
        let python = McpPrepareRequest {
            executable: python.to_string_lossy().into_owned(),
            args: vec!["-m".to_string(), "package_server".to_string()],
            cwd: cwd.to_string_lossy().into_owned(),
            env: BTreeMap::new(),
            operation: McpOperationKind::ListTools,
            tool: None,
            arguments: None,
        };
        assert!(validate_prepare_request(python, source()).is_err());

        let java = cwd.join("java.exe");
        fs::write(&java, b"fake java").unwrap();
        fs::write(cwd.join("agent.jar"), b"agent").unwrap();
        fs::write(cwd.join("server.jar"), b"server").unwrap();
        let java = McpPrepareRequest {
            executable: java.to_string_lossy().into_owned(),
            args: vec![
                "-javaagent:agent.jar".to_string(),
                "-jar".to_string(),
                "server.jar".to_string(),
            ],
            cwd: cwd.to_string_lossy().into_owned(),
            env: BTreeMap::new(),
            operation: McpOperationKind::ListTools,
            tool: None,
            arguments: None,
        };
        assert!(validate_prepare_request(java, source()).is_err());

        let mut normal_node = request(&cwd, McpOperationKind::ListTools);
        normal_node.args = vec!["server.mjs".to_string(), "--script-flag".to_string()];
        assert!(validate_prepare_request(normal_node, source()).is_ok());

        fs::remove_dir_all(&cwd).unwrap();
    }

    #[test]
    fn executable_metadata_change_is_rejected_before_spawn() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let executable = cwd.join("identity-test.bin");
        fs::write(&executable, b"first").unwrap();
        let identity = capture_path_identity(
            executable.to_str().unwrap(),
            true,
            MAX_EXECUTABLE_BYTES,
            "MCP executable",
        )
        .unwrap();

        fs::write(&executable, b"changed-and-longer").unwrap();
        let error = revalidate_path_identity(&identity, true, "MCP executable")
            .expect_err("changed executable must be rejected");
        assert_eq!(error.code, "invalid_request");

        drop(identity);
        fs::remove_dir_all(&cwd).unwrap();
    }

    #[test]
    fn executable_content_change_with_same_identity_size_and_mtime_is_rejected() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let executable = cwd.join("content-test.exe");
        fs::write(&executable, b"first-content").unwrap();
        let make_request = || McpPrepareRequest {
            executable: executable.to_string_lossy().into_owned(),
            args: vec![],
            cwd: cwd.to_string_lossy().into_owned(),
            env: BTreeMap::new(),
            operation: McpOperationKind::ListTools,
            tool: None,
            arguments: None,
        };
        let first = validate_prepare_request(make_request(), source()).unwrap();
        let original_modified = executable.metadata().unwrap().modified().unwrap();

        fs::write(&executable, b"other-content").unwrap();
        File::options()
            .write(true)
            .open(&executable)
            .unwrap()
            .set_modified(original_modified)
            .unwrap();

        revalidate_path_identity(&first.server.executable, true, "MCP executable")
            .expect("identity, size and mtime should still match");
        let error = revalidate_executable(
            &first.server.executable,
            &first.server.executable_content_sha256,
        )
        .expect_err("changed executable content must be rejected");
        assert_eq!(error.code, "invalid_request");

        let changed = validate_prepare_request(make_request(), source()).unwrap();
        assert_ne!(first.immutable_digest, changed.immutable_digest);

        drop(first);
        drop(changed);
        fs::remove_dir_all(&cwd).unwrap();
    }

    #[test]
    fn intent_ids_are_csprng_single_use_source_bound_expiring_and_cancellable() {
        let cwd = std::env::temp_dir();
        let state = McpHostState::new();
        let one = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let two = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        assert_ne!(one.intent_id, two.intent_id);
        assert_eq!(one.intent_id.len(), 36);
        assert_eq!(state.lifecycle_name(&one.intent_id), Some("prepared"));

        let other_source = IntentSource {
            window_label: "rpn".to_string(),
            origin: "https://tauri.localhost".to_string(),
        };
        assert!(state
            .begin_approval(&one.intent_id, &other_source, Instant::now())
            .is_err());
        let (_, cancel) = state
            .begin_approval(&one.intent_id, &source(), Instant::now())
            .unwrap();
        assert_eq!(
            state.lifecycle_name(&one.intent_id),
            Some("awaitingApproval")
        );
        state
            .begin_running(&one.intent_id, &source(), &cancel)
            .unwrap();
        assert_eq!(state.lifecycle_name(&one.intent_id), Some("running"));
        state.finish(&one.intent_id, false);
        assert_eq!(state.lifecycle_name(&one.intent_id), Some("finished"));
        assert!(state
            .begin_approval(&one.intent_id, &source(), Instant::now())
            .is_err());

        let raced = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let (_, raced_cancel) = state
            .begin_approval(&raced.intent_id, &source(), Instant::now())
            .unwrap();
        state
            .begin_running(&raced.intent_id, &source(), &raced_cancel)
            .unwrap();
        assert!(state.cancel(&raced.intent_id, &source()).unwrap());
        assert!(!state.finish(&raced.intent_id, false));
        assert_eq!(state.lifecycle_name(&raced.intent_id), Some("cancelled"));

        assert!(state.cancel(&two.intent_id, &source()).unwrap());
        assert!(state.lifecycle_name(&two.intent_id).is_none());

        let expired = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        {
            let mut intents = state.inner.intents.lock().unwrap();
            intents.get_mut(&expired.intent_id).unwrap().created_at =
                Instant::now() - INTENT_TTL - Duration::from_secs(1);
        }
        assert_eq!(
            state
                .begin_approval(&expired.intent_id, &source(), Instant::now())
                .err()
                .unwrap()
                .code,
            "intent_expired"
        );
    }

    #[test]
    fn global_cancel_covers_prepared_awaiting_and_running_intents() {
        let cwd = std::env::temp_dir();
        let state = McpHostState::new();
        let prepared_summary =
            prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let awaiting = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let (_, awaiting_cancel) = state
            .begin_approval(&awaiting.intent_id, &source(), Instant::now())
            .unwrap();
        let running = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let (_, running_cancel) = state
            .begin_approval(&running.intent_id, &source(), Instant::now())
            .unwrap();
        state
            .begin_running(&running.intent_id, &source(), &running_cancel)
            .unwrap();

        assert_eq!(state.cancel_all(), 3);
        assert!(awaiting_cancel.is_cancelled());
        assert!(running_cancel.is_cancelled());
        for intent_id in [
            prepared_summary.intent_id,
            awaiting.intent_id,
            running.intent_id,
        ] {
            assert_eq!(state.lifecycle_name(&intent_id), Some("cancelled"));
        }
    }

    #[tokio::test]
    async fn approval_decision_injection_runs_off_thread() {
        assert!(request_approval_with(|| true).await.unwrap());
        assert!(!request_approval_with(|| false).await.unwrap());
    }

    #[tokio::test]
    async fn unapproved_intent_never_calls_runner() {
        let cwd = std::env::temp_dir();
        let state = McpHostState::new();
        let summary = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let called = Arc::new(AtomicBool::new(false));
        let called_in_runner = called.clone();
        let result = execute_intent_flow(
            &state,
            &summary.intent_id,
            &source(),
            |_| async { Ok(false) },
            move |_, _| async move {
                called_in_runner.store(true, Ordering::SeqCst);
                Err(McpHostError::new("unexpected", "runner executed", false))
            },
        )
        .await;
        assert_eq!(result.err().unwrap().code, "cancelled");
        assert!(!called.load(Ordering::SeqCst));
        assert_eq!(state.lifecycle_name(&summary.intent_id), Some("cancelled"));
    }

    #[test]
    fn execution_and_native_approval_limits_are_stable() {
        let state = McpHostState::new();
        assert_eq!(state.active_execution_count(), 0);
        let first = state.reserve_execution().unwrap();
        assert_eq!(state.active_execution_count(), 1);
        let second = state.reserve_execution().unwrap();
        assert_eq!(state.active_execution_count(), 2);
        assert_eq!(state.reserve_execution().err().unwrap().code, "busy");
        drop(first);
        assert_eq!(state.active_execution_count(), 1);
        assert!(state.reserve_execution().is_ok());
        drop(second);

        let approval = state.reserve_native_approval().unwrap();
        assert_eq!(
            state.reserve_native_approval().err().unwrap().code,
            "approval_busy"
        );
        drop(approval);
        assert!(state.reserve_native_approval().is_ok());
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_running_intent_signals_runner() {
        let cwd = std::env::temp_dir();
        let state = McpHostState::new();
        let summary = prepare_in_state(&state, prepared(&cwd, McpOperationKind::ListTools));
        let started = Arc::new(Notify::new());
        let started_in_runner = started.clone();
        let state_in_task = state.clone();
        let intent_id = summary.intent_id.clone();
        let task = tokio::spawn(async move {
            execute_intent_flow(
                &state_in_task,
                &intent_id,
                &source(),
                |_| async { Ok(true) },
                move |_, cancel| async move {
                    started_in_runner.notify_one();
                    cancel.cancelled().await;
                    Err(McpHostError::cancelled("cancelled by test"))
                },
            )
            .await
        });
        started.notified().await;
        assert!(state.cancel(&summary.intent_id, &source()).unwrap());
        assert_eq!(task.await.unwrap().err().unwrap().code, "cancelled");
        assert_eq!(state.lifecycle_name(&summary.intent_id), Some("cancelled"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn node_stdio_mock_lists_and_calls_tools_with_clean_env() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let script = cwd.join("mock-mcp.cjs");
        fs::write(
            &script,
            r#"const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'rpn-test-mcp',
          version: '1.0.0',
          parentSecretVisible: Object.hasOwn(process.env, 'RPN_MCP_PARENT_SECRET'),
          pathVisible: Object.hasOwn(process.env, 'PATH')
        }
      }
    });
    return;
  }
  if (message.method === 'notifications/initialized') {
    send({ jsonrpc: '2.0', method: 'notifications/test', params: {} });
    return;
  }
  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{
          name: 'echo',
          description: 'Echo text',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true }
        }]
      }
    });
    return;
  }
  if (message.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [{ type: 'text', text: message.params.arguments.text }],
        isError: false
      }
    });
  }
});
"#,
        )
        .unwrap();

        let previous_secret = std::env::var_os("RPN_MCP_PARENT_SECRET");
        std::env::set_var("RPN_MCP_PARENT_SECRET", "parent-only-secret");

        let state = McpHostState::new();
        let mut list = runtime_request(&cwd, McpOperationKind::ListTools);
        list.args = vec![script.to_string_lossy().into_owned()];
        list.env
            .insert("MCP_TEST_TOKEN".to_string(), "explicit".to_string());
        let list_intent = validate_prepare_request(list, source()).unwrap();
        let list_summary = prepare_in_state(&state, list_intent);
        let list_result = execute_intent_flow(
            &state,
            &list_summary.intent_id,
            &source(),
            |_| async { Ok(true) },
            execute_prepared_intent,
        )
        .await
        .unwrap();
        assert_eq!(list_result.protocol_version, "2025-11-25");
        assert_eq!(list_result.server_info["name"], "rpn-test-mcp");
        assert_eq!(list_result.server_info["parentSecretVisible"], false);
        assert_eq!(list_result.server_info["pathVisible"], false);
        assert_eq!(list_result.tools.as_ref().unwrap()[0]["name"], "echo");
        assert!(!list_result.annotations_trusted);
        assert_eq!(
            list_result.approval_receipt.intent_id,
            list_summary.intent_id
        );
        assert_eq!(
            list_result.approval_receipt.immutable_digest,
            list_summary.immutable_digest
        );

        let mut call = runtime_request(&cwd, McpOperationKind::CallTool);
        call.args = vec![script.to_string_lossy().into_owned()];
        call.tool = Some("echo".to_string());
        call.arguments = Some(Map::from_iter([(
            "text".to_string(),
            Value::String("hello".to_string()),
        )]));
        let call_intent = validate_prepare_request(call, source()).unwrap();
        let call_summary = prepare_in_state(&state, call_intent);
        let call_result = execute_intent_flow(
            &state,
            &call_summary.intent_id,
            &source(),
            |_| async { Ok(true) },
            execute_prepared_intent,
        )
        .await
        .unwrap();
        assert_eq!(call_result.content.as_ref().unwrap()[0]["text"], "hello");
        assert_eq!(call_result.is_error, Some(false));

        match previous_secret {
            Some(value) => std::env::set_var("RPN_MCP_PARENT_SECRET", value),
            None => std::env::remove_var("RPN_MCP_PARENT_SECRET"),
        }
        fs::remove_dir_all(&cwd).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn cancelling_stdio_execution_kills_the_process_tree() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let script = cwd.join("slow-mcp.cjs");
        let heartbeat_script = cwd.join("heartbeat-child.cjs");
        let heartbeat = cwd.join("heartbeat.txt");
        fs::write(
            &heartbeat_script,
            r#"const fs = require('node:fs');
const heartbeat = process.argv[2];
setInterval(() => fs.appendFileSync(heartbeat, 'x'), 20);
"#,
        )
        .unwrap();
        fs::write(
            &script,
            r#"const { spawn } = require('node:child_process');
const readline = require('node:readline');
const heartbeatScript = process.argv[2];
const heartbeat = process.argv[3];
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'slow-rpn-test-mcp', version: '1.0.0' }
      }
    });
    return;
  }
  if (message.method === 'tools/list') {
    spawn(process.execPath, [heartbeatScript, heartbeat], { stdio: 'ignore' });
  }
});
"#,
        )
        .unwrap();

        let state = McpHostState::new();
        let mut value = runtime_request(&cwd, McpOperationKind::ListTools);
        value.args = vec![
            script.to_string_lossy().into_owned(),
            heartbeat_script.to_string_lossy().into_owned(),
            heartbeat.to_string_lossy().into_owned(),
        ];
        let summary = prepare_in_state(&state, validate_prepare_request(value, source()).unwrap());
        let state_in_task = state.clone();
        let intent_id = summary.intent_id.clone();
        let task = tokio::spawn(async move {
            execute_intent_flow(
                &state_in_task,
                &intent_id,
                &source(),
                |_| async { Ok(true) },
                execute_prepared_intent,
            )
            .await
        });

        timeout(Duration::from_secs(5), async {
            loop {
                if fs::metadata(&heartbeat).is_ok_and(|metadata| metadata.len() > 0) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .expect("child process never wrote heartbeat");

        assert!(state.cancel(&summary.intent_id, &source()).unwrap());
        let error = timeout(Duration::from_secs(5), task)
            .await
            .expect("cancelled MCP execution did not finish")
            .unwrap()
            .expect_err("cancelled MCP execution unexpectedly succeeded");
        assert_eq!(error.code, "cancelled");

        let stopped_at = fs::metadata(&heartbeat).unwrap().len();
        tokio::time::sleep(Duration::from_millis(250)).await;
        assert_eq!(
            fs::metadata(&heartbeat).unwrap().len(),
            stopped_at,
            "heartbeat continued after the child should have been killed"
        );

        fs::remove_dir_all(&cwd).unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stderr_limit_terminates_stdio_execution_promptly() {
        let cwd = temp_test_dir();
        fs::create_dir_all(&cwd).unwrap();
        let script = cwd.join("stderr-flood-mcp.cjs");
        fs::write(
            &script,
            r#"const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
rl.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'stderr-rpn-test-mcp', version: '1.0.0' }
      }
    });
    return;
  }
  if (message.method === 'tools/list') {
    process.stderr.write(Buffer.alloc(300 * 1024, 120));
    setInterval(() => {}, 1000);
  }
});
"#,
        )
        .unwrap();

        let state = McpHostState::new();
        let mut value = runtime_request(&cwd, McpOperationKind::ListTools);
        value.args = vec![script.to_string_lossy().into_owned()];
        let summary = prepare_in_state(&state, validate_prepare_request(value, source()).unwrap());
        let started = Instant::now();
        let error = timeout(
            Duration::from_secs(5),
            execute_intent_flow(
                &state,
                &summary.intent_id,
                &source(),
                |_| async { Ok(true) },
                execute_prepared_intent,
            ),
        )
        .await
        .expect("stderr limit did not stop MCP execution promptly")
        .expect_err("stderr flood unexpectedly succeeded");

        assert_eq!(error.code, "output_limit");
        assert!(started.elapsed() < Duration::from_secs(5));
        fs::remove_dir_all(&cwd).unwrap();
    }

    #[test]
    fn only_supported_protocol_versions_are_accepted() {
        for version in SUPPORTED_PROTOCOL_VERSIONS {
            let result = json!({
                "protocolVersion": version,
                "serverInfo": { "name": "test", "version": "1" }
            });
            assert!(parse_initialize_result(&result).is_ok(), "{version}");
        }
        let unsupported = json!({
            "protocolVersion": "2099-01-01",
            "serverInfo": { "name": "test", "version": "1" }
        });
        assert!(parse_initialize_result(&unsupported).is_err());
    }
}
