//! API Gateway routes - reverse proxy plus compatibility endpoints.

use crate::admin;
use crate::company_api;
use crate::company_businesses;
use crate::state::AppState;
use axum::{
    body::{Body, Bytes},
    extract::{
        ws::{WebSocket, WebSocketUpgrade},
        ConnectInfo, Extension, Query, State,
    },
    http::{HeaderMap, HeaderValue, Method, Request, StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::{any, delete, get, patch, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use hmac::{Hmac, Mac};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Validation};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{
    postgres::{PgPoolOptions, PgRow},
    PgPool, Row,
};
use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Instant;
use tokio::{
    net::{lookup_host, TcpStream},
    time::{sleep, timeout, Duration},
};
use uuid::Uuid;
use velismail_common::traffic::client_ip;
use velismail_common::Claims;

const RESEND_WEBHOOK_TOLERANCE_SECONDS: u64 = 300;
/// Maximum request body accepted by the reverse proxy (attachments are sent
/// directly to the storage service, so this only needs headroom for metadata).
const MAX_PROXY_BODY_BYTES: usize = 32 * 1024 * 1024;

pub fn api_v1_routes(_state: &AppState) -> Router<AppState> {
    Router::new()
        .route("/verify/providers", get(get_supported_providers))
        .route("/verify", post(verify_infrastructure))
        .route("/mail/send", post(send_mail))
        .route("/mail/inbound", post(receive_resend_inbound))
        .route(
            "/mail/business-emails",
            get(get_business_emails)
                .post(save_business_email)
                .delete(delete_business_email),
        )
        .route("/mail/business-emails/query", post(query_business_emails))
        .route(
            "/mail/business-mailboxes",
            get(get_business_mailboxes)
                .post(save_business_mailbox)
                .delete(delete_business_mailbox),
        )
        .route(
            "/mail/business-mailboxes/query",
            post(query_business_mailboxes),
        )
        .route("/team/invites", post(create_team_invite))
        .route("/team/invites/validate", post(validate_team_invite))
        .route("/team/invites/complete", post(complete_team_invite))
        .route("/team/invites/revoke", post(revoke_team_invite))
        .route(
            "/platform/users",
            get(list_platform_users)
                .patch(update_platform_user)
                .delete(delete_platform_user),
        )
        .route("/tenants/verify-domain", post(verify_domain))
        .route("/payments/create-order", post(create_payment_order))
        .route("/payments/verify", post(verify_payment))
        // Public client configuration. It only exposes non-secret values so
        // the browser can initialise Google sign-in without a rebuild.
        .route("/config/public", get(public_config))
        // Platform control plane (/admin). Authorization is enforced in the
        // handlers using the verified JWT and Firebase owner UID gate.
        .route("/admin/platform/me", get(admin::platform_me))
        .route("/admin/platform/overview", get(admin::platform_overview))
        .route("/admin/platform/analytics", get(admin::platform_analytics))
        .route("/admin/platform/companies", get(admin::list_companies))
        .route(
            "/admin/platform/companies/{id}",
            get(admin::get_company).patch(admin::update_company),
        )
        .route(
            "/admin/platform/companies/{id}/actions",
            post(admin::company_action),
        )
        .route("/admin/platform/users", get(admin::list_platform_users))
        .route(
            "/admin/platform/users/{id}/actions",
            post(admin::platform_user_action),
        )
        .route(
            "/admin/platform/investigations",
            get(admin::list_investigations).post(admin::create_investigation),
        )
        .route(
            "/admin/platform/investigations/{id}",
            get(admin::get_investigation).patch(admin::update_investigation),
        )
        .route(
            "/admin/platform/investigations/{id}/events",
            post(admin::add_investigation_event),
        )
        .route("/admin/platform/audit", get(admin::platform_audit))
        .route(
            "/admin/platform/team",
            get(admin::list_platform_team).post(admin::add_platform_admin),
        )
        .route(
            "/admin/platform/team/{email}",
            patch(admin::update_platform_admin),
        )
        .route("/admin/platform/billing", get(admin::platform_billing))
        .route(
            "/admin/platform/feature-flags",
            get(admin::list_feature_flags).patch(admin::update_feature_flag),
        )
        .route(
            "/admin/platform/announcements",
            get(admin::list_announcements).post(admin::create_announcement),
        )
        .route(
            "/admin/platform/announcements/{id}",
            patch(admin::update_announcement),
        )
        .route("/admin/platform/broadcast", post(admin::platform_broadcast))
        .route(
            "/admin/platform/broadcast/senders",
            get(admin::list_broadcast_senders),
        )
        .route(
            "/admin/platform/broadcasts",
            get(admin::list_platform_broadcasts),
        )
        .route("/admin/platform/support", get(admin::list_support_tickets))
        .route(
            "/admin/platform/support/{id}",
            patch(admin::update_support_ticket),
        )
        .route("/admin/platform/system", get(admin::platform_system))
        .route(
            "/admin/platform/settings",
            get(admin::list_platform_settings).patch(admin::update_platform_setting),
        )
        // Platform keys run the control plane. Only the owner creates them.
        .route(
            "/admin/platform/api-keys",
            get(admin::list_platform_api_keys).post(admin::create_platform_api_key),
        )
        .route(
            "/admin/platform/api-keys/{id}",
            delete(admin::revoke_platform_api_key),
        )
        .route(
            "/admin/platform/feedback",
            get(admin::list_platform_feedback),
        )
        .route(
            "/admin/platform/feedback/{id}",
            patch(admin::update_platform_feedback),
        )
        .route(
            "/admin/platform/feedback/{id}/escalate",
            post(admin::escalate_feedback_to_investigation),
        )
        // Company control plane inside the business dashboard.
        .route("/admin/company/overview", get(admin::company_overview))
        .route("/admin/company/members", get(admin::company_members))
        .route(
            "/admin/company/members/{id}",
            patch(admin::company_update_member),
        )
        .route("/admin/company/roles", get(admin::company_roles))
        .route("/admin/company/usage", get(admin::company_usage))
        .route("/admin/company/audit", get(admin::company_audit))
        .route("/admin/company/security", get(admin::company_security))
        .route(
            "/admin/company/api-keys",
            get(admin::list_company_api_keys).post(admin::create_company_api_key),
        )
        .route(
            "/admin/company/api-keys/{id}",
            delete(admin::revoke_company_api_key),
        )
        .route(
            "/admin/company/feedback",
            get(company_api::list_feedback).post(company_api::submit_feedback),
        )
        .route("/admin/company/billing", get(admin::company_billing))
        .route(
            "/admin/company/integrations",
            get(admin::company_integrations),
        )
        .route(
            "/admin/company/announcements",
            get(admin::company_announcements),
        )
        // Company workspace API. These endpoints belong to the customer: they
        // only ever expose the caller's own tenant (team, domains, mailboxes,
        // queue, audit trail, templates, contacts, signatures).
        .route("/company/team", get(company_api::list_team))
        .route(
            "/company/businesses",
            get(company_businesses::list_businesses).post(company_businesses::create_business),
        )
        .route(
            "/company/businesses/switch",
            post(company_businesses::switch_business),
        )
        .route(
            "/company/team/invitations",
            post(company_api::create_invitation),
        )
        .route(
            "/company/team/invitations/{id}",
            delete(company_api::revoke_invitation),
        )
        .route(
            "/company/team/remove",
            post(company_api::remove_team_member),
        )
        .route(
            "/company/domains",
            get(company_api::list_domains).post(company_api::create_domain),
        )
        .route(
            "/company/domains/dns-requirements",
            get(company_api::dns_requirements),
        )
        .route(
            "/company/domains/{id}/verify",
            post(company_api::verify_domain),
        )
        .route("/company/domains/{id}", delete(company_api::delete_domain))
        .route(
            "/company/mailboxes",
            get(company_api::list_mailboxes).post(company_api::create_mailbox),
        )
        .route(
            "/company/mailboxes/delete",
            delete(company_api::delete_mailbox),
        )
        .route("/company/queue", get(company_api::list_queue))
        .route(
            "/company/groups",
            get(company_api::list_groups).post(company_api::create_group),
        )
        .route("/company/groups/{id}", delete(company_api::delete_group))
        .route("/company/audit", get(company_api::list_audit))
        .route(
            "/company/templates",
            get(company_api::list_templates).post(company_api::create_template),
        )
        .route(
            "/company/templates/{id}",
            delete(company_api::delete_template),
        )
        .route(
            "/company/contacts",
            get(company_api::list_contacts).post(company_api::create_contact),
        )
        .route(
            "/company/contacts/{id}",
            delete(company_api::delete_contact),
        )
        .route(
            "/company/signatures",
            get(company_api::list_signatures).post(company_api::create_signature),
        )
        .route(
            "/company/signatures/{id}",
            delete(company_api::delete_signature),
        )
        .route("/ws", get(ws_handler))
        .route("/auth/{*rest}", any(proxy_auth))
        .route("/mail/{*rest}", any(proxy_mail))
        .route("/tenants/{*rest}", any(proxy_tenant))
        .route("/storage/{*rest}", any(proxy_storage))
    // The delivery engine is an internal worker (queue, DKIM signing and
    // bounce handling). It is intentionally not reachable through the
    // public gateway: exposing queue enqueue/dkim sign let any logged-in
    // user relay mail or obtain signatures from the platform key.
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

/// Public client configuration.
///
/// The Firebase web configuration is public by design (it ships in every
/// browser bundle), but keeping it on the server means the frontend never
/// needs a rebuild when the Firebase project changes. Only non-secret values
/// are returned.
pub async fn public_config(State(state): State<AppState>) -> Json<serde_json::Value> {
    let project_id = state.config.firebase_project_id.clone();
    let auth_domain = project_id
        .as_ref()
        .map(|value| format!("{}.firebaseapp.com", value));
    let storage_bucket = project_id
        .as_ref()
        .map(|value| format!("{}.firebasestorage.app", value));
    Json(json!({
        "success": true,
        "apiBase": "/api/v1",
        "firebase": {
            "apiKey": state.config.firebase_web_api_key,
            "authDomain": auth_domain,
            "projectId": project_id,
            "appId": state.config.firebase_app_id,
            "storageBucket": storage_bucket,
        },
        "features": {
            "googleSignIn": state.config.firebase_web_api_key.is_some(),
        }
    }))
}

pub async fn health_check(State(state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "api-gateway",
        "version": env!("CARGO_PKG_VERSION"),
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// Readiness probe. Verifies the database (when configured) and every
/// internal upstream before reporting the gateway as ready to serve traffic.
pub async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<serde_json::Value>) {
    let db_ok = match &state.db {
        Some(pool) => tokio::time::timeout(
            Duration::from_secs(3),
            sqlx::query("SELECT 1").execute(pool),
        )
        .await
        .map(|result| result.is_ok())
        .unwrap_or(false),
        None => true,
    };

    let upstreams = [
        ("auth", state.config.auth_service_url.as_str()),
        ("mail", state.config.mail_service_url.as_str()),
        ("storage", state.config.storage_service_url.as_str()),
        ("tenant", state.config.tenant_service_url.as_str()),
        ("delivery", state.config.delivery_service_url.as_str()),
    ];

    let mut checks = serde_json::Map::new();
    let mut all_ok = db_ok;
    checks.insert("database".to_string(), json!(db_ok));

    // Probe upstreams concurrently so readiness latency stays bounded even
    // when one dependency is slow.
    let mut probes = Vec::with_capacity(upstreams.len());
    for (name, base) in upstreams {
        let url = format!("{}/health", base.trim_end_matches('/'));
        let client = state.http_client.clone();
        probes.push(async move {
            let ok = matches!(
                tokio::time::timeout(Duration::from_secs(3), client.get(&url).send()).await,
                Ok(Ok(response)) if response.status().is_success()
            );
            (name, ok)
        });
    }
    for (name, ok) in futures::future::join_all(probes).await {
        checks.insert(name.to_string(), json!(ok));
        all_ok &= ok;
    }

    let status = if all_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(json!({
            "status": if all_ok { "ready" } else { "not_ready" },
            "service": "api-gateway",
            "version": env!("CARGO_PKG_VERSION"),
            "checks": checks,
            "timestamp": chrono::Utc::now().to_rfc3339()
        })),
    )
}

/// Prometheus metrics. Disabled unless `METRICS_TOKEN` is configured so the
/// endpoint is never exposed anonymously.
pub async fn metrics(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let Some(expected) = state.config.metrics_token.as_deref() else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let provided = velismail_common::bearer_token(&headers).unwrap_or_default();
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let body = state
        .metrics
        .render_prometheus("api-gateway", env!("CARGO_PKG_VERSION"));
    (
        StatusCode::OK,
        [(
            axum::http::header::CONTENT_TYPE,
            "text/plain; version=0.0.4",
        )],
        body,
    )
        .into_response()
}

/// JSON 404 for unknown API routes.
pub async fn not_found(method: Method, uri: Uri) -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "success": false,
            "error": {
                "code": "NOT_FOUND",
                "message": format!("No route matches {} {}", method, uri.path())
            }
        })),
    )
        .into_response()
}

