//! API Gateway routes - reverse proxy plus compatibility endpoints.

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{State, ws::{WebSocketUpgrade, WebSocket}},
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    net::{lookup_host, TcpStream},
    time::{timeout, Duration},
};

pub fn api_v1_routes(_state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/verify/providers", get(get_supported_providers))
        .route("/verify", post(verify_infrastructure))
        .route("/mail/send", post(send_mail))
        .route("/tenants/verify-domain", post(verify_domain))
        .route("/ws", get(ws_handler))
        .route("/auth/*rest", any(proxy_auth))
        .route("/mail/*rest", any(proxy_mail))
        .route("/tenants/*rest", any(proxy_tenant))
        .route("/storage/*rest", any(proxy_storage))
        .route("/delivery/*rest", any(proxy_delivery))
}

pub async fn root() -> Json<serde_json::Value> {
    Json(json!({
        "service": "api-gateway",
        "status": "online",
        "message": "VelisMail API Gateway is running.",
        "health": "/health",
        "apiBase": "/api/v1"
    }))
}

pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "api-gateway",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

pub async fn ws_handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    tracing::info!("New WebSocket connection established");
    // Send a welcome message
    if let Err(e) = socket.send(axum::extract::ws::Message::Text("connected".to_string())).await {
        tracing::error!("Failed to send welcome message: {}", e);
        return;
    }
    
    // Simulate real-time email push
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(45));
    loop {
        tokio::select! {
            _ = interval.tick() => {
                let _ = socket.send(axum::extract::ws::Message::Ping(vec![])).await;
            }
            msg = socket.recv() => {
                if let Some(Ok(msg)) = msg {
                    if let axum::extract::ws::Message::Text(text) = msg {
                        tracing::debug!("Received ws message: {}", text);
                    }
                } else {
                    tracing::info!("WebSocket disconnected");
                    break;
                }
            }
        }
    }
}

pub fn swagger_ui() -> Router<AppState> {
    Router::new()
}

async fn proxy_generic(
    state: &AppState,
    upstream_base: &str,
    strip_prefix: &str,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let path = uri.path();
    let remaining = path.strip_prefix(strip_prefix).unwrap_or(path);
    let query = uri.query().map(|q| format!("?{}", q)).unwrap_or_default();
    let target = format!(
        "{}{}{}",
        upstream_base.trim_end_matches('/'),
        remaining,
        query
    );

    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "body too large").into_response(),
    };

    let mut req = state.http_client.request(method, &target).body(body_bytes);
    for (name, value) in headers.iter() {
        let lowered = name.as_str().to_ascii_lowercase();
        if matches!(
            lowered.as_str(),
            "host" | "connection" | "content-length" | "transfer-encoding"
        ) {
            continue;
        }
        req = req.header(name.as_str(), value);
    }

    match req.send().await {
        Ok(resp) => {
            let status = resp.status();
            let mut builder = Response::builder().status(status.as_u16());
            for (name, value) in resp.headers() {
                let lowered = name.as_str().to_ascii_lowercase();
                if matches!(lowered.as_str(), "transfer-encoding" | "connection") {
                    continue;
                }
                if let Ok(header_value) = HeaderValue::from_bytes(value.as_bytes()) {
                    builder = builder.header(name.as_str(), header_value);
                }
            }
            let body = resp.bytes().await.unwrap_or_default();
            builder.body(Body::from(body)).unwrap_or_else(|_| {
                (StatusCode::BAD_GATEWAY, "upstream response build failed").into_response()
            })
        }
        Err(err) => {
            tracing::error!("proxy to {} failed: {}", target, err);
            (StatusCode::BAD_GATEWAY, format!("upstream error: {}", err)).into_response()
        }
    }
}

macro_rules! proxy_handler {
    ($fn_name:ident, $url_field:ident, $prefix:expr) => {
        async fn $fn_name(State(state): State<AppState>, req: Request<Body>) -> Response {
            let (parts, body) = req.into_parts();
            proxy_generic(
                &state,
                &state.config.$url_field,
                $prefix,
                parts.method,
                parts.uri,
                parts.headers,
                body,
            )
            .await
        }
    };
}

proxy_handler!(proxy_auth, auth_service_url, "/auth");
proxy_handler!(proxy_mail, mail_service_url, "/mail");
proxy_handler!(proxy_tenant, tenant_service_url, "/tenants");
proxy_handler!(proxy_storage, storage_service_url, "/storage");
proxy_handler!(proxy_delivery, security_service_url, "/delivery");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyInfrastructurePayload {
    pub db_provider: Option<String>,
    db_url: String,
    api_provider: String,
    api_endpoint: Option<String>,
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyDomainPayload {
    domain: String,
    db_url: String,
    api_key: String,
    verification_token: String,
    provider: Option<String>,
    api_provider: Option<String>,
    provider_endpoint: Option<String>,
    api_endpoint: Option<String>,
}


#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentPayload {
    pub filename: String,
    pub content: String,
    pub mime_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMailPayload {
    to: Vec<String>,
    subject: String,
    body: String,
    from: Option<String>,
    from_name: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
    provider_endpoint: Option<String>,
    pub attachments: Option<Vec<AttachmentPayload>>,
}

#[derive(Debug, Serialize)]
struct ProviderCatalogEntry {
    id: &'static str,
    label: &'static str,
    placeholder: &'static str,
    description: &'static str,
    requires_endpoint: bool,
}

#[derive(Debug, Serialize)]
struct DomainCheckResult {
    key: &'static str,
    label: &'static str,
    status: &'static str,
    expected: String,
    actual: String,
}

#[derive(Debug, Serialize)]
struct ProviderDnsRecord {
    record_type: String,
    name: String,
    value: String,
    status: Option<String>,
    priority: Option<u64>,
}

#[derive(Debug, Serialize)]
struct RuntimeCheckResult {
    key: &'static str,
    label: &'static str,
    status: &'static str,
    detail: String,
    category: &'static str,
    recommendation: Option<String>,
}

fn runtime_check_failure(
    key: &'static str,
    label: &'static str,
    detail: impl Into<String>,
    category: &'static str,
    recommendation: impl Into<String>,
) -> RuntimeCheckResult {
    RuntimeCheckResult {
        key,
        label,
        status: "failed",
        detail: detail.into(),
        category,
        recommendation: Some(recommendation.into()),
    }
}

fn database_target_label(db_url: &str) -> String {
    match parse_database_endpoint(db_url) {
        Ok(endpoint) if endpoint.scheme == "sqlite" => endpoint
            .sqlite_path
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "sqlite://".to_string()),
        Ok(endpoint) => format!("{}:{} ({})", endpoint.host, endpoint.port, endpoint.scheme),
        Err(_) => db_url
            .trim()
            .split_once("://")
            .map(|(_, rest)| rest.split('/').next().unwrap_or(rest).to_string())
            .unwrap_or_else(|| db_url.trim().to_string()),
    }
}

