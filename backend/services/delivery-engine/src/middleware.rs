use crate::state::DeliveryState;
use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub async fn auth_layer(
    State(state): State<DeliveryState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();
    if matches!(path, "/health" | "/ready") {
        return Ok(next.run(request).await);
    }

    let mut request = request;
    let claims = velismail_common::validate_bearer(request.headers(), &state.config.jwt_secret)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    request.extensions_mut().insert(claims);
    Ok(next.run(request).await)
}

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
        .allow_headers([
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-request-id"),
        ])
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600))
}
