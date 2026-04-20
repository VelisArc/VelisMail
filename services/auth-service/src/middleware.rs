//! Auth service middleware

use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
use std::time::Duration;
use tower::limit::RateLimitLayer;
use tower_http::cors::CorsLayer;

/// Rate limiting layer
pub fn rate_limit_layer() -> RateLimitLayer {
    RateLimitLayer::new(60, Duration::from_secs(60))
}

/// CORS layer
pub fn cors_layer() -> CorsLayer {
    CorsLayer::permissive()
}

/// Authentication middleware for protected routes
pub async fn require_auth(request: Request, next: Next) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !auth_str.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let _token = &auth_str[7..];

    // In production: validate JWT here

    Ok(next.run(request).await)
}
