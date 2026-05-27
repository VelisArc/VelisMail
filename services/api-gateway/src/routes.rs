//! API Gateway routes - reverse proxy plus compatibility endpoints.

use crate::state::AppState;
use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, DecodingKey, Validation};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::collections::HashMap;
use std::sync::Mutex;
use tokio::{
    net::{lookup_host, TcpStream},
    time::{sleep, timeout, Duration},
};

const RESEND_WEBHOOK_TOLERANCE_SECONDS: u64 = 300;

pub fn api_v1_routes(_state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/verify/providers", get(get_supported_providers))
        .route("/verify", post(verify_infrastructure))
        .route("/mail/send", post(send_mail))
        .route("/mail/inbound", post(receive_resend_inbound))
        .route(
            "/mail/business-emails",
            get(get_business_emails).post(save_business_email),
        )
        .route("/mail/business-emails/query", post(query_business_emails))
        .route("/team/invites", post(create_team_invite))
        .route("/team/invites/validate", post(validate_team_invite))
        .route("/team/invites/complete", post(complete_team_invite))
        .route("/team/invites/revoke", post(revoke_team_invite))
        .route("/tenants/verify-domain", post(verify_domain))
        .route("/payments/create-order", post(create_payment_order))
        .route("/payments/verify", post(verify_payment))
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
        "version": env!("CARGO_PKG_VERSION"),
        "message": "VelisMail API Gateway is running.",
        "health": "/health",
        "apiBase": "/api/v1"
    }))
}

pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "api-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

pub async fn ws_handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    tracing::info!("New WebSocket connection established");
    // Send a welcome message
    if let Err(e) = socket
        .send(axum::extract::ws::Message::Text("connected".to_string()))
        .await
    {
        tracing::error!("Failed to send welcome message: {}", e);
        return;
    }

    // Keep the socket alive so clients can observe connection health.
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
proxy_handler!(proxy_delivery, delivery_service_url, "/delivery");

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
    webhook_secret: Option<String>,
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
#[serde(rename_all = "camelCase")]
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

fn contains_unsafe_placeholder(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    normalized.is_empty()
        || [
            "example",
            "placeholder",
            "replace-with",
            "your-",
            "your_",
            "[password]",
            ":password@",
            "user:pass",
            "user:password",
            "xxxxx",
            "xxxxxxxx",
            "secretkey",
            "api-key",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
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
                    let sg_atts: Vec<_> = atts
                        .iter()
                        .map(|a| {
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
                        })
                        .collect();
                    if let Some(object) = req_body.as_object_mut() {
                        object.insert("attachments".to_string(), json!(sg_atts));
                    }
                }
            }
            client
                .post("https://api.sendgrid.com/v3/mail/send")
                .bearer_auth(api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        }
        "resend" => {
            let mut req_body = json!({
                "from": format!("{from_name} <{from_email}>"),
                "to": payload.to,
                "subject": payload.subject.trim(),
                "text": payload.body,
            });
            if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let rs_atts: Vec<_> = atts
                        .iter()
                        .map(|a| {
                            let content = if let Some(idx) = a.content.find("base64,") {
                                &a.content[idx + 7..]
                            } else {
                                &a.content
                            };
                            json!({
                                "content": content,
                                "filename": a.filename
                            })
                        })
                        .collect();
                    if let Some(object) = req_body.as_object_mut() {
                        object.insert("attachments".to_string(), json!(rs_atts));
                    }
                }
            }
            client
                .post("https://api.resend.com/emails")
                .bearer_auth(api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        }
        "postmark" => {
            let mut req_body = json!({
                "From": format!("{from_name} <{from_email}>"),
                "To": payload.to.join(","),
                "Subject": payload.subject.trim(),
                "TextBody": payload.body,
            });
            if let Some(atts) = &payload.attachments {
                if !atts.is_empty() {
                    let pm_atts: Vec<_> = atts
                        .iter()
                        .map(|a| {
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
                        })
                        .collect();
                    if let Some(object) = req_body.as_object_mut() {
                        object.insert("Attachments".to_string(), json!(pm_atts));
                    }
                }
            }
            client
                .post("https://api.postmarkapp.com/email")
                .header("X-Postmark-Server-Token", api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        }
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
                    let br_atts: Vec<_> = atts
                        .iter()
                        .map(|a| {
                            let content = if let Some(idx) = a.content.find("base64,") {
                                &a.content[idx + 7..]
                            } else {
                                &a.content
                            };
                            json!({
                                "name": a.filename,
                                "content": content
                            })
                        })
                        .collect();
                    if let Some(object) = req_body.as_object_mut() {
                        object.insert("attachment".to_string(), json!(br_atts));
                    }
                }
            }
            client
                .post("https://api.brevo.com/v3/smtp/email")
                .header("api-key", api_key)
                .json(&req_body)
                .send()
                .await
                .map_err(|err| err.to_string())?
        }

        "amazonses" => {
            let credentials = if let Some((ak, sk)) = api_key.split_once(':') {
                aws_sdk_sesv2::config::Credentials::new(ak, sk, None, None, "manual")
            } else {
                return Err(
                    "Amazon SES requires api_key in the format 'ACCESS_KEY:SECRET_KEY'".to_string(),
                );
            };
            let region = aws_config::Region::new(endpoint.unwrap_or("us-east-1").to_string());
            let config = aws_config::SdkConfig::builder()
                .credentials_provider(aws_sdk_sesv2::config::SharedCredentialsProvider::new(
                    credentials,
                ))
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
                    raw_message.push_str(&format!(
                        "Content-Type: multipart/mixed; boundary=\"{}\"\n\n",
                        boundary
                    ));

                    raw_message.push_str(&format!("--{}\n", boundary));
                    raw_message.push_str("Content-Type: text/plain; charset=UTF-8\n\n");
                    raw_message.push_str(&format!("{}\n\n", payload.body));

                    for att in atts {
                        raw_message.push_str(&format!("--{}\n", boundary));
                        raw_message.push_str(&format!(
                            "Content-Type: {}; name=\"{}\"\n",
                            att.mime_type, att.filename
                        ));
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

                    let raw = aws_sdk_sesv2::types::RawMessage::builder()
                        .data(aws_sdk_sesv2::primitives::Blob::new(
                            raw_message.into_bytes(),
                        ))
                        .build()
                        .map_err(|err| err.to_string())?;
                    aws_sdk_sesv2::types::EmailContent::builder()
                        .raw(raw)
                        .build()
                } else {
                    let subject = aws_sdk_sesv2::types::Content::builder()
                        .data(payload.subject.trim())
                        .build()
                        .map_err(|err| err.to_string())?;
                    let text = aws_sdk_sesv2::types::Content::builder()
                        .data(payload.body.clone())
                        .build()
                        .map_err(|err| err.to_string())?;
                    let message_builder = aws_sdk_sesv2::types::Message::builder()
                        .subject(subject)
                        .body(aws_sdk_sesv2::types::Body::builder().text(text).build());
                    aws_sdk_sesv2::types::EmailContent::builder()
                        .simple(message_builder.build())
                        .build()
                }
            } else {
                let subject = aws_sdk_sesv2::types::Content::builder()
                    .data(payload.subject.trim())
                    .build()
                    .map_err(|err| err.to_string())?;
                let text = aws_sdk_sesv2::types::Content::builder()
                    .data(payload.body.clone())
                    .build()
                    .map_err(|err| err.to_string())?;
                let message_builder = aws_sdk_sesv2::types::Message::builder()
                    .subject(subject)
                    .body(aws_sdk_sesv2::types::Body::builder().text(text).build());
                aws_sdk_sesv2::types::EmailContent::builder()
                    .simple(message_builder.build())
                    .build()
            };

            match ses_client
                .send_email()
                .from_email_address(format!("{} <{}>", from_name, from_email))
                .destination(dest_builder)
                .content(email_content)
                .send()
                .await
            {
                Ok(resp) => return Ok(resp.message_id),
                Err(err) => return Err(format!("Amazon SES error: {}", err)),
            }
        }
        "custom_webhook" => {
            let endpoint =
                endpoint.ok_or_else(|| "Custom webhook endpoint is missing.".to_string())?;
            client
                .post(endpoint)
                .header(
                    axum::http::header::AUTHORIZATION,
                    format!("Bearer {api_key}"),
                )
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
        _ => {
            return Err(format!(
                "Provider '{provider}' is not supported for outbound delivery."
            ))
        }
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
        .to_ascii_lowercase()
}

