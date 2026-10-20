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