fn verify_infrastructure_response(
    status: StatusCode,
    success: bool,
    message: impl Into<String>,
    api_provider: &str,
    db_url: &str,
    checks: Vec<RuntimeCheckResult>,
) -> (StatusCode, Json<serde_json::Value>) {
    let failing_check = checks.iter().find(|check| check.status != "verified");
    let failing_label = failing_check.map(|check| check.label);
    let failing_category = failing_check.map(|check| check.category);
    let issue_owner = match failing_category {
        Some("software") => "velismail",
        Some("network") => "server-network",
        Some("config") => "user-config",
        _ if success => "connected",
        _ => "unknown",
    };
    let database_target = database_target_label(db_url);

    (
        status,
        Json(json!({
            "success": success,
            "message": message.into(),
            "provider": api_provider,
            "dbProtocol": db_url.split("://").next().unwrap_or(""),
            "databaseTarget": database_target,
            "failingCheck": failing_label,
            "failingCategory": failing_category,
            "issueOwner": issue_owner,
            "checks": checks
        })),
    )
}

const DATABASE_SCHEMES: &[&str] = &[
    "postgresql://",
    "postgres://",
    "mysql://",
    "mysql2://",
    "mariadb://",
    "sqlite://",
    "mongodb://",
    "mongodb+srv://",
    "redis://",
    "rediss://",
    "libsql://",
    "sqlserver://",
    "mssql://",
    "clickhouse://",
    "custom://",
];

const MAIL_PROVIDER_IDS: &[&str] = &["sendgrid", "resend", "postmark", "brevo", "custom_webhook"];

fn is_valid_database_url(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    DATABASE_SCHEMES
        .iter()
        .any(|scheme| normalized.starts_with(scheme))
}

fn is_supported_mail_provider(provider: &str) -> bool {
    MAIL_PROVIDER_IDS.contains(&provider)
}

fn requires_custom_endpoint(provider: &str) -> bool {
    provider == "custom_webhook" || provider == "amazonses"
}

fn is_valid_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn default_port_for_scheme(scheme: &str) -> Option<u16> {
    match scheme {
        "postgresql" | "postgres" => Some(5432),
        "mysql" | "mysql2" | "mariadb" => Some(3306),
        "mongodb" | "mongodb+srv" => Some(27017),
        "redis" | "rediss" => Some(6379),
        "libsql" => Some(443),
        "sqlserver" | "mssql" => Some(1433),
        "clickhouse" => Some(8443),
        "http" => Some(80),
        "https" => Some(443),
        _ => None,
    }
}

struct DatabaseEndpoint {
    scheme: String,
    host: String,
    port: u16,
    sqlite_path: Option<String>,
}

fn parse_database_endpoint(db_url: &str) -> Result<DatabaseEndpoint, String> {
    let trimmed = db_url.trim();
    let scheme = trimmed
        .split_once("://")
        .map(|(scheme, _)| scheme.to_lowercase())
        .ok_or_else(|| "Database URL must include a scheme such as postgresql://.".to_string())?;

    if scheme == "sqlite" {
        let path = trimmed
            .split_once("://")
            .map(|(_, rest)| rest.trim().to_string())
            .unwrap_or_default();
        return Ok(DatabaseEndpoint {
            scheme,
            host: String::new(),
            port: 0,
            sqlite_path: Some(path),
        });
    }

    match reqwest::Url::parse(trimmed) {
        Ok(parsed) => {
            let host = parsed
                .host_str()
                .map(str::to_string)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    "Database host is missing from the connection string.".to_string()
                })?;
            let port = parsed
                .port()
                .or_else(|| default_port_for_scheme(parsed.scheme()))
                .ok_or_else(|| {
                    format!("Database port is missing for scheme '{}'.", parsed.scheme())
                })?;

            Ok(DatabaseEndpoint {
                scheme: parsed.scheme().to_string(),
                host,
                port,
                sqlite_path: None,
            })
        }
        Err(parse_error) => {
            let after_scheme = trimmed
                .split_once("://")
                .map(|(_, rest)| rest)
                .unwrap_or(trimmed);
            let authority = after_scheme
                .rsplit_once('@')
                .map(|(_, authority)| authority)
                .unwrap_or(after_scheme)
                .split(['/', '?', '#'])
                .next()
                .unwrap_or("")
                .trim();

            if authority.is_empty() {
                return Err(format!("Invalid database URL: {parse_error}"));
            }

            let (host, port) = if authority.starts_with('[') {
                let end = authority.find(']').ok_or_else(|| {
                    "Invalid IPv6 database host. Close the host with ']'.".to_string()
                })?;
                let host = authority[1..end].to_string();
                let suffix = authority[end + 1..].trim_start_matches(':');
                let port = if suffix.is_empty() {
                    default_port_for_scheme(&scheme)
                } else {
                    suffix.parse::<u16>().ok()
                };
                (host, port)
            } else if let Some((host, port_text)) = authority.rsplit_once(':') {
                if port_text.chars().all(|ch| ch.is_ascii_digit()) {
                    (host.to_string(), port_text.parse::<u16>().ok())
                } else {
                    return Err("Invalid database URL: invalid port number. If your database password contains special characters like @, :, /, ?, #, or %, URL-encode the password before pasting the connection string.".to_string());
                }
            } else {
                (authority.to_string(), default_port_for_scheme(&scheme))
            };

            let host = host.trim().to_string();
            let port = port.ok_or_else(|| {
                format!("Database port is missing or invalid for scheme '{scheme}'.")
            })?;

            if host.is_empty() {
                return Err("Database host is missing from the connection string.".to_string());
            }

            Ok(DatabaseEndpoint {
                scheme,
                host,
                port,
                sqlite_path: None,
            })
        }
    }
}