async fn query_dns_answers(
    client: &reqwest::Client,
    name: &str,
    record_type: &str,
) -> Result<Vec<String>, String> {
    let response = client
        .get("https://dns.google/resolve")
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

fn is_resend_inbound_mx_host(host: &str) -> bool {
    let normalized = normalize_dns_answer(host);
    normalized == "inbound-smtp.us-east-1.amazonaws.com"
        || (normalized.starts_with("inbound-smtp.")
            && normalized.ends_with(".amazonaws.com")
            && normalized.len() > "inbound-smtp..amazonaws.com".len())
}

fn provider_inbound_mx_hosts(records: &[ProviderDnsRecord]) -> Vec<String> {
    records
        .iter()
        .filter(|record| record.record_type.eq_ignore_ascii_case("MX"))
        .filter_map(|record| {
            let host = record
                .value
                .split_whitespace()
                .last()
                .unwrap_or(&record.value);
            let normalized = normalize_dns_answer(host);
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        })
        .collect()
}

fn public_api_base_url() -> String {
    std::env::var("PUBLIC_API_URL")
        .or_else(|_| std::env::var("VITE_API_URL"))
        .unwrap_or_else(|_| "https://api.velismail.online".to_string())
        .trim_end_matches('/')
        .to_string()
}

fn expected_resend_inbound_webhook_url() -> String {
    format!("{}/api/v1/mail/inbound", public_api_base_url())
}

fn normalize_webhook_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn webhook_event_enabled(events: &Value, event_name: &str) -> bool {
    events
        .as_array()
        .map(|items| {
            items.iter().any(|item| {
                item.as_str()
                    .map(|event| event.eq_ignore_ascii_case(event_name))
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
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

async fn verify_resend_inbound_webhook(
    client: &reqwest::Client,
    api_key: &str,
) -> RuntimeCheckResult {
    let expected_url = expected_resend_inbound_webhook_url();
    let response = {
        let mut attempt = 0u64;
        loop {
            let response = match timeout(
                Duration::from_secs(10),
                client
                    .get("https://api.resend.com/webhooks")
                    .bearer_auth(api_key)
                    .send(),
            )
            .await
            {
                Ok(Ok(response)) => response,
                Ok(Err(err)) => {
                    return RuntimeCheckResult {
                        key: "resendInboundWebhook",
                        label: "Resend Receiving Webhook",
                        status: "failed",
                        detail: format!("Resend webhook lookup failed: {err}"),
                        category: "network",
                        recommendation: Some("The backend could not reach Resend webhook APIs. Check outbound HTTPS access, then retry verification.".to_string()),
                    }
                }
                Err(_) => {
                    return RuntimeCheckResult {
                        key: "resendInboundWebhook",
                        label: "Resend Receiving Webhook",
                        status: "failed",
                        detail: "Resend webhook lookup timed out.".to_string(),
                        category: "network",
                        recommendation: Some("Retry after checking the backend network path to Resend.".to_string()),
                    }
                }
            };

            if response.status().as_u16() != 429 || attempt >= 2 {
                break response;
            }

            let retry_after_ms = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000))
                .unwrap_or_else(|| 750 * (attempt + 1));
            sleep(Duration::from_millis(retry_after_ms)).await;
            attempt += 1;
        }
    };

    if response.status().as_u16() == 429 {
        let body = response.text().await.unwrap_or_default();
        return RuntimeCheckResult {
            key: "resendInboundWebhook",
            label: "Resend Receiving Webhook",
            status: "failed",
            detail: if body.trim().is_empty() {
                "Resend rate limited webhook verification. Wait a few seconds and retry.".to_string()
            } else {
                format!("Resend rate limited webhook verification: {}", body.trim())
            },
            category: "rate_limit",
            recommendation: Some("Wait 10-30 seconds, then click Verify again. Avoid repeated rapid retries because Resend allows only a small number of API requests per second.".to_string()),
        };
    }

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return RuntimeCheckResult {
            key: "resendInboundWebhook",
            label: "Resend Receiving Webhook",
            status: "failed",
            detail: if body.trim().is_empty() {
                format!("Resend rejected webhook lookup with status {status}.")
            } else {
                format!("Resend rejected webhook lookup with status {status}: {}", body.trim())
            },
            category: "config",
            recommendation: Some("Verify that the Resend API key belongs to the same account/project where the inbound webhook is configured.".to_string()),
        };
    }

    let payload = response.json::<Value>().await.unwrap_or(Value::Null);
    let expected_normalized = normalize_webhook_url(&expected_url);
    let webhooks = payload
        .get("data")
        .and_then(Value::as_array)
        .or_else(|| payload.as_array());
    let matching = webhooks.and_then(|items| {
        items.iter().find(|webhook| {
            let endpoint = webhook
                .get("url")
                .or_else(|| webhook.get("endpoint"))
                .or_else(|| webhook.get("endpoint_url"))
                .or_else(|| webhook.get("destination"))
                .and_then(Value::as_str)
                .map(normalize_webhook_url)
                .unwrap_or_default();
            endpoint == expected_normalized
        })
    });

    let Some(webhook) = matching else {
        return RuntimeCheckResult {
            key: "resendInboundWebhook",
            label: "Resend Receiving Webhook",
            status: "failed",
            detail: format!("No Resend webhook is configured for {expected_url}."),
            category: "config",
            recommendation: Some("Create or update a Resend webhook with event email.received and URL https://api.velismail.online/api/v1/mail/inbound, then paste that webhook signing secret in setup.".to_string()),
        };
    };

    let events = webhook
        .get("events")
        .or_else(|| webhook.get("event_types"))
        .unwrap_or(&Value::Null);
    if !webhook_event_enabled(events, "email.received") {
        return RuntimeCheckResult {
            key: "resendInboundWebhook",
            label: "Resend Receiving Webhook",
            status: "failed",
            detail: format!("The Resend webhook exists, but email.received is not enabled for {expected_url}."),
            category: "config",
            recommendation: Some("Edit the Resend webhook and enable the email.received event before completing setup.".to_string()),
        };
    }

    let status = webhook
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("enabled")
        .to_ascii_lowercase();
    let enabled = !matches!(status.as_str(), "disabled" | "inactive" | "failed");

    RuntimeCheckResult {
        key: "resendInboundWebhook",
        label: "Resend Receiving Webhook",
        status: if enabled { "verified" } else { "failed" },
        detail: if enabled {
            format!("Resend forwards email.received events to {expected_url}.")
        } else {
            format!("Resend webhook for {expected_url} is {status}.")
        },
        category: if enabled { "success" } else { "config" },
        recommendation: if enabled {
            None
        } else {
            Some("Enable the Resend webhook before completing setup.".to_string())
        },
    }
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
    if contains_unsafe_placeholder(db_url) {
        return verify_infrastructure_response(
            StatusCode::BAD_REQUEST,
            false,
            "Database URL contains placeholder values.",
            api_provider,
            db_url,
            vec![runtime_check_failure(
                "database",
                "Database Runtime Check",
                "The database URL still contains example/user/password placeholder text.",
                "config",
                "Paste the exact connection string from your database provider.",
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
    if contains_unsafe_placeholder(api_key) {
        return verify_infrastructure_response(
            StatusCode::BAD_REQUEST,
            false,
            "Provider API key contains placeholder values.",
            api_provider,
            db_url,
            vec![runtime_check_failure(
                "mailProvider",
                "Mail Provider Runtime Check",
                "The provider API key looks like an example value, not a live secret.",
                "config",
                "Paste the real API key from your selected provider account.",
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
    if contains_unsafe_placeholder(db_url) || contains_unsafe_placeholder(api_key) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "ValidationError",
                "message": "Database URL or provider API key contains placeholder values."
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
    if provider.eq_ignore_ascii_case("resend")
        && payload
            .webhook_secret
            .as_deref()
            .map(str::trim)
            .filter(|secret| secret.starts_with("whsec_") && secret.len() >= 16)
            .is_none()
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Resend webhook signing secret is required for inbound receiving."
            })),
        );
    }
    if provider.eq_ignore_ascii_case("resend")
        && payload
            .webhook_secret
            .as_deref()
            .map(contains_unsafe_placeholder)
            .unwrap_or(true)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Resend webhook signing secret contains placeholder values."
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

    let txt_host = format!("_velismail-verify.{domain}");
    let dmarc_host = format!("_dmarc.{domain}");
    let resend_provider = provider.eq_ignore_ascii_case("resend");
    let (provider_domain_check, provider_records) = verify_provider_domain(
        &state.http_client,
        provider,
        api_key,
        provider_endpoint(&payload),
        &domain,
    )
    .await;
    let provider_mx_hosts = provider_inbound_mx_hosts(&provider_records);
    let expected_mx = if !provider_mx_hosts.is_empty() {
        provider_mx_hosts.join(", ")
    } else if resend_provider {
        "Provider-listed inbound MX for this domain region".to_string()
    } else {
        "Managed by the selected provider; VelisMail does not require legacy mx1/mx2 records."
            .to_string()
    };

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
    let dmarc_actual = dmarc_answers
        .iter()
        .find(|value| value.to_lowercase().starts_with("v=dmarc1"))
        .cloned()
        .unwrap_or_else(|| "DMARC record not found".to_string());
    let mx_verified = !resend_provider
        || normalized_mx_hosts
            .iter()
            .any(|host| is_resend_inbound_mx_host(host))
        || normalized_mx_hosts
            .iter()
            .any(|host| provider_mx_hosts.iter().any(|expected| host == expected));

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
            status: if mx_verified { "verified" } else { "failed" },
            expected: expected_mx,
            actual: mx_actual,
        },
        DomainCheckResult {
            key: "spf",
            label: "Provider SPF",
            status: "verified",
            expected: "Verified by provider domain check".to_string(),
            actual: "Provider DNS is checked through the selected mail provider.".to_string(),
        },
        DomainCheckResult {
            key: "dkim",
            label: "Provider DKIM",
            status: "verified",
            expected: "Verified by provider domain check".to_string(),
            actual: "Provider DNS is checked through the selected mail provider.".to_string(),
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
    let mut runtime_checks = vec![
        database_check,
        provider_runtime_check,
        provider_domain_check,
    ];
    if provider.eq_ignore_ascii_case("resend") {
        runtime_checks.push(verify_resend_inbound_webhook(&state.http_client, api_key).await);
    }

    let initial_dns_passed = checks.iter().all(|check| check.status == "verified");
    let initial_runtime_passed = runtime_checks
        .iter()
        .all(|check| check.status == "verified");
    if initial_dns_passed && initial_runtime_passed && provider.eq_ignore_ascii_case("resend") {
        let route_check = register_inbound_route(
            &state,
            &domain,
            db_url,
            provider,
            api_key,
            payload.webhook_secret.as_deref().unwrap_or(""),
        )
        .await;
        runtime_checks.push(route_check);
    }

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

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamInviteWorkspace {
    pub tenant_id: Option<String>,
    pub display_name: Option<String>,
    pub business_domain: Option<String>,
    pub business_db_url: Option<String>,
    pub business_api_key: Option<String>,
    pub business_mail_provider: Option<String>,
    pub business_mail_provider_endpoint: Option<String>,
    pub business_mailbox_address: Option<String>,
    pub business_domain_verified: Option<bool>,
    pub business_profile: Option<Value>,
    pub is_business_setup_complete: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamInviteRequest {
    pub email: String,
    pub name: String,
    pub role: String,
    pub expires_in_hours: Option<i64>,
    pub issuer_email: String,
    pub workspace: TeamInviteWorkspace,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateTeamInviteRequest {
    pub token: String,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteTeamInviteRequest {
    pub token: String,
    pub email: String,
    pub verification_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeTeamInviteRequest {
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TeamInviteRecord {
    pub id: String,
    pub token: String,
    pub email: String,
    pub name: String,
    pub role: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub accepted_at: Option<String>,
    pub issuer_email: String,
    pub workspace: TeamInviteWorkspace,
}

#[derive(Debug, Serialize, Deserialize)]
struct TeamOtpVerificationClaims {
    sub: String,
    purpose: String,
    verified_at: i64,
    exp: i64,
}

fn normalize_team_email(value: &str) -> String {
    value.trim().to_lowercase()
}

fn valid_team_role(value: &str) -> bool {
    matches!(value, "admin" | "member" | "viewer")
}

async fn load_team_invite(state: &AppState, token: &str) -> Option<TeamInviteRecord> {
    let value = {
        let invites = state.team_invites.read().await;
        invites.get(token).cloned()
    }?;
    serde_json::from_value(value).ok()
}

async fn set_team_invite_status(state: &AppState, token: &str, status: &str) {
    let mut invites = state.team_invites.write().await;
    if let Some(value) = invites.get_mut(token) {
        value["status"] = Value::String(status.to_string());
        if status == "accepted" {
            value["acceptedAt"] = Value::String(chrono::Utc::now().to_rfc3339());
        }
    }
}

fn team_invite_expired(invite: &TeamInviteRecord) -> bool {
    invite
        .expires_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&chrono::Utc) < chrono::Utc::now())
        .unwrap_or(false)
}

fn public_team_invite(invite: &TeamInviteRecord) -> Value {
    json!({
        "id": invite.id.clone(),
        "token": invite.token.clone(),
        "email": invite.email.clone(),
        "name": invite.name.clone(),
        "role": invite.role.clone(),
        "status": invite.status.clone(),
        "createdAt": invite.created_at.clone(),
        "expiresAt": invite.expires_at.clone(),
        "acceptedAt": invite.accepted_at.clone(),
        "issuerEmail": invite.issuer_email.clone()
    })
}

fn verify_team_otp_token(
    state: &AppState,
    email: &str,
    verification_token: &str,
) -> Result<(), StatusCode> {
    if state.config.otp_signing_secret.trim().is_empty() {
        tracing::error!("OTP_SIGNING_SECRET is required for Team Access completion");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let mut validation = Validation::default();
    validation.validate_aud = false;
    validation.leeway = 120;
    let decoded = decode::<TeamOtpVerificationClaims>(
        verification_token.trim(),
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if decoded.claims.purpose != "register" || decoded.claims.sub != email {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(())
}

pub async fn create_team_invite(
    State(state): State<AppState>,
    Json(payload): Json<CreateTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    let email = normalize_team_email(&payload.email);
    let issuer_email = normalize_team_email(&payload.issuer_email);
    let role = payload.role.trim().to_lowercase();

    if !email.contains('@') || !issuer_email.contains('@') {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "A valid invite email and issuer email are required."
            })),
        );
    }
    if !valid_team_role(&role) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Role must be admin, member, or viewer."
            })),
        );
    }

    let now = chrono::Utc::now();
    let requested_expiry = payload.expires_in_hours.unwrap_or(24);
    let expires_at = if requested_expiry <= 0 {
        None
    } else {
        Some((now + chrono::Duration::hours(requested_expiry.clamp(1, 720))).to_rfc3339())
    };
    let token = format!(
        "vmt_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let invite = TeamInviteRecord {
        id: uuid::Uuid::new_v4().to_string(),
        token: token.clone(),
        email,
        name: if payload.name.trim().is_empty() {
            payload
                .email
                .split('@')
                .next()
                .unwrap_or("Team member")
                .to_string()
        } else {
            payload.name.trim().to_string()
        },
        role,
        status: "pending".to_string(),
        created_at: now.to_rfc3339(),
        expires_at,
        accepted_at: None,
        issuer_email,
        workspace: payload.workspace,
    };

    let serialized = match serde_json::to_value(&invite) {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Failed to serialize invite: {err}")
                })),
            )
        }
    };

    {
        let mut invites = state.team_invites.write().await;
        invites.insert(token, serialized);
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "invite": invite
        })),
    )
}

