//! Gateway middleware — rate limiting and security headers

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

/// Authentication middleware (placeholder — downstream services handle JWT)
/// Verifies JWT tokens and extracts user context
#[allow(dead_code)]
pub async fn authentication(
    _state: State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Skip authentication for health check and public endpoints
    let path = request.uri().path().to_string();
    if path == "/health"
        || path.starts_with("/swagger")
        || path.starts_with("/api/v1/public")
        || path.starts_with("/api/v1/verify")
        || path.starts_with("/api/v1/auth")
        || path.starts_with("/api-docs")
    {
        return Ok(next.run(request).await);
    }

    // Extract Authorization header
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Verify Bearer token
    if !auth_str.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_str[7..];

    // Reject empty tokens
    if token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // In production: decode JWT, verify signature, extract claims
    // and add user context to request extensions

    Ok(next.run(request).await)
}

/// Rate limiting layer — uses semaphore-based permits refilled per minute
pub async fn rate_limit(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Try immediate acquisition; if unavailable, reject with 429
    match state.rate_limiter.clone().try_acquire_owned() {
        Ok(_permit) => Ok(next.run(request).await),
        Err(_) => Err(StatusCode::TOO_MANY_REQUESTS),
    }
}

/// Security headers middleware — adds defense-in-depth HTTP headers to all responses.
/// These headers mitigate XSS, clickjacking, MIME-sniffing, and info-disclosure.
pub async fn security_headers(
    request: Request<Body>,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // Prevent MIME-type sniffing
    headers.insert(
        axum::http::header::X_CONTENT_TYPE_OPTIONS,
        "nosniff".parse().unwrap(),
    );
    // Prevent clickjacking
    headers.insert(
        axum::http::header::HeaderName::from_static("x-frame-options"),
        "DENY".parse().unwrap(),
    );
    // XSS protection for legacy browsers
    headers.insert(
        axum::http::header::HeaderName::from_static("x-xss-protection"),
        "1; mode=block".parse().unwrap(),
    );
    // Referrer policy — don't leak full URLs on cross-origin requests
    headers.insert(
        axum::http::header::HeaderName::from_static("referrer-policy"),
        "strict-origin-when-cross-origin".parse().unwrap(),
    );
    // Permissions policy — disable unnecessary browser features
    headers.insert(
        axum::http::header::HeaderName::from_static("permissions-policy"),
        "camera=(), microphone=(), geolocation=(), payment=()".parse().unwrap(),
    );
    // Remove server identity header
    headers.remove(axum::http::header::SERVER);

    response
}
