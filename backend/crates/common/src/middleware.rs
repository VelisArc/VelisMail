//! Shared middlewares for VelisMail microservices

use crate::error::CORRELATION_ID;
use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};
use std::time::Duration;
use tracing::info;
use uuid::Uuid;

/// Request-ID & Correlation-ID middleware.
///
/// Automatically retrieves or generates an request ID, binds it to the
/// task-local `CORRELATION_ID` scope, and attaches it to response headers.
pub async fn request_id_middleware(mut req: Request, next: Next) -> Response {
    let request_id = req
        .headers()
        .get("x-request-id")
        .or_else(|| req.headers().get("x-correlation-id"))
        .and_then(|h| h.to_str().ok())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
        })
        .map(|s| s.to_string())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    req.extensions_mut().insert(request_id.clone());

    let req_id_clone = request_id.clone();
    let mut response = CORRELATION_ID.scope(request_id, next.run(req)).await;

    if let Ok(hv) = HeaderValue::from_str(&req_id_clone) {
        response.headers_mut().insert(
            axum::http::header::HeaderName::from_static("x-request-id"),
            hv.clone(),
        );
        response.headers_mut().insert(
            axum::http::header::HeaderName::from_static("x-correlation-id"),
            hv,
        );
    }

    response
}

/// Structured Logging middleware.
///
/// Log details of incoming HTTP requests: method, URI, duration, and status code.
pub async fn logging_middleware(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let start = std::time::Instant::now();

    // Extract request ID if present
    let request_id = req
        .extensions()
        .get::<String>()
        .cloned()
        .unwrap_or_default();

    let response = next.run(req).await;

    let duration = start.elapsed();
    let status = response.status();

    info!(
        request_id = %request_id,
        method = %method,
        uri = %uri.path(),
        status = %status.as_u16(),
        duration_ms = %duration.as_millis(),
        "HTTP request"
    );

    response
}

/// Request Timeout middleware.
///
/// Caps request processing time to 30 seconds.
pub async fn timeout_middleware(req: Request, next: Next) -> Result<Response, StatusCode> {
    match tokio::time::timeout(Duration::from_secs(30), next.run(req)).await {
        Ok(res) => Ok(res),
        Err(_) => Err(StatusCode::GATEWAY_TIMEOUT),
    }
}

/// Apply defence-in-depth HTTP security headers to every response.
pub async fn security_headers(req: Request, next: Next) -> Response {
    let is_docs = {
        let path = req.uri().path();
        path.starts_with("/swagger") || path.starts_with("/api-docs")
    };
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    let values = [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "strict-origin-when-cross-origin"),
        (
            "permissions-policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        ),
        (
            "strict-transport-security",
            "max-age=31536000; includeSubDomains",
        ),
    ];

    for (name, value) in values {
        headers.insert(
            axum::http::HeaderName::from_static(name),
            HeaderValue::from_static(value),
        );
    }

    // The API returns JSON, so a deny-all CSP is safe. Swagger UI needs its
    // own scripts/styles, so only relax the policy for the docs routes.
    let csp = if is_docs {
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
    } else {
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    };
    headers.insert(
        axum::http::HeaderName::from_static("content-security-policy"),
        HeaderValue::from_static(csp),
    );
    headers.remove(axum::http::header::SERVER);

    response
}