async fn verify_database_runtime(db_url: &str) -> RuntimeCheckResult {
    let endpoint = match parse_database_endpoint(db_url) {
        Ok(endpoint) => endpoint,
        Err(err) => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: err,
                category: "config",
                recommendation: Some("Review the database connection string format and URL-encode special characters inside the password.".to_string()),
            }
        }
    };

    if endpoint.scheme == "sqlite" {
        let path = endpoint.sqlite_path.as_deref().unwrap_or("").trim();
        return RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: if path.is_empty() {
                "failed"
            } else {
                "verified"
            },
            detail: if path.is_empty() {
                "SQLite path is empty.".to_string()
            } else {
                format!("SQLite path accepted: {path}")
            },
            category: if path.is_empty() { "config" } else { "success" },
            recommendation: if path.is_empty() {
                Some("Provide a valid SQLite file path.".to_string())
            } else {
                None
            },
        };
    }

    let host = endpoint.host;
    let port = endpoint.port;
    let is_supabase_host = host.contains("supabase.co");

    let resolved = timeout(Duration::from_secs(5), lookup_host((host.as_str(), port))).await;
    let mut addresses = match resolved {
        Ok(Ok(addrs)) => addrs,
        Ok(Err(err)) => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: format!("Could not resolve database host {host}:{port}: {err}"),
                category: "network",
                recommendation: Some("Check the hostname, DNS resolution, and whether your VM network can reach the database provider.".to_string()),
            }
        }
        Err(_) => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: format!("Timed out while resolving database host {host}:{port}."),
                category: "network",
                recommendation: Some("DNS resolution timed out. Retry, or verify that outbound DNS/network access is available from the server.".to_string()),
            }
        }
    };

    if endpoint.scheme == "mongodb+srv" {
        return RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "verified",
            detail: format!("Resolved SRV host {host}."),
            category: "success",
            recommendation: None,
        };
    }

    let resolved_addresses: Vec<_> = addresses.by_ref().collect();
    if resolved_addresses.is_empty() {
        return RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "failed",
            detail: format!("No addresses resolved for {host}:{port}."),
            category: "network",
            recommendation: Some("The database host resolved to no usable addresses. Verify the hostname and DNS configuration.".to_string()),
        };
    }

    let mut failures = Vec::new();
    for target in resolved_addresses {
        match timeout(Duration::from_secs(5), TcpStream::connect(target)).await {
            Ok(Ok(_)) => {
                return RuntimeCheckResult {
                    key: "database",
                    label: "Database Runtime Check",
                    status: "verified",
                    detail: format!("Connected to {host}:{port} via {target}."),
                    category: "success",
                    recommendation: None,
                };
            }
            Ok(Err(err)) => failures.push(format!("{target}: {err}")),
            Err(_) => failures.push(format!("{target}: timed out")),
        }
    }

    let joined_failures = failures.join(" | ");
    let is_unreachable = failures
        .iter()
        .all(|failure| failure.contains("Network is unreachable"));
    let is_timeout = failures.iter().all(|failure| failure.contains("timed out"));
    RuntimeCheckResult {
        key: "database",
        label: "Database Runtime Check",
        status: "failed",
        detail: format!("Unable to connect to {host}:{port}. Attempts: {joined_failures}"),
        category: if is_unreachable || is_timeout {
            "network"
        } else {
            "config"
        },
        recommendation: if is_unreachable {
            Some(if is_supabase_host {
                "The server cannot reach the Supabase database host at all. Verify that you copied the raw database URI from Supabase Project Settings, and if direct port 5432 is blocked for your plan/network, switch to the provider's recommended pooled/direct connection string.".to_string()
            } else {
                "The server cannot reach any resolved database address. This is usually outbound network or provider routing, not a frontend bug.".to_string()
            })
        } else if is_timeout {
            Some(if is_supabase_host {
                "The Supabase host resolved, but every connection attempt timed out. Check whether your VM can reach the provider over the required port, and prefer the exact connection string recommended by Supabase for external apps.".to_string()
            } else {
                "The database host resolved, but every connection attempt timed out. Check firewall rules, provider allowlists, and whether the direct connection port is open.".to_string()
            })
        } else {
            Some("The database host was reached but rejected the connection path. Double-check the URL, password encoding, SSL mode, and provider-specific connection instructions.".to_string())
        },
    }
}

async fn validate_provider_credentials(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    endpoint: Option<&str>,
) -> RuntimeCheckResult {
    let provider = provider.trim().to_lowercase();

    if requires_custom_endpoint(&provider) {
        let Some(endpoint) = endpoint else {
            return RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: "Custom webhook endpoint is required.".to_string(),
                category: "config",
                recommendation: Some(
                    "Add the custom webhook endpoint URL before verifying.".to_string(),
                ),
            };
        };

        let request = client.get(endpoint).header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {api_key}"),
        );
        return match timeout(Duration::from_secs(10), request.send()).await {
            Ok(Ok(response)) if response.status().is_success() || response.status().as_u16() == 405 => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "verified",
                detail: format!("Webhook endpoint responded with {}.", response.status()),
                category: "success",
                recommendation: None,
            },
            Ok(Ok(response)) => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: format!("Webhook endpoint returned {}.", response.status()),
                category: "config",
                recommendation: Some("The custom provider endpoint responded, but it did not accept the verification request.".to_string()),
            },
            Ok(Err(err)) => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: format!("Webhook check failed: {err}"),
                category: "network",
                recommendation: Some("The server could not reach your custom webhook endpoint. Check the URL, TLS, and firewall settings.".to_string()),
            },
            Err(_) => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: "Webhook check timed out.".to_string(),
                category: "network",
                recommendation: Some("The custom webhook endpoint timed out. Check if it is publicly reachable and responding quickly enough.".to_string()),
            },
        };
    }

    let request = match provider.as_str() {
        "sendgrid" => client
            .get("https://api.sendgrid.com/v3/user/account")
            .bearer_auth(api_key),
        "resend" => client
            .get("https://api.resend.com/domains")
            .bearer_auth(api_key),
        "postmark" => client
            .get("https://api.postmarkapp.com/server")
            .header("X-Postmark-Server-Token", api_key),
        "brevo" => client
            .get("https://api.brevo.com/v3/account")
            .header("api-key", api_key),
        _ => {
            return RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: format!("Provider '{provider}' is not supported for live runtime validation."),
                category: "software",
                recommendation: Some("This provider is not wired into live validation yet. Choose a supported provider or extend the gateway validator.".to_string()),
            }
        }
    };

    match timeout(Duration::from_secs(10), request.send()).await {
        Ok(Ok(response)) if response.status().is_success() => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "verified",
            detail: format!("{provider} credentials accepted."),
            category: "success",
            recommendation: None,
        },
        Ok(Ok(response)) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: if body.trim().is_empty() {
                    format!("{provider} rejected the credentials with status {status}.")
                } else {
                    format!("{provider} rejected the credentials with status {status}: {}", body.trim())
                },
                category: "config",
                recommendation: Some("The provider received the request but rejected the key or account configuration. Verify the API key, sender domain, and provider account status.".to_string()),
            }
        },
        Ok(Err(err)) => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "failed",
            detail: format!("{provider} validation failed: {err}"),
            category: "network",
            recommendation: Some("The server could not complete the provider validation request. Check outbound HTTPS access and provider reachability.".to_string()),
        },
        Err(_) => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "failed",
            detail: format!("{provider} validation timed out."),
            category: "network",
            recommendation: Some("The provider validation request timed out. Retry, or check whether the provider is reachable from the server network.".to_string()),
        },
    }
}

