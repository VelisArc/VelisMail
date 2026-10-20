//! Tenant middleware

use crate::state::TenantState;
use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};
use velismail_common::UserRole;

pub async fn auth_layer(
    State(state): State<TenantState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path().to_string();
    if matches!(path.as_str(), "/health" | "/ready") {
        return Ok(next.run(request).await);
    }

    let mut request = request;
    let claims = velismail_common::validate_bearer(request.headers(), &state.config.jwt_secret)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Enforce tenant isolation for path-scoped resources. Platform super
    // admins may operate across tenants.
    if let Some(rest) = path.strip_prefix("/tenants/") {
        if let Some(requested_tenant) = rest.split('/').next() {
            if requested_tenant != claims.tenant_id && claims.role != UserRole::SuperAdmin {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

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
        .allow_headers([header::AUTHORIZATION, header::ACCEPT, header::CONTENT_TYPE])
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600))
}
