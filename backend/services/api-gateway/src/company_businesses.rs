//! Business (workspace) management for the company console.
//!
//! A single account can run more than one business. Every business is a
//! separate tenant inside the same storage, with its own domain, mailboxes,
//! team and settings, and the account switches between them the same way it
//! switches between the workspace and the platform control plane.
//!
//! A new business is created with a complete setup - the domain with its DNS
//! verification records, the sending mailboxes and the owner membership - and
//! it sends through the same mail provider key as every other business.

use crate::company_api::{db_pool, fail, ok, workspace_context, ApiResult};
use crate::state::AppState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBusinessRequest {
    /// The trading name of the business.
    pub name: String,
    /// The business domain, for example acme.com.
    pub domain: String,
    /// Optional plan for the new business.
    #[serde(default)]
    pub plan: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchBusinessRequest {
    pub business_id: String,
}

/// One business the account belongs to.
fn business_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.try_get::<Uuid, _>("id").unwrap_or_default().to_string(),
        "name": row.try_get::<String, _>("organization_name").unwrap_or_default(),
        "email": row.try_get::<String, _>("organization_email").unwrap_or_default(),
        "plan": row.try_get::<String, _>("plan_tier").unwrap_or_default(),
        "status": row.try_get::<String, _>("status").unwrap_or_default(),
        "role": row.try_get::<String, _>("role").unwrap_or_default(),
        "primaryDomain": row.try_get::<Option<String>, _>("primary_domain").ok().flatten(),
        "members": row.try_get::<i64, _>("members").unwrap_or(0),
        "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at")
            .ok()
            .flatten()
            .map(|value| value.to_rfc3339())
            .unwrap_or_default(),
    })
}

/// Every business the account is a member of.
pub async fn list_businesses(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT t.id, t.organization_name, t.organization_email, t.plan_tier, t.status,
                COALESCE(cm.role, 'owner') AS role,
                (SELECT cd.domain_name FROM custom_domains cd
                  WHERE cd.tenant_id = t.id ORDER BY cd.created_at ASC LIMIT 1) AS primary_domain,
                (SELECT COUNT(*)::bigint FROM company_members m
                  WHERE m.tenant_id = t.id AND m.status = 'active') AS members,
                t.created_at
         FROM tenants t
         LEFT JOIN company_members cm ON cm.tenant_id = t.id AND LOWER(cm.email) = LOWER($1)
         WHERE t.deleted_at IS NULL
           AND (cm.email IS NOT NULL
                OR t.id = (SELECT u.tenant_id FROM users u WHERE LOWER(u.email) = LOWER($1)))
         ORDER BY (t.id = $2) DESC, t.created_at ASC",
    )
    .bind(&context.email)
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let businesses: Vec<Value> = rows.iter().map(business_json).collect();
    ok(json!({
        "success": true,
        "businesses": businesses,
        "activeBusinessId": context.tenant_id.to_string(),
    }))
}