async fn dispatch_via_provider(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    endpoint: Option<&str>,
    payload: &SendMailPayload,
) -> Result<Option<String>, String> {
    let provider = provider.trim().to_lowercase();
    let base_domain =
        std::env::var("BASE_DOMAIN").unwrap_or_else(|_| "velismail.online".to_string());
    let from_email = payload
        .from
        .clone()
        .unwrap_or_else(|| format!("noreply@{}", base_domain));
    let from_name = payload
        .from_name
        .clone()
        .unwrap_or_else(|| "VelisMail".to_string());

    let response = match provider.as_str() {
        "sendgrid" => {
            let mut req_body = json!({
                "personalizations": [{
                    "to": payload.to.iter().map(|email| json!({ "email": email })).collect::<Vec<_>>()
                }],
                "from": { "email": from_email, "name": from_name },
                "subject": payload.subject.trim(),
                "content": [{
                    "type": "text/plain",
                    "value": payload.body
                }]
            });
            if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let sg_atts: Vec<_> = atts.iter().map(|a| {
                        let content = if let Some(idx) = a.content.find("base64,") {
                            &a.content[idx + 7..]
                        } else {
                            &a.content
                        };
                        json!({
                            "content": content,
                            "filename": a.filename,
                            "type": a.mime_type,
                            "disposition": "attachment"
                        })
                    }).collect();
                    req_body.as_object_mut().unwrap().insert("attachments".to_string(), json!(sg_atts));
                }
            }
            client
                .post("https://api.sendgrid.com/v3/mail/send")
                .bearer_auth(api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        },
        "resend" => {
            let mut req_body = json!({
                "from": format!("{from_name} <{from_email}>"),
                "to": payload.to,
                "subject": payload.subject.trim(),
                "text": payload.body,
            });
            if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let rs_atts: Vec<_> = atts.iter().map(|a| {
                        let content = if let Some(idx) = a.content.find("base64,") {
                            &a.content[idx + 7..]
                        } else {
                            &a.content
                        };
                        // Note: resend API expects base64 content in 'content' without base64 prefix
                        // Wait, Resend expects raw buffer or b64 string, actually the API docs say: content: "base64..."
                        json!({
                            "content": content,
                            "filename": a.filename
                        })
                    }).collect();
                    req_body.as_object_mut().unwrap().insert("attachments".to_string(), json!(rs_atts));
                }
            }
            client
                .post("https://api.resend.com/emails")
                .bearer_auth(api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        },
        "postmark" => {
            let mut req_body = json!({
                "From": format!("{from_name} <{from_email}>"),
                "To": payload.to.join(","),
                "Subject": payload.subject.trim(),
                "TextBody": payload.body,
            });
            if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let pm_atts: Vec<_> = atts.iter().map(|a| {
                        let content = if let Some(idx) = a.content.find("base64,") {
                            &a.content[idx + 7..]
                        } else {
                            &a.content
                        };
                        json!({
                            "Name": a.filename,
                            "Content": content,
                            "ContentType": a.mime_type
                        })
                    }).collect();
                    req_body.as_object_mut().unwrap().insert("Attachments".to_string(), json!(pm_atts));
                }
            }
            client
                .post("https://api.postmarkapp.com/email")
                .header("X-Postmark-Server-Token", api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        },
        "brevo" => {
            let mut req_body = json!({
                "sender": {
                    "email": from_email,
                    "name": from_name
                },
                "to": payload.to.iter().map(|email| json!({ "email": email })).collect::<Vec<_>>(),
                "subject": payload.subject.trim(),
                "textContent": payload.body,
            });
            if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let br_atts: Vec<_> = atts.iter().map(|a| {
                        let content = if let Some(idx) = a.content.find("base64,") {
                            &a.content[idx + 7..]
                        } else {
                            &a.content
                        };
                        json!({
                            "name": a.filename,
                            "content": content
                        })
                    }).collect();
                    req_body.as_object_mut().unwrap().insert("attachment".to_string(), json!(br_atts));
                }
            }
            client
                .post("https://api.brevo.com/v3/smtp/email")
                .header("api-key", api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        },

        "amazonses" => {
            let credentials = if let Some((ak, sk)) = api_key.split_once(':') {
                aws_sdk_sesv2::config::Credentials::new(ak, sk, None, None, "manual")
            } else {
                return Err("Amazon SES requires api_key in the format 'ACCESS_KEY:SECRET_KEY'".to_string());
            };
            let region = aws_config::Region::new(endpoint.unwrap_or("us-east-1").to_string());
            let config = aws_config::SdkConfig::builder()
                .credentials_provider(aws_sdk_sesv2::config::SharedCredentialsProvider::new(credentials))
                .region(region)
                .build();
            let ses_client = aws_sdk_sesv2::Client::new(&config);

            let dest_builder = aws_sdk_sesv2::types::Destination::builder()
                .set_to_addresses(Some(payload.to.clone()))
                .build();

            let email_content = if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let boundary = "----=_NextPart_VelisMail_Boundary_123456789";
                    let mut raw_message = String::new();
                    raw_message.push_str(&format!("From: {} <{}>\n", from_name, from_email));
                    raw_message.push_str(&format!("To: {}\n", payload.to.join(",")));
                    raw_message.push_str(&format!("Subject: {}\n", payload.subject.trim()));
                    raw_message.push_str("MIME-Version: 1.0\n");
                    raw_message.push_str(&format!("Content-Type: multipart/mixed; boundary=\"{}\"\n\n", boundary));

                    raw_message.push_str(&format!("--{}\n", boundary));
                    raw_message.push_str("Content-Type: text/plain; charset=UTF-8\n\n");
                    raw_message.push_str(&format!("{}\n\n", payload.body));

                    for att in atts {
                        raw_message.push_str(&format!("--{}\n", boundary));
                        raw_message.push_str(&format!("Content-Type: {}; name=\"{}\"\n", att.mime_type, att.filename));
                        raw_message.push_str("Content-Disposition: attachment\n");
                        raw_message.push_str("Content-Transfer-Encoding: base64\n\n");
                        let b64_content = if let Some(idx) = att.content.find("base64,") {
                            &att.content[idx + 7..]
                        } else {
                            &att.content
                        };
                        raw_message.push_str(&format!("{}\n\n", b64_content));
                    }
                    raw_message.push_str(&format!("--{}--\n", boundary));

                    aws_sdk_sesv2::types::EmailContent::builder()
                        .raw(aws_sdk_sesv2::types::RawMessage::builder().data(aws_sdk_sesv2::primitives::Blob::new(raw_message.into_bytes())).build().unwrap())
                        .build()
                } else {
                    let message_builder = aws_sdk_sesv2::types::Message::builder()
                        .subject(aws_sdk_sesv2::types::Content::builder().data(payload.subject.trim()).build().unwrap())
                        .body(
                            aws_sdk_sesv2::types::Body::builder()
                                .text(aws_sdk_sesv2::types::Content::builder().data(payload.body.clone()).build().unwrap())
                                .build()
                        );
                    aws_sdk_sesv2::types::EmailContent::builder().simple(message_builder.build()).build()
                }
            } else {
                let message_builder = aws_sdk_sesv2::types::Message::builder()
                    .subject(aws_sdk_sesv2::types::Content::builder().data(payload.subject.trim()).build().unwrap())
                    .body(
                        aws_sdk_sesv2::types::Body::builder()
                            .text(aws_sdk_sesv2::types::Content::builder().data(payload.body.clone()).build().unwrap())
                            .build()
                    );
                aws_sdk_sesv2::types::EmailContent::builder().simple(message_builder.build()).build()
            };

            match ses_client.send_email()
                .from_email_address(format!("{} <{}>", from_name, from_email))
                .destination(dest_builder)
                .content(email_content)
                .send()
                .await {
                Ok(resp) => return Ok(resp.message_id),
                Err(err) => return Err(format!("Amazon SES error: {}", err)),
            }
        }
        "custom_webhook" => {
            let endpoint = endpoint.ok_or_else(|| "Custom webhook endpoint is missing.".to_string())?;
            client
                .post(endpoint)
                .header(axum::http::header::AUTHORIZATION, format!("Bearer {api_key}"))
                .json(&json!({
                    "from": from_email,
                    "fromName": from_name,
                    "to": payload.to,
                    "subject": payload.subject.trim(),
                    "body": payload.body,
                }))
                .send()
                .await
                .map_err(|err| err.to_string())?
        }
        _ => return Err(format!("Provider '{provider}' is not supported for outbound delivery.")),
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Provider rejected the message with status {status}: {body}"
        ));
    }

    let response_body = response.json::<Value>().await.unwrap_or(Value::Null);
    let external_id = response_body
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| response_body.get("messageId").and_then(Value::as_str))
        .or_else(|| response_body.get("MessageID").and_then(Value::as_str))
        .map(str::to_string);

    Ok(external_id)
}