pub async fn validate_team_invite(
    State(state): State<AppState>,
    Json(payload): Json<ValidateTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    let token = payload.token.trim();
    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Team access key is required."
            })),
        );
    }

    let invite = match load_team_invite(&state, token).await {
        Some(value) => value,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "success": false,
                    "message": "Invalid team access key."
                })),
            )
        }
    };

    if invite.status == "revoked" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "message": "This team access key was revoked."
            })),
        );
    }
    if team_invite_expired(&invite) {
        set_team_invite_status(&state, token, "expired").await;
        return (
            StatusCode::GONE,
            Json(json!({
                "success": false,
                "message": "This team access key has expired."
            })),
        );
    }

    if let Some(email) = payload.email {
        if normalize_team_email(&email) != invite.email {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "success": false,
                    "message": "This email is not assigned to the provided team access key."
                })),
            );
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "invite": public_team_invite(&invite)
        })),
    )
}

pub async fn complete_team_invite(
    State(state): State<AppState>,
    Json(payload): Json<CompleteTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    let token = payload.token.trim();
    let email = normalize_team_email(&payload.email);
    if token.is_empty() || email.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Team access key and email are required."
            })),
        );
    }

    let invite = match load_team_invite(&state, token).await {
        Some(value) => value,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({
                    "success": false,
                    "message": "Invalid team access key."
                })),
            )
        }
    };

    if invite.status == "revoked" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "message": "This team access key was revoked."
            })),
        );
    }
    if team_invite_expired(&invite) {
        set_team_invite_status(&state, token, "expired").await;
        return (
            StatusCode::GONE,
            Json(json!({
                "success": false,
                "message": "This team access key has expired."
            })),
        );
    }
    if email != invite.email {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "message": "Team access key and email do not match."
            })),
        );
    }

    if let Err(status) = verify_team_otp_token(&state, &email, &payload.verification_token) {
        return (
            status,
            Json(json!({
                "success": false,
                "message": "OTP verification token is invalid or expired."
            })),
        );
    }

    set_team_invite_status(&state, token, "accepted").await;
    let mut accepted_invite = invite;
    accepted_invite.status = "accepted".to_string();
    accepted_invite.accepted_at = Some(chrono::Utc::now().to_rfc3339());

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "invite": accepted_invite
        })),
    )
}

