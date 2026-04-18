//! Mail service middleware

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tower::{
    limit::RateLimitLayer,
};
use tower_http::cors::CorsLayer;

/// Authentication middleware
pub async fn auth_layer(
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let auth_str = auth_header
        .to_str()
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !auth_str.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // In production: validate JWT and extract user context

    Ok(next.run(request).await)
}

/// CORS layer
pub fn cors_layer() -> CorsLayer {
    CorsLayer::permissive()
}

/// Rate limiting
pub fn rate_limit_layer() -> RateLimitLayer {
    RateLimitLayer::new(100, Duration::from_secs(60))
}
