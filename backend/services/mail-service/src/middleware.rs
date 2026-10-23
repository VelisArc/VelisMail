//! Mail service middleware

use crate::state::MailState;
use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};

/// Authentication middleware.
///
/// The service binds to loopback and is normally reached through the gateway,
/// but it still validates the JWT locally so a misconfigured proxy or a local
/// process cannot impersonate a user. Only health checks are exempt. The
/// signed provider webhook is handled by the gateway.
pub async fn auth_layer(
    State(state): State<MailState>,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let path = request.uri().path();
    if matches!(path, "/health" | "/ready") {
        return Ok(next.run(request).await);
    }

    let mut request = request;
    let claims = velismail_common::validate_bearer(request.headers(), &state.config.jwt_secret)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Signature validity is not enough after a suspension or a workspace
    // shutdown; the account row is authoritative. A workspace API key is
    // exchanged by the gateway for a short-lived service token whose subject
    // is the tenant, so only the tenant state applies there.
    let is_api_key_session = claims.jti.starts_with("api-key:");
    let allowed: bool = if is_api_key_session {
        sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM tenants
                 WHERE id = $1 AND deleted_at IS NULL AND status = 'active'
             )",
        )
        .bind(uuid::Uuid::parse_str(claims.tenant_id.trim()).unwrap_or(uuid::Uuid::nil()))
        .fetch_one(&state.db)
        .await
    } else {
        sqlx::query_scalar(
            "SELECT EXISTS(
                 SELECT 1 FROM users u
                 JOIN tenants t ON t.id = u.tenant_id AND t.deleted_at IS NULL
                 WHERE u.id = $1 AND u.status = 'active' AND t.status = 'active'
             )",
        )
        .bind(claims.sub.0)
        .fetch_one(&state.db)
        .await
    }
    .map_err(|err| {
        tracing::error!("mail account status lookup failed: {}", err);
        StatusCode::SERVICE_UNAVAILABLE
    })?;
    if !allowed {
        return Err(StatusCode::FORBIDDEN);
    }

    request.extensions_mut().insert(claims);

    Ok(next.run(request).await)
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
        .allow_headers([
            header::AUTHORIZATION,
            header::ACCEPT,
            header::CONTENT_TYPE,
            axum::http::HeaderName::from_static("x-request-id"),
        ])
        .allow_credentials(true)
        .max_age(Duration::from_secs(3600))
}