pub async fn revoke_team_invite(
    State(state): State<AppState>,
    Json(payload): Json<RevokeTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    let token = payload.token.trim();
    if token.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Team access key is required."
            })),
        );
    }

    let exists = {
        let invites = state.team_invites.read().await;
        invites.contains_key(token)
    };
    if !exists {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "message": "Team access key was not found."
            })),
        );
    }

    set_team_invite_status(&state, token, "revoked").await;

    (
        StatusCode::OK,
        Json(json!({
            "success": true
        })),
    )
}

static POOLS: Lazy<Mutex<HashMap<String, PgPool>>> = Lazy::new(|| Mutex::new(HashMap::new()));

fn normalize_business_db_url(db_url: &str) -> String {
    let trimmed = db_url.trim();
    if trimmed.contains("neon.tech") && !trimmed.to_ascii_lowercase().contains("sslmode=") {
        let separator = if trimmed.contains('?') { '&' } else { '?' };
        return format!("{trimmed}{separator}sslmode=require");
    }
    trimmed.to_string()
}

async fn get_tenant_pool(db_url: &str) -> Result<PgPool, String> {
    let normalized_url = normalize_business_db_url(db_url);

    if let Some(pool) = {
        let pools = POOLS
            .lock()
            .map_err(|_| "Tenant pool cache lock poisoned".to_string())?;
        pools.get(&normalized_url).cloned()
    } {
        return Ok(pool);
    }

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&normalized_url)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut pools = POOLS
            .lock()
            .map_err(|_| "Tenant pool cache lock poisoned".to_string())?;
        pools.insert(normalized_url, pool.clone());
    }

    Ok(pool)
}

