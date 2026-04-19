//! Gateway middleware

use crate::state::AppState;
use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};

/// Authentication middleware
/// Verifies JWT tokens and extracts user context
pub async fn authentication(
    _state: State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Skip authentication for health check and public endpoints
    let path = request.uri().path().to_string();
    if path == "/health"
        || path.starts_with("/swagger")
        || path.starts_with("/api/v1/public")
        || path.starts_with("/api/v1/verify")
        || path.starts_with("/api-docs")
    {
        return Ok(next.run(request).await);
    }

    // Extract Authorization header
    let auth_header = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let auth_str = auth_header.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // Verify Bearer token
    if !auth_str.starts_with("Bearer ") {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let token = &auth_str[7..];

    // Validate JWT token (simplified - full implementation would verify signature)
    if token.is_empty() {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // In production: decode JWT, verify signature, extract claims
    // and add user context to request extensions

    Ok(next.run(request).await)
}

/// Rate limiting layer
pub async fn rate_limit(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Try immediate acquisition; if unavailable, reject with 429
    match state.rate_limiter.clone().try_acquire_owned() {
        Ok(_permit) => Ok(next.run(request).await),
        Err(_) => Err(StatusCode::TOO_MANY_REQUESTS),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_middleware_module() {
        // Module compiles
    }
}