pub async fn ws_handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_socket)
}

async fn handle_socket(mut socket: WebSocket) {
    tracing::info!("New WebSocket connection established");
    // Send a welcome message
    if let Err(e) = socket
        .send(axum::extract::ws::Message::Text("connected".into()))
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
                let _ = socket.send(axum::extract::ws::Message::Ping(Vec::new().into())).await;
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

#[allow(clippy::too_many_arguments)]
async fn proxy_generic(
    state: &AppState,
    upstream_base: &str,
    strip_prefix: &str,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    peer: Option<IpAddr>,
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

    let body_bytes = match axum::body::to_bytes(body, MAX_PROXY_BODY_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(json!({
                    "success": false,
                    "error": {
                        "code": "PAYLOAD_TOO_LARGE",
                        "message": "Request body exceeds the gateway limit."
                    }
                })),
            )
                .into_response()
        }
    };

    let real_ip = client_ip(&headers, peer);
    let request_id = headers
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();

    let forwarded_for = match headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(existing)
            if peer
                .map(velismail_common::traffic::is_trusted_proxy)
                .unwrap_or(false) =>
        {
            existing.to_string()
        }
        _ => real_ip.to_string(),
    };
    let forwarded_proto = headers
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("http")
        .to_string();
    let forwarded_host = headers
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();

    let idempotent = matches!(method, Method::GET | Method::HEAD | Method::OPTIONS);
    let mut attempt = 0u32;
    let response = loop {
        let mut req = state
            .http_client
            .request(method.clone(), &target)
            .body(body_bytes.clone())
            .header("x-forwarded-for", &forwarded_for)
            .header("x-forwarded-proto", &forwarded_proto)
            .header("x-real-ip", real_ip.to_string());

        if !forwarded_host.is_empty() {
            req = req.header("x-forwarded-host", &forwarded_host);
        }
        if !request_id.is_empty() {
            req = req.header("x-request-id", &request_id);
        }

        for (name, value) in headers.iter() {
            let lowered = name.as_str().to_ascii_lowercase();
            if matches!(
                lowered.as_str(),
                "host"
                    | "connection"
                    | "content-length"
                    | "transfer-encoding"
                    | "x-forwarded-for"
                    | "x-forwarded-proto"
                    | "x-real-ip"
                    | "x-request-id"
            ) {
                continue;
            }
            req = req.header(name.as_str(), value);
        }

        match req.send().await {
            Ok(resp) => break resp,
            Err(err) if idempotent && attempt < 2 => {
                attempt += 1;
                tracing::warn!(
                    target = %target,
                    attempt,
                    error = %err,
                    "Transient upstream failure, retrying idempotent request"
                );
                sleep(Duration::from_millis(50 * u64::from(attempt))).await;
            }
            Err(err) => {
                tracing::error!(target = %target, error = %err, "Proxy request failed");
                state
                    .metrics
                    .upstream_errors_total
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                return (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({
                        "success": false,
                        "error": {
                            "code": "UPSTREAM_UNAVAILABLE",
                            "message": "The requested service is temporarily unavailable."
                        },
                        "request_id": request_id
                    })),
                )
                    .into_response();
            }
        }
    };

    let status = response.status();
    if status.is_server_error() {
        state
            .metrics
            .upstream_errors_total
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }

    let mut builder = Response::builder().status(status);
    for (name, value) in response.headers() {
        let lowered = name.as_str().to_ascii_lowercase();
        if matches!(
            lowered.as_str(),
            "transfer-encoding" | "connection" | "keep-alive" | "proxy-authenticate" | "upgrade"
        ) {
            continue;
        }
        if let Ok(header_value) = HeaderValue::from_bytes(value.as_bytes()) {
            builder = builder.header(name.as_str(), header_value);
        }
    }

    let stream = response.bytes_stream();
    builder.body(Body::from_stream(stream)).unwrap_or_else(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "success": false,
                "error": {
                    "code": "UPSTREAM_RESPONSE_INVALID",
                    "message": "Upstream returned an invalid response."
                }
            })),
        )
            .into_response()
    })
}

macro_rules! proxy_handler {
    ($fn_name:ident, $url_field:ident, $prefix:expr) => {
        async fn $fn_name(State(state): State<AppState>, req: Request<Body>) -> Response {
            let peer = req
                .extensions()
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0.ip());
            let (parts, body) = req.into_parts();
            proxy_generic(
                &state,
                &state.config.$url_field,
                $prefix,
                parts.method,
                parts.uri,
                parts.headers,
                peer,
                body,
            )
            .await
        }
    };
}

proxy_handler!(proxy_auth, auth_service_url, "/auth");
proxy_handler!(proxy_mail, mail_service_url, "/mail");
proxy_handler!(proxy_tenant, tenant_service_url, "");
proxy_handler!(proxy_storage, storage_service_url, "/storage");

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
    /// The formatted body. Without it the receiver only gets the plain text
    /// version, so a mail that was written in the composer loses its layout.
    pub html_body: Option<String>,
    from: Option<String>,
    from_name: Option<String>,
    provider: Option<String>,
    api_key: Option<String>,
    /// Kept for wire compatibility. The database is resolved from the
    /// verified session; a client-supplied URL is ignored.
    #[allow(dead_code)]
    db_url: Option<String>,
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

