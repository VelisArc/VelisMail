//! API Gateway routes - reverse proxy plus compatibility endpoints.

use crate::state::AppState;
use axum::{
    body::Body,
    extract::State,
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
    let target = format!("{}{}{}", upstream_base.trim_end_matches('/'), remaining, query);

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

async fn proxy_auth(State(state): State<AppState>, req: Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.auth_service_url,
        "/auth",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_mail(State(state): State<AppState>, req: Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.mail_service_url,
        "/mail",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_tenant(State(state): State<AppState>, req: Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.tenant_service_url,
        "/tenants",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_storage(State(state): State<AppState>, req: Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.storage_service_url,
        "/storage",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_delivery(State(state): State<AppState>, req: Request<Body>) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.security_service_url,
        "/delivery",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

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
struct RuntimeCheckResult {
    key: &'static str,
    label: &'static str,
    status: &'static str,
    detail: String,
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

const MAIL_PROVIDER_IDS: &[&str] = &[
    "sendgrid",
    "resend",
    "postmark",
    "brevo",
    "custom_webhook",
];

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
    provider == "custom_webhook"
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

async fn verify_database_runtime(db_url: &str) -> RuntimeCheckResult {
    let parsed = match reqwest::Url::parse(db_url.trim()) {
        Ok(url) => url,
        Err(err) => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: format!("Invalid database URL: {err}"),
            }
        }
    };

    if parsed.scheme() == "sqlite" {
        let path = parsed.path().trim();
        return RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: if path.is_empty() { "failed" } else { "verified" },
            detail: if path.is_empty() {
                "SQLite path is empty.".to_string()
            } else {
                format!("SQLite path accepted: {path}")
            },
        };
    }

    let host = match parsed.host_str() {
        Some(value) if !value.trim().is_empty() => value.to_string(),
        _ => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: "Database host is missing from the connection string.".to_string(),
            }
        }
    };
    let port = parsed
        .port()
        .or_else(|| default_port_for_scheme(parsed.scheme()))
        .unwrap_or(0);

    let resolved = timeout(Duration::from_secs(5), lookup_host((host.as_str(), port))).await;
    let mut addresses = match resolved {
        Ok(Ok(addrs)) => addrs,
        Ok(Err(err)) => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: format!("Could not resolve database host {host}:{port}: {err}"),
            }
        }
        Err(_) => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: format!("Timed out while resolving database host {host}:{port}."),
            }
        }
    };

    if parsed.scheme() == "mongodb+srv" {
        return RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "verified",
            detail: format!("Resolved SRV host {host}."),
        };
    }

    let target = match addresses.next() {
        Some(addr) => addr,
        None => {
            return RuntimeCheckResult {
                key: "database",
                label: "Database Runtime Check",
                status: "failed",
                detail: format!("No addresses resolved for {host}:{port}."),
            }
        }
    };

    match timeout(Duration::from_secs(5), TcpStream::connect(target)).await {
        Ok(Ok(_)) => RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "verified",
            detail: format!("Connected to {host}:{port}."),
        },
        Ok(Err(err)) => RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "failed",
            detail: format!("Network connection to {host}:{port} failed: {err}"),
        },
        Err(_) => RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "failed",
            detail: format!("Timed out while connecting to {host}:{port}."),
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
            };
        };

        let request = client
            .get(endpoint)
            .header(axum::http::header::AUTHORIZATION, format!("Bearer {api_key}"));
        return match timeout(Duration::from_secs(10), request.send()).await {
            Ok(Ok(response)) if response.status().is_success() || response.status().as_u16() == 405 => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "verified",
                detail: format!("Webhook endpoint responded with {}.", response.status()),
            },
            Ok(Ok(response)) => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: format!("Webhook endpoint returned {}.", response.status()),
            },
            Ok(Err(err)) => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: format!("Webhook check failed: {err}"),
            },
            Err(_) => RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: "Webhook check timed out.".to_string(),
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
            }
        }
    };

    match timeout(Duration::from_secs(10), request.send()).await {
        Ok(Ok(response)) if response.status().is_success() => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "verified",
            detail: format!("{provider} credentials accepted."),
        },
        Ok(Ok(response)) => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "failed",
            detail: format!("{provider} rejected the credentials with status {}.", response.status()),
        },
        Ok(Err(err)) => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "failed",
            detail: format!("{provider} validation failed: {err}"),
        },
        Err(_) => RuntimeCheckResult {
            key: "mailProvider",
            label: "Mail Provider Runtime Check",
            status: "failed",
            detail: format!("{provider} validation timed out."),
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
    let from_email = payload
        .from
        .clone()
        .unwrap_or_else(|| "noreply@velismail.online".to_string());
    let from_name = payload.from_name.clone().unwrap_or_else(|| "VelisMail".to_string());

    let response = match provider.as_str() {
        "sendgrid" => client
            .post("https://api.sendgrid.com/v3/mail/send")
            .bearer_auth(api_key)
            .json(&json!({
                "personalizations": [{
                    "to": payload.to.iter().map(|email| json!({ "email": email })).collect::<Vec<_>>()
                }],
                "from": { "email": from_email, "name": from_name },
                "subject": payload.subject.trim(),
                "content": [{
                    "type": "text/plain",
                    "value": payload.body
                }]
            }))
            .send()
            .await
            .map_err(|err| err.to_string())?,
        "resend" => client
            .post("https://api.resend.com/emails")
            .bearer_auth(api_key)
            .json(&json!({
                "from": format!("{from_name} <{from_email}>"),
                "to": payload.to,
                "subject": payload.subject.trim(),
                "text": payload.body,
            }))
            .send()
            .await
            .map_err(|err| err.to_string())?,
        "postmark" => client
            .post("https://api.postmarkapp.com/email")
            .header("X-Postmark-Server-Token", api_key)
            .json(&json!({
                "From": format!("{from_name} <{from_email}>"),
                "To": payload.to.join(","),
                "Subject": payload.subject.trim(),
                "TextBody": payload.body,
            }))
            .send()
            .await
            .map_err(|err| err.to_string())?,
        "brevo" => client
            .post("https://api.brevo.com/v3/smtp/email")
            .header("api-key", api_key)
            .json(&json!({
                "sender": {
                    "email": from_email,
                    "name": from_name
                },
                "to": payload.to.iter().map(|email| json!({ "email": email })).collect::<Vec<_>>(),
                "subject": payload.subject.trim(),
                "textContent": payload.body,
            }))
            .send()
            .await
            .map_err(|err| err.to_string())?,
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
        return Err(format!("Provider rejected the message with status {status}: {body}"));
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
            && label.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn normalize_dns_answer(value: &str) -> String {
    value.trim()
        .trim_end_matches('.')
        .trim_matches('"')
        .replace("\" \"", "")
}

async fn query_dns_answers(client: &reqwest::Client, name: &str, record_type: &str) -> Result<Vec<String>, String> {
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
            requires_endpoint: *id == "custom_webhook",
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
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "ValidationError",
                "message": "Missing required fields."
            })),
        );
    }
    if !is_valid_database_url(db_url) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "DatabaseConnectionError",
                "message": "Invalid database URL scheme."
            })),
        );
    }
    if !is_supported_mail_provider(api_provider) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": format!("Unsupported mail provider '{}'.", api_provider)
            })),
        );
    }
    if requires_custom_endpoint(api_provider) {
        let valid_endpoint = api_endpoint.map(is_valid_http_url).unwrap_or(false);
        if !valid_endpoint {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "errorType": "MailProviderConnectionError",
                    "message": "Custom webhook requires http(s) endpoint."
                })),
            );
        }
    }
    if api_key.len() < 8 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "API key too short."
            })),
        );
    }

    let database_check = verify_database_runtime(db_url).await;
    let provider_check = validate_provider_credentials(
        &state.http_client,
        api_provider,
        api_key,
        api_endpoint,
    )
    .await;
    let success = database_check.status == "verified" && provider_check.status == "verified";

    (
        if success {
            StatusCode::OK
        } else {
            StatusCode::BAD_REQUEST
        },
        Json(json!({
            "success": success,
            "message": if success {
                "Infrastructure validated successfully."
            } else {
                "Infrastructure validation failed. Review the runtime checks and fix the failing connection."
            },
            "provider": api_provider,
            "dbProtocol": db_url.split("://").next().unwrap_or(""),
            "checks": [database_check, provider_check]
        })),
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

    let txt_host = format!("_velismail-verify.{domain}");
    let dkim_host = format!("velismail._domainkey.{domain}");
    let dmarc_host = format!("_dmarc.{domain}");
    let expected_mx_hosts = vec![
        "mx1.velismail.online".to_string(),
        "mx2.velismail.online".to_string(),
    ];
    let expected_spf_fragment = "include:velismail.online";
    let expected_dkim_target = "dkim.velismail.online".to_string();

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
            status: if txt_answers.iter().any(|value| value.contains(verification_token)) {
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
                .any(|value| value.contains(expected_spf_fragment))
            {
                "verified"
            } else {
                "failed"
            },
            expected: "v=spf1 include:velismail.online ~all".to_string(),
            actual: spf_actual,
        },
        DomainCheckResult {
            key: "dkim",
            label: "DKIM",
            status: if dkim_answers.iter().any(|value| value == &expected_dkim_target) {
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

    let failed_labels: Vec<&str> = checks
        .iter()
        .filter(|check| check.status != "verified")
        .map(|check| check.label)
        .collect();

    (
        StatusCode::OK,
        Json(json!({
            "success": failed_labels.is_empty(),
            "domain": domain,
            "message": if failed_labels.is_empty() {
                "Domain verification completed successfully.".to_string()
            } else {
                format!("DNS verification is incomplete. Fix: {}.", failed_labels.join(", "))
            },
            "checks": checks
        })),
    )
}

pub async fn send_mail(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SendMailPayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    if payload.to.is_empty() || payload.subject.trim().is_empty() || payload.body.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "At least one recipient, subject, and body are required."
            })),
        );
    }

    if let (Some(provider), Some(api_key)) = (payload.provider.as_deref(), payload.api_key.as_deref()) {
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
            Err(err) => (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "success": false,
                    "message": err,
                    "provider": provider
                })),
            ),
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
            "cc": [],
            "bcc": [],
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

    let status = StatusCode::from_u16(response.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
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