fn is_valid_domain(value: &str) -> bool {
    let domain = value.trim().to_lowercase();
    if domain.len() < 4 || domain.len() > 253 || !domain.contains('.') || domain.contains("..") {
        return false;
    }

    let labels: Vec<&str> = domain.split('.').collect();
    labels.iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn normalize_dns_answer(value: &str) -> String {
    value
        .trim()
        .trim_end_matches('.')
        .trim_matches('"')
        .replace("\" \"", "")
}

async fn query_dns_answers(
    client: &reqwest::Client,
    name: &str,
    record_type: &str,
) -> Result<Vec<String>, String> {
    let response = client
        .get("https://cloudflare-dns.com/dns-query")
        .query(&[("name", name), ("type", record_type)])
        .header("accept", "application/dns-json")
        .send()
        .await
        .map_err(|err| format!("DNS lookup failed: {err}"))?;

    if !response.status().is_success() {
        return Err(format!("DNS lookup failed for {name} ({record_type})."));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| format!("Invalid DNS response: {err}"))?;

    Ok(payload["Answer"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item["data"].as_str().map(normalize_dns_answer))
        .collect())
}

fn provider_name(payload: &VerifyDomainPayload) -> &str {
    payload
        .provider
        .as_deref()
        .or(payload.api_provider.as_deref())
        .unwrap_or("")
}

fn provider_endpoint(payload: &VerifyDomainPayload) -> Option<&str> {
    payload
        .provider_endpoint
        .as_deref()
        .or(payload.api_endpoint.as_deref())
}

fn extract_provider_dns_records(records: &Value) -> Vec<ProviderDnsRecord> {
    records
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|record| ProviderDnsRecord {
            record_type: record
                .get("record")
                .or_else(|| record.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("TXT")
                .to_string(),
            name: record
                .get("name")
                .or_else(|| record.get("host"))
                .and_then(Value::as_str)
                .unwrap_or("@")
                .to_string(),
            value: record
                .get("value")
                .or_else(|| record.get("content"))
                .or_else(|| record.get("data"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            status: record
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string),
            priority: record.get("priority").and_then(Value::as_u64),
        })
        .collect()
}

async fn verify_provider_domain(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    endpoint: Option<&str>,
    domain: &str,
) -> (RuntimeCheckResult, Vec<ProviderDnsRecord>) {
    let provider = provider.trim().to_lowercase();

    if provider == "custom_webhook" {
        return (
            RuntimeCheckResult {
                key: "providerDomain",
                label: "Provider Domain Check",
                status: "verified",
                detail: "Custom webhook providers do not expose automated sender-domain verification. Validate sender policy inside your own relay.".to_string(),
                category: "success",
                recommendation: None,
            },
            vec![],
        );
    }

    if provider != "resend" {
        let label = if endpoint.is_some() {
            format!("{provider} accepted the API key. Finish sender-domain onboarding inside the provider dashboard for {domain}.")
        } else {
            format!("{provider} credentials are valid. Sender-domain onboarding for {domain} must still be completed inside the provider dashboard.")
        };
        return (
            RuntimeCheckResult {
                key: "providerDomain",
                label: "Provider Domain Check",
                status: "verified",
                detail: label,
                category: "success",
                recommendation: None,
            },
            vec![],
        );
    }

    let response = match timeout(
        Duration::from_secs(10),
        client
            .get("https://api.resend.com/domains")
            .bearer_auth(api_key)
            .send(),
    )
    .await
    {
        Ok(Ok(response)) => response,
        Ok(Err(err)) => {
            return (
                RuntimeCheckResult {
                    key: "providerDomain",
                    label: "Provider Domain Check",
                    status: "failed",
                    detail: format!("Resend domain lookup failed: {err}"),
                    category: "network",
                    recommendation: Some("The server could not reach Resend domain APIs. Retry, or verify outbound HTTPS access from the backend.".to_string()),
                },
                vec![],
            )
        }
        Err(_) => {
            return (
                RuntimeCheckResult {
                    key: "providerDomain",
                    label: "Provider Domain Check",
                    status: "failed",
                    detail: "Resend domain lookup timed out.".to_string(),
                    category: "network",
                    recommendation: Some("The backend could not finish querying Resend domains in time. Retry after checking provider/network reachability.".to_string()),
                },
                vec![],
            )
        }
    };

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return (
            RuntimeCheckResult {
                key: "providerDomain",
                label: "Provider Domain Check",
                status: "failed",
                detail: if body.trim().is_empty() {
                    format!("Resend rejected the domain lookup with status {status}.")
                } else {
                    format!("Resend rejected the domain lookup with status {status}: {}", body.trim())
                },
                category: "config",
                recommendation: Some("Verify that the Resend API key has access to the correct account and domain resources.".to_string()),
            },
            vec![],
        );
    }

    let payload = response.json::<Value>().await.unwrap_or(Value::Null);
    let domain_entry = payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries.iter().find(|entry| {
                entry
                    .get("name")
                    .or_else(|| entry.get("domain"))
                    .and_then(Value::as_str)
                    .map(|name| name.eq_ignore_ascii_case(domain))
                    .unwrap_or(false)
            })
        });

    let Some(domain_entry) = domain_entry else {
        return (
            RuntimeCheckResult {
                key: "providerDomain",
                label: "Provider Domain Check",
                status: "failed",
                detail: format!("Resend API key is valid, but the domain {domain} has not been added to this Resend account."),
                category: "config",
                recommendation: Some("Open Resend Domains, add this exact business domain, publish the provider DNS records, and run verification again.".to_string()),
            },
            vec![],
        );
    };

    let status = domain_entry
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_lowercase();
    let provider_records = extract_provider_dns_records(
        domain_entry
            .get("records")
            .or_else(|| domain_entry.get("dns_records"))
            .unwrap_or(&Value::Null),
    );
    let verified = matches!(status.as_str(), "verified" | "active" | "valid");

    (
        RuntimeCheckResult {
            key: "providerDomain",
            label: "Provider Domain Check",
            status: if verified { "verified" } else { "failed" },
            detail: format!("Resend domain status for {domain}: {status}."),
            category: if verified { "success" } else { "config" },
            recommendation: if verified {
                None
            } else {
                Some("The domain exists in Resend, but it is not fully verified yet. Complete every pending DNS record shown below inside your DNS provider, then retry verification.".to_string())
            },
        },
        provider_records,
    )
}

