//! Gateway middleware — request context, per-client rate limiting, metrics
//! and defence-in-depth security headers.

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::Row;
use sha2::{Digest, Sha256};
use std::net::SocketAddr;
use std::time::Instant;
use uuid::Uuid;
use velismail_common::traffic::{client_ip, RateLimitDecision};

/// Read the bearer token of a request.
fn bearer_token(headers: &axum::http::HeaderMap) -> Option<String> {
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

/// End-to-end request middleware.
///
/// 1. Derives the real client IP using trusted-proxy rules.
/// 2. Generates/propagates a sanitized request id.
/// 3. Applies a per-client rate limit (stricter for auth routes).
/// 4. Records Prometheus counters and one structured access-log line.
pub async fn traffic(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_string();

    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip());
    let ip = client_ip(request.headers(), peer);

    let request_id = request
        .headers()
        .get("x-request-id")
        .or_else(|| request.headers().get("x-correlation-id"))
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
        })
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        request.headers_mut().insert(
            axum::http::header::HeaderName::from_static("x-request-id"),
            value,
        );
    }
    request.extensions_mut().insert(request_id.clone());

    state.metrics.observe_request();

    let is_health = matches!(
        path.as_str(),
        "/health" | "/health/live" | "/health/ready" | "/ready"
    );
    let is_auth = path.starts_with("/api/v1/auth") || path.starts_with("/v1/auth");
    let decision = if is_health || method == Method::OPTIONS {
        None
    } else {
        let limiter = if is_auth {
            &state.auth_rate_limiter
        } else {
            &state.rate_limiter
        };
        Some(limiter.check(&ip.to_string()))
    };

    if let Some(decision) = decision {
        if !decision.allowed {
            state
                .metrics
                .rate_limited_total
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            let mut response = (
                StatusCode::TOO_MANY_REQUESTS,
                axum::Json(json!({
                    "success": false,
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": "Too many requests. Please retry later."
                    },
                    "request_id": request_id,
                })),
            )
                .into_response();
            apply_rate_limit_headers(response.headers_mut(), decision);
            if let Ok(value) = HeaderValue::from_str(&decision.retry_after_seconds.to_string()) {
                response
                    .headers_mut()
                    .insert(axum::http::header::RETRY_AFTER, value);
            }
            attach_request_id(&mut response, &request_id);
            log_request(
                &request_id,
                ip,
                &method,
                &path,
                response.status(),
                started.elapsed(),
                true,
            );
            state
                .metrics
                .observe_response(response.status().as_u16(), started.elapsed());
            state.traffic.record_rate_limited();
            state
                .traffic
                .record(response.status().as_u16(), started.elapsed());
            return response;
        }

        // Attach the successful quota decision to the response below.
        let mut response = next.run(request).await;
        apply_rate_limit_headers(response.headers_mut(), decision);
        attach_request_id(&mut response, &request_id);
        log_request(
            &request_id,
            ip,
            &method,
            &path,
            response.status(),
            started.elapsed(),
            false,
        );
        state
            .metrics
            .observe_response(response.status().as_u16(), started.elapsed());
        state
            .traffic
            .record(response.status().as_u16(), started.elapsed());
        return response;
    }

    let mut response = next.run(request).await;
    attach_request_id(&mut response, &request_id);
    log_request(
        &request_id,
        ip,
        &method,
        &path,
        response.status(),
        started.elapsed(),
        false,
    );
    state
        .metrics
        .observe_response(response.status().as_u16(), started.elapsed());
    state
        .traffic
        .record(response.status().as_u16(), started.elapsed());
    response
}

fn apply_rate_limit_headers(headers: &mut axum::http::HeaderMap, decision: RateLimitDecision) {
    if let Ok(value) = HeaderValue::from_str(&decision.limit.to_string()) {
        headers.insert(
            axum::http::header::HeaderName::from_static("x-ratelimit-limit"),
            value,
        );
    }
    if let Ok(value) = HeaderValue::from_str(&decision.remaining.to_string()) {
        headers.insert(
            axum::http::header::HeaderName::from_static("x-ratelimit-remaining"),
            value,
        );
    }
    if let Ok(value) = HeaderValue::from_str(&format!("{};w=60", decision.limit)) {
        headers.insert(
            axum::http::header::HeaderName::from_static("x-ratelimit-policy"),
            value,
        );
    }
}

