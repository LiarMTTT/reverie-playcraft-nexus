use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    header::{HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
    Client, Method,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    error::Error,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{State, Url, WebviewWindow};
use tokio::net::lookup_host;
use tokio_util::sync::CancellationToken;

const RPN_WINDOW_LABEL: &str = "rpn";
const MAX_CONCURRENT_REQUESTS: usize = 8;
const MAX_REQUEST_ID_BYTES: usize = 128;
const MAX_MODEL_ID_BYTES: usize = 128;
const MAX_URL_BYTES: usize = 8 * 1024;
const MAX_HEADER_COUNT: usize = 24;
const MAX_HEADER_NAME_BYTES: usize = 64;
const MAX_HEADER_VALUE_BYTES: usize = 16 * 1024;
const MAX_TOTAL_HEADER_BYTES: usize = 64 * 1024;
const MAX_REQUEST_BODY_BYTES: usize = 8 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS: u64 = 120_000;
const MIN_TIMEOUT_MS: u64 = 1;
const MAX_TIMEOUT_MS: u64 = 300_000;
const CONNECT_TIMEOUT_SECONDS: u64 = 15;
const PRE_CANCEL_TTL: Duration = Duration::from_secs(5);
const MAX_PRE_CANCELLED_REQUESTS: usize = 64;

const ALLOWED_REQUEST_HEADERS: &[&str] = &[
    "accept",
    "anthropic-beta",
    "anthropic-version",
    "api-key",
    "authorization",
    "content-type",
    "openai-organization",
    "openai-project",
    "x-api-key",
    "x-goog-api-key",
];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AiTransportRequest {
    request_id: String,
    base_url: String,
    operation: AiOperation,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    network_mode: NetworkMode,
    #[serde(default)]
    headers: BTreeMap<String, String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    max_response_bytes: usize,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum AiOperation {
    Models,
    ChatCompletions,
    Responses,
    AnthropicModels,
    AnthropicMessages,
    GeminiModels,
    GeminiGenerateContent,
    CohereModels,
    CohereChat,
    DashscopeGeneration,
    OllamaTags,
    OllamaChat,
}

impl AiOperation {
    fn endpoint(self, model: Option<&str>) -> Result<String, AiTransportError> {
        match self {
            Self::Models | Self::AnthropicModels | Self::GeminiModels => {
                require_no_model(model)?;
                Ok("/models".to_string())
            }
            Self::ChatCompletions => {
                require_no_model(model)?;
                Ok("/chat/completions".to_string())
            }
            Self::Responses => {
                require_no_model(model)?;
                Ok("/responses".to_string())
            }
            Self::AnthropicMessages => {
                require_no_model(model)?;
                Ok("/messages".to_string())
            }
            Self::GeminiGenerateContent => {
                let model = model.ok_or_else(|| {
                    AiTransportError::invalid("geminiGenerateContent 操作必须提供受限的 model 字段")
                })?;
                validate_gemini_model(model)?;
                Ok(format!("/models/{model}:generateContent"))
            }
            Self::CohereModels => {
                require_no_model(model)?;
                Ok("/v1/models".to_string())
            }
            Self::CohereChat => {
                require_no_model(model)?;
                Ok("/v2/chat".to_string())
            }
            Self::DashscopeGeneration => {
                require_no_model(model)?;
                Ok("/services/aigc/text-generation/generation".to_string())
            }
            Self::OllamaTags => {
                require_no_model(model)?;
                Ok("/api/tags".to_string())
            }
            Self::OllamaChat => {
                require_no_model(model)?;
                Ok("/api/chat".to_string())
            }
        }
    }

    fn method(self) -> Method {
        match self {
            Self::Models
            | Self::AnthropicModels
            | Self::GeminiModels
            | Self::CohereModels
            | Self::OllamaTags => Method::GET,
            Self::ChatCompletions
            | Self::Responses
            | Self::AnthropicMessages
            | Self::GeminiGenerateContent
            | Self::CohereChat
            | Self::DashscopeGeneration
            | Self::OllamaChat => Method::POST,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
enum NetworkMode {
    #[default]
    Direct,
    SystemProxy,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiTransportResponse {
    status: u16,
    headers: BTreeMap<String, String>,
    body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiTransportError {
    code: &'static str,
    message: String,
    retryable: bool,
}

impl AiTransportError {
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

    fn transport(message: impl Into<String>, retryable: bool) -> Self {
        Self::new("transport", message, retryable)
    }
}

struct ValidatedRequest {
    request_id: String,
    url: Url,
    method: Method,
    headers: HeaderMap,
    body: Option<String>,
    timeout: Duration,
    max_response_bytes: usize,
    target: TargetClass,
    network_mode: NetworkMode,
}

#[derive(Default)]
struct AiRequestRegistry {
    active: HashMap<String, CancellationToken>,
    pre_cancelled: HashMap<String, Instant>,
}

type SharedRequestRegistry = Arc<Mutex<AiRequestRegistry>>;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TargetClass {
    Public,
    Loopback,
}

#[derive(Debug)]
struct GlobalDnsResolver;

impl Resolve for GlobalDnsResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addresses = lookup_host((host.as_str(), 0))
                .await
                .map_err(|error| Box::new(error) as Box<dyn Error + Send + Sync>)?
                .filter(|address| is_global_ip(address.ip()))
                .collect::<Vec<_>>();
            if addresses.is_empty() {
                let error: Box<dyn Error + Send + Sync> = Box::new(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "AI service DNS did not resolve to a global address",
                ));
                return Err(error);
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}

pub(crate) struct AiTransportState {
    direct_public_client: Client,
    system_proxy_client: Client,
    loopback_client: Client,
    requests: SharedRequestRegistry,
}

impl AiTransportState {
    pub(crate) fn new() -> Result<Self, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let base_builder = || {
            Client::builder()
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECONDS))
                .pool_idle_timeout(Duration::from_secs(90))
                .pool_max_idle_per_host(4)
                .referer(false)
        };
        let direct_public_client = base_builder()
            .no_proxy()
            .dns_resolver(GlobalDnsResolver)
            .build()
            .map_err(|_| "无法初始化直连 AI 网络通道".to_string())?;
        // systemProxy is an explicit trusted-proxy boundary. Its default resolver
        // and system proxy configuration are intentionally kept together.
        let system_proxy_client = base_builder()
            .build()
            .map_err(|_| "无法初始化系统代理 AI 网络通道".to_string())?;
        let loopback_client = base_builder()
            .no_proxy()
            .resolve_to_addrs(
                "localhost",
                &[
                    SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
                    SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 0),
                ],
            )
            .build()
            .map_err(|_| "无法初始化本机 AI 网络通道".to_string())?;
        Ok(Self {
            direct_public_client,
            system_proxy_client,
            loopback_client,
            requests: Arc::new(Mutex::new(AiRequestRegistry::default())),
        })
    }

    fn client_for(&self, target: TargetClass, network_mode: NetworkMode) -> Client {
        match target {
            TargetClass::Loopback => self.loopback_client.clone(),
            TargetClass::Public if network_mode == NetworkMode::SystemProxy => {
                self.system_proxy_client.clone()
            }
            TargetClass::Public => self.direct_public_client.clone(),
        }
    }

    fn register(
        &self,
        request_id: &str,
    ) -> Result<(CancellationToken, InFlightGuard), AiTransportError> {
        let mut registry = self
            .requests
            .lock()
            .map_err(|_| AiTransportError::transport("AI 请求状态不可用，请重启桌面程序", false))?;
        let now = Instant::now();
        registry
            .pre_cancelled
            .retain(|_, created_at| now.duration_since(*created_at) <= PRE_CANCEL_TTL);
        if registry.active.contains_key(request_id) {
            return Err(AiTransportError::invalid("requestId 已在使用"));
        }
        if registry.active.len() >= MAX_CONCURRENT_REQUESTS {
            return Err(AiTransportError::new(
                "busy",
                format!("并发 AI 请求已达到上限（{MAX_CONCURRENT_REQUESTS}）"),
                true,
            ));
        }
        let token = CancellationToken::new();
        if registry.pre_cancelled.remove(request_id).is_some() {
            token.cancel();
        }
        registry
            .active
            .insert(request_id.to_string(), token.clone());
        let guard = InFlightGuard {
            request_id: request_id.to_string(),
            requests: self.requests.clone(),
        };
        Ok((token, guard))
    }

    fn cancel(&self, request_id: &str) -> Result<bool, AiTransportError> {
        let mut registry = self
            .requests
            .lock()
            .map_err(|_| AiTransportError::transport("AI 请求状态不可用，请重启桌面程序", false))?;
        if let Some(token) = registry.active.get(request_id).cloned() {
            token.cancel();
            return Ok(true);
        }
        let now = Instant::now();
        registry
            .pre_cancelled
            .retain(|_, created_at| now.duration_since(*created_at) <= PRE_CANCEL_TTL);
        if registry.pre_cancelled.len() >= MAX_PRE_CANCELLED_REQUESTS
            && !registry.pre_cancelled.contains_key(request_id)
        {
            if let Some(oldest) = registry
                .pre_cancelled
                .iter()
                .min_by_key(|(_, created_at)| **created_at)
                .map(|(id, _)| id.clone())
            {
                registry.pre_cancelled.remove(&oldest);
            }
        }
        registry.pre_cancelled.insert(request_id.to_string(), now);
        Ok(true)
    }
}

struct InFlightGuard {
    request_id: String,
    requests: SharedRequestRegistry,
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.requests.lock() {
            registry.active.remove(&self.request_id);
        }
    }
}

fn is_bundled_rpn_url(url: &Url) -> bool {
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return false;
    }
    match (url.scheme(), url.host_str()) {
        ("tauri", Some(host)) => host.eq_ignore_ascii_case("localhost"),
        ("http" | "https", Some(host)) => host.eq_ignore_ascii_case("tauri.localhost"),
        _ => false,
    }
}