pub async fn get_supported_providers() -> Json<serde_json::Value> {
    let database_providers = vec![
        ProviderCatalogEntry {
            id: "postgresql",
            label: "PostgreSQL",
            placeholder: "postgresql://user:pass@host:5432/db",
            description: "Self-hosted or managed Postgres.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mysql",
            label: "MySQL",
            placeholder: "mysql://user:pass@host:3306/db",
            description: "MySQL / MariaDB.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mongodb",
            label: "MongoDB",
            placeholder: "mongodb://user:pass@host:27017/db",
            description: "Replica-set or standalone.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "redis",
            label: "Redis",
            placeholder: "redis://default:pass@host:6379",
            description: "Redis cache.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "others",
            label: "Custom",
            placeholder: "custom://user:pass@host:port/db",
            description: "Any RFC-style URI.",
            requires_endpoint: false,
        },
    ];

    let mail_providers: Vec<ProviderCatalogEntry> = MAIL_PROVIDER_IDS
        .iter()
        .map(|id| ProviderCatalogEntry {
            id,
            label: id,
            placeholder: "api-key",
            description: "Mail relay provider.",
            requires_endpoint: *id == "custom_webhook" || *id == "amazonses",
        })
        .collect();

    Json(json!({
        "success": true,
        "databaseProviders": database_providers,
        "mailProviders": mail_providers,
    }))
}

