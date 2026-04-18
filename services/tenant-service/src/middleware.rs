//! Tenant middleware

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use tower_http::cors::CorsLayer;

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

    Ok(next.run(request).await)
}

pub fn cors_layer() -> CorsLayer {
    CorsLayer::permissive()
}