pub(crate) fn ensure_bundled_rpn(window: &WebviewWindow) -> Result<(), AiTransportError> {
    if window.label() != RPN_WINDOW_LABEL {
        return Err(AiTransportError::forbidden(
            "此命令只允许由内置 RPN 窗口调用",
        ));
    }
    let url = window
        .url()
        .map_err(|_| AiTransportError::forbidden("无法确认 RPN 页面来源"))?;
    if !is_bundled_rpn_url(&url) {
        return Err(AiTransportError::forbidden(
            "当前页面不是受信任的 RPN 内置页面",
        ));
    }
    Ok(())
}

fn validate_request_id(value: &str) -> Result<(), AiTransportError> {
    if value.is_empty() || value.len() > MAX_REQUEST_ID_BYTES {
        return Err(AiTransportError::invalid(
            "requestId 长度必须为 1–128 个 ASCII 字符",
        ));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':'))
    {
        return Err(AiTransportError::invalid(
            "requestId 只能包含字母、数字、-、_、. 或 :",
        ));
    }
    Ok(())
}

fn require_no_model(model: Option<&str>) -> Result<(), AiTransportError> {
    if model.is_some() {
        return Err(AiTransportError::invalid(
            "model 字段只允许用于 geminiGenerateContent 操作",
        ));
    }
    Ok(())
}

