#![allow(dead_code)]
//! Auth service middleware

use crate::state::AuthState;
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
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

    request.extensions_mut().insert(claims);

    Ok(next.run(request).await)
}