async fn ensure_business_emails_table(pool: &PgPool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS business_emails (
            id VARCHAR(255) PRIMARY KEY,
            sender VARCHAR(255),
            sender_name VARCHAR(255),
            recipients TEXT,
            subject TEXT,
            body TEXT,
            folder VARCHAR(50),
            created_at VARCHAR(100),
            is_read BOOLEAN,
            is_starred BOOLEAN,
            has_attachment BOOLEAN DEFAULT FALSE
        );",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS has_attachment BOOLEAN DEFAULT FALSE;")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmail {
    pub id: String,
    pub from: String,
    pub from_name: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    pub folder: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    #[serde(default)]
    pub has_attachment: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBusinessEmailRequest {
    pub db_url: Option<String>,
    pub email: BusinessEmail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmailsQuery {
    pub db_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmailsRequest {
    pub db_url: String,
}

fn business_db_url_from_parts(
    headers: &HeaderMap,
    query_url: Option<&str>,
    body_url: Option<&str>,
) -> Option<String> {
    body_url
        .or(query_url)
        .or_else(|| {
            headers
                .get("x-business-db-url")
                .and_then(|h| h.to_str().ok())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn first_header<'a>(headers: &'a HeaderMap, names: &[&str]) -> Option<&'a str> {
    names
        .iter()
        .find_map(|name| headers.get(*name).and_then(|value| value.to_str().ok()))
}

fn decode_svix_secret(secret: &str) -> Vec<u8> {
    let raw = secret
        .trim()
        .strip_prefix("whsec_")
        .unwrap_or(secret.trim());
    general_purpose::STANDARD
        .decode(raw)
        .unwrap_or_else(|_| secret.as_bytes().to_vec())
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn html_to_readable_text(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => {
                in_tag = true;
                text.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    decode_html_entities(&text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut diff = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        let left_byte = left.get(index).copied().unwrap_or_default() as usize;
        let right_byte = right.get(index).copied().unwrap_or_default() as usize;
        diff |= left_byte ^ right_byte;
    }
    diff == 0
}

fn verify_resend_webhook_signature(
    headers: &HeaderMap,
    body: &[u8],
    secret: &str,
) -> Result<bool, String> {
    if secret.trim().is_empty() {
        return Err("Missing Resend webhook signing secret for this domain.".to_string());
    }

    let msg_id = first_header(headers, &["svix-id", "webhook-id"])
        .ok_or_else(|| "Missing Resend webhook id header.".to_string())?;
    let timestamp = first_header(headers, &["svix-timestamp", "webhook-timestamp"])
        .ok_or_else(|| "Missing Resend webhook timestamp header.".to_string())?;
    let signature = first_header(headers, &["svix-signature", "webhook-signature"])
        .ok_or_else(|| "Missing Resend webhook signature header.".to_string())?;
    let timestamp_seconds = timestamp
        .parse::<i64>()
        .map_err(|_| "Invalid Resend webhook timestamp.".to_string())?;
    let age_seconds = chrono::Utc::now().timestamp().abs_diff(timestamp_seconds);
    if age_seconds > RESEND_WEBHOOK_TOLERANCE_SECONDS {
        return Err("Expired Resend webhook timestamp.".to_string());
    }

    let signed_payload = format!("{}.{}.", msg_id, timestamp);
    let secret_key = decode_svix_secret(secret);
    let mut mac = Hmac::<Sha256>::new_from_slice(&secret_key)
        .map_err(|_| "Invalid Resend webhook secret.".to_string())?;
    mac.update(signed_payload.as_bytes());
    mac.update(body);
    let expected = mac.finalize().into_bytes().to_vec();

    let valid = signature
        .split_whitespace()
        .filter_map(|part| part.strip_prefix("v1,"))
        .filter_map(|received| general_purpose::STANDARD.decode(received).ok())
        .any(|received| constant_time_eq(&received, &expected));
    if valid {
        Ok(true)
    } else {
        Err("Invalid Resend webhook signature.".to_string())
    }
}

fn value_string(value: Option<&Value>) -> Option<String> {
    value.and_then(|item| match item {
        Value::String(text) => {
            let trimmed = text.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn value_string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => {
                    let trimmed = text.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                }
                Value::Object(map) => value_string(map.get("email").or_else(|| map.get("address"))),
                _ => None,
            })
            .collect(),
        Some(Value::String(text)) => text
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

fn resend_recipient_addresses(data: &Value) -> Vec<String> {
    let mut recipients = Vec::new();
    for key in ["to", "cc", "bcc", "recipients"] {
        for address in value_string_array(data.get(key)) {
            let normalized = address.trim().to_lowercase();
            if !normalized.is_empty()
                && !recipients
                    .iter()
                    .any(|existing: &String| existing.trim().eq_ignore_ascii_case(&normalized))
            {
                recipients.push(address);
            }
        }
    }
    recipients
}

fn email_address_domain(address: &str) -> Option<String> {
    let candidate = address
        .split('<')
        .nth(1)
        .and_then(|part| part.split('>').next())
        .unwrap_or(address)
        .trim()
        .trim_matches('"')
        .to_lowercase();
    candidate
        .split('@')
        .nth(1)
        .map(|domain| domain.trim_matches('.').to_string())
        .filter(|domain| is_valid_domain(domain))
}

fn sender_display_name(from: &str) -> String {
    let name = from
        .split('<')
        .next()
        .unwrap_or(from)
        .trim()
        .trim_matches('"');
    if name.is_empty() || name == from {
        from.to_string()
    } else {
        name.to_string()
    }
}

async fn gateway_route_pool() -> Option<PgPool> {
    let db_url = std::env::var("INBOUND_ROUTING_DB_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .ok()?;
    get_tenant_pool(&db_url).await.ok()
}

async fn ensure_inbound_routes_table(pool: &PgPool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS inbound_mail_routes (
            domain VARCHAR(255) PRIMARY KEY,
            db_url TEXT NOT NULL,
            api_key TEXT,
            webhook_secret TEXT,
            provider VARCHAR(64),
            updated_at VARCHAR(100) NOT NULL
        );",
    )
    .execute(pool)
    .await
    .map_err(|err| err.to_string())?;
    sqlx::query("ALTER TABLE inbound_mail_routes ADD COLUMN IF NOT EXISTS api_key TEXT;")
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    sqlx::query("ALTER TABLE inbound_mail_routes ADD COLUMN IF NOT EXISTS webhook_secret TEXT;")
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

async fn register_inbound_route(
    state: &AppState,
    domain: &str,
    db_url: &str,
    provider: &str,
    api_key: &str,
    webhook_secret: &str,
) -> RuntimeCheckResult {
    if !is_valid_domain(domain)
        || !is_valid_database_url(db_url)
        || api_key.trim().is_empty()
        || webhook_secret.trim().is_empty()
    {
        return RuntimeCheckResult {
            key: "inboundRoute",
            label: "Inbound Route Registration",
            status: "failed",
            detail: "VelisMail cannot register receiving because the domain, database URL, provider API key, or webhook secret is missing.".to_string(),
            category: "config",
            recommendation: Some("Complete every infrastructure and Resend receiving field before verifying the domain.".to_string()),
        };
    }

    state.inbound_routes.write().await.insert(
        domain.to_string(),
        json!({
            "dbUrl": db_url,
            "apiKey": api_key,
            "webhookSecret": webhook_secret,
            "provider": provider,
        }),
    );

    let Some(pool) = gateway_route_pool().await else {
        return RuntimeCheckResult {
            key: "inboundRoute",
            label: "Inbound Route Registration",
            status: "failed",
            detail: "INBOUND_ROUTING_DB_URL or DATABASE_URL is not configured for the API gateway.".to_string(),
            category: "software",
            recommendation: Some("Deploy the backend with INBOUND_ROUTING_DB_URL pointing to the shared route database before users can receive mail.".to_string()),
        };
    };
    if let Err(err) = ensure_inbound_routes_table(&pool).await {
        return RuntimeCheckResult {
            key: "inboundRoute",
            label: "Inbound Route Registration",
            status: "failed",
            detail: format!("VelisMail could not prepare inbound route storage: {err}"),
            category: "software",
            recommendation: Some(
                "Fix the API gateway route database connection and retry verification.".to_string(),
            ),
        };
    }
    match sqlx::query(
        "INSERT INTO inbound_mail_routes (domain, db_url, api_key, webhook_secret, provider, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (domain) DO UPDATE SET db_url = $2, api_key = $3, webhook_secret = $4, provider = $5, updated_at = $6",
    )
    .bind(domain)
    .bind(db_url)
    .bind(api_key)
    .bind(webhook_secret)
    .bind(provider)
    .bind(chrono::Utc::now().to_rfc3339())
    .execute(&pool)
    .await
    {
        Ok(_) => RuntimeCheckResult {
            key: "inboundRoute",
            label: "Inbound Route Registration",
            status: "verified",
            detail: format!("VelisMail receiving route is registered for {domain}."),
            category: "success",
            recommendation: None,
        },
        Err(err) => RuntimeCheckResult {
            key: "inboundRoute",
            label: "Inbound Route Registration",
            status: "failed",
            detail: format!("VelisMail could not persist the receiving route: {err}"),
            category: "software",
            recommendation: Some("Fix the inbound route database and retry verification before granting dashboard access.".to_string()),
        },
    }
}

fn inbound_route_value(value: &Value) -> Option<(String, String, String)> {
    let db_url = value_string(value.get("dbUrl"))?;
    let api_key = value_string(value.get("apiKey"))?;
    let webhook_secret = value_string(value.get("webhookSecret"))?;
    if is_valid_database_url(&db_url) && !api_key.is_empty() && !webhook_secret.is_empty() {
        Some((db_url, api_key, webhook_secret))
    } else {
        None
    }
}

async fn lookup_inbound_route(state: &AppState, domain: &str) -> Option<(String, String, String)> {
    if let Some(route) = state
        .inbound_routes
        .read()
        .await
        .get(domain)
        .and_then(inbound_route_value)
    {
        return Some(route);
    }

    let pool = gateway_route_pool().await?;
    ensure_inbound_routes_table(&pool).await.ok()?;
    let row = sqlx::query(
        "SELECT db_url, api_key, webhook_secret FROM inbound_mail_routes WHERE domain = $1",
    )
    .bind(domain)
    .fetch_optional(&pool)
    .await
    .ok()??;
    let db_url = row.try_get::<String, _>(0).ok()?;
    let api_key = row.try_get::<String, _>(1).ok()?;
    let webhook_secret = row.try_get::<String, _>(2).ok()?;
    Some((db_url, api_key, webhook_secret))
}

async fn fetch_resend_received_email(
    client: &reqwest::Client,
    api_key: &str,
    email_id: &str,
) -> Option<Value> {
    let response = client
        .get(format!(
            "https://api.resend.com/emails/receiving/{email_id}"
        ))
        .bearer_auth(api_key)
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

fn resend_payload_recipient_domains(payload: &Value) -> Vec<String> {
    let Some(data) = payload.get("data") else {
        return Vec::new();
    };
    resend_recipient_addresses(data)
        .iter()
        .filter_map(|address| email_address_domain(address))
        .collect()
}

async fn resend_webhook_email(
    client: &reqwest::Client,
    payload: &Value,
    api_key: &str,
) -> Result<(BusinessEmail, Vec<String>), String> {
    let event_type = value_string(payload.get("type")).unwrap_or_default();
    if event_type != "email.received" {
        return Err("Unsupported Resend webhook event.".to_string());
    }

    let data = payload
        .get("data")
        .ok_or_else(|| "Resend webhook payload is missing data.".to_string())?;
    let email_id = value_string(data.get("email_id").or_else(|| data.get("id")))
        .ok_or_else(|| "Resend inbound payload is missing email id.".to_string())?;
    let details = fetch_resend_received_email(client, api_key, &email_id).await;
    let source = details.as_ref().unwrap_or(data);

    let to = {
        let values = resend_recipient_addresses(source);
        if values.is_empty() {
            resend_recipient_addresses(data)
        } else {
            values
        }
    };
    if to.is_empty() {
        return Err("Resend inbound payload is missing recipients.".to_string());
    }

    let from = value_string(source.get("from"))
        .or_else(|| value_string(data.get("from")))
        .unwrap_or_else(|| "unknown@resend.inbound".to_string());
    let subject = value_string(source.get("subject"))
        .or_else(|| value_string(data.get("subject")))
        .unwrap_or_else(|| "(no subject)".to_string());
    let date = value_string(source.get("created_at"))
        .or_else(|| value_string(data.get("created_at")))
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let body = value_string(source.get("text"))
        .or_else(|| value_string(source.get("html")).map(|html| html_to_readable_text(&html)))
        .unwrap_or_else(|| {
            format!(
                "Received by Resend. Email ID: {}. Message ID: {}. Reconnect the domain with a Resend API key that can read received emails to hydrate the full body.",
                email_id,
                value_string(source.get("message_id")).unwrap_or_else(|| "not provided".to_string())
            )
        });
    let has_attachment = source
        .get("attachments")
        .and_then(Value::as_array)
        .map(|attachments| !attachments.is_empty())
        .unwrap_or_else(|| {
            data.get("attachments")
                .and_then(Value::as_array)
                .map(|attachments| !attachments.is_empty())
                .unwrap_or(false)
        });

    let email = BusinessEmail {
        id: format!("resend_in_{}", email_id),
        from: from.clone(),
        from_name: sender_display_name(&from),
        to,
        subject,
        body,
        folder: "inbox".to_string(),
        date,
        read: false,
        starred: false,
        has_attachment,
    };
    let domains = email
        .to
        .iter()
        .filter_map(|address| email_address_domain(address))
        .collect::<Vec<_>>();
    Ok((email, domains))
}

pub async fn receive_resend_inbound(
    State(state): State<AppState>,
    Query(_query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    let payload = match serde_json::from_slice::<Value>(&body) {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(
                    json!({"success": false, "error": format!("Invalid Resend webhook JSON: {err}")}),
                ),
            )
        }
    };

    let event_type = value_string(payload.get("type")).unwrap_or_default();
    if event_type != "email.received" {
        return (
            StatusCode::OK,
            Json(json!({"success": true, "ignored": true})),
        );
    }

    let recipient_domains = resend_payload_recipient_domains(&payload);
    if recipient_domains.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(
                json!({"success": false, "error": "Resend inbound payload is missing recipient domains."}),
            ),
        );
    }

    let mut route = None;
    for domain in &recipient_domains {
        if let Some(found) = lookup_inbound_route(&state, domain).await {
            route = Some(found);
            break;
        }
    }
    let Some((db_url, api_key, webhook_secret)) = route else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "error": "No VelisMail BYO inbound route is registered for this recipient domain.",
                "domains": recipient_domains
            })),
        );
    };

    let signature_verified = match verify_resend_webhook_signature(&headers, &body, &webhook_secret)
    {
        Ok(verified) => verified,
        Err(message) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"success": false, "error": message})),
            )
        }
    };

    let (email, _) = match resend_webhook_email(&state.http_client, &payload, &api_key).await {
        Ok(result) => result,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": message})),
            )
        }
    };

    let save_payload = SaveBusinessEmailRequest {
        db_url: Some(db_url),
        email,
    };
    let (status, Json(mut response)) = save_business_email(
        State(state),
        Query(BusinessEmailsQuery { db_url: None }),
        HeaderMap::new(),
        Json(save_payload),
    )
    .await;
    if let Some(object) = response.as_object_mut() {
        object.insert("provider".to_string(), json!("resend"));
        object.insert("signatureVerified".to_string(), json!(signature_verified));
    }
    (status, Json(response))
}