const MAIL_PROVIDER_IDS: &[&str] = &[
    "sendgrid",
    "resend",
    "postmark",
    "amazonses",
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

fn requires_provider_endpoint(provider: &str) -> bool {
    provider == "custom_webhook" || provider == "amazonses"
}

fn is_valid_provider_endpoint(provider: &str, value: &str) -> bool {
    if provider == "amazonses" {
        is_valid_aws_region(value)
    } else {
        is_valid_http_url(value)
    }
}

fn is_valid_aws_region(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 32
        && value.split('-').count() >= 3
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

fn is_valid_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

/// Reject provider webhooks that resolve to loopback, RFC1918, link-local or
/// cloud-metadata addresses. Without this check an authenticated tenant could
/// use the gateway as an SSRF proxy.
async fn is_public_http_endpoint(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value.trim()) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    if host.eq_ignore_ascii_case("localhost") {
        return false;
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let Ok(addresses) = tokio::net::lookup_host((host, port)).await else {
        return false;
    };
    let mut resolved = false;
    for address in addresses {
        resolved = true;
        if velismail_common::traffic::is_blocked_ip(address.ip()) {
            return false;
        }
    }
    resolved
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

    // Prevent the verification endpoint from being used to probe the VM's
    // private network or the cloud metadata service (SSRF).
    if !velismail_common::traffic::allow_private_database_hosts()
        && resolved_addresses
            .iter()
            .any(|addr| velismail_common::traffic::is_blocked_ip(addr.ip()))
    {
        return RuntimeCheckResult {
            key: "database",
            label: "Database Runtime Check",
            status: "failed",
            detail: "Database host resolves to a private or reserved address.".to_string(),
            category: "config",
            recommendation: Some("Use a publicly reachable database endpoint. Private/loopback hosts are blocked for security.".to_string()),
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
        if !is_public_http_endpoint(endpoint).await {
            return RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: "Custom webhook endpoint resolves to a private or reserved address."
                    .to_string(),
                category: "config",
                recommendation: Some(
                    "Use a publicly reachable HTTPS endpoint for the custom webhook.".to_string(),
                ),
            };
        }
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

    if provider == "amazonses" {
        let credentials_valid = api_key
            .split_once(':')
            .map(|(access_key, secret_key)| {
                !access_key.trim().is_empty() && !secret_key.trim().is_empty()
            })
            .unwrap_or(false);
        let region_valid = endpoint.map(is_valid_aws_region).unwrap_or(false);

        return if credentials_valid && region_valid {
            RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "verified",
                detail: "Amazon SES credentials and region have a valid format.".to_string(),
                category: "success",
                recommendation: None,
            }
        } else {
            RuntimeCheckResult {
                key: "mailProvider",
                label: "Mail Provider Runtime Check",
                status: "failed",
                detail: "Amazon SES requires an access key, secret key, and a valid region such as us-east-1.".to_string(),
                category: "config",
                recommendation: Some(
                    "Use api_key=ACCESS_KEY:SECRET_KEY and set the endpoint to the SES region.".to_string(),
                ),
            }
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
            if !is_public_http_endpoint(endpoint).await {
                return Err(
                    "Custom webhook endpoint resolves to a private or reserved address."
                        .to_string(),
                );
            }
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

pub(crate) fn is_valid_email_address(value: &str) -> bool {
    let address = value.trim().to_lowercase();
    if address.len() > 254 || address.contains("..") {
        return false;
    }
    let parts: Vec<&str> = address.split('@').collect();
    if parts.len() != 2 {
        return false;
    }
    let local = parts[0];
    let domain = parts[1];
    if local.is_empty() || local.len() > 64 || !is_valid_domain(domain) {
        return false;
    }
    local
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ".!#$%&'*+/=?^_`{|}~-".contains(ch))
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
    if requires_provider_endpoint(api_provider) {
        let valid_endpoint = api_endpoint
            .map(|endpoint| is_valid_provider_endpoint(api_provider, endpoint))
            .unwrap_or(false);
        if !valid_endpoint {
            let (detail, recommendation) = if api_provider == "amazonses" {
                (
                    "Amazon SES requires a valid AWS region such as us-east-1.",
                    "Set the provider endpoint to the SES region that owns your verified identities.",
                )
            } else {
                (
                    "A custom webhook provider was selected, but the endpoint URL is missing or invalid.",
                    "Provide a full http:// or https:// endpoint for the custom mail relay.",
                )
            };
            return verify_infrastructure_response(
                StatusCode::BAD_REQUEST,
                false,
                if api_provider == "amazonses" {
                    "Amazon SES requires a valid AWS region."
                } else {
                    "Custom webhook requires http(s) endpoint."
                },
                api_provider,
                db_url,
                vec![runtime_check_failure(
                    "mailProvider",
                    "Mail Provider Runtime Check",
                    detail,
                    "config",
                    recommendation,
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
    if requires_provider_endpoint(provider)
        && !provider_endpoint(&payload)
            .map(|endpoint| is_valid_provider_endpoint(provider, endpoint))
            .unwrap_or(false)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": if provider == "amazonses" {
                    "Amazon SES requires a valid AWS region."
                } else {
                    "Custom provider endpoint must be a valid http or https URL."
                }
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

    // A verified domain always gets its sending mailbox so the first mail
    // does not fail with "sender mailbox is not registered".
    let initial_dns_passed = checks.iter().all(|check| check.status == "verified");
    let initial_runtime_passed = runtime_checks
        .iter()
        .all(|check| check.status == "verified");
    let mut registered_mailboxes: Vec<String> = Vec::new();
    if initial_dns_passed && initial_runtime_passed {
        for (address, kind) in [
            (format!("admin@{domain}"), "primary"),
            (format!("postmaster@{domain}"), "user"),
        ] {
            match ensure_business_mailbox(db_url, &domain, &address, "VelisMail", kind).await {
                Ok(()) => registered_mailboxes.push(address),
                Err(err) => tracing::warn!("could not register mailbox {address}: {err}"),
            }
        }
    }
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
            "registeredMailboxes": registered_mailboxes,
            "provider": provider,
        })),
    )
}

pub async fn send_mail(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
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
    if payload.to.len() > 100
        || payload.subject.len() > 998
        || payload.body.len() > 5 * 1024 * 1024
        || payload
            .html_body
            .as_deref()
            .is_some_and(|html| html.len() > 5 * 1024 * 1024)
        || payload
            .provider
            .as_deref()
            .is_some_and(|provider| provider.len() > 40)
        || payload
            .api_key
            .as_deref()
            .is_some_and(|key| key.len() > 4096)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "The message is too large or malformed."
            })),
        );
    }

    if let Some(invalid) = payload
        .to
        .iter()
        .find(|email| !is_valid_email_address(email))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": format!("Invalid recipient address: {invalid}")
            })),
        );
    }

    if let Some(from) = payload.from.as_deref() {
        if !is_valid_email_address(from) {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "message": "Invalid sender mailbox address."
                })),
            );
        }

        let sender_domain = email_address_domain(from).unwrap_or_default();
        let caller_tenant = Uuid::parse_str(claims.tenant_id.trim()).unwrap_or(Uuid::nil());
        let platform_domain = email_address_domain(&state.config.platform_from_email)
            .unwrap_or_else(|| "velismail.online".to_string());
        if sender_domain == platform_domain
            && !from.eq_ignore_ascii_case(&state.config.platform_from_email)
        {
            // Only the configured platform sender (or platform staff) may use
            // an address on the platform's own domain. Everything else would
            // let a customer impersonate support@ or no-reply@.
            let is_staff = state
                .config
                .platform_owner_emails
                .contains(&claims.email.to_lowercase())
                || claims.firebase_uid.as_ref().is_some_and(|uid| {
                    state
                        .config
                        .platform_owner_uids
                        .iter()
                        .any(|value| value == uid)
                })
                || match state.db.as_ref() {
                    Some(db) => sqlx::query_scalar::<_, bool>(
                        "SELECT EXISTS(SELECT 1 FROM platform_admins
                         WHERE LOWER(email) = LOWER($1) AND status = 'active')",
                    )
                    .bind(&claims.email)
                    .fetch_one(db)
                    .await
                    .unwrap_or(false),
                    None => false,
                };
            if !is_staff {
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "success": false,
                        "message": "This sender address is reserved for the platform."
                    })),
                );
            }
        }

        if let Some(db) = state.db.as_ref() {
            // The database URL is resolved from the caller's workspace. A
            // client-supplied URL is never trusted.
            if let Some(db_url) =
                crate::company_api::tenant_business_db_url(db, caller_tenant).await
            {
                match business_mailbox_exists(&db_url, &sender_domain, from).await {
                    Ok(true) => {}
                    Ok(false) => {
                        return (
                            StatusCode::FORBIDDEN,
                            Json(json!({
                                "success": false,
                                "message": "Sender mailbox is not registered in the business database."
                            })),
                        )
                    }
                    Err(err) => {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            Json(json!({
                                "success": false,
                                "message": format!("Unable to verify sender mailbox: {err}")
                            })),
                        )
                    }
                }
            }
        }

        // The domain has to belong to the caller and be fully set up before
        // mail leaves the platform. The customer is told which record is
        // still missing.
        if let Some(db) = state.db.as_ref() {
            if let Some((ready, missing, message)) =
                crate::company_api::domain_send_readiness(&state, db, caller_tenant, &sender_domain)
                    .await
            {
                if !ready {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(json!({
                            "success": false,
                            "errorType": "DomainSetupIncomplete",
                            "message": format!(
                                "The setup of {sender_domain} is not complete yet. Publish the missing DNS records and verify the domain again: {}",
                                missing.join(", ")
                            ),
                            "missing": missing,
                            "detail": message,
                            "action": "Complete the setup in Business - Domains before sending mail."
                        })),
                    );
                }
            }
        }
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
            "html_body": payload.html_body,
            "attachment_ids": Value::Null,
            "schedule_send_at": Value::Null,
            "from": payload.from,
            "from_name": payload.from_name
        }));

    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default();
    if bearer.starts_with(crate::api_keys::API_KEY_PREFIX) {
        // The mail service only accepts a signed session JWT. Exchange the
        // validated workspace key for a short-lived internal token so a key
        // can actually send mail server-to-server. The token keeps the key's
        // tenant and is never returned to the caller.
        let Some(secret) = state.config.jwt_secret.as_deref() else {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "success": false,
                    "message": "Mail sending is not configured on this server."
                })),
            );
        };
        let token = match encode(
            &jsonwebtoken::Header::default(),
            &claims,
            &EncodingKey::from_secret(secret.as_bytes()),
        ) {
            Ok(token) => token,
            Err(err) => {
                tracing::error!("API key mail session could not be signed: {}", err);
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "success": false,
                        "message": "Unable to create the mail session."
                    })),
                );
            }
        };
        let authorization = match HeaderValue::from_str(&format!("Bearer {token}")) {
            Ok(value) => value,
            Err(_) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "success": false,
                        "message": "Unable to create the mail session."
                    })),
                );
            }
        };
        request = request.header(axum::http::header::AUTHORIZATION, authorization);
    } else if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
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

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TeamInviteWorkspace {
    pub tenant_id: Option<String>,
    pub display_name: Option<String>,
    pub business_domain: Option<String>,
    pub business_domain_verified: Option<bool>,
    pub is_business_setup_complete: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamInviteRequest {
    pub email: String,
    pub name: String,
    pub role: String,
    pub expires_in_hours: Option<i64>,
    // Kept in the wire format for older clients. The issuer and the workspace
    // always come from the verified session, never from these fields.
    #[serde(default)]
    #[allow(dead_code)]
    pub issuer_email: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    pub workspace: Option<TeamInviteWorkspace>,
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
    pub password: String,
    #[serde(default)]
    pub device_id: Option<String>,
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

/// Read one invitation from the database.
///
/// The invitation lives in `team_invites`, so a key keeps working across a
/// restart and a deploy. A missing database means the key is unknown, which is
/// the safe answer.
async fn load_team_invite(state: &AppState, token: &str) -> Option<TeamInviteRecord> {
    let db = state.db.as_ref()?;
    let row = match sqlx::query("SELECT data FROM team_invites WHERE code = $1")
        .bind(token)
        .fetch_optional(db)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return None,
        Err(err) => {
            tracing::error!("team invite lookup failed: {err}");
            return None;
        }
    };
    let data: Value = row.try_get("data").ok()?;
    serde_json::from_value(data).ok()
}

/// Write the new state of an invitation back to the database.
///
/// Returns false when the invitation does not exist or the database refused
/// the write, so the caller never reports a success it did not get.
async fn set_team_invite_status(state: &AppState, token: &str, status: &str) -> bool {
    let Some(db) = state.db.as_ref() else {
        return false;
    };
    let result = sqlx::query(
        "UPDATE team_invites
            SET data = data
                    || jsonb_build_object('status', $2::text)
                    || CASE
                           WHEN $2::text = 'accepted'
                           THEN jsonb_build_object(
                               'acceptedAt',
                               to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
                           )
                           ELSE '{}'::jsonb
                       END,
                revoked = ($2::text = 'revoked')
          WHERE code = $1",
    )
    .bind(token)
    .bind(status)
    .execute(db)
    .await;
    match result {
        Ok(done) => done.rows_affected() > 0,
        Err(err) => {
            tracing::error!("team invite status update failed: {err}");
            false
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
        "issuerEmail": invite.issuer_email.clone(),
        // Only non-secret workspace metadata. Database URLs, provider keys and
        // webhook secrets are resolved server-side from the tenant and are
        // never handed to an unauthenticated invite page.
        "workspace": {
            "tenantId": invite.workspace.tenant_id,
            "displayName": invite.workspace.display_name,
            "businessDomain": invite.workspace.business_domain,
            "businessDomainVerified": invite.workspace.business_domain_verified,
            "isBusinessSetupComplete": invite.workspace.is_business_setup_complete,
        }
    })
}

// Retained for reference; team sign-in now authenticates with a password
// instead of an emailed OTP.
#[allow(dead_code)]
fn verify_team_otp_token(
    state: &AppState,
    email: &str,
    verification_token: &str,
) -> Result<(), StatusCode> {
    if state.config.otp_signing_secret.trim().is_empty() {
        tracing::error!("OTP_SIGNING_SECRET is required for Team Access completion");
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let validation = Validation {
        validate_aud: false,
        leeway: 120,
        ..Default::default()
    };
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
    headers: HeaderMap,
    Json(payload): Json<CreateTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    // The caller's workspace and role come from the verified session. The
    // request used to choose both, which let any authenticated user create an
    // administrator key for any company whose tenant id they knew.
    let context = match crate::company_api::workspace_context(&state, &headers).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    if !context.can_manage() {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "message": "Only workspace owners and admins can create a team access key."
            })),
        );
    }

    let email = normalize_team_email(&payload.email);
    let role = payload.role.trim().to_lowercase();

    if !is_valid_email_address(&email) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "A valid invite email is required."
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
    if role == "admin" && context.role != "owner" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "message": "Only a workspace owner can invite another administrator."
            })),
        );
    }

    let Some(db) = state.db.as_ref() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "success": false,
                "message": "The invitation store is not connected. Try again in a moment."
            })),
        );
    };

    let pending: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM team_invites
         WHERE revoked = FALSE
           AND data->>'status' = 'pending'
           AND data->'workspace'->>'tenantId' = $1",
    )
    .bind(context.tenant_id.to_string())
    .fetch_one(db)
    .await
    .unwrap_or(0);
    if pending >= 50 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "success": false,
                "message": "Too many pending team access keys. Revoke unused keys first."
            })),
        );
    }

    let tenant_name: String = sqlx::query_scalar(
        "SELECT organization_name FROM tenants WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(context.tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "VelisMail workspace".to_string());
    let domain: Option<String> = sqlx::query_scalar(
        "SELECT domain_name FROM custom_domains
         WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1",
    )
    .bind(context.tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let domain_verified: bool = match domain.as_deref() {
        Some(domain) => sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM custom_domains
             WHERE tenant_id = $1 AND LOWER(domain_name) = LOWER($2)
               AND verification_status = 'verified')",
        )
        .bind(context.tenant_id)
        .bind(domain)
        .fetch_one(db)
        .await
        .unwrap_or(false),
        None => false,
    };

    let now = chrono::Utc::now();
    let requested_expiry = payload.expires_in_hours.unwrap_or(24);
    // A team access key always expires. Open ended keys were impossible to
    // retire safely when an employee left.
    let expires_at =
        Some((now + chrono::Duration::hours(requested_expiry.clamp(1, 720))).to_rfc3339());
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
            payload.name.trim().chars().take(100).collect()
        },
        role,
        status: "pending".to_string(),
        created_at: now.to_rfc3339(),
        expires_at,
        accepted_at: None,
        issuer_email: context.email.clone(),
        workspace: TeamInviteWorkspace {
            tenant_id: Some(context.tenant_id.to_string()),
            display_name: Some(tenant_name),
            business_domain: domain,
            business_domain_verified: Some(domain_verified),
            is_business_setup_complete: Some(domain_verified),
        },
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

    let expires_at_ts: Option<chrono::DateTime<chrono::Utc>> = invite
        .expires_at
        .as_deref()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&chrono::Utc));
    let stored = sqlx::query(
        "INSERT INTO team_invites (code, data, expires_at, revoked)
         VALUES ($1, $2, $3, false)
         ON CONFLICT (code) DO UPDATE
            SET data = EXCLUDED.data,
                expires_at = EXCLUDED.expires_at,
                revoked = false",
    )
    .bind(&token)
    .bind(&serialized)
    .bind(expires_at_ts)
    .execute(db)
    .await;
    if let Err(err) = stored {
        tracing::error!("team invite insert failed: {err}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Unable to save the team access key."
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "invite": public_team_invite(&invite)
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
    if invite.status != "pending" {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "success": false,
                "message": "This team access key was already used."
            })),
        );
    }
    if team_invite_expired(&invite) {
        let _ = set_team_invite_status(&state, token, "expired").await;
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

/// Extract a client IP for the refresh-token audit column.
fn gateway_request_ip(headers: &HeaderMap) -> String {
    if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        // Caddy appends the peer address, so the last entry is the one that
        // cannot be spoofed by the client.
        if let Some(last) = value.rsplit(',').next() {
            let trimmed = last.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Some(value) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "127.0.0.1".to_string()
}

/// Hash a team-access password with the same Argon2 parameters the auth
/// service uses, so a team account and a normal account verify identically.
fn hash_team_password(raw: &str) -> Result<String, StatusCode> {
    use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
    use argon2::Argon2;
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn verify_team_password(raw: &str, stored: &str) -> bool {
    use argon2::password_hash::{PasswordHash, PasswordVerifier};
    use argon2::Argon2;
    PasswordHash::new(stored)
        .and_then(|parsed| Argon2::default().verify_password(raw.as_bytes(), &parsed))
        .is_ok()
}

/// SHA-256 hex digest, matching the auth service's refresh-token hashing.
fn hash_refresh_token(token: &str) -> String {
    use sha2::Digest;
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Complete a team-access sign-in with an email + password.
///
/// The invited member is created (or verified) inside the inviter's workspace
/// so the issued session resolves to the invited company, and a real
/// access + refresh token pair is returned. No separate setup is required.
pub async fn complete_team_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CompleteTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    let token = payload.token.trim();
    let email = normalize_team_email(&payload.email);
    let password = payload.password.clone();
    if token.is_empty() || email.is_empty() || password.len() < 8 || password.len() > 256 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Team access key, email, and a password of 8-256 characters are required."
            })),
        );
    }
    if !is_valid_email_address(&email) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "message": "Enter a valid email address." })),
        );
    }

    let invite = match load_team_invite(&state, token).await {
        Some(value) => value,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(json!({ "success": false, "message": "Invalid team access key." })),
            )
        }
    };
    if invite.status == "revoked" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "success": false, "message": "This team access key was revoked." })),
        );
    }
    if invite.status != "pending" {
        return (
            StatusCode::CONFLICT,
            Json(json!({ "success": false, "message": "This team access key was already used." })),
        );
    }
    if team_invite_expired(&invite) {
        let _ = set_team_invite_status(&state, token, "expired").await;
        return (
            StatusCode::GONE,
            Json(json!({ "success": false, "message": "This team access key has expired." })),
        );
    }
    if email != invite.email {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "success": false, "message": "Team access key and email do not match." })),
        );
    }

    let db = match state.db.as_ref() {
        Some(pool) => pool,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(
                    json!({ "success": false, "message": "The account database is not connected." }),
                ),
            )
        }
    };

    let admin_tenant = match invite
        .workspace
        .tenant_id
        .as_deref()
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
    {
        Some(value) if value != uuid::Uuid::nil() => value,
        _ => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(
                    json!({ "success": false, "message": "The invite is missing its workspace. Ask the admin to generate a fresh access key." }),
                ),
            )
        }
    };

    let tenant_usable: bool = sqlx::query_scalar(
        "SELECT EXISTS(
             SELECT 1 FROM tenants
             WHERE id = $1 AND deleted_at IS NULL
               AND status NOT IN ('suspended', 'disabled', 'deleted')
         )",
    )
    .bind(admin_tenant)
    .fetch_one(db)
    .await
    .unwrap_or(false);
    if !tenant_usable {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "success": false, "message": "That workspace is not active." })),
        );
    }

    // Throttle password attempts for an existing account reached through an
    // invitation key. Without this the endpoint is a second, unthrottled
    // password login oracle.
    let recent_failures: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM failed_login_attempts
         WHERE email = $1 AND attempted_at > NOW() - INTERVAL '15 minutes'",
    )
    .bind(&email)
    .fetch_one(db)
    .await
    .unwrap_or(0);
    if recent_failures >= 5 {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(
                json!({ "success": false, "message": "Too many sign-in attempts. Try again later." }),
            ),
        );
    }

    let existing = sqlx::query(
        "SELECT id, tenant_id, password_hash FROM users WHERE email = $1 AND status = 'active' LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(db)
    .await;

    let user_id = match existing {
        Ok(Some(row)) => {
            let uid: uuid::Uuid = match row.try_get("id") {
                Ok(value) => value,
                Err(_) => {
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "success": false, "message": "Unable to load the account." })),
                    )
                }
            };
            let tenant: Option<uuid::Uuid> = row.try_get("tenant_id").ok().flatten();
            let hash: Option<String> = row.try_get("password_hash").ok().flatten();
            let stored = match hash {
                Some(value) => value,
                None => {
                    return (
                        StatusCode::UNAUTHORIZED,
                        Json(
                            json!({ "success": false, "message": "This email has no password set. Use Forgot Password first." }),
                        ),
                    )
                }
            };
            if !verify_team_password(&password, &stored) {
                let _ = sqlx::query(
                    "INSERT INTO failed_login_attempts (id, user_id, email, ip_address, attempted_at)
                     VALUES ($1, $2, $3, $4, NOW())",
                )
                .bind(uuid::Uuid::new_v4())
                .bind(uid)
                .bind(&email)
                .bind(gateway_request_ip(&headers))
                .execute(db)
                .await;
                return (
                    StatusCode::UNAUTHORIZED,
                    Json(
                        json!({ "success": false, "message": "Incorrect password for this email." }),
                    ),
                );
            }
            if let Some(t) = tenant {
                if t != admin_tenant {
                    return (
                        StatusCode::FORBIDDEN,
                        Json(
                            json!({ "success": false, "message": "This email already has its own VelisMail workspace. Ask the admin to invite a different email address." }),
                        ),
                    );
                }
            }
            uid
        }
        Ok(None) => {
            let hash = match hash_team_password(&password) {
                Ok(value) => value,
                Err(status) => {
                    return (
                        status,
                        Json(
                            json!({ "success": false, "message": "Unable to prepare the account." }),
                        ),
                    )
                }
            };
            let inserted: Result<uuid::Uuid, _> = sqlx::query_scalar(
                "INSERT INTO users (tenant_id, email, display_name, password_hash, status)
                 VALUES ($1, $2, $3, $4, 'active')
                 RETURNING id",
            )
            .bind(admin_tenant)
            .bind(&email)
            .bind(&invite.name)
            .bind(&hash)
            .fetch_one(db)
            .await;
            match inserted {
                Ok(uid) => uid,
                Err(err) => {
                    tracing::warn!("team access user create failed for {email}: {err}");
                    return (
                        StatusCode::CONFLICT,
                        Json(
                            json!({ "success": false, "message": "Unable to create the team account. It may already exist with a different status." }),
                        ),
                    );
                }
            }
        }
        Err(err) => {
            tracing::warn!("team access user lookup failed for {email}: {err}");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "message": "Unable to load the account." })),
            );
        }
    };

    // A successful team sign-in clears the password-attempt counter.
    let _ = sqlx::query("DELETE FROM failed_login_attempts WHERE email = $1")
        .bind(&email)
        .execute(db)
        .await;

    let role = if valid_team_role(&invite.role) {
        invite.role.clone()
    } else {
        "member".to_string()
    };
    let upsert = sqlx::query(
        "INSERT INTO company_members (tenant_id, user_id, email, display_name, role, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (tenant_id, email)
         DO UPDATE SET user_id = EXCLUDED.user_id,
                       display_name = EXCLUDED.display_name,
                       role = EXCLUDED.role,
                       status = 'active',
                       updated_at = NOW()",
    )
    .bind(admin_tenant)
    .bind(user_id)
    .bind(&email)
    .bind(&invite.name)
    .bind(&role)
    .execute(db)
    .await;
    if let Err(err) = upsert {
        tracing::warn!("team access membership upsert failed for {email}: {err}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(
                json!({ "success": false, "message": "Unable to add you to the company workspace." }),
            ),
        );
    }

    // The invitation is only marked accepted once the session exists. A
    // failure while signing the session must not burn the key.
    let mut accepted_invite = invite.clone();
    accepted_invite.status = "accepted".to_string();
    accepted_invite.accepted_at = Some(chrono::Utc::now().to_rfc3339());

    let jwt_secret = state.config.jwt_secret.as_deref().unwrap_or_default();
    if jwt_secret.is_empty() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "success": false, "message": "Session signing is not configured." })),
        );
    }
    let expiry_seconds: i64 = std::env::var("JWT_EXPIRY_SECONDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(86400);
    let now = chrono::Utc::now();
    let device_id = payload
        .device_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "team-access".to_string());
    let claims = velismail_common::Claims {
        sub: velismail_common::types::UserId(user_id),
        tenant_id: admin_tenant.to_string(),
        email: email.clone(),
        iat: now.timestamp(),
        exp: (now + chrono::Duration::seconds(expiry_seconds)).timestamp(),
        nbf: now.timestamp(),
        jti: uuid::Uuid::new_v4().to_string(),
        role: velismail_common::UserRole::User,
        mfa_verified: false,
        device_id: device_id.clone(),
        security_level: velismail_common::SecurityLevel::Standard,
        firebase_uid: None,
    };
    let access_token = match encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    ) {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "message": "Unable to sign the session." })),
            )
        }
    };

    let refresh_token = match velismail_crypto::random::random_token(64) {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "message": "Unable to create the session." })),
            )
        }
    };
    let refresh_hash = hash_refresh_token(&refresh_token);
    let refresh_days: i64 = std::env::var("REFRESH_TOKEN_EXPIRY_DAYS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30);
    let refresh_expiry = now + chrono::Duration::days(refresh_days);
    let ip = gateway_request_ip(&headers);
    let _ = sqlx::query(
        r#"INSERT INTO refresh_tokens
           (user_id, token_hash, device_id, device_fingerprint, expires_at, ip_address, mfa_verified)
           VALUES ($1, $2, $3, $4, $5, $6::inet, false)"#,
    )
    .bind(user_id)
    .bind(&refresh_hash)
    .bind(&device_id)
    .bind(&device_id)
    .bind(refresh_expiry)
    .bind(&ip)
    .execute(db)
    .await;

    if !set_team_invite_status(&state, token, "accepted").await {
        tracing::warn!("team invite {token} could not be marked accepted after sign-in");
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "expiresIn": expiry_seconds,
            "tokenType": "Bearer",
            "invite": public_team_invite(&accepted_invite),
            "user": {
                "id": user_id.to_string(),
                "email": email,
                "displayName": accepted_invite.name,
                "role": role,
                "tenantId": admin_tenant.to_string(),
            }
        })),
    )
}