/// Make another business the active one.
pub async fn switch_business(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SwitchBusinessRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let business_id = match Uuid::parse_str(payload.business_id.trim()) {
        Ok(value) => value,
        Err(_) => return Err(fail(StatusCode::BAD_REQUEST, "Invalid business id.")),
    };

    // Only a business the account is an active member of can be opened.
    let member: Option<String> = sqlx::query_scalar(
        "SELECT role FROM company_members
         WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND status = 'active'",
    )
    .bind(business_id)
    .bind(&context.email)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let role = match member {
        Some(role) => role,
        None => {
            return Err(fail(
                StatusCode::FORBIDDEN,
                "You are not a member of that business.",
            ))
        }
    };

    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM tenants WHERE id = $1 AND deleted_at IS NULL)",
    )
    .bind(business_id)
    .fetch_one(db)
    .await
    .unwrap_or(false);
    if !exists {
        return Err(fail(StatusCode::NOT_FOUND, "That business does not exist."));
    }

    // The account is now attached to that business.
    let _ = sqlx::query(
        "UPDATE users SET tenant_id = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)",
    )
    .bind(business_id)
    .bind(&context.email)
    .execute(db)
    .await;

    let row = sqlx::query(
        "SELECT t.id, t.organization_name, t.organization_email, t.plan_tier, t.status,
                COALESCE(cm.role, 'owner') AS role,
                (SELECT cd.domain_name FROM custom_domains cd
                  WHERE cd.tenant_id = t.id ORDER BY cd.created_at ASC LIMIT 1) AS primary_domain,
                (SELECT COUNT(*)::bigint FROM company_members m
                  WHERE m.tenant_id = t.id AND m.status = 'active') AS members,
                t.created_at
         FROM tenants t
         LEFT JOIN company_members cm ON cm.tenant_id = t.id AND LOWER(cm.email) = LOWER($1)
         WHERE t.id = $2 AND t.deleted_at IS NULL",
    )
    .bind(&context.email)
    .bind(business_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let business = row.as_ref().map(business_json).unwrap_or(json!({}));
    ok(json!({
        "success": true,
        "business": business,
        "role": role,
    }))
}

