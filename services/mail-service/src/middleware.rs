// Mail service middleware shared by current and upcoming routes.
#![allow(dead_code)]
//! Mail service middleware

use axum::{
    extract::Request,
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tower::limit::RateLimitLayer;
use tower_http::cors::{AllowOrigin, CorsLayer};

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
    let configured = std::env::var("FRONTEND_URL")
        .unwrap_or_else(|_| "https://velismail.online,http://localhost:5173,http://127.0.0.1:5173".to_string());

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

/// Rate limiting
pub fn rate_limit_layer() -> RateLimitLayer {
    RateLimitLayer::new(100, Duration::from_secs(60))
}