pub async fn revoke_team_invite(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RevokeTeamInviteRequest>,
) -> (StatusCode, Json<Value>) {
    let context = match crate::company_api::workspace_context(&state, &headers).await {
        Ok(context) => context,
        Err(response) => return response,
    };
    if !context.can_manage() {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "success": false,
                "message": "Only workspace owners and admins can revoke a team access key."
            })),
        );
    }
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
                    "message": "Team access key was not found."
                })),
            )
        }
    };

    let invite_tenant = invite
        .workspace
        .tenant_id
        .as_deref()
        .and_then(|value| uuid::Uuid::parse_str(value).ok());
    if invite_tenant != Some(context.tenant_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "message": "Team access key was not found."
            })),
        );
    }

    if invite.status != "pending" {
        return (
            StatusCode::CONFLICT,
            Json(json!({
                "success": false,
                "message": format!("This team access key is already {}.", invite.status)
            })),
        );
    }

    if !set_team_invite_status(&state, token, "revoked").await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Unable to revoke the team access key."
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true
        })),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformUserUpdateRequest {
    pub email: String,
    pub role: Option<String>,
    pub status: Option<String>,
    pub plan: Option<String>,
    pub billing_cycle: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformUserDeleteRequest {
    pub email: String,
}

fn platform_api_error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    (
        status,
        Json(json!({
            "success": false,
            "error": message,
        })),
    )
}