/// Create a new business with a complete setup and open it.
pub async fn create_business(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateBusinessRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let name = payload.name.trim();
    if name.len() < 2 {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Enter the name of the business.",
        ));
    }
    let domain = payload.domain.trim().to_lowercase();
    let valid = domain.len() >= 3
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && domain
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '.' || ch == '-');
    if !valid {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Enter a valid domain, for example acme.com.",
        ));
    }

    // The domain may only belong to one business.
    let taken: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM custom_domains WHERE domain_name = $1)")
            .bind(&domain)
            .fetch_one(db)
            .await
            .unwrap_or(false);
    if taken {
        return Err(fail(
            StatusCode::CONFLICT,
            "That domain is already connected to another business.",
        ));
    }

    let plan = payload
        .plan
        .unwrap_or_else(|| "free".to_string())
        .to_lowercase();
    let plan = if ["free", "starter", "business", "enterprise"].contains(&plan.as_str()) {
        plan
    } else {
        "free".to_string()
    };
    let slug = format!(
        "{}-{}",
        domain.replace(|ch: char| !ch.is_ascii_alphanumeric(), "-"),
        &Uuid::new_v4().simple().to_string()[..6]
    );

    // The business lives in the same storage, in its own tenant.
    let tenant_id: Uuid = match sqlx::query(
        "INSERT INTO tenants (organization_name, organization_email, plan_tier, status, settings, limits)
         VALUES ($1, $2, $3, 'active', jsonb_build_object('domain', $4, 'businessName', $1), '{}'::jsonb)
         ON CONFLICT (organization_email) DO UPDATE SET updated_at = NOW()
         RETURNING id",
    )
    .bind(name)
    .bind(&domain)
    .bind(&plan)
    .bind(&domain)
    .fetch_one(db)
    .await
    {
        Ok(row) => row.try_get::<Uuid, _>("id").unwrap_or_default(),
        Err(err) => {
            tracing::error!("business creation failed: {}", err);
            return Err(fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to create the business.",
            ));
        }
    };

    let _ = sqlx::query(
        "INSERT INTO tenant_profiles (tenant_id, slug, legal_name, billing_email, technical_email)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(&slug)
    .bind(name)
    .bind(&context.email)
    .execute(db)
    .await;

    // The domain with its verification record, exactly like a domain that is
    // added to an existing business.
    let verification_token = Uuid::new_v4().to_string();
    let domain_result = sqlx::query(
        "INSERT INTO custom_domains (tenant_id, domain_name, verification_status, verification_method, dns_records, mx_records)
         VALUES ($1, $2, 'pending', 'dns', $3, '[]'::jsonb)
         ON CONFLICT (domain_name) DO NOTHING
         RETURNING id",
    )
    .bind(tenant_id)
    .bind(&domain)
    .bind(json!([
        {
            "type": "TXT",
            "name": "_velismail-verify",
            "value": verification_token,
            "ttl": 300
        }
    ]))
    .fetch_optional(db)
    .await;
    if let Err(err) = &domain_result {
        tracing::error!("business domain creation failed: {}", err);
    }
    let domain_id = match domain_result {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        Ok(None) => {
            // Another request claimed the domain between the check above and
            // the insert. Do not steal it: undo the business that was just
            // created and tell the caller.
            let _ = sqlx::query("UPDATE tenants SET deleted_at = NOW() WHERE id = $1")
                .bind(tenant_id)
                .execute(db)
                .await;
            return Err(fail(
                StatusCode::CONFLICT,
                "That domain is already connected to another business.",
            ));
        }
        Err(err) => {
            tracing::error!("business domain creation failed: {}", err);
            let _ = sqlx::query("UPDATE tenants SET deleted_at = NOW() WHERE id = $1")
                .bind(tenant_id)
                .execute(db)
                .await;
            return Err(fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to connect the domain to the new business.",
            ));
        }
    };

    // The sending mailboxes of the business.
    for (address, display_name, kind) in [
        (format!("admin@{domain}"), name.to_string(), "primary"),
        (
            format!("postmaster@{domain}"),
            "Postmaster".to_string(),
            "user",
        ),
    ] {
        let mailbox_id = format!("mbx_{}", Uuid::new_v4().simple());
        let result = sqlx::query(
            "INSERT INTO business_mailboxes
             (id, tenant_id, domain, address, display_name, kind, aliases, active, source, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, '[]', TRUE, 'custom', $7)
             ON CONFLICT (domain, address) DO UPDATE
             SET display_name = EXCLUDED.display_name, kind = EXCLUDED.kind, tenant_id = EXCLUDED.tenant_id",
        )
        .bind(&mailbox_id)
        .bind(tenant_id)
        .bind(&domain)
        .bind(&address)
        .bind(&display_name)
        .bind(kind)
        .bind(crate::business_mailboxes::now_string())
        .execute(db)
        .await;
        if let Err(err) = result {
            tracing::warn!("mailbox {address} was not indexed: {err}");
        }
    }

    // The creator owns the new business.
    let _ = sqlx::query(
        "INSERT INTO company_members (tenant_id, user_id, email, display_name, role, status, joined_at, last_active_at)
         VALUES ($1, $2, $3, $4, 'owner', 'active', NOW(), NOW())
         ON CONFLICT (tenant_id, email) DO UPDATE
         SET role = 'owner', status = 'active', last_active_at = NOW()",
    )
    .bind(tenant_id)
    .bind(context.user_id)
    .bind(&context.email)
    .bind(name)
    .execute(db)
    .await;

    // The account is now attached to the new business.
    let _ = sqlx::query(
        "UPDATE users SET tenant_id = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)",
    )
    .bind(tenant_id)
    .bind(&context.email)
    .execute(db)
    .await;

    let row = sqlx::query(
        "SELECT t.id, t.organization_name, t.organization_email, t.plan_tier, t.status,
                COALESCE(cm.role, 'owner') AS role,
                (SELECT cd.domain_name FROM custom_domains cd
                  WHERE cd.tenant_id = t.id ORDER BY cd.created_at ASC LIMIT 1) AS primary_domain,
                (SELECT COUNT(*)::bigint FROM company_members m
                  WHERE m.tenant_id = t.id AND m.status = 'active') AS members,
                t.created_at
         FROM tenants t
         LEFT JOIN company_members cm ON cm.tenant_id = t.id AND LOWER(cm.email) = LOWER($1)
         WHERE t.id = $2 AND t.deleted_at IS NULL",
    )
    .bind(&context.email)
    .bind(tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let business = row.as_ref().map(business_json).unwrap_or(json!({}));

    ok(json!({
        "success": true,
        "business": business,
        "domain": domain,
        "domainId": domain_id.map(|value| value.to_string()),
        "verificationToken": verification_token,
    }))
}
