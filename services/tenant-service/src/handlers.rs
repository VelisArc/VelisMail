//! Tenant handlers

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use sqlx::Row;
use tracing::info;
use uuid::Uuid;

use crate::models::{AddDomainRequest, CreateTenantRequest, UpdateTenantRequest};
use crate::service::TenantService;
use crate::state::TenantState;

pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "tenant-service",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

pub async fn create_tenant(
    State(state): State<TenantState>,
    Json(request): Json<CreateTenantRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());

    match service.create_tenant(request).await {
        Ok(tenant) => Ok(Json(json!({
            "success": true,
            "tenant": {
                "id": tenant.id,
                "organization_name": tenant.organization_name,
                "organization_email": tenant.organization_email,
                "plan_tier": tenant.plan_tier,
                "status": tenant.status,
                "created_at": tenant.created_at
            }
        }))),
        Err(err) => {
            info!("Failed to create tenant: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_tenant(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.get_tenant(tenant_id).await {
        Ok(Some(tenant)) => Ok(Json(json!({
            "success": true,
            "tenant": {
                "id": tenant.id,
                "organization_name": tenant.organization_name,
                "organization_email": tenant.organization_email,
                "plan_tier": tenant.plan_tier,
                "status": tenant.status,
                "settings": tenant.settings,
                "limits": tenant.limits,
                "created_at": tenant.created_at,
                "updated_at": tenant.updated_at
            }
        }))),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            info!("Failed to get tenant: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn update_tenant(
    State(state): State<TenantState>,
    Path(id): Path<String>,
    Json(request): Json<UpdateTenantRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.update_tenant(tenant_id, request).await {
        Ok(tenant) => Ok(Json(json!({
            "success": true,
            "tenant": {
                "id": tenant.id,
                "organization_name": tenant.organization_name,
                "organization_email": tenant.organization_email,
                "plan_tier": tenant.plan_tier,
                "status": tenant.status,
                "updated_at": tenant.updated_at
            }
        }))),
        Err(err) => {
            info!("Failed to update tenant: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_users(
    State(_state): State<TenantState>,
    Path(_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "users": [],
        "pagination": {"page": 1, "per_page": 50, "total": 0}
    })))
}

pub async fn list_domains(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    // Set tenant context
    if let Err(err) = service.set_tenant_context(tenant_id).await {
        info!("Failed to set tenant context: {}", err);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Fetch domains
    let domains = sqlx::query_as::<_, crate::models::CustomDomain>(
        "SELECT * FROM custom_domains WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| {
        info!("Failed to fetch domains: {}", err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(json!({
        "success": true,
        "domains": domains
    })))
}

pub async fn add_domain(
    State(state): State<TenantState>,
    Path(id): Path<String>,
    Json(request): Json<AddDomainRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.add_domain(tenant_id, request).await {
        Ok(domain) => Ok(Json(json!({
            "success": true,
            "domain": {
                "id": domain.id,
                "domain_name": domain.domain_name,
                "verification_status": domain.verification_status,
                "dns_records": domain.dns_records,
                "created_at": domain.created_at
            }
        }))),
        Err(err) => {
            info!("Failed to add domain: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn verify_domain(
    State(state): State<TenantState>,
    Path((id, domain)): Path<(String, String)>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    // Set tenant context
    if let Err(err) = service.set_tenant_context(tenant_id).await {
        info!("Failed to set tenant context: {}", err);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    let result = sqlx::query(
        "SELECT id FROM custom_domains WHERE tenant_id = $1 AND domain_name = $2",
    )
    .bind(tenant_id)
    .bind(&domain)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| {
        info!("Failed to verify domain: {}", err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.is_none() {
        return Err(StatusCode::NOT_FOUND);
    }

    let _ = service
        .log_audit(
            tenant_id,
            None,
            "domain_verification_requested",
            "domain",
            result.map(|row| row.get("id")),
            json!({"domain_name": domain}),
            None,
            None,
        )
        .await;

    Err(StatusCode::NOT_IMPLEMENTED)
}

pub async fn get_settings(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.get_tenant(tenant_id).await {
        Ok(Some(tenant)) => Ok(Json(json!({
            "success": true,
            "settings": tenant.settings,
            "limits": tenant.limits
        }))),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            info!("Failed to get tenant settings: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn update_settings(
    State(state): State<TenantState>,
    Path(id): Path<String>,
    Json(settings): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    let request = UpdateTenantRequest {
        organization_name: None,
        organization_email: None,
        plan_tier: None,
        status: None,
        settings: Some(settings),
        limits: None,
    };

    match service.update_tenant(tenant_id, request).await {
        Ok(_) => Ok(Json(
            json!({"success": true, "message": "Settings updated"}),
        )),
        Err(err) => {
            info!("Failed to update settings: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_billing(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.get_tenant(tenant_id).await {
        Ok(Some(tenant)) => Ok(Json(json!({
            "success": true,
            "billing": tenant.billing_info
        }))),
        Ok(None) => Err(StatusCode::NOT_FOUND),
        Err(err) => {
            info!("Failed to get billing info: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn get_audit_logs(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    // Set tenant context
    if let Err(err) = service.set_tenant_context(tenant_id).await {
        info!("Failed to set tenant context: {}", err);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Fetch audit logs
    let logs = sqlx::query_as::<_, crate::models::AuditLog>(
        "SELECT * FROM audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50",
    )
    .bind(tenant_id)
    .fetch_all(&state.db)
    .await
    .map_err(|err| {
        info!("Failed to fetch audit logs: {}", err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(json!({
        "success": true,
        "logs": logs,
        "pagination": {"page": 1, "per_page": 50, "total": logs.len()}
    })))
}

pub async fn get_stats(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.get_tenant_stats(tenant_id).await {
        Ok(stats) => Ok(Json(json!({
            "success": true,
            "stats": stats
        }))),
        Err(err) => {
            info!("Failed to get tenant stats: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn check_limits(
    State(state): State<TenantState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let service = TenantService::new(state.db.clone());
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(id) => id,
        Err(_) => return Err(StatusCode::BAD_REQUEST),
    };

    match service.check_resource_limits(tenant_id).await {
        Ok(Some(warning)) => Ok(Json(json!({
            "success": true,
            "within_limits": false,
            "warning": warning
        }))),
        Ok(None) => Ok(Json(json!({
            "success": true,
            "within_limits": true,
            "warning": null
        }))),
        Err(err) => {
            info!("Failed to check resource limits: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}