async fn read_business_emails(db_url: &str) -> (StatusCode, Json<Value>) {
    let pool = match get_tenant_pool(db_url).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_emails_table(&pool).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let rows = match sqlx::query(
        "SELECT id, sender, sender_name, recipients, subject, body, folder, created_at, is_read, is_starred, has_attachment FROM business_emails ORDER BY created_at DESC"
    )
    .fetch_all(&pool)
    .await {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": format!("Query Error: {}", e)}))),
    };

    let mut emails = Vec::new();
    for row in rows {
        let id: String = row.try_get(0).unwrap_or_default();
        let sender: String = row.try_get(1).unwrap_or_default();
        let sender_name: String = row.try_get(2).unwrap_or_default();
        let recipients_str: String = row.try_get(3).unwrap_or_else(|_| "[]".to_string());
        let to: Vec<String> = serde_json::from_str(&recipients_str).unwrap_or_default();
        let subject: String = row.try_get(4).unwrap_or_default();
        let body: String = row.try_get(5).unwrap_or_default();
        let folder: String = row.try_get(6).unwrap_or_default();
        let created_at: String = row.try_get(7).unwrap_or_default();
        let is_read: bool = row.try_get(8).unwrap_or_default();
        let is_starred: bool = row.try_get(9).unwrap_or_default();
        let has_attachment: bool = row.try_get(10).unwrap_or_default();

        emails.push(json!({
            "id": id,
            "from": sender,
            "fromName": sender_name,
            "to": to,
            "subject": subject,
            "body": body,
            "folder": folder,
            "date": created_at,
            "read": is_read,
            "starred": is_starred,
            "hasAttachment": has_attachment
        }));
    }

    (
        StatusCode::OK,
        Json(json!({"success": true, "emails": emails})),
    )
}