fn normalize_platform_email(value: &str) -> String {
    value.trim().to_lowercase()
}

/// Every address that is granted platform control-plane access.
///
/// The addresses that identify one account: the login address and its
/// recovery email, which is the owner identity the platform grants.
async fn platform_identities_for(pool: &PgPool, email: &str) -> Vec<String> {
    fn push_identity(identities: &mut Vec<String>, value: String) {
        let value = normalize_platform_email(&value);
        if !value.is_empty() && !identities.contains(&value) {
            identities.push(value);
        }
    }

    let mut identities: Vec<String> = Vec::new();
    push_identity(&mut identities, email.to_string());
    if let Ok(Some(row)) = sqlx::query(
        "SELECT email, recovery_email FROM users WHERE email = $1 OR recovery_email = $1 LIMIT 1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    {
        if let Ok(primary) = row.try_get::<String, _>("email") {
            push_identity(&mut identities, primary);
        }
        if let Ok(Some(recovery)) = row.try_get::<Option<String>, _>("recovery_email") {
            push_identity(&mut identities, recovery);
        }
    }
    identities
}

/// The addresses that are granted platform control-plane access.
///
/// Platform access never comes from the shape of an email address. It is
/// granted by the configured owner list and by a row in `platform_admins`, so
/// these are the accounts the platform must never let a member of staff
/// suspend or delete by mistake.
fn platform_owner_emails(state: &AppState) -> Vec<String> {
    let mut emails: Vec<String> = state
        .config
        .platform_owner_emails
        .iter()
        .map(|value| normalize_platform_email(value))
        .filter(|value| !value.is_empty())
        .collect();
    emails.sort();
    emails.dedup();
    emails
}

/// True when the address belongs to an account the platform itself grants
/// access to.
///
/// This answers from the configured owner list, which is the address the
/// platform owner is listed under. The `platform_admins` table is checked
/// where a database pool is at hand, because it needs a query.
fn is_platform_admin_email(state: &AppState, value: &str) -> bool {
    let value = normalize_platform_email(value);
    !value.is_empty() && platform_owner_emails(state).contains(&value)
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn platform_admin_from_env(state: &AppState, emails: &[String], uid: &str) -> bool {
    if !uid.is_empty()
        && state
            .config
            .platform_owner_uids
            .iter()
            .any(|value| value == uid)
    {
        return true;
    }
    emails.iter().any(|value| {
        state
            .config
            .platform_owner_emails
            .iter()
            .any(|owner| owner == value)
    })
}

async fn user_platform_admin_async(pool: &PgPool, emails: &[String]) -> bool {
    if emails.is_empty() {
        return false;
    }
    matches!(
        sqlx::query(
            "SELECT 1 FROM platform_admins
                 WHERE status <> 'removed'
                   AND (email = ANY($1))",
        )
        .bind(emails)
        .fetch_optional(pool)
        .await,
        Ok(Some(_))
    )
}

async fn authorize_platform_admin(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, (StatusCode, Json<Value>)> {
    let secret = state.config.jwt_secret.as_deref().ok_or_else(|| {
        platform_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Platform Admin API is not configured with JWT_SECRET.",
        )
    })?;
    let token = bearer_token(headers)
        .ok_or_else(|| platform_api_error(StatusCode::UNAUTHORIZED, "Missing bearer token."))?;

    let validation = Validation {
        validate_aud: false,
        leeway: 120,
        ..Default::default()
    };
    let decoded = decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map_err(|_| platform_api_error(StatusCode::UNAUTHORIZED, "Invalid bearer token."))?;

    let email = normalize_platform_email(&decoded.claims.email);
    let uid = decoded
        .claims
        .firebase_uid
        .clone()
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    // The account may be granted under the login address or under its recovery
    // address, so both are resolved before any of the three checks.
    let identities = match state.db.as_ref() {
        Some(pool) => platform_identities_for(pool, &email).await,
        None => vec![email.clone()],
    };

    // Platform access is granted by the configured owner list and the
    // platform_admins table. An email address alone never grants it.
    let authorized = platform_admin_from_env(state, &identities, &uid)
        || platform_owner_emails(state)
            .iter()
            .any(|owner| owner == &email)
        || match state.db.as_ref() {
            Some(pool) => user_platform_admin_async(pool, &identities).await,
            None => false,
        };

    if !authorized {
        return Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "Platform Admin access is limited to configured platform owners.",
        ));
    }
    Ok(email)
}

fn gateway_db_pool(state: &AppState) -> Result<&PgPool, (StatusCode, Json<Value>)> {
    state.db.as_ref().ok_or_else(|| {
        platform_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Platform user database is not connected.",
        )
    })
}

fn db_status_to_app_status(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "deleted" | "deactivated" => "deactivated".to_string(),
        "suspended" => "suspended".to_string(),
        _ => "active".to_string(),
    }
}

fn app_status_to_db_status(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "active" => Some("active".to_string()),
        "suspended" => Some("suspended".to_string()),
        "deactivated" | "deleted" => Some("deleted".to_string()),
        _ => None,
    }
}

fn platform_user_json(row: PgRow, protected_emails: &[String]) -> Value {
    let id: uuid::Uuid = row.get("id");
    let tenant_id: uuid::Uuid = row.get("tenant_id");
    let email: String = row.get("email");
    let recovery_email: Option<String> = row.try_get("recovery_email").ok();
    let display_name: String = row.get("display_name");
    let db_status: String = row.get("status");
    let settings: Value = row.try_get("settings").unwrap_or_else(|_| json!({}));
    let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
    let updated_at: chrono::DateTime<chrono::Utc> = row.get("updated_at");
    let last_login: Option<chrono::DateTime<chrono::Utc>> = row.try_get("last_login").ok();

    let mut user = settings.as_object().cloned().unwrap_or_default();
    let app_status = user
        .get("status")
        .and_then(Value::as_str)
        .map(db_status_to_app_status)
        .unwrap_or_else(|| db_status_to_app_status(&db_status));
    let platform_admin = protected_emails.contains(&normalize_platform_email(&email));

    user.insert("id".to_string(), json!(id.to_string()));
    user.insert("tenantId".to_string(), json!(tenant_id.to_string()));
    user.insert("email".to_string(), json!(email));
    user.insert("recoveryEmail".to_string(), json!(recovery_email));
    user.insert("displayName".to_string(), json!(display_name));
    user.insert("status".to_string(), json!(app_status));
    user.insert("createdAt".to_string(), json!(created_at.to_rfc3339()));
    user.insert("updatedAt".to_string(), json!(updated_at.to_rfc3339()));
    user.insert(
        "lastActiveAt".to_string(),
        last_login
            .map(|value| json!(value.to_rfc3339()))
            .unwrap_or(Value::Null),
    );
    if !user.contains_key("plan") {
        user.insert("plan".to_string(), json!("Free"));
    }
    if !user.contains_key("billingCycle") {
        user.insert("billingCycle".to_string(), json!("monthly"));
    }
    if !user.contains_key("accountType") {
        user.insert("accountType".to_string(), json!("business"));
    }
    if !user.contains_key("isSetupComplete") {
        user.insert("isSetupComplete".to_string(), json!(false));
    }
    let role_value = if platform_admin {
        "admin".to_string()
    } else {
        user.get("role")
            .and_then(Value::as_str)
            .unwrap_or("member")
            .to_string()
    };
    user.insert("role".to_string(), json!(role_value));
    user.insert("isPlatformAdmin".to_string(), json!(platform_admin));

    Value::Object(user)
}

async fn fetch_platform_user(pool: &PgPool, email: &str) -> Option<Value> {
    let row = sqlx::query(
        "SELECT id, tenant_id, email, recovery_email, display_name, status, settings, created_at, updated_at, last_login
         FROM users
         WHERE email = $1",
    )
    .bind(email)
    .fetch_optional(pool)
    .await
    .ok()??;
    Some(platform_user_json(row, &[]))
}

pub async fn list_platform_users(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    if let Err(response) = authorize_platform_admin(&state, &headers).await {
        return response;
    }
    let pool = match gateway_db_pool(&state) {
        Ok(pool) => pool,
        Err(response) => return response,
    };

    let rows = match sqlx::query(
        "SELECT id, tenant_id, email, recovery_email, display_name, status, settings, created_at, updated_at, last_login
         FROM users
         ORDER BY created_at DESC
         LIMIT 5000",
    )
    .fetch_all(pool)
    .await
    {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("platform user list failed: {}", err);
            return platform_api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to load platform users.",
            );
        }
    };

    let protected_emails = platform_owner_emails(&state);
    let users: Vec<Value> = rows
        .into_iter()
        .map(|row| platform_user_json(row, &protected_emails))
        .collect();
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "users": users,
        })),
    )
}