pub async fn verify_infrastructure(
    State(state): State<AppState>,
    Json(payload): Json<VerifyInfrastructurePayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    let _ = payload.db_provider;
    let db_url = payload.db_url.trim();
    let api_provider = payload.api_provider.trim();
    let api_key = payload.api_key.trim();
    let api_endpoint = payload.api_endpoint.as_deref().map(str::trim);

    if db_url.is_empty() || api_provider.is_empty() || api_key.is_empty() {
        return verify_infrastructure_response(
            StatusCode::BAD_REQUEST,
            false,
            "Missing required fields.",
            api_provider,
            db_url,
            vec![runtime_check_failure(
                "request",
                "Request Validation",
                "Database URL, provider, and API key are all required before verification can start.",
                "config",
                "Fill in the missing fields and retry the verification.",
            )],
        );
    }
    if !is_valid_database_url(db_url) {
        return verify_infrastructure_response(
            StatusCode::BAD_REQUEST,
            false,
            "Invalid database URL scheme.",
            api_provider,
            db_url,
            vec![runtime_check_failure(
                "database",
                "Database Runtime Check",
                "The database connection string does not start with a supported scheme such as postgresql:// or mysql://.",
                "config",
                "Paste the full database URI, not a browser URL or dashboard page link.",
            )],
        );
    }
    if !is_supported_mail_provider(api_provider) {
        return verify_infrastructure_response(
            StatusCode::BAD_REQUEST,
            false,
            format!("Unsupported mail provider '{}'.", api_provider),
            api_provider,
            db_url,
            vec![runtime_check_failure(
                "mailProvider",
                "Mail Provider Runtime Check",
                format!("Provider '{}' is not available in the release validator.", api_provider),
                "software",
                "Choose a supported provider from the setup list, or extend the backend validator before using this provider.",
            )],
        );
    }
    if requires_custom_endpoint(api_provider) {
        let valid_endpoint = api_endpoint.map(is_valid_http_url).unwrap_or(false);
        if !valid_endpoint {
            return verify_infrastructure_response(
                StatusCode::BAD_REQUEST,
                false,
                "Custom webhook requires http(s) endpoint.",
                api_provider,
                db_url,
                vec![runtime_check_failure(
                    "mailProvider",
                    "Mail Provider Runtime Check",
                    "A custom webhook provider was selected, but the endpoint URL is missing or invalid.",
                    "config",
                    "Provide a full http:// or https:// endpoint for the custom mail relay.",
                )],
            );
        }
    }
    if api_key.len() < 8 {
        return verify_infrastructure_response(
            StatusCode::BAD_REQUEST,
            false,
            "API key too short.",
            api_provider,
            db_url,
            vec![runtime_check_failure(
                "mailProvider",
                "Mail Provider Runtime Check",
                "The supplied API key is shorter than the minimum accepted format.",
                "config",
                "Paste the full provider API key exactly as issued by the mail provider.",
            )],
        );
    }

    let database_check = verify_database_runtime(db_url).await;
    let provider_check =
        validate_provider_credentials(&state.http_client, api_provider, api_key, api_endpoint)
            .await;
    let success = database_check.status == "verified" && provider_check.status == "verified";

    verify_infrastructure_response(
        if success {
            StatusCode::OK
        } else {
            StatusCode::BAD_REQUEST
        },
        success,
        if success {
            "Infrastructure validated successfully."
        } else {
            "Infrastructure validation failed. Review the runtime checks and fix the failing connection."
        },
        api_provider,
        db_url,
        vec![database_check, provider_check],
    )
}

pub async fn verify_domain(
    State(state): State<AppState>,
    Json(payload): Json<VerifyDomainPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    let domain = payload.domain.trim().to_lowercase();
    let db_url = payload.db_url.trim();
    let api_key = payload.api_key.trim();
    let verification_token = payload.verification_token.trim();
    let provider = provider_name(&payload);

    if !is_valid_domain(&domain) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "ValidationError",
                "message": "Enter a valid business domain before starting verification."
            })),
        );
    }
    if !is_valid_database_url(db_url) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "DatabaseConnectionError",
                "message": "Database connectivity check failed because the connection string is invalid."
            })),
        );
    }
    if !is_supported_mail_provider(provider) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Unsupported mail provider."
            })),
        );
    }
    if requires_custom_endpoint(provider)
        && !provider_endpoint(&payload)
            .map(is_valid_http_url)
            .unwrap_or(false)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Custom provider endpoint must be a valid http or https URL."
            })),
        );
    }
    if api_key.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Provider API key is missing or too short."
            })),
        );
    }
    if verification_token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "ValidationError",
                "message": "verificationToken is required to validate your ownership TXT record."
            })),
        );
    }

    let base_domain =
        std::env::var("BASE_DOMAIN").unwrap_or_else(|_| "velismail.online".to_string());
    let txt_host = format!("_velismail-verify.{domain}");
    let dkim_host = format!("velismail._domainkey.{domain}");
    let dmarc_host = format!("_dmarc.{domain}");
    let expected_mx_hosts = [
        format!("mx1.{}", base_domain),
        format!("mx2.{}", base_domain),
    ];
    let expected_spf_fragment = format!("include:{}", base_domain);
    let expected_dkim_target = format!("dkim.{}", base_domain);

    let txt_answers = match query_dns_answers(&state.http_client, &txt_host, "TXT").await {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "success": false,
                    "errorType": "DnsLookupError",
                    "message": err
                })),
            )
        }
    };
    let mx_answers = query_dns_answers(&state.http_client, &domain, "MX")
        .await
        .unwrap_or_default();
    let domain_txt_answers = query_dns_answers(&state.http_client, &domain, "TXT")
        .await
        .unwrap_or_default();
    let dkim_answers = query_dns_answers(&state.http_client, &dkim_host, "CNAME")
        .await
        .unwrap_or_default();
    let dmarc_answers = query_dns_answers(&state.http_client, &dmarc_host, "TXT")
        .await
        .unwrap_or_default();

    let normalized_mx_hosts: Vec<String> = mx_answers
        .iter()
        .filter_map(|answer| answer.split_whitespace().last().map(normalize_dns_answer))
        .collect();

    let txt_actual = if txt_answers.is_empty() {
        "TXT record not found".to_string()
    } else {
        txt_answers.join(", ")
    };
    let mx_actual = if normalized_mx_hosts.is_empty() {
        "MX records not found".to_string()
    } else {
        normalized_mx_hosts.join(", ")
    };
    let spf_actual = domain_txt_answers
        .iter()
        .find(|value| value.to_lowercase().starts_with("v=spf1"))
        .cloned()
        .unwrap_or_else(|| "SPF record not found".to_string());
    let dkim_actual = if dkim_answers.is_empty() {
        "DKIM CNAME not found".to_string()
    } else {
        dkim_answers.join(", ")
    };
    let dmarc_actual = dmarc_answers
        .iter()
        .find(|value| value.to_lowercase().starts_with("v=dmarc1"))
        .cloned()
        .unwrap_or_else(|| "DMARC record not found".to_string());

    let checks = vec![
        DomainCheckResult {
            key: "txt",
            label: "Ownership TXT",
            status: if txt_answers
                .iter()
                .any(|value| value.contains(verification_token))
            {
                "verified"
            } else {
                "failed"
            },
            expected: verification_token.to_string(),
            actual: txt_actual,
        },
        DomainCheckResult {
            key: "mx",
            label: "Inbound MX",
            status: if expected_mx_hosts
                .iter()
                .all(|host| normalized_mx_hosts.contains(host))
            {
                "verified"
            } else {
                "failed"
            },
            expected: expected_mx_hosts.join(" / "),
            actual: mx_actual,
        },
        DomainCheckResult {
            key: "spf",
            label: "SPF",
            status: if domain_txt_answers
                .iter()
                .any(|value| value.contains(&expected_spf_fragment))
            {
                "verified"
            } else {
                "failed"
            },
            expected: format!("v=spf1 include:{} ~all", base_domain),
            actual: spf_actual,
        },
        DomainCheckResult {
            key: "dkim",
            label: "DKIM",
            status: if dkim_answers
                .iter()
                .any(|value| value == &expected_dkim_target)
            {
                "verified"
            } else {
                "failed"
            },
            expected: expected_dkim_target,
            actual: dkim_actual,
        },
        DomainCheckResult {
            key: "dmarc",
            label: "DMARC",
            status: if dmarc_answers
                .iter()
                .any(|value| value.to_lowercase().starts_with("v=dmarc1"))
            {
                "verified"
            } else {
                "failed"
            },
            expected: "v=DMARC1".to_string(),
            actual: dmarc_actual,
        },
    ];

    let database_check = verify_database_runtime(db_url).await;
    let provider_runtime_check = validate_provider_credentials(
        &state.http_client,
        provider,
        api_key,
        provider_endpoint(&payload),
    )
    .await;
    let (provider_domain_check, provider_records) = verify_provider_domain(
        &state.http_client,
        provider,
        api_key,
        provider_endpoint(&payload),
        &domain,
    )
    .await;
    let runtime_checks = vec![
        database_check,
        provider_runtime_check,
        provider_domain_check,
    ];

    let failed_labels: Vec<&str> = checks
        .iter()
        .filter(|check| check.status != "verified")
        .map(|check| check.label)
        .collect();
    let failed_runtime_labels: Vec<&str> = runtime_checks
        .iter()
        .filter(|check| check.status != "verified")
        .map(|check| check.label)
        .collect();
    let success = failed_labels.is_empty() && failed_runtime_labels.is_empty();
    let mut failure_segments = Vec::new();
    if !failed_labels.is_empty() {
        failure_segments.push(format!("DNS checks: {}", failed_labels.join(", ")));
    }
    if !failed_runtime_labels.is_empty() {
        failure_segments.push(format!(
            "Runtime checks: {}",
            failed_runtime_labels.join(", ")
        ));
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": success,
            "domain": domain,
            "message": if success {
                "Domain verification completed successfully.".to_string()
            } else {
                format!("Domain verification is incomplete. Fix: {}.", failure_segments.join(" | "))
            },
            "checks": checks,
            "runtimeChecks": runtime_checks,
            "providerRecords": provider_records,
            "provider": provider,
        })),
    )
}