fn attach_request_id(response: &mut Response, request_id: &str) {
    if let Ok(value) = HeaderValue::from_str(request_id) {
        response.headers_mut().insert(
            axum::http::header::HeaderName::from_static("x-request-id"),
            value.clone(),
        );
        response.headers_mut().insert(
            axum::http::header::HeaderName::from_static("x-correlation-id"),
            value,
        );
    }
}

#[allow(clippy::too_many_arguments)]
fn log_request(
    request_id: &str,
    ip: std::net::IpAddr,
    method: &Method,
    path: &str,
    status: StatusCode,
    duration: std::time::Duration,
    rate_limited: bool,
) {
    tracing::info!(
        request_id = %request_id,
        client_ip = %ip,
        method = %method,
        path = %path,
        status = %status.as_u16(),
        duration_ms = %duration.as_millis(),
        rate_limited,
        "HTTP request"
    );
}

/// Authentication middleware for gateway-owned API routes.
///
/// Public endpoints (auth proxy, signed webhooks, invite acceptance, pricing
/// lookups and the WebSocket handshake) are explicitly allow-listed. Every
/// other `/api/v1` route requires a valid JWT signed by the auth service.
pub async fn require_auth(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let raw_path = request.uri().path();
    // `require_auth` is layered onto the API router before it is nested under
    // `/api/v1`, so the URI it sees is already stripped (`/auth/login`). Also
    // accept the full path when the layer is reused outside a nested router.
    let path = raw_path
        .strip_prefix("/api/v1")
        .or_else(|| raw_path.strip_prefix("/v1"))
        .unwrap_or(raw_path);
    let is_public = path.starts_with("/auth")
        || path == "/verify/providers"
        || path == "/config/public"
        || path == "/mail/inbound"
        || path == "/team/invites/validate"
        || path == "/team/invites/complete"
        || path == "/payments/create-order"
        || path == "/payments/verify"
        || path == "/ws";

    if is_public || request.method() == Method::OPTIONS {
        return next.run(request).await;
    }

    let Some(secret) = state.config.jwt_secret.as_deref() else {
        tracing::error!("JWT_SECRET is not configured; refusing protected gateway request");
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "Authentication is not configured on this server.",
        );
    };

    // Workspace API keys authenticate on their own. A key is bound to exactly
    // one company and carries the scopes the customer granted, so an
    // automation or an assistant can run the workspace without a user
    // session - and never without the permissions the key was issued with.
    if let Some(token) = bearer_token(request.headers()) {
        if token.starts_with(API_KEY_PREFIX) {
            let owned_path = path.to_string();
            return authorize_api_key(&state, request, next, &owned_path, &token).await;
        }
    }

    match velismail_common::validate_bearer(request.headers(), secret) {
        Ok(claims) => {
            request.extensions_mut().insert(claims);
            next.run(request).await
        }
        Err(_) => error_response(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "A valid bearer token is required for this endpoint.",
        ),
    }
}

/// Prefix of every workspace API key.
pub const API_KEY_PREFIX: &str = "vsk_live_";

/// The scope a workspace route needs. `None` means the route is not part of
/// the key driven workspace API.
fn required_scope(method: &Method, path: &str) -> Option<&'static str> {
    let route = path.strip_prefix("/company").unwrap_or(path);
    match (method.as_str(), route) {
        ("GET", "/team") => Some("team.read"),
        ("POST", "/team/invitations") => Some("team.write"),
        ("DELETE", p) if p.starts_with("/team/invitations") => Some("team.write"),
        ("GET", "/domains") => Some("domains.read"),
        ("POST", "/domains") => Some("domains.write"),
        ("GET", "/mailboxes") => Some("mailboxes.read"),
        ("POST", "/mailboxes") => Some("mailboxes.write"),
        ("DELETE", "/mailboxes") => Some("mailboxes.write"),
        ("GET", "/queue") => Some("mail.read"),
        ("GET", "/audit") => Some("audit.read"),
        ("GET", "/templates") => Some("templates.read"),
        ("POST", "/templates") => Some("templates.write"),
        ("DELETE", p) if p.starts_with("/templates") => Some("templates.write"),
        ("GET", "/contacts") => Some("contacts.read"),
        ("POST", "/contacts") => Some("contacts.write"),
        ("DELETE", p) if p.starts_with("/contacts") => Some("contacts.write"),
        ("GET", "/signatures") => Some("signatures.read"),
        ("POST", "/signatures") => Some("signatures.write"),
        ("DELETE", p) if p.starts_with("/signatures") => Some("signatures.write"),
        _ => None,
    }
}