pub async fn update_platform_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PlatformUserUpdateRequest>,
) -> (StatusCode, Json<Value>) {
    let actor_email = match authorize_platform_admin(&state, &headers).await {
        Ok(email) => email,
        Err(response) => return response,
    };
    let pool = match gateway_db_pool(&state) {
        Ok(pool) => pool,
        Err(response) => return response,
    };

    let target_email = normalize_platform_email(&payload.email);
    if !target_email.contains('@') {
        return platform_api_error(StatusCode::BAD_REQUEST, "A valid user email is required.");
    }

    let mut settings_patch = serde_json::Map::new();
    let mut db_status: Option<String> = None;

    if let Some(status) = payload.status.as_deref() {
        let Some(next_db_status) = app_status_to_db_status(status) else {
            return platform_api_error(StatusCode::BAD_REQUEST, "Invalid user status.");
        };
        if is_platform_admin_email(&state, &target_email) && next_db_status != "active" {
            return platform_api_error(
                StatusCode::BAD_REQUEST,
                "Platform-domain admin accounts cannot be suspended or deactivated.",
            );
        }
        let app_status = db_status_to_app_status(&next_db_status);
        db_status = Some(next_db_status);
        settings_patch.insert("status".to_string(), json!(app_status));
        if status.eq_ignore_ascii_case("suspended") {
            settings_patch.insert(
                "suspendedAt".to_string(),
                json!(chrono::Utc::now().to_rfc3339()),
            );
            settings_patch.insert(
                "suspensionReason".to_string(),
                json!(format!("Updated by {actor_email}")),
            );
        } else {
            settings_patch.insert("suspendedAt".to_string(), Value::Null);
            settings_patch.insert("suspensionReason".to_string(), Value::Null);
        }
    }

    if let Some(role) = payload.role.as_deref() {
        let role = role.trim().to_lowercase();
        if !valid_team_role(&role) {
            return platform_api_error(StatusCode::BAD_REQUEST, "Invalid user role.");
        }
        if is_platform_admin_email(&state, &target_email) && role != "admin" {
            return platform_api_error(
                StatusCode::BAD_REQUEST,
                "Platform-domain accounts are locked to admin access.",
            );
        }
        settings_patch.insert("role".to_string(), json!(role));
        settings_patch.insert(
            "isPlatformAdmin".to_string(),
            json!(is_platform_admin_email(&state, &target_email)),
        );
    }

    if let Some(plan) = payload.plan.as_deref() {
        let plan = plan.trim();
        if plan.is_empty() {
            return platform_api_error(StatusCode::BAD_REQUEST, "Invalid plan.");
        }
        let now = chrono::Utc::now();
        let billing = payload
            .billing_cycle
            .as_deref()
            .unwrap_or("monthly")
            .trim()
            .to_lowercase();
        let billing = if billing == "annual" {
            "annual"
        } else {
            "monthly"
        };
        settings_patch.insert("plan".to_string(), json!(plan));
        settings_patch.insert("billingCycle".to_string(), json!(billing));
        settings_patch.insert("lastPlanChangeAt".to_string(), json!(now.to_rfc3339()));
        if !plan.eq_ignore_ascii_case("free") {
            let expires_at = if billing == "annual" {
                now + chrono::Duration::days(365)
            } else {
                now + chrono::Duration::days(31)
            };
            settings_patch.insert("paidPlanPurchasedAt".to_string(), json!(now.to_rfc3339()));
            settings_patch.insert(
                "paidPlanExpiresAt".to_string(),
                json!(expires_at.to_rfc3339()),
            );
            settings_patch.insert("subscriptionStatus".to_string(), json!("active"));
        } else {
            settings_patch.insert("paidPlanPurchasedAt".to_string(), Value::Null);
            settings_patch.insert("paidPlanExpiresAt".to_string(), Value::Null);
            settings_patch.insert("subscriptionStatus".to_string(), json!("active"));
        }
    } else if let Some(billing_cycle) = payload.billing_cycle.as_deref() {
        let billing = billing_cycle.trim().to_lowercase();
        if billing != "monthly" && billing != "annual" {
            return platform_api_error(StatusCode::BAD_REQUEST, "Invalid billing cycle.");
        }
        settings_patch.insert("billingCycle".to_string(), json!(billing));
        settings_patch.insert(
            "lastPlanChangeAt".to_string(),
            json!(chrono::Utc::now().to_rfc3339()),
        );
    }

    if settings_patch.is_empty() && db_status.is_none() {
        return platform_api_error(StatusCode::BAD_REQUEST, "No user change was provided.");
    }

    let settings_json = Value::Object(settings_patch).to_string();
    let result = sqlx::query(
        "UPDATE users
         SET status = COALESCE($1::text, status),
             settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW()
         WHERE email = $3",
    )
    .bind(db_status.as_deref())
    .bind(&settings_json)
    .bind(&target_email)
    .execute(pool)
    .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            let mut user = fetch_platform_user(pool, &target_email)
                .await
                .unwrap_or_else(|| json!({ "email": target_email }));
            // The protection list is rebuilt, so the answer reflects the
            // current owner configuration rather than the one at sign-in.
            let protected = is_platform_admin_email(&state, &target_email);
            if let Some(object) = user.as_object_mut() {
                object.insert("isPlatformAdmin".to_string(), json!(protected));
            }
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "user": user,
                })),
            )
        }
        Ok(_) => platform_api_error(StatusCode::NOT_FOUND, "User was not found."),
        Err(err) => {
            tracing::error!("platform user update failed: {}", err);
            platform_api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to update platform user.",
            )
        }
    }
}

pub async fn delete_platform_user(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PlatformUserDeleteRequest>,
) -> (StatusCode, Json<Value>) {
    if let Err(response) = authorize_platform_admin(&state, &headers).await {
        return response;
    }
    let pool = match gateway_db_pool(&state) {
        Ok(pool) => pool,
        Err(response) => return response,
    };

    let target_email = normalize_platform_email(&payload.email);
    if is_platform_admin_email(&state, &target_email) {
        return platform_api_error(
            StatusCode::BAD_REQUEST,
            "Platform-domain admin accounts cannot be deleted.",
        );
    }

    let result = sqlx::query("DELETE FROM users WHERE email = $1")
        .bind(&target_email)
        .execute(pool)
        .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => (
            StatusCode::OK,
            Json(json!({
                "success": true,
            })),
        ),
        Ok(_) => platform_api_error(StatusCode::NOT_FOUND, "User was not found."),
        Err(err) => {
            tracing::error!("platform user delete failed: {}", err);
            platform_api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to delete platform user.",
            )
        }
    }
}

static POOLS: Lazy<Mutex<HashMap<String, PgPool>>> = Lazy::new(|| Mutex::new(HashMap::new()));
/// Recently failed tenant databases. A dead customer database must not make
/// every request wait for the full connect timeout, so failures are cached
/// briefly and returned immediately.
static FAILED_POOLS: Lazy<Mutex<HashMap<String, (Instant, String)>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// How long a failed tenant database is remembered.
const FAILED_POOL_TTL: Duration = Duration::from_secs(30);
/// Hard limit for reaching a customer database.
const TENANT_DB_CONNECT_TIMEOUT: Duration = Duration::from_secs(8);
/// Hard limit for a single customer database query.
const TENANT_DB_QUERY_TIMEOUT: Duration = Duration::from_secs(10);

fn remember_failed_pool(url: &str, reason: &str) {
    if let Ok(mut pools) = FAILED_POOLS.lock() {
        pools.insert(url.to_string(), (Instant::now(), reason.to_string()));
    }
}

fn recent_failed_pool(url: &str) -> Option<String> {
    let pools = FAILED_POOLS.lock().ok()?;
    match pools.get(url) {
        Some((at, reason)) if at.elapsed() < FAILED_POOL_TTL => Some(reason.clone()),
        Some(_) => {
            drop(pools);
            if let Ok(mut pools) = FAILED_POOLS.lock() {
                pools.remove(url);
            }
            None
        }
        None => None,
    }
}