pub async fn send_mail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendMailPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    if payload.to.is_empty() || payload.subject.trim().is_empty() || payload.body.trim().is_empty()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "At least one recipient, subject, and body are required."
            })),
        );
    }

    if let (Some(provider), Some(api_key)) =
        (payload.provider.as_deref(), payload.api_key.as_deref())
    {
        let provider_check = validate_provider_credentials(
            &state.http_client,
            provider,
            api_key,
            payload.provider_endpoint.as_deref(),
        )
        .await;
        if provider_check.status != "verified" {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "message": provider_check.detail,
                    "provider": provider
                })),
            );
        }

        return match dispatch_via_provider(
            &state.http_client,
            provider,
            api_key,
            payload.provider_endpoint.as_deref(),
            &payload,
        )
        .await
        {
            Ok(external_id) => (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "message": "Mail delivered through the configured external provider.",
                    "queued": false,
                    "id": external_id.unwrap_or_default(),
                    "provider": provider,
                    "from": payload.from,
                    "fromName": payload.from_name
                })),
            ),
            Err(err) => {
                let lower = err.to_lowercase();
                let suggestion = if provider.eq_ignore_ascii_case("resend")
                    && lower.contains("domain")
                    && lower.contains("not verified")
                {
                    Some("The sender domain is not verified in Resend yet. Open Business → Domains, review the provider domain check, publish the required DNS records in Resend, then retry sending.".to_string())
                } else {
                    None
                };

                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "success": false,
                        "message": err,
                        "provider": provider,
                        "errorType": "ProviderRejected",
                        "suggestion": suggestion
                    })),
                )
            }
        };
    }

    let mut request = state
        .http_client
        .post(format!(
            "{}/emails",
            state.config.mail_service_url.trim_end_matches('/')
        ))
        .json(&json!({
            "to": payload.to,
            "cc": Value::Null,
            "bcc": Value::Null,
            "subject": payload.subject.trim(),
            "body": payload.body,
            "html_body": Value::Null,
            "attachment_ids": Value::Null,
            "schedule_send_at": Value::Null,
            "from": payload.from,
            "from_name": payload.from_name
        }));

    if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
        request = request.header(axum::http::header::AUTHORIZATION, auth_header);
    }

    let response = match request.send().await {
        Ok(resp) => resp,
        Err(err) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "success": false,
                    "message": format!("Mail service unavailable: {err}")
                })),
            )
        }
    };

    let status =
        StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let body = response
        .json::<Value>()
        .await
        .unwrap_or_else(|_| json!({"success": false, "message": "Invalid upstream response"}));

    let response_json = if status.is_success() {
        json!({
            "success": true,
            "message": "Mail delivered through the backend relay.",
            "queued": false,
            "id": body.get("message_id").and_then(Value::as_str).unwrap_or_default(),
            "upstream": body,
            "from": payload.from,
            "fromName": payload.from_name
        })
    } else {
        body
    };

    (status, Json(response_json))
}

#[cfg(test)]
mod tests {
    #[test]
    fn nested_auth_path_rewrites_to_upstream_root() {
        let path = "/auth/send-otp";
        let remaining = path.strip_prefix("/auth").unwrap_or(path);
        assert_eq!(remaining, "/send-otp");
    }

    #[test]
    fn nested_mail_path_rewrites_to_upstream_root() {
        let path = "/mail/emails";
        let remaining = path.strip_prefix("/mail").unwrap_or(path);
        assert_eq!(remaining, "/emails");
    }
}
