//! API Gateway routes — real reverse-proxy implementation.
//!
//! Previous version returned hard-coded fake JSON (fake JWTs, fake user IDs,
//! fake message IDs) for every endpoint. That silently lied to the frontend
//! and was a security hazard. This version forwards requests to the
//! downstream services using reqwest and passes their responses through.

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
use serde_json::json;

pub fn api_v1_routes(_state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/verify/providers", get(get_supported_providers))
        .route("/verify", post(verify_infrastructure))
        // Downstream proxies — any HTTP method under these prefixes
        .route("/auth/*rest", any(proxy_auth))
        .route("/mail/*rest", any(proxy_mail))
        .route("/tenants/*rest", any(proxy_tenant))
        .route("/storage/*rest", any(proxy_storage))
        .route("/delivery/*rest", any(proxy_delivery))
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

// ---------- Generic proxy helper ----------

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
        Ok(b) => b,
        Err(_) => return (StatusCode::PAYLOAD_TOO_LARGE, "body too large").into_response(),
    };

    let mut req = state.http_client.request(method, &target).body(body_bytes);
    for (name, value) in headers.iter() {
        // skip hop-by-hop + host
        let n = name.as_str().to_ascii_lowercase();
        if matches!(
            n.as_str(),
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
            for (n, v) in resp.headers() {
                let ln = n.as_str().to_ascii_lowercase();
                if matches!(ln.as_str(), "transfer-encoding" | "connection") {
                    continue;
                }
                if let Ok(val) = HeaderValue::from_bytes(v.as_bytes()) {
                    builder = builder.header(n.as_str(), val);
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

async fn proxy_auth(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.auth_service_url,
        "/api/v1/auth",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_mail(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.mail_service_url,
        "/api/v1/mail",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_tenant(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.tenant_service_url,
        "/api/v1/tenants",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_storage(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.storage_service_url,
        "/api/v1/storage",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

async fn proxy_delivery(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Response {
    let (parts, body) = req.into_parts();
    proxy_generic(
        &state,
        &state.config.security_service_url, // delivery/security use the same slot
        "/api/v1/delivery",
        parts.method,
        parts.uri,
        parts.headers,
        body,
    )
    .await
}

// ---------- Provider catalog + infra verification (gateway-local) ----------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyInfrastructurePayload {
    pub db_provider: Option<String>,
    db_url: String,
    api_provider: String,
    api_endpoint: Option<String>,
    api_key: String,
}

#[derive(Debug, Serialize)]
struct ProviderCatalogEntry {
    id: &'static str,
    label: &'static str,
    placeholder: &'static str,
    description: &'static str,
    requires_endpoint: bool,
}

const DATABASE_SCHEMES: &[&str] = &[
    "postgresql://", "postgres://", "mysql://", "mysql2://", "mariadb://", "sqlite://",
    "mongodb://", "mongodb+srv://", "redis://", "rediss://", "libsql://", "sqlserver://",
    "mssql://", "clickhouse://", "custom://",
];

const MAIL_PROVIDER_IDS: &[&str] = &[
    "sendgrid", "resend", "mailgun", "postmark", "ses", "brevo", "mailersend", "sparkpost",
    "mailjet", "zeptomail", "smtp2go", "elastic_email", "courier", "custom_webhook",
];

fn is_valid_database_url(v: &str) -> bool {
    let n = v.trim().to_lowercase();
    DATABASE_SCHEMES.iter().any(|s| n.starts_with(s))
}

fn is_supported_mail_provider(p: &str) -> bool {
    MAIL_PROVIDER_IDS.contains(&p)
}

fn requires_custom_endpoint(p: &str) -> bool {
    p == "custom_webhook"
}

pub async fn get_supported_providers() -> Json<serde_json::Value> {
    let dbs: Vec<ProviderCatalogEntry> = vec![
        ProviderCatalogEntry { id: "postgresql", label: "PostgreSQL",
            placeholder: "postgresql://user:pass@host:5432/db",
            description: "Self-hosted or managed Postgres.", requires_endpoint: false },
        ProviderCatalogEntry { id: "mysql", label: "MySQL",
            placeholder: "mysql://user:pass@host:3306/db",
            description: "MySQL / MariaDB.", requires_endpoint: false },
        ProviderCatalogEntry { id: "mongodb", label: "MongoDB",
            placeholder: "mongodb://user:pass@host:27017/db",
            description: "Replica-set or standalone.", requires_endpoint: false },
        ProviderCatalogEntry { id: "redis", label: "Redis",
            placeholder: "redis://default:pass@host:6379",
            description: "Redis cache.", requires_endpoint: false },
        ProviderCatalogEntry { id: "others", label: "Custom",
            placeholder: "custom://user:pass@host:port/db",
            description: "Any RFC-style URI.", requires_endpoint: false },
    ];
    let mail: Vec<ProviderCatalogEntry> = MAIL_PROVIDER_IDS.iter().map(|id| ProviderCatalogEntry {
        id,
        label: id,
        placeholder: "api-key",
        description: "Mail relay provider.",
        requires_endpoint: *id == "custom_webhook",
    }).collect();

    Json(json!({
        "success": true,
        "databaseProviders": dbs,
        "mailProviders": mail,
    }))
}

pub async fn verify_infrastructure(
    State(_state): State<AppState>,
    Json(payload): Json<VerifyInfrastructurePayload>,
) -> (StatusCode, Json<serde_json::Value>) {
    let _ = payload.db_provider;
    let db_url = payload.db_url.trim();
    let api_provider = payload.api_provider.trim();
    let api_key = payload.api_key.trim();
    let api_endpoint = payload.api_endpoint.as_deref().map(str::trim);

    if db_url.is_empty() || api_provider.is_empty() || api_key.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false, "errorType": "ValidationError",
            "message": "Missing required fields."
        })));
    }
    if !is_valid_database_url(db_url) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false, "errorType": "DatabaseConnectionError",
            "message": "Invalid database URL scheme.",
        })));
    }
    if !is_supported_mail_provider(api_provider) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false, "errorType": "MailProviderConnectionError",
            "message": format!("Unsupported mail provider '{}'.", api_provider),
        })));
    }
    if requires_custom_endpoint(api_provider) {
        let ok = api_endpoint
            .map(|e| e.starts_with("http://") || e.starts_with("https://"))
            .unwrap_or(false);
        if !ok {
            return (StatusCode::BAD_REQUEST, Json(json!({
                "success": false, "errorType": "MailProviderConnectionError",
                "message": "Custom webhook requires http(s) endpoint.",
            })));
        }
    }
    if api_key.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "success": false, "errorType": "MailProviderConnectionError",
            "message": "API key too short.",
        })));
    }

    (StatusCode::OK, Json(json!({
        "success": true,
        "message": "Configuration accepted. Live connection checks happen at service runtime.",
        "provider": api_provider,
        "db_protocol": db_url.split("://").next().unwrap_or(""),
    })))
}

#[cfg(test)]
mod tests {
    use super::{is_supported_mail_provider, is_valid_database_url};
    #[test]
    fn db_ok() {
        assert!(is_valid_database_url("postgresql://a:b@c/d"));
        assert!(!is_valid_database_url("ftp://x"));
    }
    #[test]
    fn mail_ok() {
        assert!(is_supported_mail_provider("resend"));
        assert!(!is_supported_mail_provider("bogus"));
    }
}
