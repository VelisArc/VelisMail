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
use serde_json::json;
use std::net::SocketAddr;
use std::time::Instant;
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

/// Routes that a signed-in user (or key) may call before the workspace setup
/// is complete. Everything else waits for a verified domain, stored database
/// and provider credentials. This is enforced server-side so a stale or
/// modified browser cannot use an unfinished workspace.
fn setup_exempt(path: &str) -> bool {
    matches!(
        path,
        "/verify"
            | "/verify/providers"
            | "/config/public"
            | "/tenants/verify-domain"
            | "/company/businesses"
            | "/company/businesses/switch"
            | "/company/setup-state"
            | "/company/domains"
    ) || path.starts_with("/company/domains/")
        || path.starts_with("/payments/")
        || path.starts_with("/admin/platform/")
        || path.starts_with("/auth/")
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
    let is_public = path == "/auth"
        || path.starts_with("/auth/")
        || path == "/verify/providers"
        || path == "/config/public"
        || path == "/mail/inbound"
        || path == "/team/invites/validate"
        || path == "/team/invites/complete"
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
        // Platform keys run the control plane. They are refused on every
        // route that is not part of the platform API, so a key can never
        // reach an endpoint that was added later.
        if token.starts_with(crate::platform_api_keys::PLATFORM_API_KEY_PREFIX) {
            let owned_path = path.to_string();
            return authorize_platform_api_key(&state, request, next, &owned_path, &token).await;
        }
    }

    match velismail_common::validate_bearer(request.headers(), secret) {
        Ok(claims) => {
            // A valid signature is not enough: the account may have been
            // suspended or removed from its workspace since the token was
            // issued. Check the authoritative account row on every protected
            // gateway request. A tenant change (business switch) returns 401
            // so the client rotates the token and picks up the new tenant.
            if let Some(db) = state.db.as_ref() {
                let account = sqlx::query(
                    "SELECT u.status, u.tenant_id, t.status AS tenant_status,
                            (SELECT cm.status FROM company_members cm
                             WHERE cm.tenant_id = u.tenant_id
                               AND LOWER(cm.email) = LOWER(u.email)
                             ORDER BY CASE cm.status WHEN 'active' THEN 0 ELSE 1 END
                             LIMIT 1) AS membership_status
                     FROM users u
                     LEFT JOIN tenants t ON t.id = u.tenant_id AND t.deleted_at IS NULL
                     WHERE u.id = $1",
                )
                .bind(claims.sub.0)
                .fetch_optional(db)
                .await;
                match account {
                    Ok(Some(row)) => {
                        let status: String = sqlx::Row::try_get(&row, "status")
                            .unwrap_or_else(|_| "inactive".to_string());
                        if status != "active" {
                            return error_response(
                                StatusCode::FORBIDDEN,
                                "ACCOUNT_SUSPENDED",
                                "This account is suspended. Contact support.",
                            );
                        }
                        let current_tenant: Option<uuid::Uuid> =
                            sqlx::Row::try_get(&row, "tenant_id").ok().flatten();
                        if current_tenant.is_some() {
                            let tenant_status: Option<String> =
                                sqlx::Row::try_get(&row, "tenant_status").ok();
                            if !matches!(tenant_status.as_deref(), Some("active")) {
                                return error_response(
                                    StatusCode::FORBIDDEN,
                                    "WORKSPACE_UNAVAILABLE",
                                    "This workspace is not active. Contact support.",
                                );
                            }
                        }
                        // A removed or suspended membership ends the access
                        // immediately, even while an older access token is
                        // still within its lifetime. Platform control-plane
                        // paths are governed by platform_admins instead.
                        let membership_status: Option<String> =
                            sqlx::Row::try_get(&row, "membership_status").ok().flatten();
                        if !path.starts_with("/admin/platform")
                            && !path.starts_with("/platform")
                            && membership_status
                                .as_deref()
                                .is_some_and(|status| status != "active")
                        {
                            return error_response(
                                StatusCode::FORBIDDEN,
                                "MEMBERSHIP_INACTIVE",
                                "Your workspace membership is not active. Contact a company administrator.",
                            );
                        }
                        let token_tenant = uuid::Uuid::parse_str(claims.tenant_id.trim()).ok();
                        if let (Some(current), Some(token)) = (current_tenant, token_tenant) {
                            if current != token {
                                return error_response(
                                    StatusCode::UNAUTHORIZED,
                                    "STALE_SESSION",
                                    "The workspace changed. Refresh the session and retry.",
                                );
                            }
                        }
                        if !setup_exempt(path) {
                            if let Some(tenant) = current_tenant {
                                match crate::company_api::workspace_setup_state(db, tenant).await {
                                    Ok(setup) if setup.is_complete() => {}
                                    Ok(_) => return error_response(
                                        StatusCode::FORBIDDEN,
                                        "WORKSPACE_SETUP_INCOMPLETE",
                                        "Finish the workspace setup before using the dashboard.",
                                    ),
                                    Err(err) => {
                                        tracing::error!(
                                            "workspace setup lookup failed during auth: {}",
                                            err
                                        );
                                        return error_response(
                                            StatusCode::SERVICE_UNAVAILABLE,
                                            "SERVICE_UNAVAILABLE",
                                            "Unable to verify the workspace setup right now.",
                                        );
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => {
                        return error_response(
                            StatusCode::UNAUTHORIZED,
                            "UNAUTHORIZED",
                            "This account no longer exists.",
                        )
                    }
                    Err(err) => {
                        tracing::error!("account status lookup failed: {}", err);
                        return error_response(
                            StatusCode::SERVICE_UNAVAILABLE,
                            "SERVICE_UNAVAILABLE",
                            "Unable to verify the account right now.",
                        );
                    }
                }
            }
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
pub const API_KEY_PREFIX: &str = crate::api_keys::API_KEY_PREFIX;

/// Authenticate a workspace API key and enforce its scopes.
async fn authorize_api_key(
    state: &AppState,
    mut request: Request<Body>,
    next: Next,
    path: &str,
    token: &str,
) -> Response {
    let context = match crate::api_keys::resolve(state, token).await {
        Ok(context) => context,
        Err(crate::api_keys::ApiKeyError::Revoked) => {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This API key was revoked.",
            )
        }
        Err(crate::api_keys::ApiKeyError::Expired) => {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This API key has expired.",
            )
        }
        Err(crate::api_keys::ApiKeyError::Unavailable) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "SERVICE_UNAVAILABLE",
                "The workspace database is not connected.",
            )
        }
        Err(crate::api_keys::ApiKeyError::Unknown) => {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This API key is not valid.",
            )
        }
    };

    // A workspace key may only call the routes the scope table knows, and it
    // needs the scope of that route. A route that is not in the table is
    // refused, so a new endpoint is never reachable by accident.
    match crate::api_keys::required_scope(request.method().as_str(), path) {
        Some(required) => {
            if !context.allows(required) {
                return error_response(
                    StatusCode::FORBIDDEN,
                    "FORBIDDEN",
                    &format!("This API key is missing the {} scope.", required),
                );
            }
        }
        None => {
            return error_response(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "This API key cannot call this endpoint.",
            );
        }
    }

    if !setup_exempt(path) {
        if let Some(db) = state.db.as_ref() {
            match crate::company_api::workspace_setup_state(db, context.tenant_id).await {
                Ok(setup) if setup.is_complete() => {}
                Ok(_) => {
                    return error_response(
                        StatusCode::FORBIDDEN,
                        "WORKSPACE_SETUP_INCOMPLETE",
                        "Finish the workspace setup before using this API key.",
                    )
                }
                Err(err) => {
                    tracing::error!("workspace setup lookup failed for API key: {}", err);
                    return error_response(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "SERVICE_UNAVAILABLE",
                        "Unable to verify the workspace setup right now.",
                    );
                }
            }
        }
    }

    let now = chrono::Utc::now();
    let claims = velismail_common::Claims {
        sub: velismail_common::types::UserId(context.tenant_id),
        tenant_id: context.tenant_id.to_string(),
        email: context.created_by.clone(),
        iat: now.timestamp(),
        exp: (now + chrono::Duration::hours(1)).timestamp(),
        nbf: now.timestamp(),
        jti: format!("api-key:{}", context.key_id),
        role: velismail_common::UserRole::User,
        mfa_verified: false,
        device_id: format!("api-key:{}", context.key_id),
        security_level: velismail_common::SecurityLevel::Standard,
        firebase_uid: None,
    };
    request.extensions_mut().insert(claims);
    crate::api_keys::touch_last_used(state, context.key_id);
    next.run(request).await
}

/// Authenticate a platform API key and enforce its scopes.
///
/// A platform key runs the control plane. The scope of the route decides
/// whether the key may run it, and a route that is not part of the platform
/// API is refused: a key never falls back to "allowed because it is unknown".
/// The key is then exchanged for a short lived internal token that keeps its
/// creator, so every action is attributed in the audit trail.
async fn authorize_platform_api_key(
    state: &AppState,
    request: Request<Body>,
    next: Next,
    path: &str,
    token: &str,
) -> Response {
    let context = match crate::platform_api_keys::resolve(state, token).await {
        Ok(context) => context,
        Err(crate::platform_api_keys::PlatformKeyError::Revoked) => {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This platform API key was revoked.",
            )
        }
        Err(crate::platform_api_keys::PlatformKeyError::Expired) => {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This platform API key has expired.",
            )
        }
        Err(crate::platform_api_keys::PlatformKeyError::Unavailable) => {
            return error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                "SERVICE_UNAVAILABLE",
                "The control-plane database is not connected.",
            )
        }
        Err(crate::platform_api_keys::PlatformKeyError::Unknown) => {
            return error_response(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "This platform API key is not valid.",
            )
        }
    };

    let Some(required) = crate::platform_api_keys::required_scope(request.method().as_str(), path)
    else {
        return error_response(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            "A platform API key cannot call this endpoint.",
        );
    };
    if !context.allows(required) {
        return error_response(
            StatusCode::FORBIDDEN,
            "FORBIDDEN",
            &format!("This platform API key is missing the {required} scope."),
        );
    }

    let Some(secret) = state.config.jwt_secret.as_deref() else {
        return error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "JWT authentication is not configured on the gateway.",
        );
    };

    let now = chrono::Utc::now();
    let claims = velismail_common::Claims {
        sub: velismail_common::types::UserId(uuid::Uuid::nil()),
        tenant_id: String::new(),
        email: context.created_by.clone(),
        iat: now.timestamp(),
        exp: (now + chrono::Duration::minutes(15)).timestamp(),
        nbf: now.timestamp(),
        jti: format!("platform-key:{}", context.key_id),
        role: velismail_common::UserRole::User,
        mfa_verified: false,
        device_id: format!("platform-key:{}", context.key_id),
        security_level: velismail_common::SecurityLevel::Standard,
        firebase_uid: None,
    };

    let signed = match jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(secret.as_bytes()),
    ) {
        Ok(signed) => signed,
        Err(err) => {
            tracing::error!("platform API key session could not be signed: {}", err);
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_SERVER_ERROR",
                "Unable to create the platform session.",
            );
        }
    };
    let authorization = match HeaderValue::from_str(&format!("Bearer {signed}")) {
        Ok(value) => value,
        Err(_) => {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_SERVER_ERROR",
                "Unable to create the platform session.",
            )
        }
    };

    let (mut parts, body) = request.into_parts();
    parts
        .headers
        .insert(axum::http::header::AUTHORIZATION, authorization);
    let mut request = Request::from_parts(parts, body);
    request.extensions_mut().insert(claims);
    crate::platform_api_keys::touch_last_used(state, context.key_id);
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