fn validate_gemini_model(model: &str) -> Result<(), AiTransportError> {
    if model.is_empty() || model.len() > MAX_MODEL_ID_BYTES {
        return Err(AiTransportError::invalid(
            "Gemini model 长度必须为 1–128 个 ASCII 字符",
        ));
    }
    if !model
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_alphanumeric())
        || !model
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(AiTransportError::invalid(
            "Gemini model 只能是以字母或数字开头的单段模型标识",
        ));
    }
    Ok(())
}

fn normalized_host(host: &str) -> &str {
    host.strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
        .unwrap_or(host)
}

fn is_global_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !matches!(
        (a, b, c),
        (0, _, _)
            | (10, _, _)
            | (100, 64..=127, _)
            | (127, _, _)
            | (169, 254, _)
            | (172, 16..=31, _)
            | (192, 0, 0)
            | (192, 0, 2)
            | (192, 88, 99)
            | (192, 168, _)
            | (198, 18..=19, _)
            | (198, 51, 100)
            | (203, 0, 113)
            | (224..=255, _, _)
    )
}

fn is_global_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let is_global_unicast = segments[0] & 0xe000 == 0x2000;
    let is_protocol_assignment = segments[0] == 0x2001 && segments[1] <= 0x01ff;
    let is_six_to_four = segments[0] == 0x2002;
    let is_documentation = (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0);
    is_global_unicast && !is_protocol_assignment && !is_six_to_four && !is_documentation
}

fn is_global_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_global_ipv4(address),
        IpAddr::V6(address) => is_global_ipv6(address),
    }
}

fn classify_target(host: &str) -> Result<TargetClass, AiTransportError> {
    let host = normalized_host(host);
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(TargetClass::Loopback);
    }
    if let Ok(address) = IpAddr::from_str(host) {
        if address.is_loopback() {
            return Ok(TargetClass::Loopback);
        }
        if is_global_ip(address) {
            return Ok(TargetClass::Public);
        }
        return Err(AiTransportError::invalid(
            "AI Base URL 的 IP 地址不是 global 或 loopback",
        ));
    }
    Ok(TargetClass::Public)
}

fn is_operation_endpoint(path: &str) -> bool {
    let path = path.trim_end_matches('/').to_ascii_lowercase();
    path == "/models"
        || path.ends_with("/models")
        || path == "/chat/completions"
        || path.ends_with("/chat/completions")
        || path == "/responses"
        || path.ends_with("/responses")
        || path == "/messages"
        || path.ends_with("/messages")
        || path == "/v2/chat"
        || path.ends_with("/v2/chat")
        || path == "/services/aigc/text-generation/generation"
        || path.ends_with("/services/aigc/text-generation/generation")
        || path == "/api/tags"
        || path.ends_with("/api/tags")
        || path == "/api/chat"
        || path.ends_with("/api/chat")
        || path.ends_with(":generatecontent")
}

