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
    /// Optional plan for the new business. Accepted for older clients only;
    /// the plan is assigned by the server.
    #[serde(default)]
    #[allow(dead_code)]
    pub plan: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchBusinessRequest {
    pub business_id: String,
}

fn internal_error(message: &str) -> (StatusCode, Json<Value>) {
    fail(StatusCode::INTERNAL_SERVER_ERROR, message)
}

/// Contact address stored on the tenant row.
///
/// `tenants.organization_email` is unique, so the bare domain must never be
/// used as the address: two rows would collide on one string and an upsert
/// could attach the caller to a tenant they do not own. The domain's admin
/// mailbox is unique per domain and is a real address the business owns.
fn business_contact_email(domain: &str) -> String {
    format!("admin@{domain}")
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
    .map_err(|err| {
        tracing::error!("business list could not be loaded: {}", err);
        internal_error("Unable to load the businesses.")
    })?;

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
    .map_err(|err| {
        tracing::error!("business membership could not be checked: {}", err);
        internal_error("Unable to switch the business.")
    })?;
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
    .map_err(|err| {
        tracing::error!("business existence check failed: {}", err);
        internal_error("Unable to switch the business.")
    })?;
    if !exists {
        return Err(fail(StatusCode::NOT_FOUND, "That business does not exist."));
    }

    // The account is now attached to that business.
    sqlx::query(
        "UPDATE users SET tenant_id = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)",
    )
    .bind(business_id)
    .bind(&context.email)
    .execute(db)
    .await
    .map_err(|err| {
        tracing::error!("business switch could not be stored: {}", err);
        internal_error("Unable to switch the business.")
    })?;

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
    .map_err(|err| {
        tracing::error!("switched business could not be loaded: {}", err);
        internal_error("Unable to switch the business.")
    })?
    .ok_or_else(|| fail(StatusCode::NOT_FOUND, "That business does not exist."))?;

    ok(json!({
        "success": true,
        "business": business_json(&row),
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
    // Creating a business mints a tenant with the caller as its owner, so a
    // plain member or viewer must not be able to do it from inside a
    // workspace they only observe.
    context.require_manage()?;
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

    // Self-service creation always starts on the free plan. Paid tiers are only
    // granted by the billing flow (or the platform console); accepting the plan
    // from the request let a user grant themselves an enterprise allowance.
    let plan = "free".to_string();
    let slug = format!(
        "{}-{}",
        domain.replace(|ch: char| !ch.is_ascii_alphanumeric(), "-"),
        &Uuid::new_v4().simple().to_string()[..6]
    );

    // The business lives in the same storage, in its own tenant. Every row is
    // written in one transaction: a half-created workspace (tenant without its
    // domain or without its owner) must never become visible to the customer.
    let mut tx = db.begin().await.map_err(|err| {
        tracing::error!("business transaction could not start: {}", err);
        internal_error("Unable to start the business setup.")
    })?;

    let tenant_id: Uuid = match sqlx::query(
        "INSERT INTO tenants (organization_name, organization_email, plan_tier, status, settings, limits)
         VALUES ($1, $2, $3, 'active', jsonb_build_object('domain', $4, 'businessName', $1), '{}'::jsonb)
         ON CONFLICT (organization_email) DO NOTHING
         RETURNING id",
    )
    .bind(name)
    .bind(business_contact_email(&domain))
    .bind(&plan)
    .bind(&domain)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").unwrap_or_default(),
        Ok(None) => {
            return Err(fail(
                StatusCode::CONFLICT,
                "That domain is already connected to another business.",
            ))
        }
        Err(err) => {
            tracing::error!("business creation failed: {}", err);
            return Err(internal_error("Unable to create the business."));
        }
    };
    if tenant_id == Uuid::nil() {
        return Err(internal_error("Unable to create the business."));
    }

    sqlx::query(
        "INSERT INTO tenant_profiles (tenant_id, slug, legal_name, billing_email, technical_email)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(&slug)
    .bind(name)
    .bind(&context.email)
    .execute(&mut *tx)
    .await
    .map_err(|err| {
        tracing::error!("business profile could not be created: {}", err);
        internal_error("Unable to create the business.")
    })?;

    // The domain with its verification record, exactly like a domain that is
    // added to an existing business.
    let verification_token = Uuid::new_v4().to_string();
    let domain_row = sqlx::query(
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
    .fetch_optional(&mut *tx)
    .await
    .map_err(|err| {
        tracing::error!("business domain creation failed: {}", err);
        internal_error("Unable to connect the domain to the new business.")
    })?
    .ok_or_else(|| {
        // Another request claimed the domain between the check above and this
        // insert. The transaction rolls back the tenant as well.
        fail(
            StatusCode::CONFLICT,
            "That domain is already connected to another business.",
        )
    })?;
    let domain_id = domain_row.try_get::<Uuid, _>("id").ok();

    // The business starts without mailboxes. An address that the owner did not
    // create is not a real mailbox, and sending from it would fail.

    // The creator owns the new business.
    sqlx::query(
        "INSERT INTO company_members (tenant_id, user_id, email, display_name, role, status, joined_at, last_active_at)
         VALUES ($1, $2, $3, $4, 'owner', 'active', NOW(), NOW())
         ON CONFLICT (tenant_id, email) DO UPDATE
         SET role = 'owner', status = 'active', last_active_at = NOW()",
    )
    .bind(tenant_id)
    .bind(context.user_id)
    .bind(&context.email)
    .bind(name)
    .execute(&mut *tx)
    .await
    .map_err(|err| {
        tracing::error!("business owner could not be stored: {}", err);
        internal_error("Unable to create the business.")
    })?;

    // The account is now attached to the new business.
    sqlx::query(
        "UPDATE users SET tenant_id = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)",
    )
    .bind(tenant_id)
    .bind(&context.email)
    .execute(&mut *tx)
    .await
    .map_err(|err| {
        tracing::error!("business could not be attached to the account: {}", err);
        internal_error("Unable to open the new business.")
    })?;

    tx.commit().await.map_err(|err| {
        tracing::error!("business transaction could not be committed: {}", err);
        internal_error("Unable to create the business.")
    })?;

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
    .map_err(|err| {
        tracing::error!("created business could not be loaded: {}", err);
        internal_error("Unable to load the new business.")
    })?
    .ok_or_else(|| internal_error("Unable to load the new business."))?;
    let business = business_json(&row);

    ok(json!({
        "success": true,
        "business": business,
        "domain": domain,
        "domainId": domain_id.map(|value| value.to_string()),
        "verificationToken": verification_token,
    }))
}

#[cfg(test)]
mod tests {
    use super::business_contact_email;

    #[test]
    fn contact_email_uses_the_workspace_domain() {
        assert_eq!(business_contact_email("acme.com"), "admin@acme.com");
    }

    #[test]
    fn contact_email_is_never_the_bare_domain() {
        // organization_email is UNIQUE. Using the domain itself made two
        // different businesses collide on the same row and could attach the
        // caller to a tenant they do not own.
        let address = business_contact_email("acme.com");
        assert!(address.contains('@'));
        assert_ne!(address, "acme.com");
    }
}