/// Authenticate a workspace API key and enforce its scopes.
async fn authorize_api_key(
    state: &AppState,
    mut request: Request<Body>,
    next: Next,
    path: &str,
    token: &str,
) -> Response {
    let Some(db) = state.db.as_ref() else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "The workspace database is not connected.",
        );
    };

    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let record = sqlx::query(
        "SELECT id, tenant_id, scopes, created_by, revoked_at, expires_at
         FROM company_api_keys WHERE key_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let Some(record) = record else {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "This API key is not valid.",
        );
    };

    let revoked_at: Option<DateTime<Utc>> = record.try_get("revoked_at").ok().flatten();
    let expires_at: Option<DateTime<Utc>> = record.try_get("expires_at").ok().flatten();
    if revoked_at.is_some() {
        return error_response(
            StatusCode::UNAUTHORIZED,
            "UNAUTHORIZED",
            "This API key was revoked.",
        );
    }
    if let Some(expires_at) = expires_at {
        if expires_at <= Utc::now() {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This API key has expired.",
            );
        }
    }

    let scopes: Vec<String> = record.try_get("scopes").unwrap_or_default();
    if let Some(required) = required_scope(request.method(), path) {
        let allowed = scopes.iter().any(|scope| scope == "*" || scope == "admin.full" || scope == required);
        if !allowed {
            return error_response(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                &format!("This API key is missing the {} scope.", required),
            );
        }
    }

    let tenant_id: Uuid = record.try_get("tenant_id").unwrap_or_else(|_| Uuid::nil());
    let created_by: String = record.try_get("created_by").unwrap_or_default();
    let key_id: Uuid = record.try_get("id").unwrap_or_else(|_| Uuid::nil());

    let claims = velismail_common::Claims {
        sub: velismail_common::types::UserId(tenant_id),
        tenant_id: tenant_id.to_string(),
        email: created_by,
        iat: (Utc::now().timestamp()),
        exp: (Utc::now() + chrono::Duration::hours(1)).timestamp(),
        nbf: Utc::now().timestamp(),
        jti: format!("api-key:{}", key_id),
        role: velismail_common::UserRole::User,
        mfa_verified: false,
        device_id: format!("api-key:{}", key_id),
        security_level: velismail_common::SecurityLevel::Standard,
        firebase_uid: None,
    };
    request.extensions_mut().insert(claims);
    next.run(request).await
}

fn error_response(status: StatusCode, code: &str, message: &str) -> Response {
    (
        status,
        axum::Json(json!({
            "success": false,
            "error": { "code": code, "message": message }
        })),
    )
        .into_response()
}

/// Reject requests once the configured number of in-flight requests is
/// reached. This is the last line of defence against memory exhaustion.
pub async fn concurrency_limit(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    let permit = match state.request_slots.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            state
                .metrics
                .overload_total
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            state.traffic.record_overload();
            tracing::warn!(
                limit = state.config.max_concurrent_requests,
                "Gateway concurrency limit reached"
            );
            let mut response = error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "SERVER_OVERLOADED",
                "The server is handling too many requests. Please retry shortly.",
            );
            response.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                HeaderValue::from_static("1"),
            );
            return response;
        }
    };

    let response = next.run(request).await;
    drop(permit);
    response
}

/// Security headers middleware (shared with internal services).
pub async fn security_headers(request: Request<Body>, next: Next) -> Response {
    velismail_common::middleware::security_headers(request, next).await
}
