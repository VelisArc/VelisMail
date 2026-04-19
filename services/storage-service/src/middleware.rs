//! Storage middleware

use axum::{extract::Request, http::StatusCode, middleware::Next, response::Response};
use tower_http::cors::CorsLayer;
use tower_http::limit::RequestBodyLimitLayer;

/// Authentication middleware
pub async fn auth_layer(request: Request, next: Next) -> Result<Response, StatusCode> {
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    if !auth_str.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}

/// CORS layer
pub fn cors_layer() -> CorsLayer {
    CorsLayer::permissive()
}

/// Request body size limit (50MB)
pub fn body_limit_layer() -> RequestBodyLimitLayer {
    RequestBodyLimitLayer::new(50 * 1024 * 1024)
}