pub async fn get_business_emails(
    State(_state): State<AppState>,
    Query(query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    let db_url = match business_db_url_from_parts(&headers, query.db_url.as_deref(), None) {
        Some(url) => url,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": "Missing business database URL"})),
            )
        }
    };

    read_business_emails(&db_url).await
}

pub async fn query_business_emails(
    State(_state): State<AppState>,
    Json(payload): Json<BusinessEmailsRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = payload.db_url.trim();
    if db_url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "error": "Missing business database URL"})),
        );
    }

    read_business_emails(db_url).await
}

pub async fn save_business_email(
    State(_state): State<AppState>,
    Query(query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
    Json(payload): Json<SaveBusinessEmailRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match business_db_url_from_parts(
        &headers,
        query.db_url.as_deref(),
        payload.db_url.as_deref(),
    ) {
        Some(url) => url,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": "Missing business database URL"})),
            )
        }
    };

    let pool = match get_tenant_pool(&db_url).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_emails_table(&pool).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let e = payload.email;
    let recipients_str = serde_json::to_string(&e.to).unwrap_or_else(|_| "[]".to_string());

    match sqlx::query(
        "INSERT INTO business_emails (id, sender, sender_name, recipients, subject, body, folder, created_at, is_read, is_starred, has_attachment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
            sender = $2,
            sender_name = $3,
            recipients = $4,
            subject = $5,
            body = $6,
            folder = $7,
            created_at = $8,
            is_read = $9,
            is_starred = $10,
            has_attachment = $11"
    )
    .bind(&e.id)
    .bind(&e.from)
    .bind(&e.from_name)
    .bind(&recipients_str)
    .bind(&e.subject)
    .bind(&e.body)
    .bind(&e.folder)
    .bind(&e.date)
    .bind(e.read)
    .bind(e.starred)
    .bind(e.has_attachment)
    .execute(&pool)
    .await {
        Ok(_) => (StatusCode::OK, Json(json!({"success": true}))),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": format!("Insert Error: {}", err)}))),
    }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOrderRequest {
    pub amount: Option<u64>,
    pub currency: String,
    pub plan: Option<String>,
    pub billing: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyPaymentRequest {
    pub razorpay_payment_id: String,
    pub razorpay_order_id: String,
    pub razorpay_signature: String,
}

fn expected_subscription_amount_paise(plan: &str, billing: &str) -> Option<u64> {
    let rupees = match (plan, billing) {
        ("starter", "monthly") => 299,
        ("starter", "annual") => 3014,
        ("business", "monthly") => 999,
        ("business", "annual") => 10070,
        ("enterprise", "monthly") => 2499,
        ("enterprise", "annual") => 25190,
        _ => return None,
    };
    Some(rupees * 100)
}

pub async fn create_payment_order(
    State(state): State<AppState>,
    Json(payload): Json<CreateOrderRequest>,
) -> (StatusCode, Json<Value>) {
    if state.config.razorpay_key_id.is_empty() || state.config.razorpay_key_secret.is_empty() {
        tracing::error!("Razorpay credentials not configured");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Payment gateway is not configured on this server."
            })),
        );
    }

    let plan = payload
        .plan
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let billing = payload
        .billing
        .as_deref()
        .unwrap_or("monthly")
        .trim()
        .to_ascii_lowercase();
    let Some(expected_amount) = expected_subscription_amount_paise(&plan, &billing) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Unsupported subscription plan or billing cycle."
            })),
        );
    };
    if let Some(requested_amount) = payload.amount {
        if requested_amount != expected_amount {
            tracing::warn!(
                requested_amount,
                expected_amount,
                plan = %plan,
                billing = %billing,
                "Ignoring stale client payment amount and using server-side plan price"
            );
        }
    }
    if !payload.currency.eq_ignore_ascii_case("INR") {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Unsupported payment currency."
            })),
        );
    }

    let client = reqwest::Client::new();
    let amount = expected_amount;
    let currency = payload.currency.to_ascii_uppercase();
    let receipt_email = payload.email.unwrap_or_else(|| "workspace".to_string());
    let receipt_suffix: String = uuid::Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(18)
        .collect();
    let plan_prefix: String = plan.chars().take(3).collect();
    let billing_prefix = billing.chars().next().unwrap_or('m');
    let receipt = format!("vm_{plan_prefix}_{billing_prefix}_{receipt_suffix}");

    let res = client
        .post("https://api.razorpay.com/v1/orders")
        .basic_auth(
            &state.config.razorpay_key_id,
            Some(&state.config.razorpay_key_secret),
        )
        .json(&json!({
            "amount": amount,
            "currency": currency,
            "receipt": receipt,
            "notes": {
                "plan": plan,
                "billing": billing,
                "email": receipt_email,
            }
        }))
        .send()
        .await;

    match res {
        Ok(response) => {
            if response.status().is_success() {
                if let Ok(order) = response.json::<Value>().await {
                    let order_id = order["id"].as_str().unwrap_or_default().to_string();
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "order_id": order_id,
                            "id": order_id, // include id for compatibility
                            "razorpay_key_id": state.config.razorpay_key_id,
                            "amount": amount,
                            "currency": currency
                        })),
                    )
                } else {
                    tracing::error!("Failed to parse Razorpay response body");
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({
                            "success": false,
                            "message": "Failed to parse payment gateway response."
                        })),
                    )
                }
            } else {
                let status = response.status();
                let error_text = response.text().await.unwrap_or_default();
                let gateway_message = serde_json::from_str::<Value>(&error_text)
                    .ok()
                    .and_then(|body| {
                        body.pointer("/error/description")
                            .and_then(Value::as_str)
                            .or_else(|| body.pointer("/error/reason").and_then(Value::as_str))
                            .map(str::to_string)
                    })
                    .unwrap_or_else(|| "Payment gateway rejected the order request.".to_string());
                tracing::error!(
                    "Razorpay order creation failed: {} - {}",
                    status,
                    error_text
                );
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "success": false,
                        "message": gateway_message,
                        "gatewayStatus": status.as_u16()
                    })),
                )
            }
        }
        Err(e) => {
            tracing::error!("Failed to request Razorpay API: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": "Failed to communicate with payment gateway."
                })),
            )
        }
    }
}