async fn get_tenant_pool(db_url: &str) -> Result<PgPool, String> {
    let normalized_url = velismail_common::traffic::validate_external_db_url(db_url).await?;

    if let Some(reason) = recent_failed_pool(&normalized_url) {
        return Err(format!(
            "The business database is temporarily unreachable: {}",
            reason
        ));
    }

    if let Some(pool) = {
        let pools = POOLS
            .lock()
            .map_err(|_| "Tenant pool cache lock poisoned".to_string())?;
        pools.get(&normalized_url).cloned()
    } {
        if !pool.is_closed() {
            return Ok(pool);
        }
        if let Ok(mut pools) = POOLS.lock() {
            pools.remove(&normalized_url);
        }
    }

    let pool: PgPool = match timeout(
        TENANT_DB_CONNECT_TIMEOUT,
        PgPoolOptions::new()
            .max_connections(8)
            .min_connections(0)
            .idle_timeout(Some(Duration::from_secs(60)))
            .max_lifetime(Some(Duration::from_secs(300)))
            .acquire_timeout(Duration::from_secs(10))
            .connect(&normalized_url),
    )
    .await
    {
        Ok(Ok(pool)) => pool,
        Ok(Err(err)) => {
            let reason = err.to_string();
            remember_failed_pool(&normalized_url, &reason);
            return Err(reason);
        }
        Err(_) => {
            let reason = format!(
                "no answer within {} seconds",
                TENANT_DB_CONNECT_TIMEOUT.as_secs()
            );
            remember_failed_pool(&normalized_url, &reason);
            return Err(reason);
        }
    };

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
            html_body TEXT,
            folder VARCHAR(50),
            created_at VARCHAR(100),
            is_read BOOLEAN,
            is_starred BOOLEAN,
            has_attachment BOOLEAN DEFAULT FALSE,
            in_reply_to VARCHAR(512),
            thread_id VARCHAR(255),
            message_id VARCHAR(512)
        );",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    for column in [
        "has_attachment BOOLEAN DEFAULT FALSE",
        "html_body TEXT",
        "in_reply_to VARCHAR(512)",
        "thread_id VARCHAR(255)",
        "message_id VARCHAR(512)",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS {column};"
        )))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    for index in [
        "CREATE INDEX IF NOT EXISTS idx_business_emails_folder_created ON business_emails(folder, created_at DESC);",
        "CREATE INDEX IF NOT EXISTS idx_business_emails_message_id ON business_emails(message_id);",
        "CREATE INDEX IF NOT EXISTS idx_business_emails_thread_id ON business_emails(thread_id);",
    ] {
        sqlx::query(index)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

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
    #[serde(default)]
    pub html_body: Option<String>,
    pub folder: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    #[serde(default)]
    pub has_attachment: bool,
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBusinessEmailRequest {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: Option<String>,
    pub email: BusinessEmail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBusinessEmailRequest {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: Option<String>,
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmailsQuery {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmailsRequest {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessMailbox {
    pub id: String,
    pub domain: String,
    pub address: String,
    pub display_name: String,
    pub kind: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub active: bool,
    pub source: String,
    pub created_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBusinessMailboxRequest {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: Option<String>,
    pub mailbox: BusinessMailbox,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteBusinessMailboxRequest {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: Option<String>,
    pub domain: String,
    pub address: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessMailboxesQuery {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: Option<String>,
    pub domain: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessMailboxesRequest {
    #[allow(dead_code)] // Ignored: the workspace database comes from the session.
    pub db_url: String,
    pub domain: String,
}

/// Resolve the caller's business database from the server-side tenant
/// configuration.
///
/// The database URL is a credential. Accepting it from a header, query or body
/// let any authenticated account read or modify another workspace's mail and
/// wrote the plaintext password into proxy access logs. The URL is now looked
/// up from the caller's own tenant; client-supplied values are ignored.
async fn authorized_business_db_url(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<String, crate::company_api::ApiError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            crate::company_api::fail(StatusCode::UNAUTHORIZED, "A bearer token is required.")
        })?;

    let tenant_id = if token.starts_with(crate::api_keys::API_KEY_PREFIX) {
        crate::api_keys::resolve(state, token)
            .await
            .map(|key| key.tenant_id)
            .map_err(|_| {
                crate::company_api::fail(StatusCode::UNAUTHORIZED, "This API key is not valid.")
            })?
    } else {
        let claims = crate::company_api::session_claims(state, headers)?;
        Uuid::parse_str(claims.tenant_id.trim()).map_err(|_| {
            crate::company_api::fail(
                StatusCode::UNAUTHORIZED,
                "Invalid tenant identity in token.",
            )
        })?
    };

    let db = state.db.as_ref().ok_or_else(|| {
        crate::company_api::fail(
            StatusCode::SERVICE_UNAVAILABLE,
            "The workspace database is not connected.",
        )
    })?;

    crate::company_api::tenant_business_db_url(db, tenant_id)
        .await
        .ok_or_else(|| {
            crate::company_api::fail(
                StatusCode::BAD_REQUEST,
                "Configure the business database in Settings before using mail storage.",
            )
        })
}

async fn ensure_business_mailboxes_table(pool: &PgPool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS business_mailboxes (
            id VARCHAR(255) NOT NULL,
            domain VARCHAR(255) NOT NULL,
            address VARCHAR(255) NOT NULL,
            display_name VARCHAR(255) NOT NULL,
            kind VARCHAR(50) NOT NULL,
            aliases TEXT NOT NULL DEFAULT '[]',
            active BOOLEAN NOT NULL DEFAULT TRUE,
            source VARCHAR(50) NOT NULL DEFAULT 'custom',
            created_at VARCHAR(100) NOT NULL,
            last_used_at VARCHAR(100),
            PRIMARY KEY (domain, address)
        );",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    for column in [
        "last_used_at VARCHAR(100)",
        "aliases TEXT NOT NULL DEFAULT '[]'",
        "source VARCHAR(50) NOT NULL DEFAULT 'custom'",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE business_mailboxes ADD COLUMN IF NOT EXISTS {column};"
        )))
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }

    for index in [
        "CREATE INDEX IF NOT EXISTS idx_business_mailboxes_domain ON business_mailboxes(domain);",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_business_mailboxes_domain_address ON business_mailboxes(domain, address);",
    ] {
        sqlx::query(index)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn normalize_business_mailbox(mailbox: BusinessMailbox) -> Result<BusinessMailbox, String> {
    let domain = mailbox.domain.trim().to_lowercase();
    let address = mailbox.address.trim().to_lowercase();
    if !is_valid_domain(&domain) {
        return Err("Invalid mailbox domain.".to_string());
    }
    if !is_valid_email_address(&address) || !address.ends_with(&format!("@{domain}")) {
        return Err(format!(
            "Mailbox address must be a valid @{domain} address."
        ));
    }

    let kind = match mailbox.kind.trim().to_lowercase().as_str() {
        "primary" => "primary",
        "mailbox" => "mailbox",
        "alias" => "alias",
        "shared" => "shared",
        _ => return Err("Invalid mailbox kind.".to_string()),
    }
    .to_string();
    let source = match mailbox.source.trim().to_lowercase().as_str() {
        "system" => "system",
        "custom" => "custom",
        _ => "custom",
    }
    .to_string();

    let aliases = mailbox
        .aliases
        .into_iter()
        .map(|alias| alias.trim().to_lowercase())
        .filter(|alias| is_valid_email_address(alias))
        .collect::<Vec<_>>();

    Ok(BusinessMailbox {
        id: mailbox.id.trim().to_string(),
        domain,
        address,
        display_name: mailbox.display_name.trim().to_string(),
        kind,
        aliases,
        active: mailbox.active,
        source,
        created_at: mailbox.created_at.trim().to_string(),
        last_used_at: mailbox
            .last_used_at
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

async fn read_business_mailboxes(db_url: &str, domain: &str) -> (StatusCode, Json<Value>) {
    let domain = domain.trim().to_lowercase();
    if !is_valid_domain(&domain) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "error": "Invalid mailbox domain."})),
        );
    }

    let pool = match get_tenant_pool(db_url).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_mailboxes_table(&pool).await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let query = sqlx::query(
        "SELECT id, domain, address, display_name, kind, aliases, active, source, created_at, last_used_at
         FROM business_mailboxes
         WHERE domain = $1
         ORDER BY active DESC, created_at ASC",
    )
    .bind(&domain);
    let rows = match timeout(TENANT_DB_QUERY_TIMEOUT, query.fetch_all(&pool)).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(e)) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"success": false, "error": format!("Query Error: {}", e)})),
            )
        }
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "success": false,
                    "error": "The business database did not answer in time."
                })),
            )
        }
    };

    let mailboxes: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let aliases: String = row.try_get("aliases").unwrap_or_else(|_| "[]".to_string());
            let aliases: Vec<String> = serde_json::from_str(&aliases).unwrap_or_default();
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain").unwrap_or_default(),
                "address": row.try_get::<String, _>("address").unwrap_or_default(),
                "displayName": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "kind": row.try_get::<String, _>("kind").unwrap_or_else(|_| "mailbox".to_string()),
                "aliases": aliases,
                "active": row.try_get::<bool, _>("active").unwrap_or(true),
                "source": row.try_get::<String, _>("source").unwrap_or_else(|_| "custom".to_string()),
                "createdAt": row.try_get::<String, _>("created_at").unwrap_or_default(),
                "lastUsedAt": row.try_get::<Option<String>, _>("last_used_at").unwrap_or_default(),
            })
        })
        .collect();

    (
        StatusCode::OK,
        Json(json!({"success": true, "mailboxes": mailboxes})),
    )
}

async fn business_mailbox_exists(
    db_url: &str,
    domain: &str,
    address: &str,
) -> Result<bool, String> {
    let pool = get_tenant_pool(db_url).await?;
    ensure_business_mailboxes_table(&pool).await?;
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM business_mailboxes WHERE domain = $1 AND address = $2",
    )
    .bind(domain.trim().to_lowercase())
    .bind(address.trim().to_lowercase())
    .fetch_one(&pool)
    .await
    .map(|count| count > 0)
    .map_err(|e| e.to_string())
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

/// Pool for the gateway's own route database. This URL is operator-provided,
/// so it is trusted (it may legitimately point at localhost PostgreSQL) and is
/// not passed through the public business-database validator.
async fn gateway_route_pool() -> Option<PgPool> {
    let db_url = std::env::var("INBOUND_ROUTING_DB_URL")
        .or_else(|_| std::env::var("DATABASE_URL"))
        .ok()?;
    PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&db_url)
        .await
        .ok()
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
    let html_body = value_string(source.get("html")).or_else(|| value_string(data.get("html")));
    let message_id = value_string(source.get("message_id"))
        .or_else(|| value_string(data.get("message_id")))
        .or_else(|| Some(email_id.clone()));
    let body = value_string(source.get("text"))
        .or_else(|| html_body.as_deref().map(html_to_readable_text))
        .unwrap_or_else(|| {
            format!(
                "Received by Resend. Email ID: {}. Message ID: {}. Reconnect the domain with a Resend API key that can read received emails to hydrate the full body.",
                email_id,
                message_id.as_deref().unwrap_or("not provided")
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
        html_body,
        folder: "inbox".to_string(),
        date,
        read: false,
        starred: false,
        has_attachment,
        in_reply_to: value_string(source.get("in_reply_to"))
            .or_else(|| value_string(data.get("in_reply_to"))),
        thread_id: message_id.clone(),
        message_id,
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

    // The webhook was authenticated with the per-domain signing secret above,
    // so it may store into that route's database directly.
    let (status, Json(mut response)) = save_business_email_with_db(&db_url, email).await;
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
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_emails_table(&pool).await {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let query = sqlx::query(
        "SELECT id, sender, sender_name, recipients, subject, body, folder, created_at, is_read, is_starred, has_attachment, html_body, in_reply_to, thread_id, message_id FROM business_emails ORDER BY created_at DESC",
    );
    let rows = match timeout(TENANT_DB_QUERY_TIMEOUT, query.fetch_all(&pool)).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(e)) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"success": false, "error": format!("Query Error: {}", e)})),
            )
        }
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "success": false,
                    "error": "The business database did not answer in time."
                })),
            )
        }
    };

    let mut emails = Vec::new();
    for row in rows {
        let id: String = row.try_get("id").unwrap_or_default();
        let sender: String = row.try_get("sender").unwrap_or_default();
        let sender_name: String = row.try_get("sender_name").unwrap_or_default();
        let recipients_str: String = row
            .try_get("recipients")
            .unwrap_or_else(|_| "[]".to_string());
        let to: Vec<String> = serde_json::from_str(&recipients_str).unwrap_or_default();
        let subject: String = row.try_get("subject").unwrap_or_default();
        let body: String = row.try_get("body").unwrap_or_default();
        let folder: String = row.try_get("folder").unwrap_or_default();
        let created_at: String = row.try_get("created_at").unwrap_or_default();
        let is_read: bool = row.try_get("is_read").unwrap_or_default();
        let is_starred: bool = row.try_get("is_starred").unwrap_or_default();
        let has_attachment: bool = row.try_get("has_attachment").unwrap_or_default();

        emails.push(json!({
            "id": id,
            "from": sender,
            "fromName": sender_name,
            "to": to,
            "subject": subject,
            "body": body,
            "htmlBody": row.try_get::<Option<String>, _>("html_body").unwrap_or_default(),
            "folder": folder,
            "date": created_at,
            "read": is_read,
            "starred": is_starred,
            "hasAttachment": has_attachment,
            "inReplyTo": row.try_get::<Option<String>, _>("in_reply_to").unwrap_or_default(),
            "threadId": row.try_get::<Option<String>, _>("thread_id").unwrap_or_default(),
            "messageId": row.try_get::<Option<String>, _>("message_id").unwrap_or_default()
        }));
    }

    (
        StatusCode::OK,
        Json(json!({"success": true, "emails": emails})),
    )
}

pub async fn get_business_mailboxes(
    State(state): State<AppState>,
    Query(query): Query<BusinessMailboxesQuery>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };
    let Some(domain) = query.domain.as_deref() else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "error": "Missing mailbox domain"})),
        );
    };

    read_business_mailboxes(&db_url, domain).await
}

pub async fn query_business_mailboxes(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BusinessMailboxesRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };

    read_business_mailboxes(&db_url, payload.domain.trim()).await
}

/// Register a mailbox in the company business database.
///
/// A verified domain always gets its sending mailbox, otherwise the first
/// mail would fail with "sender mailbox is not registered".
/// Open the business database of a company.
///
/// The pool is cached, so repeated calls for the same database reuse one
/// connection set.
pub(crate) async fn business_mailbox_pool(db_url: &str) -> Result<PgPool, String> {
    get_tenant_pool(db_url).await
}

