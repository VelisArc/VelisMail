//! Tenant middleware

use crate::state::TenantState;
use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::Next,
    response::Response,
};
use sqlx::Row;
use std::time::Duration;
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;
use velismail_common::UserRole;

/// Extra authorization facts for the handlers.
#[derive(Debug, Clone, Copy)]
pub struct TenantActor {
    pub is_platform: bool,
}

async fn is_platform_admin(state: &TenantState, email: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM platform_admins
         WHERE LOWER(email) = LOWER($1) AND status = 'active')",
    )
    .bind(email)
    .fetch_one(&state.db)
    .await
    .unwrap_or(false)
}

async fn membership_role(
    state: &TenantState,
    tenant_id: Uuid,
    email: &str,
) -> Option<(String, String)> {
    let row = sqlx::query(
        "SELECT role, status FROM company_members
         WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()?;
    Some((
        row.try_get("role").unwrap_or_else(|_| "member".to_string()),
        row.try_get("status")
            .unwrap_or_else(|_| "removed".to_string()),
    ))
}

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

    let is_platform =
        claims.role == UserRole::SuperAdmin || is_platform_admin(&state, &claims.email).await;

    // POST /tenants mints a workspace. That is a platform operation; regular
    // accounts get their workspace from the auth service.
    if path == "/tenants" || path == "/tenants/" {
        if request.method() != Method::GET && !is_platform {
            return Err(StatusCode::FORBIDDEN);
        }
        request.extensions_mut().insert(TenantActor { is_platform });
        request.extensions_mut().insert(claims);
        return Ok(next.run(request).await);
    }

    // Enforce tenant isolation for path-scoped resources. Platform super
    // admins may operate across tenants.
    if let Some(rest) = path.strip_prefix("/tenants/") {
        let requested_tenant = rest.split('/').next().unwrap_or_default();
        let tenant_id = Uuid::parse_str(requested_tenant).map_err(|_| StatusCode::BAD_REQUEST)?;
        if !is_platform {
            if requested_tenant != claims.tenant_id.trim() {
                return Err(StatusCode::FORBIDDEN);
            }
            let Some((role, status)) = membership_role(&state, tenant_id, &claims.email).await
            else {
                return Err(StatusCode::FORBIDDEN);
            };
            if status != "active" {
                return Err(StatusCode::FORBIDDEN);
            }
            let mutating = !matches!(request.method(), &Method::GET | &Method::HEAD);
            if mutating && role != "owner" && role != "admin" {
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    request.extensions_mut().insert(TenantActor { is_platform });
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