fn bytes_to_lower_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub async fn verify_payment(
    State(state): State<AppState>,
    Json(payload): Json<VerifyPaymentRequest>,
) -> (StatusCode, Json<Value>) {
    if state.config.razorpay_key_secret.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Payment gateway verification is not configured."
            })),
        );
    }

    let payment_id = payload.razorpay_payment_id.trim();
    let order_id = payload.razorpay_order_id.trim();
    let signature = payload.razorpay_signature.trim();
    if payment_id.is_empty() || order_id.is_empty() || signature.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Missing payment verification fields."
            })),
        );
    }

    let signed = format!("{order_id}|{payment_id}");
    let mut mac = match Hmac::<Sha256>::new_from_slice(state.config.razorpay_key_secret.as_bytes())
    {
        Ok(mac) => mac,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": "Payment gateway verification failed to initialize."
                })),
            )
        }
    };
    mac.update(signed.as_bytes());
    let expected = bytes_to_lower_hex(&mac.finalize().into_bytes());
    let verified = constant_time_eq(
        expected.as_bytes(),
        signature.to_ascii_lowercase().as_bytes(),
    );

    if verified {
        (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "paymentId": payment_id,
                "orderId": order_id
            })),
        )
    } else {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "success": false,
                "message": "Payment signature verification failed."
            })),
        )
    }
}