fn validate_base_url(value: &str) -> Result<(Url, TargetClass), AiTransportError> {
    if value.len() > MAX_URL_BYTES {
        return Err(AiTransportError::invalid("AI Base URL 过长"));
    }
    let url = Url::parse(value).map_err(|_| AiTransportError::invalid("AI Base URL 无效"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(AiTransportError::invalid(
            "AI Base URL 只允许 http 或 https",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AiTransportError::invalid(
            "AI Base URL 不得包含用户名或密码",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(AiTransportError::invalid(
            "AI Base URL 不得包含 query 或 fragment",
        ));
    }
    if is_operation_endpoint(url.path()) {
        return Err(AiTransportError::invalid(
            "AI Base URL 不得包含具体模型 API endpoint",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AiTransportError::invalid("AI Base URL 缺少主机名"))?;
    let target = classify_target(host)?;
    if target == TargetClass::Public && url.scheme() != "https" {
        return Err(AiTransportError::invalid(
            "公网 AI Base URL 必须使用 https；http 仅允许显式 loopback",
        ));
    }
    Ok((url, target))
}

fn operation_url(mut base_url: Url, endpoint: &str) -> Url {
    let base_path = base_url.path().trim_end_matches('/');
    base_url.set_path(&format!("{base_path}{endpoint}"));
    base_url
}

fn validate_headers(values: BTreeMap<String, String>) -> Result<HeaderMap, AiTransportError> {
    if values.len() > MAX_HEADER_COUNT {
        return Err(AiTransportError::invalid("AI 请求 header 数量超过上限"));
    }
    let mut total_bytes = 0usize;
    let mut seen = HashSet::new();
    let mut headers = HeaderMap::new();
    for (name, value) in values {
        if name.len() > MAX_HEADER_NAME_BYTES || value.len() > MAX_HEADER_VALUE_BYTES {
            return Err(AiTransportError::invalid("AI 请求 header 超过大小上限"));
        }
        let normalized_name = name.to_ascii_lowercase();
        if !ALLOWED_REQUEST_HEADERS.contains(&normalized_name.as_str()) {
            return Err(AiTransportError::invalid(format!(
                "不允许发送 header：{name}"
            )));
        }
        if !seen.insert(normalized_name.clone()) {
            return Err(AiTransportError::invalid(format!(
                "AI 请求 header 重复：{name}"
            )));
        }
        total_bytes = total_bytes.saturating_add(name.len() + value.len());
        if total_bytes > MAX_TOTAL_HEADER_BYTES {
            return Err(AiTransportError::invalid("AI 请求 header 总大小超过上限"));
        }
        let header_name = HeaderName::from_bytes(normalized_name.as_bytes())
            .map_err(|_| AiTransportError::invalid(format!("header 名称无效：{name}")))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|_| AiTransportError::invalid(format!("header 值无效：{name}")))?;
        headers.insert(header_name, header_value);
    }
    Ok(headers)
}

fn validate_request(request: AiTransportRequest) -> Result<ValidatedRequest, AiTransportError> {
    validate_request_id(&request.request_id)?;
    let (base_url, target) = validate_base_url(request.base_url.trim())?;
    let endpoint = request.operation.endpoint(request.model.as_deref())?;
    let url = operation_url(base_url, &endpoint);
    let method = request.operation.method();
    let headers = validate_headers(request.headers)?;
    let body = match method {
        Method::GET => {
            if request.body.is_some() {
                return Err(AiTransportError::invalid("GET 操作不得包含请求正文"));
            }
            None
        }
        Method::POST => match request.body {
            Some(body) if !body.is_empty() => Some(body),
            _ => return Err(AiTransportError::invalid("POST 操作必须包含请求正文")),
        },
        _ => unreachable!("AI operation methods are limited to GET and POST"),
    };
    let body_bytes = body.as_ref().map_or(0, |body| body.len());
    if body_bytes > MAX_REQUEST_BODY_BYTES {
        return Err(AiTransportError::invalid(format!(
            "AI 请求正文不能超过 {} MiB",
            MAX_REQUEST_BODY_BYTES / 1024 / 1024
        )));
    }
    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if !(MIN_TIMEOUT_MS..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(AiTransportError::invalid(format!(
            "timeoutMs 必须位于 {MIN_TIMEOUT_MS}–{MAX_TIMEOUT_MS} 之间"
        )));
    }
    if !(1..=MAX_RESPONSE_BODY_BYTES).contains(&request.max_response_bytes) {
        return Err(AiTransportError::invalid(format!(
            "maxResponseBytes 必须位于 1–{MAX_RESPONSE_BODY_BYTES} 之间"
        )));
    }
    Ok(ValidatedRequest {
        request_id: request.request_id,
        url,
        method,
        headers,
        body,
        timeout: Duration::from_millis(timeout_ms),
        max_response_bytes: request.max_response_bytes,
        target,
        network_mode: request.network_mode,
    })
}

fn is_allowed_response_header(name: &str) -> bool {
    matches!(
        name,
        "content-length"
            | "content-type"
            | "location"
            | "openai-processing-ms"
            | "request-id"
            | "retry-after"
            | "www-authenticate"
            | "x-request-id"
    ) || name.starts_with("x-ratelimit-")
}

fn collect_response_headers(headers: &HeaderMap) -> BTreeMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value)| {
            let name = name.as_str();
            if !is_allowed_response_header(name) {
                return None;
            }
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect()
}

fn classify_reqwest_error(error: reqwest::Error) -> AiTransportError {
    if error.is_timeout() {
        return AiTransportError::new("timeout", "AI 服务请求超时", true);
    }

    // Classification uses the internal error chain, but the detail is never returned
    // to the WebView because it may contain a URL or proxy address.
    let detail = format!("{error:?}").to_ascii_lowercase();
    if detail.contains("proxy") || detail.contains("tunnel") || detail.contains("407") {
        AiTransportError::new("proxy", "无法通过系统代理连接 AI 服务", true)
    } else if [
        "tls",
        "ssl",
        "certificate",
        "cert ",
        "handshake",
        "unknownissuer",
    ]
    .iter()
    .any(|token| detail.contains(token))
    {
        AiTransportError::new("tls", "AI 服务 TLS 或证书校验失败", false)
    } else if [
        "dns",
        "resolve",
        "lookup",
        "no such host",
        "name or service",
        "nodename",
    ]
    .iter()
    .any(|token| detail.contains(token))
    {
        AiTransportError::new("dns", "无法解析 AI 服务域名", true)
    } else {
        AiTransportError::transport("无法连接 AI 服务", true)
    }
}

async fn execute_request(
    client: Client,
    request: ValidatedRequest,
) -> Result<AiTransportResponse, AiTransportError> {
    let mut builder = client
        .request(request.method.clone(), request.url)
        .headers(request.headers)
        .timeout(request.timeout);
    if request.method == Method::POST {
        builder = builder.body(request.body.unwrap_or_default());
    }

    let mut response = builder.send().await.map_err(classify_reqwest_error)?;
    if response
        .content_length()
        .is_some_and(|length| length > request.max_response_bytes as u64)
    {
        return Err(AiTransportError::transport(
            "AI 响应正文超过 maxResponseBytes 上限",
            false,
        ));
    }

    let status = response.status().as_u16();
    let headers = collect_response_headers(response.headers());
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(classify_reqwest_error)? {
        if bytes.len().saturating_add(chunk.len()) > request.max_response_bytes {
            return Err(AiTransportError::transport(
                "AI 响应正文超过 maxResponseBytes 上限",
                false,
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes)
        .map_err(|_| AiTransportError::transport("AI 响应不是有效 UTF-8 文本", false))?;
    Ok(AiTransportResponse {
        status,
        headers,
        body,
    })
}

#[tauri::command]
pub(crate) async fn desktop_ai_request(
    window: WebviewWindow,
    state: State<'_, AiTransportState>,
    request: AiTransportRequest,
) -> Result<AiTransportResponse, AiTransportError> {
    ensure_bundled_rpn(&window)?;
    let request = validate_request(request)?;
    let request_id = request.request_id.clone();
    let (token, _guard) = state.register(&request_id)?;
    if token.is_cancelled() {
        return Err(AiTransportError::new("cancelled", "AI 请求已取消", false));
    }
    let client = state.client_for(request.target, request.network_mode);
    match token
        .run_until_cancelled(execute_request(client, request))
        .await
    {
        Some(result) => result,
        None => Err(AiTransportError::new("cancelled", "AI 请求已取消", false)),
    }
}

#[tauri::command]
pub(crate) fn desktop_ai_cancel(
    window: WebviewWindow,
    state: State<'_, AiTransportState>,
    request_id: String,
) -> Result<bool, AiTransportError> {
    ensure_bundled_rpn(&window)?;
    validate_request_id(&request_id)?;
    state.cancel(&request_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(base_url: &str, operation: AiOperation) -> AiTransportRequest {
        AiTransportRequest {
            request_id: "request-1".to_string(),
            base_url: base_url.to_string(),
            operation,
            model: (operation == AiOperation::GeminiGenerateContent)
                .then(|| "gemini-2.5-pro".to_string()),
            network_mode: NetworkMode::Direct,
            headers: BTreeMap::new(),
            body: (operation.method() == Method::POST).then(|| "{}".to_string()),
            timeout_ms: None,
            max_response_bytes: 2 * 1024 * 1024,
        }
    }

    #[test]
    fn only_bundled_rpn_origins_are_trusted() {
        for value in [
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/assets/app.js",
            "tauri://localhost/index.html",
        ] {
            assert!(is_bundled_rpn_url(&Url::parse(value).unwrap()), "{value}");
        }
        for value in [
            "http://localhost/index.html",
            "http://127.0.0.1/index.html",
            "https://tauri.localhost:444/index.html",
            "https://tauri.localhost.evil.test/index.html",
            "https://user@tauri.localhost/index.html",
        ] {
            assert!(!is_bundled_rpn_url(&Url::parse(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn public_https_and_explicit_loopback_base_urls_are_allowed() {
        for (value, target) in [
            ("http://localhost:11434/v1", TargetClass::Loopback),
            ("http://127.0.0.1:11434/v1", TargetClass::Loopback),
            ("https://[::1]:11434/v1", TargetClass::Loopback),
            ("https://api.deepseek.com/v1", TargetClass::Public),
            ("https://8.8.8.8/v1", TargetClass::Public),
        ] {
            assert_eq!(validate_base_url(value).unwrap().1, target, "{value}");
        }
    }

    #[test]
    fn unsafe_or_completed_base_urls_are_rejected() {
        for value in [
            "http://api.example.com/v1",
            "https://10.0.0.1/v1",
            "https://169.254.169.254/v1",
            "https://192.0.2.1/v1",
            "https://[fc00::1]/v1",
            "https://user:secret@example.com/v1/models",
            "https://example.com/v1?key=secret",
            "https://example.com/v1/models#secret",
            "https://example.com/v1/models",
            "https://example.com/v1/chat/completions/",
            "https://example.com/v1/messages",
            "https://example.com/api/tags/",
            "https://example.com/api/chat",
            "https://example.com/v1beta/models/gemini-2.5-pro:generateContent",
            "file:///tmp/model",
            "ftp://example.com/model",
        ] {
            assert!(validate_base_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn only_global_ip_literals_pass_the_public_boundary() {
        for value in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_global_ip(IpAddr::from_str(value).unwrap()), "{value}");
        }
        for value in [
            "0.0.0.0",
            "10.0.0.1",
            "100.64.0.1",
            "127.0.0.1",
            "169.254.1.1",
            "172.16.0.1",
            "192.168.0.1",
            "198.18.0.1",
            "203.0.113.1",
            "224.0.0.1",
            "::1",
            "2001:db8::1",
            "2002:0808:0808::1",
            "3fff::1",
            "fc00::1",
            "fe80::1",
        ] {
            assert!(!is_global_ip(IpAddr::from_str(value).unwrap()), "{value}");
        }
    }

    #[test]
    fn only_explicit_protocol_headers_are_allowed() {
        let headers = BTreeMap::from([
            ("Authorization".to_string(), "Bearer secret".to_string()),
            ("anthropic-version".to_string(), "2023-06-01".to_string()),
            ("x-goog-api-key".to_string(), "secret".to_string()),
        ]);
        assert_eq!(validate_headers(headers).unwrap().len(), 3);
        for name in ["Cookie", "Host", "Origin", "Referer", "Connection"] {
            let headers = BTreeMap::from([(name.to_string(), "value".to_string())]);
            assert_eq!(
                validate_headers(headers).unwrap_err().code,
                "invalid_request"
            );
        }
    }

    #[test]
    fn operation_controls_endpoint_method_and_body() {
        for (operation, base_url, expected_url, expected_method) in [
            (
                AiOperation::Models,
                "https://api.example.com/v1/",
                "https://api.example.com/v1/models",
                Method::GET,
            ),
            (
                AiOperation::ChatCompletions,
                "https://api.example.com/v1",
                "https://api.example.com/v1/chat/completions",
                Method::POST,
            ),
            (
                AiOperation::Responses,
                "https://api.example.com/v1",
                "https://api.example.com/v1/responses",
                Method::POST,
            ),
            (
                AiOperation::AnthropicModels,
                "https://api.example.com/v1",
                "https://api.example.com/v1/models",
                Method::GET,
            ),
            (
                AiOperation::AnthropicMessages,
                "https://api.example.com/v1",
                "https://api.example.com/v1/messages",
                Method::POST,
            ),
            (
                AiOperation::GeminiModels,
                "https://api.example.com/v1beta",
                "https://api.example.com/v1beta/models",
                Method::GET,
            ),
            (
                AiOperation::GeminiGenerateContent,
                "https://api.example.com/v1beta",
                "https://api.example.com/v1beta/models/gemini-2.5-pro:generateContent",
                Method::POST,
            ),
            (
                AiOperation::CohereModels,
                "https://api.cohere.com",
                "https://api.cohere.com/v1/models",
                Method::GET,
            ),
            (
                AiOperation::CohereChat,
                "https://api.cohere.com",
                "https://api.cohere.com/v2/chat",
                Method::POST,
            ),
            (
                AiOperation::DashscopeGeneration,
                "https://dashscope.aliyuncs.com/api/v1",
                "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
                Method::POST,
            ),
            (
                AiOperation::OllamaTags,
                "http://localhost:11434",
                "http://localhost:11434/api/tags",
                Method::GET,
            ),
            (
                AiOperation::OllamaChat,
                "http://localhost:11434",
                "http://localhost:11434/api/chat",
                Method::POST,
            ),
        ] {
            let validated = validate_request(request(base_url, operation)).unwrap();
            assert_eq!(validated.url.as_str(), expected_url, "{operation:?}");
            assert_eq!(validated.method, expected_method, "{operation:?}");
            assert_eq!(
                validated.body.is_some(),
                expected_method == Method::POST,
                "{operation:?}"
            );
        }
    }

    #[test]
    fn request_limits_and_operation_bodies_are_enforced() {
        for operation in [
            AiOperation::Models,
            AiOperation::AnthropicModels,
            AiOperation::GeminiModels,
            AiOperation::CohereModels,
            AiOperation::OllamaTags,
        ] {
            let mut with_body = request("https://api.example.com/v1", operation);
            with_body.body = Some("{}".to_string());
            assert!(validate_request(with_body).is_err(), "{operation:?}");
        }
        for operation in [
            AiOperation::ChatCompletions,
            AiOperation::Responses,
            AiOperation::AnthropicMessages,
            AiOperation::GeminiGenerateContent,
            AiOperation::CohereChat,
            AiOperation::DashscopeGeneration,
            AiOperation::OllamaChat,
        ] {
            let mut without_body = request("https://api.example.com/v1", operation);
            without_body.body = None;
            assert!(validate_request(without_body).is_err(), "{operation:?}");
        }

        let mut invalid_timeout =
            request("https://api.example.com/v1", AiOperation::ChatCompletions);
        invalid_timeout.timeout_ms = Some(MAX_TIMEOUT_MS + 1);
        assert!(validate_request(invalid_timeout).is_err());

        for value in [0, MAX_RESPONSE_BODY_BYTES + 1] {
            let mut invalid_limit =
                request("https://api.example.com/v1", AiOperation::ChatCompletions);
            invalid_limit.max_response_bytes = value;
            assert!(validate_request(invalid_limit).is_err(), "{value}");
        }
    }

    #[test]
    fn gemini_model_is_required_and_cannot_escape_its_path_segment() {
        let base_url = "https://generativelanguage.googleapis.com/v1beta";
        let mut missing = request(base_url, AiOperation::GeminiGenerateContent);
        missing.model = None;
        assert!(validate_request(missing).is_err());

        for value in [
            "",
            "models/gemini-2.5-pro",
            "../gemini-2.5-pro",
            "gemini-2.5-pro?key=secret",
            "gemini-2.5-pro:streamGenerateContent",
            " gemini-2.5-pro",
            "模型",
        ] {
            let mut invalid = request(base_url, AiOperation::GeminiGenerateContent);
            invalid.model = Some(value.to_string());
            assert!(validate_request(invalid).is_err(), "{value}");
        }

        let mut unexpected = request("https://api.example.com/v1", AiOperation::Models);
        unexpected.model = Some("gemini-2.5-pro".to_string());
        assert!(validate_request(unexpected).is_err());
    }

    #[test]
    fn request_schema_rejects_generic_fetch_fields() {
        let valid = serde_json::json!({
            "requestId": "request-1",
            "baseUrl": "https://api.example.com/v1",
            "operation": "models",
            "networkMode": "direct",
            "headers": {},
            "body": null,
            "timeoutMs": 30_000,
            "maxResponseBytes": 2_097_152
        });
        assert!(serde_json::from_value::<AiTransportRequest>(valid).is_ok());
        let defaults = serde_json::json!({
            "requestId": "request-2",
            "baseUrl": "https://api.example.com/v1",
            "operation": "models",
            "headers": {},
            "body": null,
            "timeoutMs": 30_000,
            "maxResponseBytes": 2_097_152
        });
        assert_eq!(
            serde_json::from_value::<AiTransportRequest>(defaults)
                .unwrap()
                .network_mode,
            NetworkMode::Direct
        );
        for value in ["direct", "systemProxy"] {
            let mut request = serde_json::json!({
                "requestId": "request-3",
                "baseUrl": "https://api.example.com/v1",
                "operation": "models",
                "headers": {},
                "body": null,
                "timeoutMs": 30_000,
                "maxResponseBytes": 2_097_152
            });
            request["networkMode"] = serde_json::json!(value);
            assert!(
                serde_json::from_value::<AiTransportRequest>(request).is_ok(),
                "{value}"
            );
        }
        let mut invalid_mode = serde_json::json!({
            "requestId": "request-4",
            "baseUrl": "https://api.example.com/v1",
            "operation": "models",
            "headers": {},
            "body": null,
            "timeoutMs": 30_000,
            "maxResponseBytes": 2_097_152
        });
        invalid_mode["networkMode"] = serde_json::json!("auto");
        assert!(serde_json::from_value::<AiTransportRequest>(invalid_mode).is_err());
        let generic_fetch = serde_json::json!({
            "requestId": "request-1",
            "url": "https://api.example.com/v1/models",
            "method": "GET",
            "headers": {},
            "body": null,
            "timeoutMs": 30_000,
            "maxResponseBytes": 2_097_152
        });
        assert!(serde_json::from_value::<AiTransportRequest>(generic_fetch).is_err());
    }

    #[test]
    fn request_schema_exposes_only_fixed_native_operations() {
        for operation in [
            "models",
            "chatCompletions",
            "responses",
            "anthropicModels",
            "anthropicMessages",
            "geminiModels",
            "geminiGenerateContent",
            "cohereModels",
            "cohereChat",
            "dashscopeGeneration",
            "ollamaTags",
            "ollamaChat",
        ] {
            let value = serde_json::json!({
                "requestId": "request-1",
                "baseUrl": "https://api.example.com/v1",
                "operation": operation,
                "headers": {},
                "body": null,
                "maxResponseBytes": 2_097_152
            });
            assert!(
                serde_json::from_value::<AiTransportRequest>(value).is_ok(),
                "{operation}"
            );
        }
        for operation in [
            "fetch",
            "request",
            "customEndpoint",
            "geminiStreamGenerateContent",
        ] {
            let value = serde_json::json!({
                "requestId": "request-1",
                "baseUrl": "https://api.example.com/v1",
                "operation": operation,
                "headers": {},
                "body": null,
                "maxResponseBytes": 2_097_152
            });
            assert!(
                serde_json::from_value::<AiTransportRequest>(value).is_err(),
                "{operation}"
            );
        }
    }

    #[test]
    fn response_headers_are_narrowly_filtered() {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        headers.insert("retry-after", HeaderValue::from_static("2"));
        headers.insert("x-ratelimit-remaining", HeaderValue::from_static("9"));
        headers.insert("set-cookie", HeaderValue::from_static("secret=value"));
        let result = collect_response_headers(&headers);
        assert_eq!(result.len(), 3);
        assert!(!result.contains_key("set-cookie"));
    }

    #[test]
    fn registered_requests_can_be_cancelled_and_are_released() {
        let state = AiTransportState::new().unwrap();
        let (token, guard) = state.register("request-1").unwrap();
        assert!(state.cancel("request-1").unwrap());
        assert!(token.is_cancelled());
        drop(guard);
        assert!(!state
            .requests
            .lock()
            .unwrap()
            .active
            .contains_key("request-1"));
    }

    #[test]
    fn cancel_before_register_is_consumed_by_the_matching_request() {
        let state = AiTransportState::new().unwrap();
        assert!(state.cancel("request-before-register").unwrap());

        let (cancelled, guard) = state.register("request-before-register").unwrap();
        assert!(cancelled.is_cancelled());
        drop(guard);

        let (fresh, guard) = state.register("request-before-register").unwrap();
        assert!(!fresh.is_cancelled());
        drop(guard);
    }

    #[test]
    fn pre_cancel_registry_is_bounded_and_expired_entries_are_removed() {
        let state = AiTransportState::new().unwrap();
        for index in 0..(MAX_PRE_CANCELLED_REQUESTS + 8) {
            assert!(state.cancel(&format!("pre-cancel-{index}")).unwrap());
        }
        assert_eq!(
            state.requests.lock().unwrap().pre_cancelled.len(),
            MAX_PRE_CANCELLED_REQUESTS
        );

        {
            let mut registry = state.requests.lock().unwrap();
            for created_at in registry.pre_cancelled.values_mut() {
                *created_at = Instant::now() - PRE_CANCEL_TTL - Duration::from_millis(1);
            }
        }
        assert!(state.cancel("fresh-pre-cancel").unwrap());
        let registry = state.requests.lock().unwrap();
        assert_eq!(registry.pre_cancelled.len(), 1);
        assert!(registry.pre_cancelled.contains_key("fresh-pre-cancel"));
    }
}
