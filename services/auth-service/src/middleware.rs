// cors_layer() and require_auth() are actively used.
//! Auth service middleware

use crate::state::AuthState;
use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Clone-safe token-bucket style limiter for axum middleware.
pub async fn rate_limit(
    State(state): State<AuthState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    match state.rate_limiter.clone().try_acquire_owned() {
        Ok(_permit) => Ok(next.run(request).await),
        Err(_) => Err(StatusCode::TOO_MANY_REQUESTS),
    }
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

    request.extensions_mut().insert(claims);

    Ok(next.run(request).await)
}
