// cors_layer() and require_auth() are actively used.
//! Auth service middleware

use crate::state::AuthState;
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::net::SocketAddr;
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};
use velismail_common::traffic::client_ip;

/// Keyed rate limiter using governor keyed by the real client IP.
pub async fn rate_limit(State(state): State<AuthState>, request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if matches!(path, "/health" | "/ready") {
        return next.run(request).await;
    }

    let peer = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|info| info.0.ip());
    let ip = client_ip(request.headers(), peer);

    match state.rate_limiter.check_key(&ip) {
        Ok(_) => next.run(request).await,
        Err(_) => {
            tracing::warn!(client_ip = %ip, path = %path, "Auth rate limit exceeded");
            let mut response = (
                StatusCode::TOO_MANY_REQUESTS,
                Json(json!({
                    "success": false,
                    "error": {
                        "code": "RATE_LIMIT_EXCEEDED",
                        "message": "Too many authentication attempts. Please retry shortly."
                    }
                })),
            )
                .into_response();
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
            response
        }
    }
}

/// Request ID extraction/generation middleware.
pub async fn request_id(request: Request, next: Next) -> Response {
    velismail_common::middleware::request_id_middleware(request, next).await
}

/// CORS layer
pub fn cors_layer() -> CorsLayer {
    let configured = std::env::var("FRONTEND_URL").unwrap_or_else(|_| {
        "https://velismail.online,http://localhost:5173,http://127.0.0.1:5173".to_string()
    });

    let origins: Vec<HeaderValue> = configured
        .split(',')
        .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
        .collect();

    let allow_origin = if origins.is_empty() {
        AllowOrigin::exact(HeaderValue::from_static("https://velismail.online"))
    } else {
        AllowOrigin::list(origins)
    };

    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::PATCH,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::ACCEPT, header::CONTENT_TYPE])
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600))
}

/// Authentication middleware for protected routes
pub async fn require_auth(
    State(state): State<AuthState>,
    mut request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !auth_str.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_str[7..];

    let claims = state
        .jwt_manager
        .validate_token(token)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // A signed token remains valid after an account is suspended. Reject it
    // here so the status change takes effect immediately on every protected
    // auth endpoint (settings, sessions, password change, MFA setup).
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM users WHERE id = $1")
        .bind(claims.sub.0)
        .fetch_optional(&state.db)
        .await
        .map_err(|err| {
            tracing::error!("account status lookup failed during auth: {}", err);
            StatusCode::SERVICE_UNAVAILABLE
        })?;
    match status.as_deref() {
        Some("active") => {}
        Some(_) => return Err(StatusCode::FORBIDDEN),
        None => return Err(StatusCode::UNAUTHORIZED),
    }

    request.extensions_mut().insert(claims);

    Ok(next.run(request).await)
}