async fn ensure_business_mailbox(
    db_url: &str,
    domain: &str,
    address: &str,
    display_name: &str,
    kind: &str,
) -> Result<(), String> {
    let pool = get_tenant_pool(db_url).await?;
    ensure_business_mailboxes_table(&pool).await?;
    let aliases = serde_json::to_string(&Vec::<String>::new()).unwrap_or_else(|_| "[]".to_string());
    let id = format!("mbx_{}", uuid::Uuid::new_v4().simple());
    // The timestamp column of the mailbox index is text, so the value has to
    // be a string. A database timestamp is rejected by the column type.
    sqlx::query(
        "INSERT INTO business_mailboxes (id, domain, address, display_name, kind, aliases, active, source, created_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'system', $7, NULL)
         ON CONFLICT (domain, address) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            kind = EXCLUDED.kind,
            active = TRUE",
    )
    .bind(&id)
    .bind(domain.trim().to_lowercase())
    .bind(address.trim().to_lowercase())
    .bind(display_name)
    .bind(kind)
    .bind(&aliases)
    .bind(crate::business_mailboxes::now_string())
    .execute(&pool)
    .await
    .map(|_| ())
    .map_err(|err| format!("{err}"))
}

pub async fn save_business_mailbox(
    State(state): State<AppState>,
    Query(_query): Query<BusinessMailboxesQuery>,
    headers: HeaderMap,
    Json(payload): Json<SaveBusinessMailboxRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };

    let mailbox = match normalize_business_mailbox(payload.mailbox) {
        Ok(mailbox) => mailbox,
        Err(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": message})),
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

    if let Err(e) = ensure_business_mailboxes_table(&pool).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let aliases = serde_json::to_string(&mailbox.aliases).unwrap_or_else(|_| "[]".to_string());
    match sqlx::query(
        "INSERT INTO business_mailboxes (id, domain, address, display_name, kind, aliases, active, source, created_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (domain, address) DO UPDATE SET
            id = $1,
            display_name = $4,
            kind = $5,
            aliases = $6,
            active = $7,
            source = $8,
            created_at = $9,
            last_used_at = $10",
    )
    .bind(&mailbox.id)
    .bind(&mailbox.domain)
    .bind(&mailbox.address)
    .bind(&mailbox.display_name)
    .bind(&mailbox.kind)
    .bind(&aliases)
    .bind(mailbox.active)
    .bind(&mailbox.source)
    .bind(&mailbox.created_at)
    .bind(&mailbox.last_used_at)
    .execute(&pool)
    .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({"success": true, "mailbox": mailbox})),
        ),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Insert Error: {}", err)})),
        ),
    }
}

pub async fn delete_business_mailbox(
    State(state): State<AppState>,
    Query(_query): Query<BusinessMailboxesQuery>,
    headers: HeaderMap,
    Json(payload): Json<DeleteBusinessMailboxRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };

    let domain = payload.domain.trim().to_lowercase();
    let address = payload.address.trim().to_lowercase();
    if !is_valid_domain(&domain) || !is_valid_email_address(&address) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "error": "Invalid mailbox domain or address."})),
        );
    }

    let pool = match get_tenant_pool(&db_url).await {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_mailboxes_table(&pool).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    match sqlx::query("DELETE FROM business_mailboxes WHERE domain = $1 AND address = $2")
        .bind(&domain)
        .bind(&address)
        .execute(&pool)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(json!({"success": true}))),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Delete Error: {}", err)})),
        ),
    }
}

pub async fn get_business_emails(
    State(state): State<AppState>,
    Query(_query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };

    read_business_emails(&db_url).await
}

pub async fn query_business_emails(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(_payload): Json<BusinessEmailsRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };

    read_business_emails(&db_url).await
}

pub async fn save_business_email(
    State(state): State<AppState>,
    Query(_query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
    Json(payload): Json<SaveBusinessEmailRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
    };

    save_business_email_with_db(&db_url, payload.email).await
}

async fn save_business_email_with_db(
    db_url: &str,
    email: BusinessEmail,
) -> (StatusCode, Json<Value>) {
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

    let e = email;
    let recipients_str = serde_json::to_string(&e.to).unwrap_or_else(|_| "[]".to_string());

    match sqlx::query(
        "INSERT INTO business_emails (id, sender, sender_name, recipients, subject, body, html_body, folder, created_at, is_read, is_starred, has_attachment, in_reply_to, thread_id, message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
            sender = $2,
            sender_name = $3,
            recipients = $4,
            subject = $5,
            body = $6,
            html_body = $7,
            folder = $8,
            created_at = $9,
            is_read = $10,
            is_starred = $11,
            has_attachment = $12,
            in_reply_to = $13,
            thread_id = $14,
            message_id = $15"
    )
    .bind(&e.id)
    .bind(&e.from)
    .bind(&e.from_name)
    .bind(&recipients_str)
    .bind(&e.subject)
    .bind(&e.body)
    .bind(&e.html_body)
    .bind(&e.folder)
    .bind(&e.date)
    .bind(e.read)
    .bind(e.starred)
    .bind(e.has_attachment)
    .bind(&e.in_reply_to)
    .bind(&e.thread_id)
    .bind(&e.message_id)
    .execute(&pool)
    .await {
        Ok(_) => (StatusCode::OK, Json(json!({"success": true}))),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"success": false, "error": format!("Insert Error: {}", err)}))),
    }
}

pub async fn delete_business_email(
    State(state): State<AppState>,
    Query(_query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
    Json(payload): Json<DeleteBusinessEmailRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match authorized_business_db_url(&state, &headers).await {
        Ok(url) => url,
        Err(response) => return response,
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

    match sqlx::query("DELETE FROM business_emails WHERE id = $1")
        .bind(&payload.id)
        .execute(&pool)
        .await
    {
        Ok(_) => (StatusCode::OK, Json(json!({"success": true}))),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Delete Error: {}", err)})),
        ),
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
// The field names are the ones Razorpay itself uses in the checkout callback
// (razorpay_payment_id, razorpay_order_id, razorpay_signature). A camelCase
// rename here would reject the very payload the gateway sends back.
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

    if !verified {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "success": false,
                "message": "Payment signature verification failed."
            })),
        );
    }

    // 1. Fetch order details from Razorpay to get notes (plan, billing, email)
    let client = reqwest::Client::new();
    let order_url = format!("https://api.razorpay.com/v1/orders/{}", order_id);
    let order_res = client
        .get(&order_url)
        .basic_auth(
            &state.config.razorpay_key_id,
            Some(&state.config.razorpay_key_secret),
        )
        .send()
        .await;

    let mut plan = String::new();
    let mut billing = String::new();
    let mut email = String::new();

    match order_res {
        Ok(res) if res.status().is_success() => {
            if let Ok(order_data) = res.json::<serde_json::Value>().await {
                if let Some(notes) = order_data.get("notes") {
                    plan = notes
                        .get("plan")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    billing = notes
                        .get("billing")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    email = notes
                        .get("email")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
        _ => {
            tracing::error!("Failed to fetch Razorpay order details for verification");
        }
    }

    if plan.is_empty() || email.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Missing order details (plan or email) from Razorpay."
            })),
        );
    }

    // 2. Calculate subscription timers
    let now = chrono::Utc::now();
    let expires_at = if billing.eq_ignore_ascii_case("annual") {
        now + chrono::Months::new(12)
    } else {
        now + chrono::Months::new(1)
    };

    let settings_update = json!({
        "plan": plan,
        "billingCycle": billing,
        "paidPlanPurchasedAt": now.to_rfc3339(),
        "paidPlanExpiresAt": expires_at.to_rfc3339(),
        "subscriptionStatus": "active"
    });

    let settings_json =
        serde_json::to_string(&settings_update).unwrap_or_else(|_| "{}".to_string());

    // 3. Update user settings in the database based on the email from the order
    let Some(db_pool) = state.db.as_ref() else {
        tracing::error!("Database connection pool not available in api-gateway state");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Internal server error: Database not connected."
            })),
        );
    };

    let update_result = sqlx::query(
        "UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE email = $2"
    )
    .bind(&settings_json)
    .bind(&email)
    .execute(db_pool)
    .await;

    if let Err(e) = update_result {
        tracing::error!("Failed to update user subscription settings: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Failed to update subscription in database."
            })),
        );
    }

    // 4. Keep tenant plan and billing ledger in sync. The invoice insert is
    // idempotent on (gateway, payment_ref) so a retried verification cannot
    // double-charge the revenue ledger.
    let tenant_id: Option<uuid::Uuid> =
        sqlx::query_scalar("SELECT tenant_id FROM users WHERE email = $1 LIMIT 1")
            .bind(&email)
            .fetch_optional(db_pool)
            .await
            .ok()
            .flatten()
            .flatten();
    if let Some(tenant_id) = tenant_id {
        let plan_key = plan.trim().to_lowercase();
        let _ = sqlx::query(
            "UPDATE tenants SET plan_tier = $2,
                billing_info = COALESCE(billing_info, '{}'::jsonb)
                    || jsonb_build_object('billingCycle', $3, 'lastPaymentAt', NOW()),
                updated_at = NOW()
             WHERE id = $1",
        )
        .bind(tenant_id)
        .bind(&plan_key)
        .bind(&billing)
        .execute(db_pool)
        .await;

        let already_recorded: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM company_invoices WHERE gateway = 'razorpay' AND payment_ref = $1)",
        )
        .bind(payment_id)
        .fetch_one(db_pool)
        .await
        .unwrap_or(false);
        if !already_recorded {
            let amount_paise =
                expected_subscription_amount_paise(&plan_key, &billing).unwrap_or(0) as i64;
            let invoice_number = format!(
                "VM-{}-{}",
                now.format("%Y%m"),
                uuid::Uuid::new_v4().simple().to_string()[..8].to_uppercase()
            );
            let line_items = json!([{
                "description": format!("{} plan ({})", plan_key, billing),
                "amountPaise": amount_paise
            }]);
            let invoice_result = sqlx::query(
                "INSERT INTO company_invoices
                 (tenant_id, invoice_number, plan, billing_cycle, amount_paise, currency, status,
                  issued_at, paid_at, gateway, payment_ref, line_items)
                 VALUES ($1,$2,$3,$4,$5,'INR','paid',$6,$6,'razorpay',$7,$8)",
            )
            .bind(tenant_id)
            .bind(&invoice_number)
            .bind(&plan_key)
            .bind(&billing)
            .bind(amount_paise)
            .bind(now)
            .bind(payment_id)
            .bind(&line_items)
            .execute(db_pool)
            .await;
            if let Err(err) = invoice_result {
                tracing::error!("Failed to record subscription invoice: {}", err);
            } else {
                let _ = sqlx::query(
                    "INSERT INTO platform_audit_logs
                     (actor_email, actor_role, action, category, resource_type, resource_id, tenant_id, details, severity)
                     VALUES ($1, 'owner', 'billing.payment_captured', 'billing', 'invoice', $2, $3, $4, 'info')",
                )
                .bind(&email)
                .bind(&invoice_number)
                .bind(tenant_id)
                .bind(json!({
                    "plan": plan_key,
                    "billing": billing,
                    "amountPaise": amount_paise,
                    "paymentId": payment_id,
                    "orderId": order_id
                }))
                .execute(db_pool)
                .await;
            }
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "paymentId": payment_id,
            "orderId": order_id
        })),
    )
}
