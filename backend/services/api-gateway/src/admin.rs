//! Control-plane administration API.
//!
//! Two surfaces share one authorization core:
//!
//! * `/admin/platform/*`  - VelisMail staff, gated by a verified Firebase UID
//!   (PLATFORM_OWNER_UIDS) or an existing platform_admins record.
//! * `/admin/company/*`   - a company owner/admin operating on their own tenant.
//!
//! Every mutation writes a durable `platform_audit_logs` row. No mock data is
//! generated here: each response is derived from PostgreSQL or the live
//! gateway metrics.

use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use uuid::Uuid;
use velismail_common::Claims;

type ApiResult = (StatusCode, Json<Value>);

/// Roles that only the platform owner may hand out.
///
/// Everybody else can invite staff, but handing out a role that manages
/// members or escalates to full platform operations is an owner decision.
const OWNER_ONLY_ROLES: &[&str] = &["owner", "superadmin", "member_manager"];

/// True when the role may only be assigned by the platform owner.
fn is_owner_only_role(role: &str) -> bool {
    OWNER_ONLY_ROLES.contains(&role)
}

pub(crate) fn ok(value: Value) -> ApiResult {
    (StatusCode::OK, Json(value))
}

pub(crate) fn fail(status: StatusCode, message: &str) -> ApiResult {
    (status, Json(json!({ "success": false, "error": message })))
}

fn platform_api_error(status: StatusCode, message: &str) -> (StatusCode, Json<Value>) {
    fail(status, message)
}

fn normalize_email(value: &str) -> String {
    value.trim().to_lowercase()
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn decode_claims(state: &AppState, headers: &HeaderMap) -> Result<Claims, ApiResult> {
    let secret = state.config.jwt_secret.as_deref().ok_or_else(|| {
        platform_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "JWT authentication is not configured on the gateway.",
        )
    })?;
    let token = bearer_token(headers)
        .ok_or_else(|| platform_api_error(StatusCode::UNAUTHORIZED, "Missing bearer token."))?;
    let validation = Validation {
        validate_aud: false,
        leeway: 120,
        ..Default::default()
    };
    decode::<Claims>(
        &token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|_| platform_api_error(StatusCode::UNAUTHORIZED, "Invalid or expired bearer token."))
}

pub(crate) fn pool(state: &AppState) -> Result<&PgPool, ApiResult> {
    state.db.as_ref().ok_or_else(|| {
        platform_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "Control-plane database is not connected.",
        )
    })
}

fn uid_allowed(state: &AppState, claims: &Claims) -> bool {
    claims
        .firebase_uid
        .as_ref()
        .map(|uid| {
            state
                .config
                .platform_owner_uids
                .iter()
                .any(|allowed| allowed == uid)
        })
        .unwrap_or(false)
}

/// True when one of the account identities is listed in
/// `PLATFORM_OWNER_EMAILS`.
///
/// Owners are normally configured by email: a Firebase UID only exists after
/// the very first verified sign-in, so it cannot be known while preparing the
/// deployment. Either list grants ownership.
fn email_allowed(state: &AppState, email: &str) -> bool {
    let email = normalize_email(email);
    state.config.platform_owner_emails.contains(&email)
}

/// Ownership is granted by a listed Firebase UID **or** a listed email, where
/// either the login address or the recovery email may be the listed one.
fn owner_allowed(state: &AppState, claims: &Claims, identities: &[String]) -> bool {
    uid_allowed(state, claims)
        || identities
            .iter()
            .any(|identity| email_allowed(state, identity))
}

#[derive(Debug, Clone)]
struct PlatformActor {
    email: String,
    role: String,
    permissions: Vec<String>,
    /// True when the account is listed in PLATFORM_OWNER_UIDS or
    /// PLATFORM_OWNER_EMAILS. Only these accounts may run the owner-only
    /// operations, for example a platform wide broadcast.
    is_configured_owner: bool,
}

impl PlatformActor {
    fn can(&self, permission: &str) -> bool {
        self.role == "owner"
            || self.permissions.iter().any(|value| value == "*")
            || self.permissions.iter().any(|value| value == permission)
    }
}

async fn authorize_platform(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<PlatformActor, ApiResult> {
    let claims = decode_claims(state, headers)?;
    let login_email = normalize_email(&claims.email);
    let db = pool(state)?;
    // Ownership is configured by Firebase UID and/or email address. Either the
    // login address or the recovery address of the account may be the listed
    // one, so both are resolved before the check.
    //
    // The recovery email is the personal identity, so it becomes the canonical
    // control-plane address that roles and audit rows are stored against.
    let mut identities: Vec<String> = vec![login_email.clone()];
    let mut email = login_email;
    if let Ok(Some(row)) = sqlx::query(
        "SELECT email, recovery_email FROM users WHERE email = $1 OR recovery_email = $1 LIMIT 1",
    )
    .bind(&identities[0])
    .fetch_optional(db)
    .await
    {
        for column in ["email", "recovery_email"] {
            if let Ok(Some(value)) = row.try_get::<Option<String>, _>(column) {
                let value = normalize_email(&value);
                if !value.is_empty() && !identities.contains(&value) {
                    identities.push(value);
                }
            }
        }
        if let Ok(Some(recovery)) = row.try_get::<Option<String>, _>("recovery_email") {
            let recovery = normalize_email(&recovery);
            if !recovery.is_empty() {
                email = recovery;
            }
        }
    }
    let is_configured_owner = owner_allowed(state, &claims, &identities);

    let existing =
        sqlx::query("SELECT role, status, permissions FROM platform_admins WHERE email = ANY($1)")
            .bind(&identities)
            .fetch_optional(db)
            .await
            .map_err(|err| {
                tracing::error!("platform admin lookup failed: {}", err);
                platform_api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to authorize platform access.",
                )
            })?;

    let (mut role, mut status, mut permissions) = match existing {
        Some(row) => {
            let role: String = row.try_get("role").unwrap_or_else(|_| "viewer".to_string());
            let status: String = row
                .try_get("status")
                .unwrap_or_else(|_| "active".to_string());
            let permissions: Value = row.try_get("permissions").unwrap_or_else(|_| json!([]));
            let permissions = permissions
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            (role, status, permissions)
        }
        None => {
            // Only accounts that are explicitly configured as owners get
            // provisioned. There is no first-user bootstrap and no implicit
            // domain grant: everybody else needs an explicit invitation.
            if !is_configured_owner {
                return Err(platform_api_error(
                    StatusCode::FORBIDDEN,
                    "This account is not authorized for the VelisMail control plane.",
                ));
            }
            let role = "owner";
            let permissions = json!(["*"]);
            sqlx::query(
                "INSERT INTO platform_admins (email, display_name, role, status, permissions, last_seen_at)
                 VALUES ($1, $1, $2, 'active', $3, NOW())
                 ON CONFLICT (email) DO NOTHING",
            )
            .bind(&email)
            .bind(role)
            .bind(&permissions)
            .execute(db)
            .await
            .map_err(|err| {
                tracing::error!("platform admin provisioning failed: {}", err);
                platform_api_error(StatusCode::INTERNAL_SERVER_ERROR, "Unable to provision platform access.")
            })?;
            let permissions = permissions
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|value| value.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            (role.to_string(), "active".to_string(), permissions)
        }
    };

    // The configured owner list is authoritative: a listed account always acts
    // as owner, whatever the stored row says.
    if is_configured_owner {
        if role != "owner" {
            role = "owner".to_string();
            permissions = vec!["*".to_string()];
            status = "active".to_string();
            let _ = sqlx::query(
                "UPDATE platform_admins SET role = 'owner', permissions = $2::jsonb, status = 'active', updated_at = NOW()
                 WHERE email = ANY($1)",
            )
            .bind(&identities)
            .bind(json!(["*"]))
            .execute(db)
            .await;
        }
    } else if role == "owner" {
        // The owner role is reserved for the configured owner accounts. A row
        // that claims ownership without being configured is stale and is not
        // allowed to act as owner.
        return Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "The platform owner role is reserved for accounts listed in PLATFORM_OWNER_UIDS or PLATFORM_OWNER_EMAILS.",
        ));
    }

    if status != "active" {
        return Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "This platform administrator account is suspended.",
        ));
    }
    let _ = sqlx::query("UPDATE platform_admins SET last_seen_at = NOW() WHERE email = ANY($1)")
        .bind(&identities)
        .execute(db)
        .await;

    Ok(PlatformActor {
        email,
        role,
        permissions,
        is_configured_owner,
    })
}

#[derive(Debug, Clone)]
struct CompanyActor {
    email: String,
    tenant_id: Uuid,
    tenant_name: String,
    plan: String,
    company_status: String,
    role: String,
    is_platform_admin: bool,
}

async fn is_platform_staff(state: &AppState, claims: &Claims) -> bool {
    let email = normalize_email(&claims.email);
    if uid_allowed(state, claims) || email_allowed(state, &email) {
        return true;
    }
    let Some(db) = state.db.as_ref() else {
        return false;
    };
    // The recovery email identifies the person, so a membership recorded under
    // it also counts as staff.
    let row =
        sqlx::query("SELECT recovery_email FROM users WHERE email = $1 OR recovery_email = $1")
            .bind(&email)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
    let mut identities: Vec<String> = vec![email];
    if let Some(row) = row {
        if let Ok(Some(recovery)) = row.try_get::<Option<String>, _>("recovery_email") {
            let recovery = normalize_email(&recovery);
            if !recovery.is_empty() && !identities.contains(&recovery) {
                identities.push(recovery);
            }
        }
    }
    sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS (SELECT 1 FROM platform_admins WHERE email = ANY($1) AND status = 'active')",
    )
    .bind(identities)
    .fetch_one(db)
    .await
    .unwrap_or(false)
}

async fn resolve_tenant_for_email(
    db: &PgPool,
    email: &str,
    plan: &str,
) -> Result<Uuid, sqlx::Error> {
    let domain = email
        .split('@')
        .nth(1)
        .unwrap_or("workspace")
        .to_lowercase();
    if let Some(row) = sqlx::query(
        "SELECT id FROM tenants
         WHERE deleted_at IS NULL AND organization_email = $1
         ORDER BY created_at ASC LIMIT 1",
    )
    .bind(email)
    .fetch_optional(db)
    .await?
    {
        return row.try_get("id");
    }

    let slug = format!(
        "{}-{}",
        domain.replace(|ch: char| !ch.is_ascii_alphanumeric(), "-"),
        &Uuid::new_v4().simple().to_string()[..6]
    );
    let row = sqlx::query(
        "INSERT INTO tenants (organization_name, organization_email, plan_tier, status, settings, limits)
         VALUES ($1, $2, $3, 'active', jsonb_build_object('domain', $1), '{}'::jsonb)
         ON CONFLICT (organization_email) DO UPDATE SET updated_at = NOW()
         RETURNING id",
    )
    .bind(&domain)
    .bind(email)
    .bind(plan)
    .fetch_one(db)
    .await?;
    let id: Uuid = row.try_get("id")?;
    sqlx::query(
        "INSERT INTO tenant_profiles (tenant_id, slug, legal_name, billing_email, technical_email)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(id)
    .bind(&slug)
    .bind(&domain)
    .bind(email)
    .execute(db)
    .await
    .ok();
    Ok(id)
}

async fn authorize_company(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<CompanyActor, ApiResult> {
    let claims = decode_claims(state, headers)?;
    let db = pool(state)?;
    let email = normalize_email(&claims.email);

    let user = sqlx::query(
        "SELECT tenant_id, settings, status, display_name FROM users WHERE email = $1 LIMIT 1",
    )
    .bind(&email)
    .fetch_optional(db)
    .await
    .map_err(|err| {
        tracing::error!("company actor lookup failed: {}", err);
        platform_api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to authorize company access.",
        )
    })?
    .ok_or_else(|| platform_api_error(StatusCode::FORBIDDEN, "Account not found."))?;

    let settings: Value = user.try_get("settings").unwrap_or_else(|_| json!({}));
    let user_status: String = user
        .try_get("status")
        .unwrap_or_else(|_| "active".to_string());
    if user_status != "active" {
        return Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "This account is suspended. Contact VelisMail support.",
        ));
    }
    let plan = settings
        .get("plan")
        .and_then(Value::as_str)
        .unwrap_or("free")
        .to_lowercase();

    let is_platform = is_platform_staff(state, &claims).await;

    let explicit_tenant = user
        .try_get::<Option<Uuid>, _>("tenant_id")
        .ok()
        .flatten()
        .filter(|id| !id.is_nil());
    let tenant_id = match explicit_tenant {
        Some(id) => {
            let exists: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM tenants WHERE id = $1 AND deleted_at IS NULL)",
            )
            .bind(id)
            .fetch_one(db)
            .await
            .unwrap_or(false);
            if exists {
                id
            } else if is_platform {
                resolve_tenant_for_email(db, &email, &plan)
                    .await
                    .map_err(|err| {
                        tracing::error!("tenant resolution failed: {}", err);
                        platform_api_error(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Unable to resolve company workspace.",
                        )
                    })?
            } else {
                return Err(platform_api_error(
                    StatusCode::FORBIDDEN,
                    "This account is not attached to an active workspace.",
                ));
            }
        }
        None if is_platform => {
            resolve_tenant_for_email(db, &email, &plan)
                .await
                .map_err(|err| {
                    tracing::error!("tenant resolution failed: {}", err);
                    platform_api_error(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to resolve company workspace.",
                    )
                })?
        }
        None => {
            return Err(platform_api_error(
                StatusCode::FORBIDDEN,
                "This account is not attached to a workspace yet.",
            ));
        }
    };

    let _ = sqlx::query("UPDATE users SET tenant_id = $1 WHERE email = $2 AND (tenant_id IS NULL OR tenant_id <> $1)")
        .bind(tenant_id)
        .bind(&email)
        .execute(db)
        .await;

    // The workspace role is taken from an explicit membership row. Sharing a
    // tenant or an email domain does not grant access on its own.
    let explicit_membership: Option<(String, String)> = sqlx::query(
        "SELECT role, status FROM company_members
         WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(&email)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .map(|row| {
        (
            row.try_get::<String, _>("role")
                .unwrap_or_else(|_| "member".to_string()),
            row.try_get::<String, _>("status")
                .unwrap_or_else(|_| "active".to_string()),
        )
    });

    let (mut company_role, membership_status) = match explicit_membership {
        Some(entry) => entry,
        None if is_platform => {
            // Platform staff administer the platform itself, so their own
            // workspace keeps an owning membership for the console.
            let _ = sqlx::query(
                "INSERT INTO company_members (tenant_id, user_id, email, display_name, role, status, joined_at, last_active_at)
                 SELECT $1, id, email, display_name, 'owner', 'active', NOW(), NOW()
                 FROM users WHERE id = $2
                 ON CONFLICT (tenant_id, email) DO NOTHING",
            )
            .bind(tenant_id)
            .bind(claims.sub.0)
            .execute(db)
            .await;
            ("owner".to_string(), "active".to_string())
        }
        None => {
            // Never create a membership implicitly. A removed member would
            // otherwise regain access simply by calling the console again.
            return Err(platform_api_error(
                StatusCode::FORBIDDEN,
                "You are not a member of this workspace.",
            ));
        }
    };

    let tenant =
        sqlx::query("SELECT organization_name, plan_tier, status FROM tenants WHERE id = $1")
            .bind(tenant_id)
            .fetch_optional(db)
            .await
            .map_err(|_| {
                platform_api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to load company workspace.",
                )
            })?
            .ok_or_else(|| {
                platform_api_error(StatusCode::NOT_FOUND, "Company workspace not found.")
            })?;

    let tenant_name: String = tenant.try_get("organization_name").unwrap_or_default();
    let tenant_plan: String = tenant.try_get("plan_tier").unwrap_or_else(|_| plan.clone());
    let company_status: String = tenant
        .try_get("status")
        .unwrap_or_else(|_| "active".to_string());
    // A workspace that is not running cannot be administered: suspended,
    // disabled, deleted and a workspace that never finished the verification.
    match company_status.as_str() {
        "suspended" => {
            return Err(platform_api_error(
                StatusCode::FORBIDDEN,
                "This workspace is suspended. Contact VelisMail support.",
            ))
        }
        "disabled" => {
            return Err(platform_api_error(
                StatusCode::FORBIDDEN,
                "This workspace is disabled. Contact VelisMail support.",
            ))
        }
        "pending_verification" => {
            return Err(platform_api_error(
                StatusCode::FORBIDDEN,
                "This workspace has not finished its verification yet.",
            ))
        }
        "deleted" => {
            return Err(platform_api_error(
                StatusCode::FORBIDDEN,
                "This workspace has been deleted.",
            ))
        }
        _ => {}
    }

    if membership_status != "active" && !is_platform {
        return Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "Your company membership is not active. Contact a company administrator.",
        ));
    }

    if !is_platform && company_role != "owner" && company_role != "admin" {
        // Legacy repair: a workspace whose administrators were never recorded
        // (or were all removed) promotes its earliest active member once, so
        // the company is never left without a way to administer it.
        let has_admin: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                SELECT 1 FROM company_members
                WHERE tenant_id = $1 AND status = 'active' AND role IN ('owner', 'admin')
            )",
        )
        .bind(tenant_id)
        .fetch_one(db)
        .await
        .unwrap_or(true);
        if !has_admin {
            let earliest: Option<String> = sqlx::query_scalar(
                "SELECT email FROM company_members
                 WHERE tenant_id = $1 AND status = 'active'
                 ORDER BY joined_at ASC, created_at ASC LIMIT 1",
            )
            .bind(tenant_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
            if earliest.as_deref().map(normalize_email).as_deref() == Some(email.as_str()) {
                let _ = sqlx::query(
                    "UPDATE company_members SET role = 'owner'
                     WHERE tenant_id = $1 AND email = $2",
                )
                .bind(tenant_id)
                .bind(&email)
                .execute(db)
                .await;
                let _ = sqlx::query(
                    "UPDATE tenant_users SET role = 'owner', updated_at = NOW()
                     WHERE tenant_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2 LIMIT 1)",
                )
                .bind(tenant_id)
                .bind(&email)
                .execute(db)
                .await;
                let _ = sqlx::query(
                    "UPDATE users
                     SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{role}', '\"admin\"'::jsonb)
                     WHERE email = $1",
                )
                .bind(&email)
                .execute(db)
                .await;
                company_role = "owner".to_string();
            }
        }
    }

    if !is_platform && company_role != "owner" && company_role != "admin" {
        return Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "Company administration requires an owner or admin role.",
        ));
    }

    Ok(CompanyActor {
        email,
        tenant_id,
        tenant_name,
        plan: tenant_plan,
        company_status,
        role: if is_platform {
            "owner".to_string()
        } else {
            company_role
        },
        is_platform_admin: is_platform,
    })
}

fn require_permission(actor: &PlatformActor, permission: &str) -> Result<(), ApiResult> {
    if actor.can(permission) {
        Ok(())
    } else {
        Err(platform_api_error(
            StatusCode::FORBIDDEN,
            "Your platform role does not allow this action.",
        ))
    }
}

#[allow(clippy::too_many_arguments)]
async fn audit(
    db: &PgPool,
    actor_email: &str,
    actor_role: &str,
    action: &str,
    category: &str,
    resource_type: &str,
    resource_id: Option<&str>,
    tenant_id: Option<Uuid>,
    details: Value,
    severity: &str,
) {
    let _ = sqlx::query(
        "INSERT INTO platform_audit_logs
         (actor_email, actor_role, action, category, resource_type, resource_id, tenant_id, details, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(actor_email)
    .bind(actor_role)
    .bind(action)
    .bind(category)
    .bind(resource_type)
    .bind(resource_id)
    .bind(tenant_id)
    .bind(details)
    .bind(severity)
    .execute(db)
    .await;
}

async fn monthly_revenue(db: &PgPool) -> (i64, i64) {
    let rows = sqlx::query(
        "SELECT LOWER(plan_tier) AS plan,
                LOWER(COALESCE(billing_info->>'billingCycle', settings->>'billingCycle', 'monthly')) AS billing
         FROM tenants WHERE deleted_at IS NULL AND LOWER(plan_tier) <> 'free'",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let mut mrr: i64 = 0;
    let mut paid = 0i64;
    for row in rows {
        let plan: String = row.try_get("plan").unwrap_or_else(|_| "free".to_string());
        let billing: String = row
            .try_get("billing")
            .unwrap_or_else(|_| "monthly".to_string());
        // Money is reported in paise (the same unit as the invoice ledger) so
        // the console and the billing screens never disagree by a factor of
        // 100.
        let monthly_paise = match plan.as_str() {
            "starter" => {
                if billing == "annual" {
                    301_400 / 12
                } else {
                    29_900
                }
            }
            "business" => {
                if billing == "annual" {
                    1_007_000 / 12
                } else {
                    99_900
                }
            }
            "enterprise" => {
                if billing == "annual" {
                    2_519_000 / 12
                } else {
                    249_900
                }
            }
            _ => 0,
        };
        if monthly_paise > 0 {
            paid += 1;
            mrr += monthly_paise;
        }
    }
    (mrr, paid)
}

fn day_series(rows: &[sqlx::postgres::PgRow], days: i64) -> Vec<Value> {
    let mut counts: HashMap<String, i64> = HashMap::new();
    for row in rows {
        let day: Option<chrono::NaiveDate> = row.try_get("day").ok();
        let count: i64 = row.try_get("count").unwrap_or(0);
        if let Some(day) = day {
            counts.insert(day.format("%Y-%m-%d").to_string(), count);
        }
    }
    let today = Utc::now().date_naive();
    (0..days)
        .rev()
        .map(|offset| {
            let day = today - chrono::Duration::days(offset);
            let key = day.format("%Y-%m-%d").to_string();
            json!({ "date": key, "value": counts.get(&key).copied().unwrap_or(0) })
        })
        .collect()
}

fn plan_distribution(rows: &[sqlx::postgres::PgRow]) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            json!({
                "plan": row.try_get::<String, _>("plan").unwrap_or_else(|_| "Free".to_string()),
                "count": row.try_get::<i64, _>("count").unwrap_or(0),
            })
        })
        .collect()
}

fn investigation_json(row: &sqlx::postgres::PgRow) -> Value {
    let tags: Vec<String> = row.try_get("tags").unwrap_or_default();
    let evidence: Value = row.try_get("evidence").unwrap_or_else(|_| json!([]));
    json!({
        "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
        "caseNumber": row.try_get::<String, _>("case_number").unwrap_or_default(),
        "title": row.try_get::<String, _>("title").unwrap_or_default(),
        "type": row.try_get::<String, _>("investigation_type").unwrap_or_else(|_| "abuse".to_string()),
        "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "medium".to_string()),
        "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "open".to_string()),
        "priority": row.try_get::<String, _>("priority").unwrap_or_else(|_| "P3".to_string()),
        "tenantId": row.try_get::<Option<Uuid>, _>("tenant_id").ok().flatten().map(|v| v.to_string()),
        "tenantName": row.try_get::<Option<String>, _>("tenant_name").ok().flatten(),
        "reporterEmail": row.try_get::<Option<String>, _>("reporter_email").ok().flatten(),
        "assigneeEmail": row.try_get::<Option<String>, _>("assignee_email").ok().flatten(),
        "summary": row.try_get::<String, _>("summary").unwrap_or_default(),
        "description": row.try_get::<String, _>("description").unwrap_or_default(),
        "evidence": evidence,
        "tags": tags,
        "slaDueAt": row.try_get::<Option<DateTime<Utc>>, _>("sla_due_at").ok().flatten().map(|v| v.to_rfc3339()),
        "resolvedAt": row.try_get::<Option<DateTime<Utc>>, _>("resolved_at").ok().flatten().map(|v| v.to_rfc3339()),
        "createdBy": row.try_get::<String, _>("created_by").unwrap_or_default(),
        "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "eventCount": row.try_get::<i64, _>("event_count").unwrap_or(0),
    })
}

// ---------------------------------------------------------------------------
// Platform overview & analytics
// ---------------------------------------------------------------------------

pub async fn platform_me(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    match authorize_platform(&state, &headers).await {
        Ok(actor) => ok(json!({
            "success": true,
            "owner": actor.is_configured_owner,
            "roleOwner": actor.role == "owner",
            "admin": {
                "email": actor.email,
                "role": actor.role,
                "permissions": actor.permissions,
            }
        })),
        Err(response) => response,
    }
}

pub async fn platform_overview(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };

    let company_stats = sqlx::query(
        "SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE status = 'active')::bigint AS active,
                COUNT(*) FILTER (WHERE plan_tier <> 'free')::bigint AS paid
         FROM tenants WHERE deleted_at IS NULL",
    )
    .fetch_one(db)
    .await;
    let (companies, active_companies, paid_companies) = match company_stats {
        Ok(row) => (
            row.try_get::<i64, _>("total").unwrap_or(0),
            row.try_get::<i64, _>("active").unwrap_or(0),
            row.try_get::<i64, _>("paid").unwrap_or(0),
        ),
        Err(_) => (0, 0, 0),
    };

    let user_stats = sqlx::query(
        "SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE status = 'active')::bigint AS active,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::bigint AS new30,
                COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '24 hours')::bigint AS active24
         FROM users",
    )
    .fetch_one(db)
    .await;
    let (users, active_users, new_users, active_24h) = match user_stats {
        Ok(row) => (
            row.try_get::<i64, _>("total").unwrap_or(0),
            row.try_get::<i64, _>("active").unwrap_or(0),
            row.try_get::<i64, _>("new30").unwrap_or(0),
            row.try_get::<i64, _>("active24").unwrap_or(0),
        ),
        Err(_) => (0, 0, 0, 0),
    };

    let mail_30d: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM delivery_queue WHERE created_at > NOW() - INTERVAL '30 days'",
    )
    .fetch_one(db)
    .await
    .unwrap_or(0);
    let storage: i64 =
        sqlx::query_scalar("SELECT COALESCE(SUM(size_bytes), 0)::bigint FROM storage_objects")
            .fetch_one(db)
            .await
            .unwrap_or(0);
    let queue: (i64, i64, i64) = match sqlx::query(
        "SELECT COUNT(*) FILTER (WHERE status IN ('pending','sending','retry'))::bigint AS queued,
                COUNT(*) FILTER (WHERE status = 'failed')::bigint AS failed,
                COUNT(*) FILTER (WHERE status = 'delivered')::bigint AS delivered
         FROM delivery_queue",
    )
    .fetch_one(db)
    .await
    {
        Ok(row) => (
            row.try_get::<i64, _>("queued").unwrap_or(0),
            row.try_get::<i64, _>("failed").unwrap_or(0),
            row.try_get::<i64, _>("delivered").unwrap_or(0),
        ),
        Err(_) => (0, 0, 0),
    };
    let open_investigations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM investigations WHERE status IN ('open','investigating','contained')",
    )
    .fetch_one(db)
    .await
    .unwrap_or(0);
    let critical_investigations: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM investigations WHERE severity = 'critical' AND status IN ('open','investigating','contained')",
    )
    .fetch_one(db)
    .await
    .unwrap_or(0);
    let (mrr, paid_subscriptions) = monthly_revenue(db).await;

    let plan_rows = sqlx::query(
        "SELECT COALESCE(settings->>'plan','Free') AS plan, COUNT(*)::bigint AS count
         FROM users GROUP BY 1 ORDER BY count DESC",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let company_growth = sqlx::query(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count
         FROM tenants WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let user_growth = sqlx::query(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count
         FROM users WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let mail_series = sqlx::query(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count
         FROM delivery_queue WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY 1",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let top_companies = sqlx::query(
        "SELECT t.id, t.organization_name, t.plan_tier, t.status,
                COUNT(u.id)::bigint AS users,
                (SELECT COUNT(*)::bigint FROM delivery_queue q
                 WHERE EXISTS (SELECT 1 FROM custom_domains d
                               WHERE d.tenant_id = t.id AND q.sender ILIKE '%@' || d.domain_name)) AS sent
         FROM tenants t
         LEFT JOIN users u ON u.tenant_id = t.id
         WHERE t.deleted_at IS NULL
         GROUP BY t.id
         ORDER BY sent DESC, users DESC
         LIMIT 6",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let top_companies: Vec<Value> = top_companies
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("organization_name").unwrap_or_default(),
                "plan": row.try_get::<String, _>("plan_tier").unwrap_or_else(|_| "free".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
                "users": row.try_get::<i64, _>("users").unwrap_or(0),
                "sent": row.try_get::<i64, _>("sent").unwrap_or(0),
            })
        })
        .collect();

    let investigations = sqlx::query(
        "SELECT i.*, (SELECT COUNT(*)::bigint FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count
         FROM investigations i
         ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  i.created_at DESC
         LIMIT 6",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let investigations: Vec<Value> = investigations.iter().map(investigation_json).collect();

    let audit_rows = sqlx::query(
        "SELECT id, actor_email, action, category, severity, resource_type, details, created_at
         FROM platform_audit_logs ORDER BY created_at DESC LIMIT 8",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let recent_audit: Vec<Value> = audit_rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "actor": row.try_get::<String, _>("actor_email").unwrap_or_default(),
                "action": row.try_get::<String, _>("action").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "resourceType": row.try_get::<String, _>("resource_type").unwrap_or_default(),
                "details": row.try_get::<Value, _>("details").unwrap_or_else(|_| json!({})),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();

    let traffic = sqlx::query(
        "SELECT requests, errors, total_latency_us, rate_limited, overloads
         FROM platform_traffic_daily WHERE day = CURRENT_DATE",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let (today_requests, today_errors, today_latency) = traffic
        .map(|row| {
            (
                row.try_get::<i64, _>("requests").unwrap_or(0),
                row.try_get::<i64, _>("errors").unwrap_or(0),
                row.try_get::<i64, _>("total_latency_us").unwrap_or(0),
            )
        })
        .unwrap_or((0, 0, 0));
    let avg_latency_ms = if today_requests > 0 {
        (today_latency as f64 / today_requests as f64) / 1000.0
    } else {
        0.0
    };

    ok(json!({
        "success": true,
        "generatedAt": Utc::now().to_rfc3339(),
        "actor": { "email": actor.email, "role": actor.role },
        "kpis": {
            "companies": companies,
            "activeCompanies": active_companies,
            "paidCompanies": paid_companies,
            "users": users,
            "activeUsers": active_users,
            "newUsers30d": new_users,
            "activeUsers24h": active_24h,
            "emails30d": mail_30d,
            "storageBytes": storage,
            "queueDepth": queue.0,
            "queueFailed": queue.1,
            "delivered": queue.2,
            "openInvestigations": open_investigations,
            "criticalInvestigations": critical_investigations,
            "paidSubscriptions": paid_subscriptions,
            "mrr": mrr,
            "arr": mrr * 12,
            "requestsToday": today_requests,
            "errorsToday": today_errors,
            "avgLatencyMs": avg_latency_ms,
        },
        "growth": {
            "companies": day_series(&company_growth, 30),
            "users": day_series(&user_growth, 30),
            "emails": day_series(&mail_series, 30),
        },
        "planDistribution": plan_distribution(&plan_rows),
        "topCompanies": top_companies,
        "investigations": investigations,
        "recentAudit": recent_audit,
        "health": {
            "database": true,
            "queueBacklog": queue.0,
            "queueFailed": queue.1,
        }
    }))
}

pub async fn platform_analytics(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let days = params
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(30)
        .clamp(7, 90);

    let signups = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count FROM users
         WHERE created_at > NOW() - INTERVAL '{} days' GROUP BY 1 ORDER BY 1",
        days
    )))
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let companies = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count FROM tenants
         WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '{} days' GROUP BY 1 ORDER BY 1",
        days
    )))
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let sent = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count FROM delivery_queue
         WHERE created_at > NOW() - INTERVAL '{} days' GROUP BY 1 ORDER BY 1",
        days
    )))
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let delivered = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count FROM delivery_queue
         WHERE status = 'delivered' AND created_at > NOW() - INTERVAL '{} days' GROUP BY 1 ORDER BY 1",
        days
    )))
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let failed = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT created_at::date AS day, COUNT(*)::bigint AS count FROM delivery_queue
         WHERE status = 'failed' AND created_at > NOW() - INTERVAL '{} days' GROUP BY 1 ORDER BY 1",
        days
    )))
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let traffic = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT day, requests, errors, total_latency_us, rate_limited, overloads
         FROM platform_traffic_daily
         WHERE day > CURRENT_DATE - INTERVAL '{} days' ORDER BY day",
        days
    )))
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let traffic_series: Vec<Value> = traffic
        .iter()
        .map(|row| {
            let requests = row.try_get::<i64, _>("requests").unwrap_or(0);
            let latency = row.try_get::<i64, _>("total_latency_us").unwrap_or(0);
            json!({
                "date": row.try_get::<chrono::NaiveDate, _>("day").map(|v| v.format("%Y-%m-%d").to_string()).unwrap_or_default(),
                "requests": requests,
                "errors": row.try_get::<i64, _>("errors").unwrap_or(0),
                "rateLimited": row.try_get::<i64, _>("rate_limited").unwrap_or(0),
                "overloads": row.try_get::<i64, _>("overloads").unwrap_or(0),
                "avgLatencyMs": if requests > 0 { (latency as f64 / requests as f64) / 1000.0 } else { 0.0 },
            })
        })
        .collect();

    let leaderboard = sqlx::query(
        "SELECT t.id, t.organization_name, t.plan_tier,
                (SELECT COUNT(*)::bigint FROM users u WHERE u.tenant_id = t.id) AS users,
                (SELECT COUNT(*)::bigint FROM custom_domains d WHERE d.tenant_id = t.id) AS domains,
                (SELECT COALESCE(SUM(s.size_bytes),0)::bigint FROM storage_objects s WHERE s.tenant_id = t.id) AS storage,
                (SELECT COUNT(*)::bigint FROM delivery_queue q
                 WHERE EXISTS (SELECT 1 FROM custom_domains d
                               WHERE d.tenant_id = t.id AND q.sender ILIKE '%@' || d.domain_name)) AS sent
         FROM tenants t WHERE t.deleted_at IS NULL
         ORDER BY sent DESC, users DESC LIMIT 10",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let leaderboard: Vec<Value> = leaderboard
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("organization_name").unwrap_or_default(),
                "plan": row.try_get::<String, _>("plan_tier").unwrap_or_else(|_| "free".to_string()),
                "users": row.try_get::<i64, _>("users").unwrap_or(0),
                "domains": row.try_get::<i64, _>("domains").unwrap_or(0),
                "storage": row.try_get::<i64, _>("storage").unwrap_or(0),
                "sent": row.try_get::<i64, _>("sent").unwrap_or(0),
            })
        })
        .collect();

    ok(json!({
        "success": true,
        "rangeDays": days,
        "series": {
            "signups": day_series(&signups, days),
            "companies": day_series(&companies, days),
            "sent": day_series(&sent, days),
            "delivered": day_series(&delivered, days),
            "failed": day_series(&failed, days),
            "traffic": traffic_series,
        },
        "leaderboard": leaderboard,
    }))
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const COMPANY_SELECT: &str = r#"
SELECT t.id, t.organization_name, t.organization_email, t.plan_tier, t.status,
       t.created_at, t.updated_at, t.settings, t.limits,
       p.slug, p.industry, p.country, p.timezone, p.legal_name, p.billing_email,
       p.technical_email, p.seat_limit, p.logo_url,
       (SELECT COUNT(*)::bigint FROM users u WHERE u.tenant_id = t.id) AS user_count,
       (SELECT COUNT(*)::bigint FROM company_members m WHERE m.tenant_id = t.id AND m.status = 'active') AS member_count,
       (SELECT COUNT(*)::bigint FROM custom_domains d WHERE d.tenant_id = t.id) AS domain_count,
       (SELECT COALESCE(SUM(s.size_bytes),0)::bigint FROM storage_objects s WHERE s.tenant_id = t.id) AS storage_bytes,
       (SELECT COUNT(*)::bigint FROM delivery_queue q
        WHERE EXISTS (SELECT 1 FROM custom_domains d
                      WHERE d.tenant_id = t.id AND q.sender ILIKE '%@' || d.domain_name)) AS sent_count,
       (SELECT COUNT(*)::bigint FROM delivery_queue q
        WHERE q.status IN ('pending','sending','retry')
          AND EXISTS (SELECT 1 FROM custom_domains d
                      WHERE d.tenant_id = t.id AND q.sender ILIKE '%@' || d.domain_name)) AS queue_depth,
       (SELECT COUNT(*)::bigint FROM company_invoices i WHERE i.tenant_id = t.id AND i.status = 'paid') AS invoice_count,
       (SELECT COUNT(*)::bigint FROM investigations i WHERE i.tenant_id = t.id AND i.status IN ('open','investigating','contained')) AS open_cases,
       (SELECT COALESCE(jsonb_agg(d.domain_name ORDER BY d.domain_name), '[]'::jsonb)
        FROM custom_domains d WHERE d.tenant_id = t.id) AS domain_list,
       (SELECT COUNT(*)::bigint FROM business_mailboxes bm WHERE bm.tenant_id = t.id) AS mailbox_count,
       (SELECT MAX(u2.last_login) FROM users u2 WHERE u2.tenant_id = t.id) AS last_activity
FROM tenants t
LEFT JOIN tenant_profiles p ON p.tenant_id = t.id
"#;

fn company_json(row: &sqlx::postgres::PgRow) -> Value {
    let settings: Value = row.try_get("settings").unwrap_or_else(|_| json!({}));
    let limits: Value = row.try_get("limits").unwrap_or_else(|_| json!({}));
    json!({
        "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
        "name": row.try_get::<String, _>("organization_name").unwrap_or_default(),
        "email": row.try_get::<String, _>("organization_email").unwrap_or_default(),
        "plan": row.try_get::<String, _>("plan_tier").unwrap_or_else(|_| "free".to_string()),
        "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
        "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
        "settings": settings,
        "limits": limits,
        "slug": row.try_get::<Option<String>, _>("slug").ok().flatten(),
        "industry": row.try_get::<Option<String>, _>("industry").ok().flatten(),
        "country": row.try_get::<Option<String>, _>("country").ok().flatten(),
        "timezone": row.try_get::<Option<String>, _>("timezone").ok().flatten(),
        "legalName": row.try_get::<Option<String>, _>("legal_name").ok().flatten(),
        "billingEmail": row.try_get::<Option<String>, _>("billing_email").ok().flatten(),
        "technicalEmail": row.try_get::<Option<String>, _>("technical_email").ok().flatten(),
        "seatLimit": row.try_get::<Option<i32>, _>("seat_limit").ok().flatten().unwrap_or(10),
        "logoUrl": row.try_get::<Option<String>, _>("logo_url").ok().flatten(),
        "users": row.try_get::<i64, _>("user_count").unwrap_or(0),
        "members": row.try_get::<i64, _>("member_count").unwrap_or(0),
        "domains": row.try_get::<i64, _>("domain_count").unwrap_or(0),
        "storageBytes": row.try_get::<i64, _>("storage_bytes").unwrap_or(0),
        "sent": row.try_get::<i64, _>("sent_count").unwrap_or(0),
        "queueDepth": row.try_get::<i64, _>("queue_depth").unwrap_or(0),
        "invoices": row.try_get::<i64, _>("invoice_count").unwrap_or(0),
        "openCases": row.try_get::<i64, _>("open_cases").unwrap_or(0),
        "domainList": row.try_get::<Value, _>("domain_list").unwrap_or_else(|_| json!([])),
        "mailboxes": row.try_get::<i64, _>("mailbox_count").unwrap_or(0),
        "lastActivity": row.try_get::<Option<DateTime<Utc>>, _>("last_activity").ok().flatten().map(|v| v.to_rfc3339()),
    })
}

pub async fn list_companies(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let search = params
        .get("search")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let plan = params
        .get("plan")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let status = params
        .get("status")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let limit = params
        .get("limit")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(100)
        .clamp(1, 500);
    let offset = params
        .get("offset")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
        .max(0);

    let query = format!(
        "{} WHERE t.deleted_at IS NULL
           AND ($1 = '' OR LOWER(t.organization_name) LIKE '%' || $1 || '%' OR LOWER(t.organization_email) LIKE '%' || $1 || '%')
           AND ($2 = 'all' OR LOWER(t.plan_tier) = $2)
           AND ($3 = 'all' OR LOWER(t.status) = $3)
         ORDER BY t.created_at DESC LIMIT $4 OFFSET $5",
        COMPANY_SELECT
    );
    let rows = match sqlx::query(sqlx::AssertSqlSafe(query))
        .bind(&search)
        .bind(&plan)
        .bind(&status)
        .bind(limit)
        .bind(offset)
        .fetch_all(db)
        .await
    {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("company list failed: {}", err);
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to load companies.",
            );
        }
    };
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM tenants t WHERE t.deleted_at IS NULL
           AND ($1 = '' OR LOWER(t.organization_name) LIKE '%' || $1 || '%' OR LOWER(t.organization_email) LIKE '%' || $1 || '%')
           AND ($2 = 'all' OR LOWER(t.plan_tier) = $2)
           AND ($3 = 'all' OR LOWER(t.status) = $3)",
    )
    .bind(&search)
    .bind(&plan)
    .bind(&status)
    .fetch_one(db)
    .await
    .unwrap_or(0);

    let companies: Vec<Value> = rows.iter().map(company_json).collect();
    ok(json!({
        "success": true,
        "companies": companies,
        "pagination": { "total": total, "limit": limit, "offset": offset },
    }))
}

pub async fn get_company(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid company id."),
    };
    let query = format!(
        "{} WHERE t.id = $1 AND t.deleted_at IS NULL",
        COMPANY_SELECT
    );
    let row = match sqlx::query(sqlx::AssertSqlSafe(query))
        .bind(tenant_id)
        .fetch_optional(db)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Company not found."),
        Err(err) => {
            tracing::error!("company detail failed: {}", err);
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load company.");
        }
    };

    let members = sqlx::query(
        "SELECT id, email, display_name, role, status, joined_at, last_active_at
         FROM company_members WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 100",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let members: Vec<Value> = members
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_else(|_| "member".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
                "joinedAt": row.try_get::<DateTime<Utc>, _>("joined_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "lastActiveAt": row.try_get::<Option<DateTime<Utc>>, _>("last_active_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    let domains = sqlx::query(
        "SELECT id, domain_name, verification_status, created_at, verified_at
         FROM custom_domains WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let domains: Vec<Value> = domains
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain_name").unwrap_or_default(),
                "status": row.try_get::<String, _>("verification_status").unwrap_or_else(|_| "pending".to_string()),
                "addedAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "verifiedAt": row.try_get::<Option<DateTime<Utc>>, _>("verified_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    let invoices = sqlx::query(
        "SELECT id, invoice_number, plan, billing_cycle, amount_paise, currency, status, issued_at, paid_at, gateway, payment_ref
         FROM company_invoices WHERE tenant_id = $1 ORDER BY issued_at DESC LIMIT 50",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let invoices: Vec<Value> = invoices
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "plan": row.try_get::<String, _>("plan").unwrap_or_default(),
                "billingCycle": row.try_get::<String, _>("billing_cycle").unwrap_or_else(|_| "monthly".to_string()),
                "amountPaise": row.try_get::<i64, _>("amount_paise").unwrap_or(0),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "INR".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "paid".to_string()),
                "issuedAt": row.try_get::<DateTime<Utc>, _>("issued_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "paidAt": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").ok().flatten().map(|v| v.to_rfc3339()),
                "gateway": row.try_get::<String, _>("gateway").unwrap_or_default(),
                "paymentRef": row.try_get::<Option<String>, _>("payment_ref").ok().flatten(),
            })
        })
        .collect();

    let cases = sqlx::query(
        "SELECT i.*, (SELECT COUNT(*)::bigint FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count
         FROM investigations i WHERE i.tenant_id = $1 ORDER BY i.created_at DESC LIMIT 20",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let cases: Vec<Value> = cases.iter().map(investigation_json).collect();

    // Operational detail: the platform operator needs the same visibility the
    // customer has, plus the credentials and sessions that belong to them.
    let mailboxes = sqlx::query(
        "SELECT id, domain, address, display_name, kind, active, source, created_at, last_used_at
         FROM business_mailboxes WHERE tenant_id = $1 ORDER BY domain, address LIMIT 500",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let mailboxes: Vec<Value> = mailboxes
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain").unwrap_or_default(),
                "address": row.try_get::<String, _>("address").unwrap_or_default(),
                "name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "kind": row.try_get::<String, _>("kind").unwrap_or_default(),
                "active": row.try_get::<bool, _>("active").unwrap_or(true),
                "source": row.try_get::<String, _>("source").unwrap_or_default(),
                "createdAt": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
                "lastUsedAt": row.try_get::<Option<String>, _>("last_used_at").ok().flatten(),
            })
        })
        .collect();

    let api_keys = sqlx::query(
        "SELECT id, name, key_prefix, scopes, created_by, last_used_at, expires_at, revoked_at, created_at
         FROM company_api_keys WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let api_keys: Vec<Value> = api_keys
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "prefix": row.try_get::<String, _>("key_prefix").unwrap_or_default(),
                "scopes": row.try_get::<Vec<String>, _>("scopes").unwrap_or_default(),
                "createdBy": row.try_get::<String, _>("created_by").unwrap_or_default(),
                "lastUsedAt": row.try_get::<Option<DateTime<Utc>>, _>("last_used_at").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
                "revokedAt": row.try_get::<Option<DateTime<Utc>>, _>("revoked_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    let sessions = sqlx::query(
        "SELECT s.id, u.email, s.device_fingerprint, s.ip_address::text, s.user_agent,
                s.created_at, s.last_active, s.expires_at, s.mfa_verified
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.tenant_id = $1 AND s.is_active AND s.expires_at > NOW()
         ORDER BY s.last_active DESC LIMIT 200",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let sessions: Vec<Value> = sessions
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "device": row.try_get::<String, _>("device_fingerprint").unwrap_or_default(),
                "ip": row.try_get::<Option<String>, _>("ip_address").ok().flatten(),
                "userAgent": row.try_get::<Option<String>, _>("user_agent").ok().flatten(),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "lastActive": row.try_get::<Option<DateTime<Utc>>, _>("last_active").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
                "mfaVerified": row.try_get::<bool, _>("mfa_verified").unwrap_or(false),
            })
        })
        .collect();

    let usage = sqlx::query(
        "SELECT day, emails_sent, emails_received, api_requests, storage_bytes,
                active_users, queue_depth, bounces, spam_blocked, avg_latency_ms, error_rate
         FROM tenant_usage_daily WHERE tenant_id = $1 ORDER BY day DESC LIMIT 30",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let usage: Vec<Value> = usage
        .iter()
        .map(|row| {
            json!({
                "date": row.try_get::<Option<chrono::NaiveDate>, _>("day").ok().flatten().map(|v| v.to_string()).unwrap_or_default(),
                "sent": row.try_get::<i32, _>("emails_sent").unwrap_or(0),
                "received": row.try_get::<i32, _>("emails_received").unwrap_or(0),
                "apiRequests": row.try_get::<i32, _>("api_requests").unwrap_or(0),
                "storageBytes": row.try_get::<i64, _>("storage_bytes").unwrap_or(0),
                "activeUsers": row.try_get::<i32, _>("active_users").unwrap_or(0),
                "queueDepth": row.try_get::<i32, _>("queue_depth").unwrap_or(0),
                "bounces": row.try_get::<i32, _>("bounces").unwrap_or(0),
                "spamBlocked": row.try_get::<i32, _>("spam_blocked").unwrap_or(0),
                "avgLatencyMs": row.try_get::<i32, _>("avg_latency_ms").unwrap_or(0),
                "errorRate": row.try_get::<f64, _>("error_rate").unwrap_or(0.0),
            })
        })
        .collect();

    let recent_audit = sqlx::query(
        "SELECT id, actor_email, actor_role, action, category, resource_type, severity, created_at
         FROM platform_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let recent_audit: Vec<Value> = recent_audit
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "actor": row.try_get::<String, _>("actor_email").unwrap_or_default(),
                "actorRole": row.try_get::<String, _>("actor_role").unwrap_or_default(),
                "action": row.try_get::<String, _>("action").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "resourceType": row.try_get::<String, _>("resource_type").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_default(),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({
        "success": true,
        "company": company_json(&row),
        "members": members,
        "domains": domains,
        "invoices": invoices,
        "investigations": cases,
        "mailboxes": mailboxes,
        "apiKeys": api_keys,
        "sessions": sessions,
        "usage": usage,
        "recentAudit": recent_audit,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyUpdateRequest {
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub seat_limit: Option<i32>,
    #[serde(default)]
    pub industry: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub billing_email: Option<String>,
    #[serde(default)]
    pub legal_name: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

// ---------------------------------------------------------------------------
// Platform actions
//
// The control plane belongs to the VelisMail operator: it can suspend a
// company, move it between plans, cut its credentials and force every
// session closed. Every action is audited.
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCompanyAction {
    pub action: String,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub seat_limit: Option<i32>,
    #[serde(default)]
    pub reason: Option<String>,
}

pub async fn company_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlatformCompanyAction>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "companies.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid company id."),
    };
    let action = payload.action.trim().to_lowercase();
    let reason = payload
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let affected = match action.as_str() {
        "suspend" => {
            let result = sqlx::query(
                "UPDATE tenants SET status = 'suspended', updated_at = NOW() WHERE id = $1",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE sessions SET is_active = FALSE
                 WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE refresh_tokens SET revoked = TRUE
                 WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1) AND revoked = FALSE",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to suspend the company.",
                    )
                }
            }
        }
        "activate" => {
            let result = sqlx::query(
                "UPDATE tenants SET status = 'active', updated_at = NOW() WHERE id = $1",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to reactivate the company.",
                    )
                }
            }
        }
        "set_plan" => {
            let plan = payload
                .plan
                .as_deref()
                .map(|value| value.trim().to_lowercase())
                .filter(|value| !value.is_empty());
            let plan = match plan {
                Some(value)
                    if matches!(
                        value.as_str(),
                        "free" | "starter" | "business" | "enterprise"
                    ) =>
                {
                    value
                }
                _ => return fail(StatusCode::BAD_REQUEST, "Unknown plan."),
            };
            let result =
                sqlx::query("UPDATE tenants SET plan_tier = $2, updated_at = NOW() WHERE id = $1")
                    .bind(tenant_id)
                    .bind(&plan)
                    .execute(db)
                    .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to change the plan.",
                    )
                }
            }
        }
        "set_seats" => {
            let seats = payload.seat_limit.unwrap_or(0);
            if !(1..=100_000).contains(&seats) {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "Seat limit must be between 1 and 100000.",
                );
            }
            // The seat limit belongs to the allowance of the workspace, so it
            // is written to the limits of the tenant. The profile keeps a copy
            // for the console.
            let result = sqlx::query(
                "UPDATE tenants
                 SET limits = COALESCE(limits, '{}'::jsonb) || jsonb_build_object('max_users', $2::int),
                     updated_at = NOW()
                 WHERE id = $1",
            )
            .bind(tenant_id)
            .bind(seats)
            .execute(db)
            .await;
            if let Err(err) = result {
                tracing::error!("seat limit update failed for {tenant_id}: {err}");
                return fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to update the seat limit.",
                );
            }
            let profile = sqlx::query(
                "INSERT INTO tenant_profiles (tenant_id, seat_limit) VALUES ($1, $2)
                 ON CONFLICT (tenant_id) DO UPDATE SET seat_limit = EXCLUDED.seat_limit",
            )
            .bind(tenant_id)
            .bind(seats)
            .execute(db)
            .await;
            match profile {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to update the seat limit.",
                    )
                }
            }
        }
        "revoke_api_keys" => {
            let result = sqlx::query(
                "UPDATE company_api_keys SET revoked_at = NOW()
                 WHERE tenant_id = $1 AND revoked_at IS NULL",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to revoke the API keys.",
                    )
                }
            }
        }
        "terminate_sessions" => {
            let result = sqlx::query(
                "UPDATE sessions SET is_active = FALSE
                 WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1) AND is_active",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to terminate the sessions.",
                    )
                }
            }
        }
        "close_cases" => {
            let result = sqlx::query(
                "UPDATE investigations SET status = 'closed', updated_at = NOW()
                 WHERE tenant_id = $1 AND status IN ('open','investigating','contained')",
            )
            .bind(tenant_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to close the investigations.",
                    )
                }
            }
        }
        _ => return fail(StatusCode::BAD_REQUEST, "Unknown company action."),
    };

    if affected == 0 {
        return fail(StatusCode::NOT_FOUND, "Nothing to change for this company.");
    }

    audit(
        db,
        &actor.email,
        &actor.role,
        &format!("platform.company_{}", action),
        "companies",
        "company",
        Some(&tenant_id.to_string()),
        Some(tenant_id),
        json!({ "reason": reason, "affected": affected }),
        "warning",
    )
    .await;

    ok(json!({ "success": true, "action": action, "affected": affected }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformUserAction {
    pub action: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

pub async fn platform_user_action(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlatformUserAction>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "users.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let user_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid user id."),
    };
    let action = payload.action.trim().to_lowercase();

    let affected = match action.as_str() {
        "suspend" => {
            let result = sqlx::query(
                "UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1",
            )
            .bind(user_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE sessions SET is_active = FALSE WHERE user_id = $1 AND is_active",
            )
            .bind(user_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE",
            )
            .bind(user_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to suspend the account.",
                    )
                }
            }
        }
        "activate" => {
            let result =
                sqlx::query("UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1")
                    .bind(user_id)
                    .execute(db)
                    .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to reactivate the account.",
                    )
                }
            }
        }
        "terminate_sessions" => {
            let result = sqlx::query(
                "UPDATE sessions SET is_active = FALSE WHERE user_id = $1 AND is_active",
            )
            .bind(user_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE",
            )
            .bind(user_id)
            .execute(db)
            .await;
            match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to terminate the sessions.",
                    )
                }
            }
        }
        "set_role" => {
            let role = payload
                .role
                .as_deref()
                .map(|value| value.trim().to_lowercase())
                .filter(|value| !value.is_empty());
            let role = match role {
                Some(value)
                    if matches!(value.as_str(), "owner" | "admin" | "member" | "viewer") =>
                {
                    value
                }
                _ => return fail(StatusCode::BAD_REQUEST, "Unknown workspace role."),
            };
            if role == "owner" && !actor.is_configured_owner {
                return fail(
                    StatusCode::FORBIDDEN,
                    "Only the platform owner can assign the workspace owner role.",
                );
            }
            if role != "owner" {
                // Demoting the last active owner of any workspace would leave
                // that workspace without anybody who can administer it.
                let last_owner: bool = sqlx::query_scalar(
                    "SELECT EXISTS(
                         SELECT 1 FROM company_members cm
                         WHERE cm.user_id = $1
                           AND cm.role = 'owner'
                           AND cm.status = 'active'
                           AND (
                               SELECT COUNT(*) FROM company_members peer
                               WHERE peer.tenant_id = cm.tenant_id
                                 AND peer.role = 'owner'
                                 AND peer.status = 'active'
                           ) <= 1
                     )",
                )
                .bind(user_id)
                .fetch_one(db)
                .await
                .unwrap_or(false);
                if last_owner {
                    return fail(
                        StatusCode::BAD_REQUEST,
                        "This account is the last active owner of a workspace. Assign another owner first.",
                    );
                }
            }
            let result = sqlx::query(
                "UPDATE company_members SET role = $2, updated_at = NOW()
                 WHERE user_id = $1 AND status <> 'removed'",
            )
            .bind(user_id)
            .bind(&role)
            .execute(db)
            .await;
            let membership_rows = match result {
                Ok(done) => done.rows_affected(),
                Err(_) => {
                    return fail(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Unable to change the workspace role.",
                    )
                }
            };
            let _ = sqlx::query(
                "UPDATE users SET settings = COALESCE(settings, '{}'::jsonb)
                    || jsonb_build_object('role', $2), updated_at = NOW()
                 WHERE id = $1",
            )
            .bind(user_id)
            .bind(&role)
            .execute(db)
            .await;
            membership_rows
        }
        _ => return fail(StatusCode::BAD_REQUEST, "Unknown account action."),
    };

    if affected == 0 {
        return fail(StatusCode::NOT_FOUND, "Nothing to change for this account.");
    }

    audit(
        db,
        &actor.email,
        &actor.role,
        &format!("platform.user_{}", action),
        "users",
        "user",
        Some(&user_id.to_string()),
        None,
        json!({ "reason": payload.reason, "affected": affected }),
        "warning",
    )
    .await;

    ok(json!({ "success": true, "action": action, "affected": affected }))
}

pub async fn update_company(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<CompanyUpdateRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "companies.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let tenant_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid company id."),
    };
    let current = sqlx::query(
        "SELECT organization_name, plan_tier, status FROM tenants WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let Some(current) = current else {
        return fail(StatusCode::NOT_FOUND, "Company not found.");
    };
    let old_plan: String = current
        .try_get("plan_tier")
        .unwrap_or_else(|_| "free".to_string());
    let old_status: String = current
        .try_get("status")
        .unwrap_or_else(|_| "active".to_string());
    let company_name: String = current.try_get("organization_name").unwrap_or_default();

    if let Some(ref plan) = payload.plan {
        let normalized = plan.trim().to_lowercase();
        if !matches!(
            normalized.as_str(),
            "free" | "starter" | "business" | "enterprise"
        ) {
            return fail(StatusCode::BAD_REQUEST, "Invalid plan tier.");
        }
    }
    if let Some(ref status) = payload.status {
        let normalized = status.trim().to_lowercase();
        if !matches!(
            normalized.as_str(),
            "active" | "suspended" | "pending_verification" | "disabled"
        ) {
            return fail(StatusCode::BAD_REQUEST, "Invalid company status.");
        }
    }
    if let Some(seat_limit) = payload.seat_limit {
        if !(1..=100_000).contains(&seat_limit) {
            return fail(
                StatusCode::BAD_REQUEST,
                "Seat limit must be between 1 and 100000.",
            );
        }
    }

    let result = sqlx::query(
        "UPDATE tenants SET
            plan_tier = COALESCE($2, plan_tier),
            status = COALESCE($3, status),
            updated_at = NOW()
         WHERE id = $1",
    )
    .bind(tenant_id)
    .bind(payload.plan.as_deref().map(|v| v.trim().to_lowercase()))
    .bind(payload.status.as_deref().map(|v| v.trim().to_lowercase()))
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("company update failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to update company.",
        );
    }

    // A seat limit that was changed here also belongs to the allowance of the
    // workspace, otherwise the seat counter and the limit disagree.
    if let Some(seat_limit) = payload.seat_limit {
        let _ = sqlx::query(
            "UPDATE tenants
             SET limits = COALESCE(limits, '{}'::jsonb) || jsonb_build_object('max_users', $2::int)
             WHERE id = $1",
        )
        .bind(tenant_id)
        .bind(seat_limit)
        .execute(db)
        .await;
    }

    let _ = sqlx::query(
        "INSERT INTO tenant_profiles (tenant_id, seat_limit, industry, country, timezone, billing_email, legal_name)
         VALUES ($1, COALESCE($2, 10), $3, $4, COALESCE($5, 'Asia/Kolkata'), $6, $7)
         ON CONFLICT (tenant_id) DO UPDATE SET
            seat_limit = COALESCE($2, tenant_profiles.seat_limit),
            industry = COALESCE($3, tenant_profiles.industry),
            country = COALESCE($4, tenant_profiles.country),
            timezone = COALESCE($5, tenant_profiles.timezone),
            billing_email = COALESCE($6, tenant_profiles.billing_email),
            legal_name = COALESCE($7, tenant_profiles.legal_name),
            updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(payload.seat_limit)
    .bind(payload.industry.as_deref())
    .bind(payload.country.as_deref())
    .bind(payload.timezone.as_deref())
    .bind(payload.billing_email.as_deref())
    .bind(payload.legal_name.as_deref())
    .execute(db)
    .await;

    if let Some(ref plan) = payload.plan {
        let normalized = plan.trim().to_lowercase();
        let _ = sqlx::query(
            "UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('plan', $1), updated_at = NOW()
             WHERE tenant_id = $2",
        )
        .bind(&normalized)
        .bind(tenant_id)
        .execute(db)
        .await;
        if normalized != old_plan && normalized != "free" {
            let amount = match normalized.as_str() {
                "starter" => 29900i64,
                "business" => 99900,
                "enterprise" => 249900,
                _ => 0,
            };
            if amount > 0 {
                let invoice_number = format!(
                    "VM-{}-{}",
                    Utc::now().format("%Y%m"),
                    Uuid::new_v4().simple().to_string()[..8].to_uppercase()
                );
                let _ = sqlx::query(
                    "INSERT INTO company_invoices
                     (tenant_id, invoice_number, plan, billing_cycle, amount_paise, currency, status, issued_at, paid_at, gateway, line_items)
                     VALUES ($1, $2, $3, 'monthly', $4, 'INR', 'paid', NOW(), NOW(), 'platform-admin',
                             jsonb_build_array(jsonb_build_object('description', $3 || ' plan (platform adjustment)', 'amountPaise', $4)))",
                )
                .bind(tenant_id)
                .bind(&invoice_number)
                .bind(&normalized)
                .bind(amount)
                .execute(db)
                .await;
            }
        }
    }

    audit(
        db,
        &actor.email,
        &actor.role,
        "company.updated",
        "companies",
        "tenant",
        Some(&tenant_id.to_string()),
        Some(tenant_id),
        json!({
            "company": company_name,
            "oldPlan": old_plan,
            "oldStatus": old_status,
            "changes": {
                "plan": payload.plan,
                "status": payload.status,
                "seatLimit": payload.seat_limit,
                "industry": payload.industry,
                "country": payload.country,
                "timezone": payload.timezone,
            },
            "note": payload.note,
        }),
        "warning",
    )
    .await;

    ok(json!({ "success": true, "message": "Company updated." }))
}

pub async fn list_platform_users(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let search = params
        .get("search")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let status = params
        .get("status")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let plan = params
        .get("plan")
        .cloned()
        .unwrap_or_else(|| "all".to_string());

    let rows = sqlx::query(
        "SELECT u.id, u.email, u.display_name, u.status, u.settings, u.created_at, u.last_login,
                u.tenant_id, t.organization_name, t.organization_email,
                (SELECT cm.role FROM company_members cm
                 WHERE cm.tenant_id = u.tenant_id AND LOWER(cm.email) = LOWER(u.email)
                   AND cm.status = 'active' LIMIT 1) AS company_role,
                (SELECT COALESCE(jsonb_agg(d.domain_name ORDER BY d.domain_name), '[]'::jsonb)
                 FROM custom_domains d WHERE d.tenant_id = u.tenant_id) AS domain_list,
                (SELECT COUNT(*)::bigint FROM delivery_queue q WHERE q.sender = u.email) AS sent_count,
                (SELECT COUNT(*)::bigint FROM sessions s WHERE s.user_id = u.id AND s.is_active AND s.expires_at > NOW()) AS active_sessions,
                (SELECT COUNT(*)::bigint FROM failed_login_attempts f WHERE f.user_id = u.id AND f.attempted_at > NOW() - INTERVAL '30 days') AS failed_logins,
                 COALESCE(NULLIF(u.recovery_email, ''), u.email) AS recovery_email
         FROM users u
         LEFT JOIN tenants t ON t.id = u.tenant_id
         WHERE ($1 = '' OR LOWER(u.email) LIKE '%' || $1 || '%' OR LOWER(u.display_name) LIKE '%' || $1 || '%')
           AND ($2 = 'all' OR LOWER(u.status) = $2)
           AND ($3 = 'all' OR LOWER(COALESCE(u.settings->>'plan','free')) = $3)
         ORDER BY u.created_at DESC LIMIT 1000",
    )
    .bind(&search)
    .bind(&status)
    .bind(&plan)
    .fetch_all(db)
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("platform users query failed: {}", err);
            return fail(StatusCode::INTERNAL_SERVER_ERROR, "Unable to load users.");
        }
    };

    let users: Vec<Value> = rows
        .iter()
        .map(|row| {
            let settings: Value = row.try_get("settings").unwrap_or_else(|_| json!({}));
            let user_status: String = row.try_get("status").unwrap_or_else(|_| "active".to_string());
            let failed_logins: i64 = row.try_get("failed_logins").unwrap_or(0);
            let risk = if user_status != "active" || failed_logins >= 5 {
                "high"
            } else if failed_logins >= 2 {
                "medium"
            } else {
                "low"
            };
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "recoveryEmail": row.try_get::<String, _>("recovery_email").unwrap_or_default(),
                "displayName": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "status": user_status,
                "tenantId": row.try_get::<Option<Uuid>, _>("tenant_id").ok().flatten().map(|v| v.to_string()),
                "company": row.try_get::<Option<String>, _>("organization_name").ok().flatten(),
                "companyEmail": row.try_get::<Option<String>, _>("organization_email").ok().flatten(),
                "plan": settings.get("plan").and_then(Value::as_str).unwrap_or("Free"),
                "billingCycle": settings.get("billingCycle").and_then(Value::as_str).unwrap_or("monthly"),
                "role": settings.get("role").and_then(Value::as_str).unwrap_or("member"),
                "companyRole": row.try_get::<Option<String>, _>("company_role").ok().flatten(),
                "domains": row.try_get::<Value, _>("domain_list").unwrap_or_else(|_| json!([])),
                "isPlatformAdmin": settings.get("isPlatformAdmin").and_then(Value::as_bool).unwrap_or(false),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "lastLogin": row.try_get::<Option<DateTime<Utc>>, _>("last_login").ok().flatten().map(|v| v.to_rfc3339()),
                "sent": row.try_get::<i64, _>("sent_count").unwrap_or(0),
                "activeSessions": row.try_get::<i64, _>("active_sessions").unwrap_or(0),
                "failedLogins": failed_logins,
                "risk": risk,
            })
        })
        .collect();

    ok(json!({ "success": true, "users": users }))
}

// ---------------------------------------------------------------------------
// Investigations
// ---------------------------------------------------------------------------

pub async fn list_investigations(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let search = params
        .get("search")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let status = params
        .get("status")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let severity = params
        .get("severity")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let assignee = params
        .get("assignee")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let rows = sqlx::query(
        "SELECT i.*, (SELECT COUNT(*)::bigint FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count
         FROM investigations i
         WHERE ($1 = '' OR LOWER(i.title) LIKE '%' || $1 || '%' OR LOWER(i.case_number) LIKE '%' || $1 || '%'
                OR LOWER(COALESCE(i.tenant_name,'')) LIKE '%' || $1 || '%')
           AND ($2 = 'all' OR i.status = $2)
           AND ($3 = 'all' OR i.severity = $3)
           AND ($4 = '' OR LOWER(COALESCE(i.assignee_email,'')) = $4)
         ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 WHEN 'contained' THEN 2 ELSE 3 END,
                  CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  i.created_at DESC
         LIMIT 500",
    )
    .bind(&search)
    .bind(&status)
    .bind(&severity)
    .bind(&assignee)
    .fetch_all(db)
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("investigations query failed: {}", err);
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to load investigations.",
            );
        }
    };
    let investigations: Vec<Value> = rows.iter().map(investigation_json).collect();
    let counts = sqlx::query(
        "SELECT COUNT(*)::bigint AS total,
                COUNT(*) FILTER (WHERE status = 'open')::bigint AS open,
                COUNT(*) FILTER (WHERE status = 'investigating')::bigint AS investigating,
                COUNT(*) FILTER (WHERE severity = 'critical' AND status NOT IN ('resolved','closed'))::bigint AS critical,
                COUNT(*) FILTER (WHERE sla_due_at IS NOT NULL AND sla_due_at < NOW() AND status NOT IN ('resolved','closed'))::bigint AS overdue
         FROM investigations",
    )
    .fetch_one(db)
    .await
    .ok();
    let counts = counts
        .map(|row| {
            json!({
                "total": row.try_get::<i64, _>("total").unwrap_or(0),
                "open": row.try_get::<i64, _>("open").unwrap_or(0),
                "investigating": row.try_get::<i64, _>("investigating").unwrap_or(0),
                "critical": row.try_get::<i64, _>("critical").unwrap_or(0),
                "overdue": row.try_get::<i64, _>("overdue").unwrap_or(0),
            })
        })
        .unwrap_or_else(
            || json!({ "total": 0, "open": 0, "investigating": 0, "critical": 0, "overdue": 0 }),
        );
    ok(json!({
        "success": true,
        "investigations": investigations,
        "counts": counts,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInvestigationRequest {
    pub title: String,
    #[serde(rename = "type")]
    #[serde(default)]
    pub investigation_type: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub tenant_id: Option<String>,
    #[serde(default)]
    pub tenant_name: Option<String>,
    #[serde(default)]
    pub reporter_email: Option<String>,
    #[serde(default)]
    pub assignee_email: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub sla_hours: Option<i32>,
}

pub async fn create_investigation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateInvestigationRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "investigations.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let title = payload.title.trim();
    if title.len() < 4 {
        return fail(
            StatusCode::BAD_REQUEST,
            "Investigation title must be at least 4 characters.",
        );
    }
    let severity = payload
        .severity
        .unwrap_or_else(|| "medium".to_string())
        .to_lowercase();
    if !matches!(severity.as_str(), "low" | "medium" | "high" | "critical") {
        return fail(StatusCode::BAD_REQUEST, "Invalid severity.");
    }
    let priority = payload
        .priority
        .unwrap_or_else(|| "P3".to_string())
        .to_uppercase();
    if !matches!(priority.as_str(), "P1" | "P2" | "P3" | "P4") {
        return fail(StatusCode::BAD_REQUEST, "Invalid priority.");
    }
    let investigation_type = payload
        .investigation_type
        .unwrap_or_else(|| "abuse".to_string())
        .to_lowercase();
    let tenant_id = payload
        .tenant_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok());
    let case_number = format!(
        "INV-{}-{}",
        Utc::now().format("%Y%m%d"),
        Uuid::new_v4().simple().to_string()[..6].to_uppercase()
    );
    let sla_due_at =
        Utc::now() + chrono::Duration::hours(payload.sla_hours.unwrap_or(48).max(1) as i64);
    let tags = payload.tags.unwrap_or_default();
    let evidence = json!([]);
    let row = sqlx::query(
        "INSERT INTO investigations
         (case_number, title, investigation_type, severity, status, priority, tenant_id, tenant_name,
          reporter_email, assignee_email, summary, description, evidence, tags, sla_due_at, created_by)
         VALUES ($1,$2,$3,$4,'open',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *",
    )
    .bind(&case_number)
    .bind(title)
    .bind(&investigation_type)
    .bind(&severity)
    .bind(&priority)
    .bind(tenant_id)
    .bind(payload.tenant_name.as_deref())
    .bind(payload.reporter_email.as_deref())
    .bind(payload.assignee_email.as_deref())
    .bind(payload.summary.unwrap_or_default())
    .bind(payload.description.unwrap_or_default())
    .bind(&evidence)
    .bind(&tags)
    .bind(sla_due_at)
    .bind(&actor.email)
    .fetch_one(db)
    .await;
    let row = match row {
        Ok(row) => row,
        Err(err) => {
            tracing::error!("investigation create failed: {}", err);
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to create investigation.",
            );
        }
    };
    let id: Uuid = row.try_get("id").unwrap_or_else(|_| Uuid::nil());
    let _ = sqlx::query(
        "INSERT INTO investigation_events (investigation_id, actor_email, kind, message)
         VALUES ($1, $2, 'created', $3)",
    )
    .bind(id)
    .bind(&actor.email)
    .bind(format!("Case {} opened: {}", case_number, title))
    .execute(db)
    .await;
    audit(
        db,
        &actor.email,
        &actor.role,
        "investigation.created",
        "investigations",
        "investigation",
        Some(&id.to_string()),
        tenant_id,
        json!({ "caseNumber": case_number, "severity": severity, "priority": priority }),
        if severity == "critical" {
            "critical"
        } else {
            "warning"
        },
    )
    .await;

    let row = sqlx::query(
        "SELECT i.*, (SELECT COUNT(*)::bigint FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count
         FROM investigations i WHERE i.id = $1",
    )
    .bind(id)
    .fetch_one(db)
    .await;
    match row {
        Ok(row) => ok(json!({ "success": true, "investigation": investigation_json(&row) })),
        Err(_) => ok(json!({ "success": true, "id": id.to_string(), "caseNumber": case_number })),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationUpdateRequest {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub assignee_email: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub note: Option<String>,
}

pub async fn update_investigation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvestigationUpdateRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "investigations.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let investigation_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid investigation id."),
    };
    let existing = sqlx::query(
        "SELECT status, severity, priority, tenant_id, case_number FROM investigations WHERE id = $1",
    )
    .bind(investigation_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let Some(existing) = existing else {
        return fail(StatusCode::NOT_FOUND, "Investigation not found.");
    };
    let old_status: String = existing.try_get("status").unwrap_or_default();
    let tenant_id: Option<Uuid> = existing.try_get("tenant_id").ok().flatten();
    let case_number: String = existing.try_get("case_number").unwrap_or_default();

    if let Some(ref status) = payload.status {
        if !matches!(
            status.to_lowercase().as_str(),
            "open" | "investigating" | "contained" | "resolved" | "closed"
        ) {
            return fail(StatusCode::BAD_REQUEST, "Invalid investigation status.");
        }
    }
    if let Some(ref severity) = payload.severity {
        if !matches!(
            severity.to_lowercase().as_str(),
            "low" | "medium" | "high" | "critical"
        ) {
            return fail(StatusCode::BAD_REQUEST, "Invalid severity.");
        }
    }
    if let Some(ref priority) = payload.priority {
        if !matches!(priority.to_uppercase().as_str(), "P1" | "P2" | "P3" | "P4") {
            return fail(StatusCode::BAD_REQUEST, "Invalid priority.");
        }
    }
    let resolved_at = payload
        .status
        .as_deref()
        .filter(|value| matches!(value.to_lowercase().as_str(), "resolved" | "closed"))
        .map(|_| Utc::now());

    let result = sqlx::query(
        "UPDATE investigations SET
            status = COALESCE($2, status),
            severity = COALESCE($3, severity),
            priority = COALESCE($4, priority),
            assignee_email = COALESCE($5, assignee_email),
            summary = COALESCE($6, summary),
            tags = COALESCE($7, tags),
            resolved_at = COALESCE($8, resolved_at),
            updated_at = NOW()
         WHERE id = $1",
    )
    .bind(investigation_id)
    .bind(payload.status.as_deref().map(str::to_lowercase))
    .bind(payload.severity.as_deref().map(str::to_lowercase))
    .bind(payload.priority.as_deref().map(str::to_uppercase))
    .bind(payload.assignee_email.as_deref())
    .bind(payload.summary.as_deref())
    .bind(payload.tags.as_ref())
    .bind(resolved_at)
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("investigation update failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to update investigation.",
        );
    }
    let message = payload
        .note
        .clone()
        .unwrap_or_else(|| "Case details updated.".to_string());
    let kind = if payload.status.is_some() {
        "status"
    } else if payload.assignee_email.is_some() {
        "assignment"
    } else {
        "note"
    };
    let _ = sqlx::query(
        "INSERT INTO investigation_events (investigation_id, actor_email, kind, message, metadata)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(investigation_id)
    .bind(&actor.email)
    .bind(kind)
    .bind(&message)
    .bind(json!({
        "status": payload.status,
        "severity": payload.severity,
        "priority": payload.priority,
        "assigneeEmail": payload.assignee_email,
    }))
    .execute(db)
    .await;
    audit(
        db,
        &actor.email,
        &actor.role,
        "investigation.updated",
        "investigations",
        "investigation",
        Some(&investigation_id.to_string()),
        tenant_id,
        json!({
            "caseNumber": case_number,
            "fromStatus": old_status,
            "status": payload.status,
            "severity": payload.severity,
            "priority": payload.priority,
            "assignee": payload.assignee_email,
            "note": payload.note,
        }),
        "warning",
    )
    .await;

    let row = sqlx::query(
        "SELECT i.*, (SELECT COUNT(*)::bigint FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count
         FROM investigations i WHERE i.id = $1",
    )
    .bind(investigation_id)
    .fetch_one(db)
    .await;
    match row {
        Ok(row) => ok(json!({ "success": true, "investigation": investigation_json(&row) })),
        Err(_) => ok(json!({ "success": true })),
    }
}

pub async fn get_investigation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let investigation_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid investigation id."),
    };
    let row = sqlx::query(
        "SELECT i.*, (SELECT COUNT(*)::bigint FROM investigation_events e WHERE e.investigation_id = i.id) AS event_count
         FROM investigations i WHERE i.id = $1",
    )
    .bind(investigation_id)
    .fetch_optional(db)
    .await;
    let row = match row {
        Ok(Some(row)) => row,
        Ok(None) => return fail(StatusCode::NOT_FOUND, "Investigation not found."),
        Err(err) => {
            tracing::error!("investigation detail failed: {}", err);
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to load investigation.",
            );
        }
    };
    let events = sqlx::query(
        "SELECT id, actor_email, kind, message, metadata, created_at
         FROM investigation_events WHERE investigation_id = $1 ORDER BY created_at ASC",
    )
    .bind(investigation_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let events: Vec<Value> = events
        .iter()
        .map(|event| {
            json!({
                "id": event.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "actor": event.try_get::<String, _>("actor_email").unwrap_or_default(),
                "kind": event.try_get::<String, _>("kind").unwrap_or_else(|_| "note".to_string()),
                "message": event.try_get::<String, _>("message").unwrap_or_default(),
                "metadata": event.try_get::<Value, _>("metadata").unwrap_or_else(|_| json!({})),
                "createdAt": event.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({
        "success": true,
        "investigation": investigation_json(&row),
        "events": events,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvestigationEventRequest {
    #[serde(default)]
    pub kind: Option<String>,
    pub message: String,
    #[serde(default)]
    pub metadata: Option<Value>,
}

pub async fn add_investigation_event(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<InvestigationEventRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "investigations.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let investigation_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid investigation id."),
    };
    if payload.message.trim().is_empty() {
        return fail(StatusCode::BAD_REQUEST, "Event message is required.");
    }
    let tenant_id: Option<Uuid> =
        sqlx::query_scalar("SELECT tenant_id FROM investigations WHERE id = $1")
            .bind(investigation_id)
            .fetch_optional(db)
            .await
            .ok()
            .flatten()
            .flatten();
    let result = sqlx::query(
        "INSERT INTO investigation_events (investigation_id, actor_email, kind, message, metadata)
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(investigation_id)
    .bind(&actor.email)
    .bind(payload.kind.unwrap_or_else(|| "note".to_string()))
    .bind(payload.message.trim())
    .bind(payload.metadata.unwrap_or_else(|| json!({})))
    .execute(db)
    .await;
    if result.is_err() {
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to add investigation event.",
        );
    }
    let _ = sqlx::query("UPDATE investigations SET updated_at = NOW() WHERE id = $1")
        .bind(investigation_id)
        .execute(db)
        .await;
    audit(
        db,
        &actor.email,
        &actor.role,
        "investigation.note_added",
        "investigations",
        "investigation",
        Some(&investigation_id.to_string()),
        tenant_id,
        json!({ "message": payload.message }),
        "info",
    )
    .await;
    ok(json!({ "success": true }))
}

// ---------------------------------------------------------------------------
// Audit, team, billing, configuration, system
// ---------------------------------------------------------------------------

pub async fn platform_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let category = params
        .get("category")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let severity = params
        .get("severity")
        .cloned()
        .unwrap_or_else(|| "all".to_string());
    let search = params
        .get("search")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let tenant = params.get("tenantId").cloned().unwrap_or_default();
    let rows = sqlx::query(
        "SELECT a.id, a.actor_email, a.actor_role, a.action, a.category, a.resource_type, a.resource_id,
                a.tenant_id, a.details, a.severity, a.created_at, t.organization_name
         FROM platform_audit_logs a
         LEFT JOIN tenants t ON t.id = a.tenant_id
         WHERE ($1 = 'all' OR a.category = $1)
           AND ($2 = 'all' OR a.severity = $2)
           AND ($3 = '' OR LOWER(a.actor_email) LIKE '%' || $3 || '%' OR LOWER(a.action) LIKE '%' || $3 || '%'
                OR LOWER(a.resource_id) LIKE '%' || $3 || '%')
           AND ($4 = '' OR a.tenant_id::text = $4)
         ORDER BY a.created_at DESC LIMIT 500",
    )
    .bind(&category)
    .bind(&severity)
    .bind(&search)
    .bind(&tenant)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let logs: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "actor": row.try_get::<String, _>("actor_email").unwrap_or_default(),
                "actorRole": row.try_get::<String, _>("actor_role").unwrap_or_default(),
                "action": row.try_get::<String, _>("action").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "resourceType": row.try_get::<String, _>("resource_type").unwrap_or_default(),
                "resourceId": row.try_get::<Option<String>, _>("resource_id").ok().flatten(),
                "tenantId": row.try_get::<Option<Uuid>, _>("tenant_id").ok().flatten().map(|v| v.to_string()),
                "tenantName": row.try_get::<Option<String>, _>("organization_name").ok().flatten(),
                "details": row.try_get::<Value, _>("details").unwrap_or_else(|_| json!({})),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    let categories =
        sqlx::query("SELECT DISTINCT category FROM platform_audit_logs ORDER BY category")
            .fetch_all(db)
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|row| row.try_get::<String, _>("category").unwrap_or_default())
            .collect::<Vec<_>>();
    ok(json!({ "success": true, "logs": logs, "categories": categories }))
}

pub async fn list_platform_team(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    // Only the owner may see - and therefore hand out - the privileged roles.
    let is_owner = actor.role == "owner";
    let rows = sqlx::query(
        "SELECT a.email, a.display_name, a.role, a.status, a.permissions, a.mfa_enabled,
                a.last_seen_at, a.created_at, r.name AS role_name, r.description AS role_description
         FROM platform_admins a
         LEFT JOIN platform_roles r ON r.key = a.role
         ORDER BY CASE a.role WHEN 'owner' THEN 0 WHEN 'superadmin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END, a.created_at",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let admins: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "displayName": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_default(),
                "roleName": row.try_get::<Option<String>, _>("role_name").ok().flatten(),
                "roleDescription": row.try_get::<Option<String>, _>("role_description").ok().flatten(),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
                "permissions": row.try_get::<Value, _>("permissions").unwrap_or_else(|_| json!([])),
                "mfaEnabled": row.try_get::<bool, _>("mfa_enabled").unwrap_or(false),
                "lastSeenAt": row.try_get::<Option<DateTime<Utc>>, _>("last_seen_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    let roles = sqlx::query(
        "SELECT key, name, description, permissions, is_system FROM platform_roles ORDER BY
         CASE key WHEN 'owner' THEN 0 WHEN 'superadmin' THEN 1 WHEN 'admin' THEN 2 ELSE 3 END",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let roles: Vec<Value> = roles
        .iter()
        .filter(|row| {
            // Staff that is not the owner never sees the privileged roles, so
            // they cannot hand them out either.
            is_owner || !is_owner_only_role(&row.try_get::<String, _>("key").unwrap_or_default())
        })
        .map(|row| {
            json!({
                "key": row.try_get::<String, _>("key").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "permissions": row.try_get::<Value, _>("permissions").unwrap_or_else(|_| json!([])),
                "isSystem": row.try_get::<bool, _>("is_system").unwrap_or(true),
                "ownerOnly": is_owner_only_role(&row.try_get::<String, _>("key").unwrap_or_default()),
            })
        })
        .collect();
    ok(json!({
        "success": true,
        "admins": admins,
        "roles": roles,
        "viewerRole": actor.role,
        "isOwner": is_owner,
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPlatformAdminRequest {
    pub email: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

pub async fn add_platform_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AddPlatformAdminRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "team.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let email = normalize_email(&payload.email);
    if !email.contains('@') {
        return fail(StatusCode::BAD_REQUEST, "A valid email is required.");
    }
    let role = payload
        .role
        .unwrap_or_else(|| "admin".to_string())
        .to_lowercase();
    let valid: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM platform_roles WHERE key = $1)")
            .bind(&role)
            .fetch_one(db)
            .await
            .unwrap_or(false);
    if !valid || role == "owner" {
        return fail(StatusCode::BAD_REQUEST, "Invalid platform role.");
    }
    if is_owner_only_role(&role) && actor.role != "owner" {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can grant this role.",
        );
    }
    let existing_role: Option<String> =
        sqlx::query_scalar("SELECT role FROM platform_admins WHERE email = $1")
            .bind(&email)
            .fetch_optional(db)
            .await
            .ok()
            .flatten();
    if existing_role.as_deref() == Some("owner") {
        return fail(
            StatusCode::BAD_REQUEST,
            "The platform owner cannot be overwritten through the team form.",
        );
    }
    let display_name = payload.display_name.unwrap_or_else(|| {
        email
            .split('@')
            .next()
            .unwrap_or("Platform Admin")
            .to_string()
    });
    let permissions: Value =
        sqlx::query_scalar("SELECT permissions FROM platform_roles WHERE key = $1")
            .bind(&role)
            .fetch_one(db)
            .await
            .unwrap_or_else(|_| json!([]));
    let result = sqlx::query(
        "INSERT INTO platform_admins (email, display_name, role, status, permissions)
         VALUES ($1, $2, $3, 'active', $4)
         ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role,
             permissions = EXCLUDED.permissions, status = 'active', updated_at = NOW()",
    )
    .bind(&email)
    .bind(&display_name)
    .bind(&role)
    .bind(permissions)
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("add platform admin failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to add platform administrator.",
        );
    }
    audit(
        db,
        &actor.email,
        &actor.role,
        "platform_admin.added",
        "team",
        "platform_admin",
        Some(&email),
        None,
        json!({ "email": email, "role": role }),
        "critical",
    )
    .await;
    ok(json!({ "success": true }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePlatformAdminRequest {
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
}

pub async fn update_platform_admin(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(email): Path<String>,
    Json(payload): Json<UpdatePlatformAdminRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "team.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let email = normalize_email(&email);
    let target = sqlx::query("SELECT role, status FROM platform_admins WHERE email = $1")
        .bind(&email)
        .fetch_optional(db)
        .await
        .ok()
        .flatten();
    let Some(target) = target else {
        return fail(StatusCode::NOT_FOUND, "Platform administrator not found.");
    };
    let target_role: String = target.try_get("role").unwrap_or_default();
    if target_role == "owner" && (payload.role.is_some() || payload.status.is_some()) {
        return fail(
            StatusCode::BAD_REQUEST,
            "The platform owner cannot be demoted or suspended.",
        );
    }
    if actor.email == email && payload.status.as_deref() == Some("suspended") {
        return fail(
            StatusCode::BAD_REQUEST,
            "You cannot suspend your own account.",
        );
    }
    if let Some(ref role) = payload.role {
        let normalized = role.to_lowercase();
        let valid: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM platform_roles WHERE key = $1)")
                .bind(&normalized)
                .fetch_one(db)
                .await
                .unwrap_or(false);
        if !valid || normalized == "owner" {
            return fail(StatusCode::BAD_REQUEST, "Invalid platform role.");
        }
        if is_owner_only_role(&normalized) && actor.role != "owner" {
            return fail(
                StatusCode::FORBIDDEN,
                "Only the platform owner can grant this role.",
            );
        }
    }
    // The table only accepts these two states, so an unknown one is refused
    // here with a clear message instead of a database error.
    let status = match payload
        .status
        .as_deref()
        .map(|value| value.trim().to_lowercase())
    {
        Some(value) if !value.is_empty() => {
            if !matches!(value.as_str(), "active" | "suspended") {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "Unknown administrator status. Use 'active' or 'suspended'.",
                );
            }
            Some(value)
        }
        _ => None,
    };
    let permissions: Value = match payload.role.as_deref() {
        Some(role) => sqlx::query_scalar("SELECT permissions FROM platform_roles WHERE key = $1")
            .bind(role.to_lowercase())
            .fetch_one(db)
            .await
            .unwrap_or_else(|_| json!([])),
        None => json!(null),
    };
    let result = sqlx::query(
        "UPDATE platform_admins SET
            role = COALESCE($2, role),
            status = COALESCE($3, status),
            display_name = COALESCE($4, display_name),
            permissions = CASE WHEN $5::jsonb = 'null'::jsonb THEN permissions ELSE $5::jsonb END,
            updated_at = NOW()
         WHERE email = $1",
    )
    .bind(&email)
    .bind(payload.role.as_deref().map(str::to_lowercase))
    .bind(status)
    .bind(payload.display_name.as_deref())
    .bind(permissions)
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("update platform admin failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to update platform administrator.",
        );
    }
    audit(
        db,
        &actor.email,
        &actor.role,
        "platform_admin.updated",
        "team",
        "platform_admin",
        Some(&email),
        None,
        json!({ "role": payload.role, "status": payload.status }),
        "critical",
    )
    .await;
    ok(json!({ "success": true }))
}

pub async fn platform_billing(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let (mrr, paid_subscriptions) = monthly_revenue(db).await;
    let invoice_rows = sqlx::query(
        "SELECT i.id, i.invoice_number, i.plan, i.billing_cycle, i.amount_paise, i.currency, i.status,
                i.issued_at, i.paid_at, i.gateway, i.payment_ref, t.organization_name, t.organization_email
         FROM company_invoices i
         JOIN tenants t ON t.id = i.tenant_id
         ORDER BY i.issued_at DESC LIMIT 500",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let invoices: Vec<Value> = invoice_rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "company": row.try_get::<String, _>("organization_name").unwrap_or_default(),
                "email": row.try_get::<String, _>("organization_email").unwrap_or_default(),
                "plan": row.try_get::<String, _>("plan").unwrap_or_default(),
                "billingCycle": row.try_get::<String, _>("billing_cycle").unwrap_or_else(|_| "monthly".to_string()),
                "amountPaise": row.try_get::<i64, _>("amount_paise").unwrap_or(0),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "INR".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "paid".to_string()),
                "issuedAt": row.try_get::<DateTime<Utc>, _>("issued_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "paidAt": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").ok().flatten().map(|v| v.to_rfc3339()),
                "gateway": row.try_get::<String, _>("gateway").unwrap_or_default(),
                "paymentRef": row.try_get::<Option<String>, _>("payment_ref").ok().flatten(),
            })
        })
        .collect();
    let total_collected: i64 = invoice_rows
        .iter()
        .filter(|row| row.try_get::<String, _>("status").as_deref().unwrap_or("") == "paid")
        .map(|row| row.try_get::<i64, _>("amount_paise").unwrap_or(0))
        .sum();
    let plan_rows = sqlx::query(
        "SELECT plan_tier AS plan, COUNT(*)::bigint AS count FROM tenants
         WHERE deleted_at IS NULL GROUP BY 1 ORDER BY count DESC",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    ok(json!({
        "success": true,
        "summary": {
            "mrr": mrr,
            "arr": mrr * 12,
            "paidSubscriptions": paid_subscriptions,
            "totalCollectedPaise": total_collected,
            "invoiceCount": invoice_rows.len(),
            "currency": "INR",
        },
        "planDistribution": plan_distribution(&plan_rows),
        "invoices": invoices,
    }))
}

pub async fn list_feature_flags(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT key, name, description, enabled, rollout_percent, audience, updated_by, updated_at
         FROM feature_flags ORDER BY key",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let flags: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "key": row.try_get::<String, _>("key").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "enabled": row.try_get::<bool, _>("enabled").unwrap_or(false),
                "rolloutPercent": row.try_get::<i32, _>("rollout_percent").unwrap_or(100),
                "audience": row.try_get::<Value, _>("audience").unwrap_or_else(|_| json!({})),
                "updatedBy": row.try_get::<Option<String>, _>("updated_by").ok().flatten(),
                "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({ "success": true, "flags": flags }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureFlagUpdateRequest {
    pub key: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub rollout_percent: Option<i32>,
}

pub async fn update_feature_flag(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<FeatureFlagUpdateRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "config.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let result = sqlx::query(
        "UPDATE feature_flags SET enabled = COALESCE($2, enabled),
            rollout_percent = COALESCE($3, rollout_percent), updated_by = $4, updated_at = NOW()
         WHERE key = $1",
    )
    .bind(&payload.key)
    .bind(payload.enabled)
    .bind(payload.rollout_percent.map(|value| value.clamp(0, 100)))
    .bind(&actor.email)
    .execute(db)
    .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "feature_flag.updated",
                "config",
                "feature_flag",
                Some(&payload.key),
                None,
                json!({ "enabled": payload.enabled, "rolloutPercent": payload.rollout_percent }),
                "warning",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => fail(StatusCode::NOT_FOUND, "Feature flag not found."),
        Err(err) => {
            tracing::error!("feature flag update failed: {}", err);
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to update feature flag.",
            )
        }
    }
}

pub async fn list_announcements(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, title, body, severity, audience, status, published_at, expires_at, created_by, created_at
         FROM announcements ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "audience": row.try_get::<String, _>("audience").unwrap_or_else(|_| "all".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "draft".to_string()),
                "publishedAt": row.try_get::<Option<DateTime<Utc>>, _>("published_at").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdBy": row.try_get::<String, _>("created_by").unwrap_or_default(),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({ "success": true, "announcements": items }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAnnouncementRequest {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub severity: Option<String>,
    #[serde(default)]
    pub audience: Option<String>,
    #[serde(default)]
    pub publish: Option<bool>,
    #[serde(default)]
    pub expires_at: Option<String>,
}

pub async fn create_announcement(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateAnnouncementRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "config.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    if payload.title.trim().len() < 4 {
        return fail(StatusCode::BAD_REQUEST, "Announcement title is too short.");
    }
    let status = if payload.publish.unwrap_or(true) {
        "published"
    } else {
        "draft"
    };
    let published_at = if status == "published" {
        Some(Utc::now())
    } else {
        None
    };
    let expires_at = payload
        .expires_at
        .as_deref()
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.with_timezone(&Utc));
    let result = sqlx::query(
        "INSERT INTO announcements (title, body, severity, audience, status, published_at, expires_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    )
    .bind(payload.title.trim())
    .bind(&payload.body)
    .bind(payload.severity.unwrap_or_else(|| "info".to_string()).to_lowercase())
    .bind(payload.audience.unwrap_or_else(|| "all".to_string()).to_lowercase())
    .bind(status)
    .bind(published_at)
    .bind(expires_at)
    .bind(&actor.email)
    .execute(db)
    .await;
    match result {
        Ok(_) => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "announcement.created",
                "config",
                "announcement",
                None,
                None,
                json!({ "title": payload.title, "status": status }),
                "warning",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Err(err) => {
            tracing::error!("announcement create failed: {}", err);
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to create announcement.",
            )
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAnnouncementRequest {
    pub status: String,
}

pub async fn update_announcement(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<UpdateAnnouncementRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "config.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let announcement_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid announcement id."),
    };
    let status = payload.status.to_lowercase();
    if !matches!(status.as_str(), "draft" | "published" | "archived") {
        return fail(StatusCode::BAD_REQUEST, "Invalid announcement status.");
    }
    let published_at = if status == "published" {
        Some(Utc::now())
    } else {
        None
    };
    let result = sqlx::query(
        "UPDATE announcements SET status = $2, published_at = COALESCE($3, published_at) WHERE id = $1",
    )
    .bind(announcement_id)
    .bind(&status)
    .bind(published_at)
    .execute(db)
    .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "announcement.updated",
                "config",
                "announcement",
                Some(&announcement_id.to_string()),
                None,
                json!({ "status": status }),
                "info",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => fail(StatusCode::NOT_FOUND, "Announcement not found."),
        Err(_) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to update announcement.",
        ),
    }
}

// ---------------------------------------------------------------------------
// Platform broadcast
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastRequest {
    pub subject: String,
    pub body: String,
    /// event | feature | notification | alert | maintenance
    #[serde(default)]
    pub category: Option<String>,
    /// all | active | suspended | free | paid | verified | unverified
    #[serde(default)]
    pub audience: Option<String>,
    /// Free text filter on email and display name.
    #[serde(default)]
    pub search: Option<String>,
    /// Explicit recipient selection.
    #[serde(default)]
    pub recipient_ids: Option<Vec<Uuid>>,
    /// Extra addresses that are not accounts on the platform.
    #[serde(default)]
    pub additional_emails: Option<Vec<String>>,
    /// The mailbox the broadcast is sent from. Empty keeps the platform
    /// default sender configured on the mail service.
    #[serde(default)]
    pub from: Option<String>,
    /// Preview the recipients without sending anything.
    #[serde(default)]
    pub dry_run: Option<bool>,
    /// Safety valve for a single broadcast.
    #[serde(default)]
    pub max_recipients: Option<i64>,
}

/// How many recipients are contacted at the same time.
const BROADCAST_CONCURRENCY: usize = 5;
/// Upper bound for a single broadcast.
const BROADCAST_HARD_LIMIT: i64 = 5_000;

/// Resolve the recipients of a broadcast from the account directory.
async fn resolve_broadcast_recipients(
    db: &PgPool,
    search: &str,
    audience: &str,
    recipient_ids: Option<&[Uuid]>,
    limit: i64,
) -> Result<Vec<(String, String)>, sqlx::Error> {
    let audience = audience.to_lowercase();
    // The audience maps onto the three directory filters.
    let status_filter = match audience.as_str() {
        "active" | "suspended" => audience.as_str(),
        _ => "all",
    };
    let plan_filter = match audience.as_str() {
        "free" | "paid" => audience.as_str(),
        _ => "all",
    };
    let verified_filter = match audience.as_str() {
        "verified" | "unverified" => audience.as_str(),
        _ => "all",
    };
    let rows = sqlx::query(
        "SELECT COALESCE(NULLIF(u.recovery_email, ''), u.email) AS email,
                u.email AS account_email,
                COALESCE(u.display_name, '') AS display_name
         FROM users u
         WHERE ($1::uuid[] IS NULL OR u.id = ANY($1::uuid[]))
           AND ($2 = '' OR LOWER(u.email) LIKE '%' || LOWER($2) || '%'
                OR LOWER(COALESCE(u.display_name, '')) LIKE '%' || LOWER($2) || '%')
           AND ($3 = 'all' OR LOWER(u.status) = $3)
           AND ($4 = 'all' OR LOWER(COALESCE(u.settings->>'plan', 'free')) = $4)
           AND ($5 = 'all'
                OR ($5 = 'verified' AND COALESCE(u.recovery_email_verified, FALSE))
                OR ($5 = 'unverified' AND NOT COALESCE(u.recovery_email_verified, FALSE)))
           AND COALESCE(u.status, 'active') <> 'deactivated'
         ORDER BY u.created_at DESC
         LIMIT $6",
    )
    .bind(recipient_ids.map(|ids| ids.to_vec()))
    .bind(search)
    .bind(status_filter)
    .bind(plan_filter)
    .bind(verified_filter)
    .bind(limit)
    .fetch_all(db)
    .await?;

    Ok(rows
        .iter()
        .map(|row| {
            (
                row.try_get::<String, _>("email").unwrap_or_default(),
                row.try_get::<String, _>("display_name").unwrap_or_default(),
            )
        })
        .collect())
}

/// Collect the extra addresses that were typed into the composer.
fn collect_additional_emails(values: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for value in values {
        let email = value.trim().to_lowercase();
        if email.is_empty() || !email.contains('@') {
            continue;
        }
        if !out.contains(&email) {
            out.push(email);
        }
    }
    out
}

/// The mailboxes the platform owner can choose as the broadcast sender.
///
/// The list is built from the workspace mailbox index, so every entry is a
/// real, active mailbox on a domain that can actually send. Nothing is guessed
/// from the account email or built client side. When a workspace has no
/// mailbox at all the list stays empty and the composer keeps the platform
/// default (the configured no-reply address).
pub async fn list_broadcast_senders(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !actor.is_configured_owner {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can choose a broadcast sender.",
        );
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };

    let platform_domain = state
        .config
        .platform_from_email
        .rsplit_once('@')
        .map(|(_, domain)| domain.trim().to_lowercase())
        .unwrap_or_default();

    // Only sendable mailboxes: the mailbox is active and its domain either
    // belongs to the platform or is a verified custom domain. Listing a
    // mailbox whose domain is still pending would only produce failed sends.
    let rows = sqlx::query(
        "SELECT bm.address,
                bm.display_name,
                bm.domain,
                bm.source,
                COALESCE(t.organization_name, '') AS company,
                COALESCE((
                    SELECT cd.verification_status
                    FROM custom_domains cd
                    WHERE cd.tenant_id = bm.tenant_id
                      AND LOWER(cd.domain_name) = LOWER(bm.domain)
                    ORDER BY cd.created_at DESC NULLS LAST, cd.id DESC
                    LIMIT 1
                ), 'unknown') AS domain_status
         FROM business_mailboxes bm
         LEFT JOIN tenants t ON t.id = bm.tenant_id
         WHERE bm.active = TRUE
           AND (
                ($1 <> '' AND LOWER(bm.domain) = $1)
                OR EXISTS (
                    SELECT 1 FROM custom_domains cd
                    WHERE cd.tenant_id = bm.tenant_id
                      AND LOWER(cd.domain_name) = LOWER(bm.domain)
                      AND cd.verification_status = 'verified'
                )
           )
         ORDER BY bm.domain, bm.address
         LIMIT 500",
    )
    .bind(&platform_domain)
    .fetch_all(db)
    .await;

    let rows = match rows {
        Ok(rows) => rows,
        Err(err) => {
            tracing::error!("broadcast sender lookup failed: {}", err);
            return fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to load the workspace mailboxes.",
            );
        }
    };

    let mut seen = std::collections::HashSet::new();
    let mailboxes: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let address: String = row.try_get("address").ok()?;
            let address = address.trim().to_lowercase();
            if address.is_empty() || !seen.insert(address.clone()) {
                return None;
            }
            Some(json!({
                "address": address,
                "displayName": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain").unwrap_or_default(),
                "company": row.try_get::<String, _>("company").unwrap_or_default(),
                "source": row.try_get::<String, _>("source").unwrap_or_else(|_| "custom".to_string()),
                "domainStatus": row.try_get::<String, _>("domain_status").unwrap_or_else(|_| "unknown".to_string()),
            }))
        })
        .collect();

    ok(json!({
        "success": true,
        "defaultSender": {
            "address": state.config.platform_from_email,
            "name": state.config.platform_from_name,
        },
        "mailboxes": mailboxes,
    }))
}

/// Deliver one message to one recipient. The mail service is called per
/// recipient so nobody sees another recipient's address.
async fn deliver_broadcast(
    state: &AppState,
    headers: &HeaderMap,
    to: &str,
    subject: &str,
    body: &str,
    from: Option<&str>,
    from_name: Option<&str>,
) -> Result<(), String> {
    let mut request = state
        .http_client
        .post(format!(
            "{}/emails",
            state.config.mail_service_url.trim_end_matches('/')
        ))
        .json(&json!({
            // One request per recipient. The To header only ever contains the
            // address that belongs to this delivery.
            "to": [to],
            "cc": Value::Null,
            "bcc": Value::Null,
            "subject": subject,
            "body": body,
            "html_body": Value::Null,
            "attachment_ids": Value::Null,
            "schedule_send_at": Value::Null,
            "from": from,
            "from_name": from_name
        }));
    if let Some(auth_header) = headers.get(axum::http::header::AUTHORIZATION) {
        request = request.header(axum::http::header::AUTHORIZATION, auth_header);
    }
    let response = request.send().await.map_err(|err| err.to_string())?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let detail = response.text().await.unwrap_or_default();
    Err(format!(
        "{status}: {}",
        detail.chars().take(180).collect::<String>()
    ))
}

pub async fn platform_broadcast(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<BroadcastRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    // A platform wide broadcast reaches every account, so it stays with the
    // configured owner. Invited staff can use the console, but not this.
    if !actor.is_configured_owner {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can send a platform broadcast.",
        );
    }
    let subject = payload.subject.trim().to_string();
    let body = payload.body.trim().to_string();
    if subject.len() < 4 {
        return fail(StatusCode::BAD_REQUEST, "The subject is too short.");
    }
    if body.len() < 10 {
        return fail(StatusCode::BAD_REQUEST, "The message is too short to send.");
    }
    let category = payload
        .category
        .unwrap_or_else(|| "notification".to_string())
        .to_lowercase();
    if !matches!(
        category.as_str(),
        "event" | "feature" | "notification" | "alert" | "maintenance"
    ) {
        return fail(StatusCode::BAD_REQUEST, "Invalid broadcast category.");
    }
    let audience = payload
        .audience
        .unwrap_or_else(|| "all".to_string())
        .to_lowercase();
    if !matches!(
        audience.as_str(),
        "all" | "active" | "suspended" | "free" | "paid" | "verified" | "unverified"
    ) {
        return fail(StatusCode::BAD_REQUEST, "Invalid broadcast audience.");
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };

    // Resolve the sender once. An empty value keeps the configured platform
    // default; anything else must be a real, active workspace mailbox on a
    // verified domain. Guessing an address from the domain is never allowed,
    // so the From header can only ever be a mailbox that exists.
    let requested_from = payload.from.unwrap_or_default().trim().to_lowercase();
    let platform_default_from = state.config.platform_from_email.trim().to_lowercase();
    let platform_domain = platform_default_from
        .rsplit_once('@')
        .map(|(_, domain)| domain.to_string())
        .unwrap_or_default();
    let (sender_from, sender_name) = if requested_from.is_empty()
        || requested_from == platform_default_from
    {
        (None, None)
    } else {
        if !crate::routes::is_valid_email_address(&requested_from) {
            return fail(StatusCode::BAD_REQUEST, "Invalid sender mailbox address.");
        }
        let sender = sqlx::query(
            "SELECT bm.display_name
             FROM business_mailboxes bm
             WHERE LOWER(bm.address) = $1
               AND bm.active = TRUE
               AND (
                    ($2 <> '' AND LOWER(bm.domain) = $2)
                    OR EXISTS (
                        SELECT 1 FROM custom_domains cd
                        WHERE cd.tenant_id = bm.tenant_id
                          AND LOWER(cd.domain_name) = LOWER(bm.domain)
                          AND cd.verification_status = 'verified'
                    )
               )
             LIMIT 1",
        )
        .bind(&requested_from)
        .bind(&platform_domain)
        .fetch_optional(db)
        .await;
        match sender {
            Ok(Some(row)) => {
                let display_name: String = row.try_get("display_name").unwrap_or_default();
                let display_name = display_name.trim().to_string();
                (
                    Some(requested_from),
                    if display_name.is_empty() {
                        None
                    } else {
                        Some(display_name)
                    },
                )
            }
            Ok(None) => {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "Choose an active workspace mailbox on a verified domain, or keep the platform default.",
                )
            }
            Err(err) => {
                tracing::error!("broadcast sender lookup failed: {}", err);
                return fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to verify the sender mailbox.",
                );
            }
        }
    };

    let limit = payload
        .max_recipients
        .unwrap_or(BROADCAST_HARD_LIMIT)
        .clamp(1, BROADCAST_HARD_LIMIT);
    let search = payload.search.unwrap_or_default().trim().to_string();
    let selected = payload.recipient_ids.unwrap_or_default();
    let extra = collect_additional_emails(payload.additional_emails.unwrap_or_default());

    // Who receives the message:
    //
    // * a selection of accounts - exactly those accounts,
    // * otherwise custom addresses only - a one to one send, never the whole
    //   audience,
    // * otherwise everyone that matches the audience filter.
    let lookup = if !selected.is_empty() {
        (String::new(), "all".to_string(), Some(selected.clone()))
    } else if !extra.is_empty() {
        (String::new(), "all".to_string(), Some(Vec::new()))
    } else {
        (search.clone(), audience.clone(), None)
    };

    let mut recipients = if lookup.2.as_deref() == Some(&[][..]) {
        Vec::new()
    } else {
        match resolve_broadcast_recipients(db, &lookup.0, &lookup.1, lookup.2.as_deref(), limit)
            .await
        {
            Ok(rows) => rows,
            Err(err) => {
                tracing::error!("broadcast recipient lookup failed: {}", err);
                return fail(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Unable to resolve the broadcast recipients.",
                );
            }
        }
    };

    let account_count = recipients.len();
    for email in &extra {
        if recipients
            .iter()
            .any(|(existing, _)| existing.eq_ignore_ascii_case(email))
        {
            continue;
        }
        recipients.push((email.clone(), String::new()));
    }

    if recipients.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "No recipient matches the selected audience.",
        );
    }

    if payload.dry_run.unwrap_or(false) {
        return ok(json!({
            "success": true,
            "dryRun": true,
            "recipientCount": recipients.len(),
            "accountCount": account_count,
            "additionalCount": extra.len(),
            "recipients": recipients.iter().map(|(email, name)| json!({ "email": email, "name": name })).collect::<Vec<_>>(),
        }));
    }

    let total = recipients.len();
    let mut delivered = 0usize;
    let mut failures: Vec<Value> = Vec::new();

    // Deliver in small private batches: one request per recipient so nobody
    // ever sees another recipient's address.
    for chunk in recipients.chunks(BROADCAST_CONCURRENCY) {
        let pending = chunk.iter().map(|recipient| {
            deliver_broadcast(
                &state,
                &headers,
                &recipient.0,
                &subject,
                &body,
                sender_from.as_deref(),
                sender_name.as_deref(),
            )
        });
        let outcomes = futures::future::join_all(pending).await;
        for (recipient, outcome) in chunk.iter().zip(outcomes) {
            match outcome {
                Ok(()) => delivered += 1,
                Err(reason) => {
                    tracing::warn!("broadcast delivery failed for {}: {}", recipient.0, reason);
                    failures.push(json!({ "email": recipient.0, "error": reason }));
                }
            }
        }
    }

    let failed = failures.len();
    let status = if failed == 0 { "sent" } else { "partial" };

    let recorded_from = sender_from
        .as_deref()
        .unwrap_or(&state.config.platform_from_email);
    if let Err(err) = sqlx::query(
        "INSERT INTO platform_broadcasts
           (subject, body, category, audience, recipient_count, delivered_count, failed_count, status, from_address, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(&subject)
    .bind(&body)
    .bind(&category)
    .bind(&audience)
    .bind(total as i32)
    .bind(delivered as i32)
    .bind(failed as i32)
    .bind(status)
    .bind(recorded_from)
    .bind(&actor.email)
    .execute(db)
    .await
    {
        tracing::error!("broadcast record failed: {}", err);
    }

    audit(
        db,
        &actor.email,
        &actor.role,
        "platform.broadcast.sent",
        "system",
        "broadcast",
        None,
        None,
        json!({
            "subject": subject,
            "category": category,
            "audience": audience,
            "from": recorded_from,
            "recipients": total,
            "delivered": delivered,
            "failed": failed,
        }),
        "critical",
    )
    .await;

    ok(json!({
        "success": true,
        "recipientCount": total,
        "deliveredCount": delivered,
        "failedCount": failed,
        "status": status,
        "failures": failures,
    }))
}

pub async fn list_platform_broadcasts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !actor.is_configured_owner {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can see the broadcast history.",
        );
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, subject, body, category, audience, recipient_count, delivered_count,
                failed_count, status, COALESCE(from_address, '') AS from_address,
                created_by, created_at
         FROM platform_broadcasts ORDER BY created_at DESC LIMIT 50",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default().to_string(),
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "audience": row.try_get::<String, _>("audience").unwrap_or_default(),
                "recipientCount": row.try_get::<i32, _>("recipient_count").unwrap_or_default(),
                "deliveredCount": row.try_get::<i32, _>("delivered_count").unwrap_or_default(),
                "failedCount": row.try_get::<i32, _>("failed_count").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "fromAddress": row.try_get::<String, _>("from_address").unwrap_or_default(),
                "createdBy": row.try_get::<String, _>("created_by").unwrap_or_default(),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at")
                    .map(|value| value.to_rfc3339())
                    .unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({ "success": true, "broadcasts": items }))
}

pub async fn list_support_tickets(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT s.id, s.subject, s.category, s.priority, s.status, s.requester_email, s.assignee_email,
                s.last_message, s.message_count, s.created_at, s.updated_at, s.resolved_at, t.organization_name
         FROM support_tickets s LEFT JOIN tenants t ON t.id = s.tenant_id
         ORDER BY CASE s.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, s.updated_at DESC LIMIT 300",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let tickets: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "priority": row.try_get::<String, _>("priority").unwrap_or_else(|_| "P3".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "open".to_string()),
                "requester": row.try_get::<String, _>("requester_email").unwrap_or_default(),
                "assignee": row.try_get::<Option<String>, _>("assignee_email").ok().flatten(),
                "lastMessage": row.try_get::<String, _>("last_message").unwrap_or_default(),
                "messageCount": row.try_get::<i32, _>("message_count").unwrap_or(1),
                "company": row.try_get::<Option<String>, _>("organization_name").ok().flatten(),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "resolvedAt": row.try_get::<Option<DateTime<Utc>>, _>("resolved_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();
    ok(json!({ "success": true, "tickets": tickets }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportUpdateRequest {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub assignee_email: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
}

/// The statuses a support ticket can take. The table carries the same check,
/// so an unknown value is refused here with a clear message instead of
/// turning into a database error later.
const SUPPORT_TICKET_STATUSES: [&str; 4] = ["open", "pending", "resolved", "closed"];

/// The priorities a support ticket can take.
const SUPPORT_TICKET_PRIORITIES: [&str; 4] = ["P1", "P2", "P3", "P4"];

pub async fn update_support_ticket(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<SupportUpdateRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let ticket_id = match Uuid::parse_str(&id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid ticket id."),
    };
    let status = match payload
        .status
        .as_deref()
        .map(|value| value.trim().to_lowercase())
    {
        Some(value) if !value.is_empty() => {
            if !SUPPORT_TICKET_STATUSES.contains(&value.as_str()) {
                return fail(
                    StatusCode::BAD_REQUEST,
                    &format!(
                        "Unknown ticket status '{}'. Use one of: {}.",
                        value,
                        SUPPORT_TICKET_STATUSES.join(", ")
                    ),
                );
            }
            Some(value)
        }
        _ => None,
    };
    let priority = match payload
        .priority
        .as_deref()
        .map(|value| value.trim().to_uppercase())
    {
        Some(value) if !value.is_empty() => {
            if !SUPPORT_TICKET_PRIORITIES.contains(&value.as_str()) {
                return fail(
                    StatusCode::BAD_REQUEST,
                    &format!(
                        "Unknown ticket priority '{}'. Use one of: {}.",
                        value,
                        SUPPORT_TICKET_PRIORITIES.join(", ")
                    ),
                );
            }
            Some(value)
        }
        _ => None,
    };
    let resolved_at = status
        .as_deref()
        .filter(|value| matches!(*value, "resolved" | "closed"))
        .map(|_| Utc::now());
    let result = sqlx::query(
        "UPDATE support_tickets SET status = COALESCE($2, status),
            assignee_email = COALESCE($3, assignee_email),
            priority = COALESCE($4, priority),
            resolved_at = COALESCE($5, resolved_at), updated_at = NOW()
         WHERE id = $1",
    )
    .bind(ticket_id)
    .bind(status)
    .bind(payload.assignee_email.as_deref())
    .bind(priority)
    .bind(resolved_at)
    .execute(db)
    .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "support_ticket.updated",
                "support",
                "support_ticket",
                Some(&ticket_id.to_string()),
                None,
                json!({ "status": payload.status, "assignee": payload.assignee_email }),
                "info",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => fail(StatusCode::NOT_FOUND, "Support ticket not found."),
        Err(_) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to update support ticket.",
        ),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePlatformApiKeyRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    #[serde(default)]
    pub expires_in_days: Option<i32>,
}

/// Every platform key, with the scope catalogue and the templates.
///
/// A platform key runs the whole control plane, so only the configured owner
/// gets to see them.
pub async fn list_platform_api_keys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !actor.is_configured_owner {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can manage the platform API keys.",
        );
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, name, key_prefix, scopes, created_by, last_used_at, expires_at, revoked_at, created_at
         FROM platform_api_keys ORDER BY created_at DESC LIMIT 200",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let keys: Vec<Value> = rows
        .iter()
        .map(|row| {
            let scopes: Vec<String> = row.try_get("scopes").unwrap_or_default();
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "prefix": row.try_get::<String, _>("key_prefix").unwrap_or_default(),
                "scopes": scopes,
                "createdBy": row.try_get::<String, _>("created_by").unwrap_or_default(),
                "lastUsedAt": row.try_get::<Option<DateTime<Utc>>, _>("last_used_at").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
                "revokedAt": row.try_get::<Option<DateTime<Utc>>, _>("revoked_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({
        "success": true,
        "keys": keys,
        "scopes": crate::platform_api_keys::scope_catalog(),
        "presets": crate::platform_api_keys::key_presets(),
    }))
}

/// Create a platform key.
///
/// The key can do everything the control plane allows, so it stays with the
/// configured owner. Each scope is enforced on the API, not only here.
pub async fn create_platform_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreatePlatformApiKeyRequest>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !actor.is_configured_owner {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can create a platform API key.",
        );
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let name = payload.name.trim();
    if name.len() < 2 {
        return fail(StatusCode::BAD_REQUEST, "API key name is required.");
    }
    let allowed = crate::platform_api_keys::allowed_scopes();
    let scopes: Vec<String> = payload
        .scopes
        .unwrap_or_else(|| vec!["platform.full".to_string()])
        .into_iter()
        .filter(|scope| allowed.contains(scope))
        .collect();
    if scopes.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "Select at least one valid platform scope.",
        );
    }
    let key = format!(
        "{}{}{}",
        crate::platform_api_keys::PLATFORM_API_KEY_PREFIX,
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let prefix: String = key.chars().take(20).collect();
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let expires_at = payload
        .expires_in_days
        .map(|days| Utc::now() + chrono::Duration::days(days.clamp(1, 3650) as i64));
    let result = sqlx::query(
        "INSERT INTO platform_api_keys (name, key_prefix, key_hash, scopes, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(name)
    .bind(&prefix)
    .bind(&hash)
    .bind(&scopes)
    .bind(&actor.email)
    .bind(expires_at)
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("platform api key create failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to create the platform API key.",
        );
    }
    audit(
        db,
        &actor.email,
        &actor.role,
        "platform_api_key.created",
        "platform",
        "api_key",
        Some(&prefix),
        None,
        json!({ "name": name, "scopes": scopes, "expiresAt": expires_at }),
        "warning",
    )
    .await;
    ok(json!({
        "success": true,
        "key": key,
        "prefix": prefix,
        "scopes": scopes,
        "expiresAt": expires_at,
        "message": "Store this key now. It will not be shown again.",
    }))
}

/// Revoke a platform key. It stops working immediately.
pub async fn revoke_platform_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key_id): Path<String>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if !actor.is_configured_owner {
        return fail(
            StatusCode::FORBIDDEN,
            "Only the platform owner can revoke a platform API key.",
        );
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let id = match Uuid::parse_str(&key_id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid API key id."),
    };
    let result = sqlx::query(
        "UPDATE platform_api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
    )
    .bind(id)
    .execute(db)
    .await;
    match result {
        Ok(result) if result.rows_affected() > 0 => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "platform_api_key.revoked",
                "platform",
                "api_key",
                Some(&id.to_string()),
                None,
                json!({}),
                "warning",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => fail(StatusCode::NOT_FOUND, "API key not found."),
        Err(_) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to revoke the platform API key.",
        ),
    }
}

pub async fn platform_system(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let started = std::time::Instant::now();
    let db_ok = sqlx::query("SELECT 1").execute(db).await.is_ok();
    let db_latency_ms = started.elapsed().as_millis();
    let counts = sqlx::query(
        "SELECT
            (SELECT COUNT(*)::bigint FROM users) AS users,
            (SELECT COUNT(*)::bigint FROM tenants WHERE deleted_at IS NULL) AS companies,
            (SELECT COUNT(*)::bigint FROM delivery_queue) AS queue,
            (SELECT COUNT(*)::bigint FROM email_messages) AS messages,
            (SELECT COUNT(*)::bigint FROM storage_objects) AS objects,
            (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM storage_objects) AS storage,
            (SELECT COUNT(*)::bigint FROM sessions WHERE is_active AND expires_at > NOW()) AS sessions,
            (SELECT COUNT(*)::bigint FROM investigations WHERE status NOT IN ('resolved','closed')) AS cases,
            (SELECT pg_database_size(current_database())::bigint) AS db_size",
    )
    .fetch_one(db)
    .await
    .ok();
    let metrics = &state.metrics;
    use std::sync::atomic::Ordering;
    let requests = metrics.requests_total.load(Ordering::Relaxed);
    let in_flight = metrics.requests_in_flight.load(Ordering::Relaxed);
    let errors5xx = metrics.responses_5xx.load(Ordering::Relaxed);
    let errors4xx = metrics.responses_4xx.load(Ordering::Relaxed);
    let duration_total = metrics
        .request_duration_micros_total
        .load(Ordering::Relaxed);
    let avg_latency_ms = if requests > 0 {
        (duration_total as f64 / requests as f64) / 1000.0
    } else {
        0.0
    };
    let traffic_rows = sqlx::query(
        "SELECT day, requests, errors, rate_limited, overloads, total_latency_us
         FROM platform_traffic_daily WHERE day > CURRENT_DATE - INTERVAL '14 days' ORDER BY day",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let traffic: Vec<Value> = traffic_rows
        .iter()
        .map(|row| {
            let req = row.try_get::<i64, _>("requests").unwrap_or(0);
            let latency = row.try_get::<i64, _>("total_latency_us").unwrap_or(0);
            json!({
                "date": row.try_get::<chrono::NaiveDate, _>("day").map(|v| v.format("%Y-%m-%d").to_string()).unwrap_or_default(),
                "requests": req,
                "errors": row.try_get::<i64, _>("errors").unwrap_or(0),
                "rateLimited": row.try_get::<i64, _>("rate_limited").unwrap_or(0),
                "overloads": row.try_get::<i64, _>("overloads").unwrap_or(0),
                "avgLatencyMs": if req > 0 { (latency as f64 / req as f64) / 1000.0 } else { 0.0 },
            })
        })
        .collect();
    ok(json!({
        "success": true,
        "service": {
            "name": "api-gateway",
            "version": env!("CARGO_PKG_VERSION"),
            "uptimeSeconds": state.started_at.elapsed().as_secs(),
            "databaseConnected": db_ok,
            "databaseLatencyMs": db_latency_ms,
            "paymentGatewayConfigured": !state.config.razorpay_key_id.is_empty() && !state.config.razorpay_key_secret.is_empty(),
            "firebaseOwnerGate": !state.config.platform_owner_uids.is_empty(),
        },
        "live": {
            "requestsTotal": requests,
            "requestsInFlight": in_flight,
            "responses4xx": errors4xx,
            "responses5xx": errors5xx,
            "avgLatencyMs": avg_latency_ms,
            "rateLimited": metrics.rate_limited_total.load(Ordering::Relaxed),
            "overloads": metrics.overload_total.load(Ordering::Relaxed),
            "upstreamErrors": metrics.upstream_errors_total.load(Ordering::Relaxed),
        },
        "counts": counts.map(|row| json!({
            "users": row.try_get::<i64, _>("users").unwrap_or(0),
            "companies": row.try_get::<i64, _>("companies").unwrap_or(0),
            "queue": row.try_get::<i64, _>("queue").unwrap_or(0),
            "messages": row.try_get::<i64, _>("messages").unwrap_or(0),
            "objects": row.try_get::<i64, _>("objects").unwrap_or(0),
            "storageBytes": row.try_get::<i64, _>("storage").unwrap_or(0),
            "activeSessions": row.try_get::<i64, _>("sessions").unwrap_or(0),
            "openCases": row.try_get::<i64, _>("cases").unwrap_or(0),
            "databaseBytes": row.try_get::<i64, _>("db_size").unwrap_or(0),
        })).unwrap_or_else(|| json!({})),
        "traffic": traffic,
    }))
}

/// List every feedback note submitted from workspaces (platform control plane).
pub async fn list_platform_feedback(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, tenant_id, user_id, user_email, subject, body, category, priority,
                image_base64, status, assignee_email, reply, created_at, updated_at, resolved_at
         FROM feedback
         ORDER BY created_at DESC
         LIMIT 500",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "tenantId": row.try_get::<Option<Uuid>, _>("tenant_id").ok().flatten().map(|v| v.to_string()),
                "userId": row.try_get::<Option<Uuid>, _>("user_id").ok().flatten().map(|v| v.to_string()),
                "userEmail": row.try_get::<String, _>("user_email").unwrap_or_default(),
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_else(|_| "general".to_string()),
                "priority": row.try_get::<String, _>("priority").unwrap_or_else(|_| "medium".to_string()),
                "hasImage": row.try_get::<Option<String>, _>("image_base64").ok().flatten().is_some(),
                "imageBase64": row.try_get::<Option<String>, _>("image_base64").ok().flatten(),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "open".to_string()),
                "assigneeEmail": row.try_get::<Option<String>, _>("assignee_email").ok().flatten(),
                "reply": row.try_get::<Option<String>, _>("reply").ok().flatten(),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "resolvedAt": row.try_get::<Option<DateTime<Utc>>, _>("resolved_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();
    let open = items.iter().filter(|i| i["status"] == "open").count();
    ok(
        json!({ "success": true, "feedback": items, "counts": { "total": items.len(), "open": open } }),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformFeedbackUpdate {
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub assignee_email: Option<String>,
    #[serde(default)]
    pub reply: Option<String>,
}

pub async fn update_platform_feedback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(payload): Json<PlatformFeedbackUpdate>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let fid = match Uuid::parse_str(&id) {
        Ok(v) => v,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid feedback id."),
    };
    let resolved_at = if payload.status.as_deref() == Some("resolved")
        || payload.status.as_deref() == Some("closed")
    {
        Some(Utc::now())
    } else {
        None
    };
    let result = sqlx::query(
        "UPDATE feedback
         SET status = COALESCE($2, status),
             priority = COALESCE($3, priority),
             assignee_email = COALESCE($4, assignee_email),
             reply = COALESCE($5, reply),
             resolved_at = COALESCE($6, resolved_at),
             updated_at = NOW()
         WHERE id = $1",
    )
    .bind(fid)
    .bind(&payload.status)
    .bind(&payload.priority)
    .bind(&payload.assignee_email)
    .bind(&payload.reply)
    .bind(resolved_at)
    .execute(db)
    .await;
    match result {
        Ok(r) if r.rows_affected() > 0 => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "feedback.updated",
                "support",
                "feedback",
                Some(&id),
                None,
                json!({ "status": payload.status, "priority": payload.priority }),
                "info",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => fail(StatusCode::NOT_FOUND, "Feedback not found."),
        Err(_) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not update feedback.",
        ),
    }
}

/// Escalate a feedback note into a platform investigation.
pub async fn escalate_feedback_to_investigation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let row = sqlx::query(
        "SELECT subject, body, user_email, tenant_id, category, priority FROM feedback WHERE id = $1",
    )
    .bind(Uuid::parse_str(&id).unwrap_or(Uuid::nil()))
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let Some(row) = row else {
        return fail(StatusCode::NOT_FOUND, "Feedback not found.");
    };
    let subject: String = row.try_get("subject").unwrap_or_default();
    let body: String = row.try_get("body").unwrap_or_default();
    let email: String = row.try_get("user_email").unwrap_or_default();
    let tenant_id: Option<Uuid> = row.try_get("tenant_id").ok().flatten();
    let category: String = row
        .try_get("category")
        .unwrap_or_else(|_| "general".to_string());
    let priority: String = row
        .try_get("priority")
        .unwrap_or_else(|_| "medium".to_string());
    let sev = if priority == "high" || priority == "urgent" {
        "high"
    } else {
        "medium"
    };
    let case_priority = if priority == "high" || priority == "urgent" {
        "P2"
    } else {
        "P3"
    };
    let now = Utc::now();
    let case_number = format!("FB-{}", &id[..8]);
    let tags: Vec<String> = vec![category.clone(), "feedback".to_string()];
    let result = sqlx::query(
        "INSERT INTO investigations (case_number, title, investigation_type, severity, status, priority, tenant_id,
            reporter_email, summary, description, tags, sla_due_at, created_by, created_at, updated_at)
         VALUES ($1, $2, 'feedback', $3, 'open', $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)",
    )
    .bind(&case_number)
    .bind(&subject)
    .bind(sev)
    .bind(case_priority)
    .bind(tenant_id)
    .bind(&email)
    .bind(&body)
    .bind(&body)
    .bind(&tags)
    .bind(now + chrono::Duration::days(7))
    .bind(&actor.email)
    .bind(now)
    .execute(db)
    .await;
    match result {
        Ok(_) => {
            let _ = sqlx::query(
                "UPDATE feedback SET status = 'escalated', updated_at = NOW() WHERE id = $1",
            )
            .bind(Uuid::parse_str(&id).unwrap_or(Uuid::nil()))
            .execute(db)
            .await;
            ok(json!({ "success": true, "caseNumber": case_number }))
        }
        Err(e) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Could not create investigation: {}", e),
        ),
    }
}
pub async fn list_platform_settings(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult {
    if let Err(response) = authorize_platform(&state, &headers).await {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT key, value, updated_by, updated_at FROM platform_settings ORDER BY key",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let settings: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "key": row.try_get::<String, _>("key").unwrap_or_default(),
                "value": row.try_get::<Value, _>("value").unwrap_or_else(|_| json!({})),
                "updatedBy": row.try_get::<Option<String>, _>("updated_by").ok().flatten(),
                "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({ "success": true, "settings": settings }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSettingUpdate {
    pub key: String,
    pub value: Value,
}

pub async fn update_platform_setting(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<PlatformSettingUpdate>,
) -> ApiResult {
    let actor = match authorize_platform(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = require_permission(&actor, "config.write") {
        return response;
    }
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let result = sqlx::query(
        "INSERT INTO platform_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()",
    )
    .bind(&payload.key)
    .bind(&payload.value)
    .bind(&actor.email)
    .execute(db)
    .await;
    match result {
        Ok(_) => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "platform_setting.updated",
                "config",
                "platform_setting",
                Some(&payload.key),
                None,
                json!({ "value": payload.value }),
                "warning",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Err(err) => {
            tracing::error!("platform setting update failed: {}", err);
            fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to update platform setting.",
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Company control plane
// ---------------------------------------------------------------------------

/// The allowance of a plan, in the shape the console shows it.
///
/// The numbers live in the shared crate so the console can never show a
/// limit that differs from the one the tenant service enforces.
fn plan_limits(plan: &str) -> Value {
    velismail_common::plans::plan_allowance(plan).to_console_limits()
}

/// The allowance a tenant actually runs with.
///
/// A tenant that was provisioned with its own allowance keeps it, every other
/// tenant gets the published allowance of its plan. A negotiated plan - which
/// is only available on request - has no published allowance, so without a
/// stored one it is not capped at all.
pub(crate) async fn tenant_allowance(
    db: &PgPool,
    tenant_id: Uuid,
    plan: &str,
) -> velismail_common::plans::PlanAllowance {
    let stored: Value = sqlx::query_scalar("SELECT limits FROM tenants WHERE id = $1")
        .bind(tenant_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    velismail_common::plans::effective_allowance(plan, &stored)
}

/// Seats a workspace has already promised.
///
/// Active members, pending workspace invitations and pending team-access keys
/// all reserve a seat. The same email can exist in both invitation stores, so
/// the union counts every address once.
pub(crate) async fn workspace_seat_usage(db: &PgPool, tenant_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM (
            SELECT LOWER(email) AS email
            FROM company_members
            WHERE tenant_id = $1 AND status IN ('active', 'invited')
            UNION
            SELECT LOWER(email)
            FROM workspace_invitations
            WHERE tenant_id = $1 AND status = 'pending'
              AND (expires_at IS NULL OR expires_at > NOW())
            UNION
            SELECT LOWER(data->>'email')
            FROM team_invites
            WHERE revoked = FALSE
              AND data->>'status' = 'pending'
              AND data->'workspace'->>'tenantId' = $2
              AND CASE
                      WHEN COALESCE(data->>'expiresAt', '') = '' THEN TRUE
                      WHEN (data->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                          THEN (data->>'expiresAt')::timestamptz > NOW()
                      ELSE FALSE
                  END
        ) seats",
    )
    .bind(tenant_id)
    .bind(tenant_id.to_string())
    .fetch_one(db)
    .await
    .unwrap_or(0)
}

/// True when the address already holds a seat or a pending invitation, so an
/// extra invitation does not consume another seat.
pub(crate) async fn workspace_email_reserved(db: &PgPool, tenant_id: Uuid, email: &str) -> bool {
    sqlx::query_scalar(
        "SELECT EXISTS(
            SELECT 1 FROM company_members
            WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)
              AND status IN ('active', 'invited')
            UNION ALL
            SELECT 1 FROM workspace_invitations
            WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'
            UNION ALL
            SELECT 1 FROM team_invites
            WHERE revoked = FALSE
              AND data->>'status' = 'pending'
              AND data->'workspace'->>'tenantId' = $3
              AND LOWER(data->>'email') = LOWER($2)
              AND CASE
                      WHEN COALESCE(data->>'expiresAt', '') = '' THEN TRUE
                      WHEN (data->>'expiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
                          THEN (data->>'expiresAt')::timestamptz > NOW()
                      ELSE FALSE
                  END
        )",
    )
    .bind(tenant_id)
    .bind(email)
    .bind(tenant_id.to_string())
    .fetch_one(db)
    .await
    .unwrap_or(false)
}

pub async fn company_overview(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let tenant_id = actor.tenant_id;

    let counts = sqlx::query(
        "SELECT
            (SELECT COUNT(*)::bigint FROM company_members WHERE tenant_id = $1 AND status = 'active') AS members,
            (SELECT COUNT(*)::bigint FROM custom_domains WHERE tenant_id = $1) AS domains,
            (SELECT COUNT(*)::bigint FROM company_api_keys WHERE tenant_id = $1 AND revoked_at IS NULL) AS api_keys,
            (SELECT COUNT(*)::bigint FROM company_invoices WHERE tenant_id = $1 AND status = 'paid') AS invoices,
            (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM storage_objects WHERE tenant_id = $1) AS storage,
            (SELECT COUNT(*)::bigint FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE u.tenant_id = $1 AND s.is_active AND s.expires_at > NOW()) AS active_sessions,
            (SELECT COUNT(*)::bigint FROM investigations WHERE tenant_id = $1 AND status NOT IN ('resolved','closed')) AS open_cases,
            (SELECT COUNT(*)::bigint FROM delivery_queue q JOIN users u ON u.email = q.sender
                WHERE u.tenant_id = $1 AND q.created_at > NOW() - INTERVAL '30 days') AS sent30,
            (SELECT COUNT(*)::bigint FROM delivery_queue q JOIN users u ON u.email = q.sender
                WHERE u.tenant_id = $1 AND q.status IN ('pending','sending','retry')) AS queue_depth,
            (SELECT COUNT(*)::bigint FROM delivery_queue q JOIN users u ON u.email = q.sender
                WHERE u.tenant_id = $1 AND q.status = 'failed' AND q.created_at > NOW() - INTERVAL '30 days') AS failed30,
            (SELECT COALESCE(SUM(u2.api_requests),0)::bigint FROM tenant_usage_daily u2
                WHERE u2.tenant_id = $1 AND u2.day >= CURRENT_DATE - 30) AS api_requests30",
    )
    .bind(tenant_id)
    .fetch_one(db)
    .await;
    let counts = counts
        .map(|row| {
            json!({
                "members": row.try_get::<i64, _>("members").unwrap_or(0),
                "domains": row.try_get::<i64, _>("domains").unwrap_or(0),
                "apiKeys": row.try_get::<i64, _>("api_keys").unwrap_or(0),
                "invoices": row.try_get::<i64, _>("invoices").unwrap_or(0),
                "storageBytes": row.try_get::<i64, _>("storage").unwrap_or(0),
                "activeSessions": row.try_get::<i64, _>("active_sessions").unwrap_or(0),
                "openCases": row.try_get::<i64, _>("open_cases").unwrap_or(0),
                "sent30d": row.try_get::<i64, _>("sent30").unwrap_or(0),
                "queueDepth": row.try_get::<i64, _>("queue_depth").unwrap_or(0),
                "failed30d": row.try_get::<i64, _>("failed30").unwrap_or(0),
                "apiRequests30": row.try_get::<i64, _>("api_requests30").unwrap_or(0),
            })
        })
        .unwrap_or_else(|_| json!({}));

    let series = sqlx::query(
        "SELECT q.created_at::date AS day, COUNT(*)::bigint AS sent,
                COUNT(*) FILTER (WHERE q.status = 'delivered')::bigint AS delivered,
                COUNT(*) FILTER (WHERE q.status = 'failed')::bigint AS failed
         FROM delivery_queue q JOIN users u ON u.email = q.sender
         WHERE u.tenant_id = $1 AND q.created_at > NOW() - INTERVAL '30 days'
         GROUP BY 1 ORDER BY 1",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let mut by_day: HashMap<String, (i64, i64, i64)> = HashMap::new();
    for row in &series {
        if let Ok(day) = row.try_get::<chrono::NaiveDate, _>("day") {
            by_day.insert(
                day.format("%Y-%m-%d").to_string(),
                (
                    row.try_get::<i64, _>("sent").unwrap_or(0),
                    row.try_get::<i64, _>("delivered").unwrap_or(0),
                    row.try_get::<i64, _>("failed").unwrap_or(0),
                ),
            );
        }
    }
    let today = Utc::now().date_naive();
    let activity: Vec<Value> = (0..30)
        .rev()
        .map(|offset| {
            let day = today - chrono::Duration::days(offset);
            let key = day.format("%Y-%m-%d").to_string();
            let (sent, delivered, failed) = by_day.get(&key).copied().unwrap_or((0, 0, 0));
            json!({ "date": key, "sent": sent, "delivered": delivered, "failed": failed })
        })
        .collect();

    let members = sqlx::query(
        "SELECT email, display_name, role, status, last_active_at
         FROM company_members WHERE tenant_id = $1 AND status = 'active'
         ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at LIMIT 8",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let members: Vec<Value> = members
        .iter()
        .map(|row| {
            json!({
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_else(|_| "member".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
                "lastActiveAt": row.try_get::<Option<DateTime<Utc>>, _>("last_active_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    let audit_rows = sqlx::query(
        "SELECT id, actor_email, action, category, severity, created_at
         FROM platform_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 8",
    )
    .bind(tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let recent_activity: Vec<Value> = audit_rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "actor": row.try_get::<String, _>("actor_email").unwrap_or_default(),
                "action": row.try_get::<String, _>("action").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();

    // The limits the tenant actually runs with. A tenant that was provisioned
    // with its own allowance keeps it, every other tenant gets the allowance
    // of its plan - the same numbers the tenant service enforces. Nothing is
    // invented here, so the console can never show a limit that is not real.
    let stored_limits: Value = sqlx::query_scalar("SELECT limits FROM tenants WHERE id = $1")
        .bind(tenant_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let allowance = velismail_common::plans::effective_allowance(&actor.plan, &stored_limits);
    let limits = allowance.to_console_limits();
    let sent_used = counts.get("sent30d").and_then(Value::as_i64).unwrap_or(0);
    let email_limit = limits
        .get("emailsPerMonth")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let storage_used = counts
        .get("storageBytes")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let storage_limit = limits
        .get("storageBytes")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let api_requests_used = counts
        .get("apiRequests30")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let api_requests_limit = limits
        .get("apiRequestsPerMinute")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let seats_used = counts.get("members").and_then(Value::as_i64).unwrap_or(0);
    let seats_limit = limits.get("seats").and_then(Value::as_i64).unwrap_or(0);
    let is_free_trial = actor.plan.eq_ignore_ascii_case("free");

    // Every allowance the workspace has, with the real consumption, so the
    // customer can see what is included, what is used and what to buy next.
    // A limit of zero means the plan does not cap it, and the console says so
    // instead of showing a made up number.
    let quotas = json!([
        {
            "key": "emails",
            "label": "Mail volume",
            "used": sent_used,
            "limit": email_limit,
            "unit": "emails",
            "period": "per month",
            "source": "Delivery engine volume over the last 30 days"
        },
        {
            "key": "storage",
            "label": "Database storage",
            "used": storage_used,
            "limit": storage_limit,
            "unit": "bytes",
            "period": "",
            "source": "Object storage attached to this workspace"
        },
        {
            "key": "apiRequests",
            "label": "API request rate",
            "used": api_requests_used,
            "limit": api_requests_limit,
            "unit": "requests",
            "period": "per minute",
            "source": "Requests made with your API keys"
        },
        {
            "key": "seats",
            "label": "Team seats",
            "used": seats_used,
            "limit": seats_limit,
            "unit": "seats",
            "period": "",
            "source": "People with access to this workspace"
        }
    ]);

    ok(json!({
        "success": true,
        "company": {
            "id": tenant_id.to_string(),
            "name": actor.tenant_name,
            "plan": actor.plan,
            "status": actor.company_status,
            "role": actor.role,
            "email": actor.email,
            "isPlatformAdmin": actor.is_platform_admin,
        },
        "counts": counts,
        "limits": limits,
        "quotas": quotas,
        "trial": {
            "active": is_free_trial,
            "label": if is_free_trial { "Free trial" } else { "" },
            "detail": if is_free_trial {
                "The free plan includes 500 MB of database storage and 100 mail API sends. Upgrade to keep sending when the trial ends."
            } else {
                ""
            }
        },
        "usage": {
            "emailPercent": if email_limit > 0 { (sent_used as f64 / email_limit as f64 * 100.0).min(100.0) } else { 0.0 },
            "storagePercent": if storage_limit > 0 { (storage_used as f64 / storage_limit as f64 * 100.0).min(100.0) } else { 0.0 },
        },
        "activity": activity,
        "members": members,
        "recentActivity": recent_activity,
        "generatedAt": Utc::now().to_rfc3339(),
    }))
}

pub async fn company_members(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, user_id, email, display_name, role, status, invited_by, joined_at, last_active_at, created_at
         FROM company_members WHERE tenant_id = $1 ORDER BY
         CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, created_at",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let members: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "userId": row.try_get::<Option<Uuid>, _>("user_id").ok().flatten().map(|v| v.to_string()),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_else(|_| "member".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "active".to_string()),
                "invitedBy": row.try_get::<Option<String>, _>("invited_by").ok().flatten(),
                "joinedAt": row.try_get::<DateTime<Utc>, _>("joined_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "lastActiveAt": row.try_get::<Option<DateTime<Utc>>, _>("last_active_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();

    // The workspace API writes the invitations of a company, so the console
    // reads the same table. Otherwise the two views disagree.
    let invitations = sqlx::query(
        "SELECT id, email, role, status, invited_by, expires_at, created_at
         FROM workspace_invitations WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let invitations: Vec<Value> = invitations
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "invitedBy": row.try_get::<String, _>("invited_by").unwrap_or_default(),
                "expiresAt": row.try_get::<DateTime<Utc>, _>("expires_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();

    let allowance = tenant_allowance(db, actor.tenant_id, &actor.plan).await;
    let seats_max = if allowance.seats > 0 {
        allowance.seats
    } else {
        0
    };

    ok(json!({
        "success": true,
        "members": members,
        "invitations": invitations,
        "seatLimit": {
            "used": workspace_seat_usage(db, actor.tenant_id).await,
            "max": seats_max,
            "capped": allowance.seats > 0,
        },
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanyMemberUpdateRequest {
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
}

pub async fn company_update_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(member_id): Path<String>,
    Json(payload): Json<CompanyMemberUpdateRequest>,
) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let id = match Uuid::parse_str(&member_id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid member id."),
    };
    let target = sqlx::query(
        "SELECT email, role, status, user_id, display_name FROM company_members WHERE id = $1 AND tenant_id = $2",
    )
    .bind(id)
    .bind(actor.tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let Some(target) = target else {
        return fail(StatusCode::NOT_FOUND, "Company member not found.");
    };
    let target_email: String = target.try_get("email").unwrap_or_default();
    let target_role: String = target
        .try_get("role")
        .unwrap_or_else(|_| "member".to_string());
    let target_status: String = target
        .try_get("status")
        .unwrap_or_else(|_| "active".to_string());
    let target_user: Option<Uuid> = target.try_get("user_id").ok().flatten();
    let requested_role = payload.role.as_deref().map(str::to_lowercase);

    if actor.role != "owner"
        && (target_role == "owner"
            || target_role == "admin"
            || requested_role.as_deref() == Some("owner")
            || requested_role.as_deref() == Some("admin"))
    {
        return fail(
            StatusCode::FORBIDDEN,
            "Only a workspace owner can change owner- or admin-level access.",
        );
    }

    if let Some(ref role) = requested_role {
        let role = role.to_lowercase();
        let valid: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM company_roles WHERE key = $1)")
                .bind(&role)
                .fetch_one(db)
                .await
                .unwrap_or(false);
        if !valid {
            return fail(StatusCode::BAD_REQUEST, "Invalid company role.");
        }
        if role != "owner" && target_role == "owner" {
            let owners: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM company_members WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'",
            )
            .bind(actor.tenant_id)
            .fetch_one(db)
            .await
            .unwrap_or(1);
            if owners <= 1 {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "The workspace must keep at least one owner.",
                );
            }
        }
        if target_email == actor.email && role != "owner" && actor.role == "owner" {
            let owners: i64 = sqlx::query_scalar(
                "SELECT COUNT(*)::bigint FROM company_members WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'",
            )
            .bind(actor.tenant_id)
            .fetch_one(db)
            .await
            .unwrap_or(1);
            if owners <= 1 {
                return fail(
                    StatusCode::BAD_REQUEST,
                    "You cannot remove your own owner role while you are the only owner.",
                );
            }
        }
    }
    if let Some(ref status) = payload.status {
        if !matches!(
            status.to_lowercase().as_str(),
            "active" | "suspended" | "removed"
        ) {
            return fail(StatusCode::BAD_REQUEST, "Invalid member status.");
        }
        if target_email == actor.email && status.to_lowercase() != "active" {
            return fail(
                StatusCode::BAD_REQUEST,
                "You cannot suspend your own account.",
            );
        }
    }

    let new_role = payload.role.as_deref().map(str::to_lowercase);
    let new_status = payload.status.as_deref().map(str::to_lowercase);

    // Reactivating a suspended member consumes a seat again.
    if new_status.as_deref() == Some("active") && target_status != "active" {
        let allowance = tenant_allowance(db, actor.tenant_id, &actor.plan).await;
        if allowance.seats > 0 && workspace_seat_usage(db, actor.tenant_id).await >= allowance.seats
        {
            return fail(
                StatusCode::CONFLICT,
                &format!(
                    "All {} seats of this workspace are in use. Remove a member or raise the seat limit first.",
                    allowance.seats
                ),
            );
        }
    }

    let result = sqlx::query(
        "UPDATE company_members SET role = COALESCE($2, role), status = COALESCE($3, status), updated_at = NOW()
         WHERE id = $1",
    )
    .bind(id)
    .bind(new_role.as_deref())
    .bind(new_status.as_deref())
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("company member update failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to update company member.",
        );
    }

    if let Some(user_id) = target_user {
        if let Some(ref role) = new_role {
            let _ = sqlx::query(
                "UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('role', $2), updated_at = NOW()
                 WHERE id = $1",
            )
            .bind(user_id)
            .bind(role)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE tenant_users SET role = $3, updated_at = NOW() WHERE tenant_id = $1 AND user_id = $2",
            )
            .bind(actor.tenant_id)
            .bind(user_id)
            .bind(role)
            .execute(db)
            .await;
        }
        if new_status.as_deref() == Some("suspended") || new_status.as_deref() == Some("removed") {
            let _ = sqlx::query(
                "UPDATE sessions SET is_active = FALSE WHERE user_id = $1
                   AND (is_active = TRUE OR expires_at > NOW())",
            )
            .bind(user_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE",
            )
            .bind(user_id)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "UPDATE company_api_keys SET revoked_at = NOW()
                 WHERE tenant_id = $1 AND LOWER(created_by) = LOWER($2) AND revoked_at IS NULL",
            )
            .bind(actor.tenant_id)
            .bind(&target_email)
            .execute(db)
            .await;
        }
    }

    if new_status.as_deref() == Some("suspended") || new_status.as_deref() == Some("removed") {
        // A suspended or removed member must not keep a pending invitation
        // alive in either invitation store. Otherwise the old email link or
        // team access key could add them straight back.
        let _ = sqlx::query(
            "UPDATE workspace_invitations SET status = 'revoked'
             WHERE tenant_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'",
        )
        .bind(actor.tenant_id)
        .bind(&target_email)
        .execute(db)
        .await;
        let _ = sqlx::query(
            "UPDATE team_invites
                SET revoked = TRUE,
                    data = data || '{\"status\":\"revoked\"}'::jsonb
              WHERE revoked = FALSE
                AND data->>'status' = 'pending'
                AND data->'workspace'->>'tenantId' = $1
                AND LOWER(data->>'email') = LOWER($2)",
        )
        .bind(actor.tenant_id.to_string())
        .bind(&target_email)
        .execute(db)
        .await;

        let _ = sqlx::query(
            "INSERT INTO security_events (tenant_id, user_id, event_type, severity, details)
             VALUES ($1, $2, 'member_access_revoked', 'warning', $3)",
        )
        .bind(actor.tenant_id)
        .bind(target_user)
        .bind(json!({ "email": target_email, "by": actor.email }))
        .execute(db)
        .await;
    }

    audit(
        db,
        &actor.email,
        &actor.role,
        "company_member.updated",
        "companies",
        "company_member",
        Some(&id.to_string()),
        Some(actor.tenant_id),
        json!({ "email": target_email, "role": new_role, "status": new_status }),
        "warning",
    )
    .await;
    ok(json!({ "success": true }))
}

pub async fn company_roles(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT key, name, description, permissions FROM company_roles ORDER BY
         CASE key WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let roles: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "key": row.try_get::<String, _>("key").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "description": row.try_get::<String, _>("description").unwrap_or_default(),
                "permissions": row.try_get::<Value, _>("permissions").unwrap_or_else(|_| json!([])),
            })
        })
        .collect();
    ok(json!({ "success": true, "roles": roles, "currentRole": actor.role }))
}

pub async fn company_usage(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let days = params
        .get("days")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(30)
        .clamp(7, 90);
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT q.created_at::date AS day,
                COUNT(*)::bigint AS sent,
                COUNT(*) FILTER (WHERE q.status = 'delivered')::bigint AS delivered,
                COUNT(*) FILTER (WHERE q.status = 'failed')::bigint AS failed,
                COUNT(*) FILTER (WHERE q.status = 'bounced')::bigint AS bounced
         FROM delivery_queue q JOIN users u ON u.email = q.sender
         WHERE u.tenant_id = $1 AND q.created_at > NOW() - INTERVAL '{} days'
         GROUP BY 1 ORDER BY 1",
        days
    )))
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let mut by_day: HashMap<String, Value> = HashMap::new();
    for row in &rows {
        if let Ok(day) = row.try_get::<chrono::NaiveDate, _>("day") {
            by_day.insert(
                day.format("%Y-%m-%d").to_string(),
                json!({
                    "sent": row.try_get::<i64, _>("sent").unwrap_or(0),
                    "delivered": row.try_get::<i64, _>("delivered").unwrap_or(0),
                    "failed": row.try_get::<i64, _>("failed").unwrap_or(0),
                    "bounced": row.try_get::<i64, _>("bounced").unwrap_or(0),
                }),
            );
        }
    }
    let today = Utc::now().date_naive();
    let series: Vec<Value> = (0..days)
        .rev()
        .map(|offset| {
            let day = today - chrono::Duration::days(offset);
            let key = day.format("%Y-%m-%d").to_string();
            let entry = by_day.get(&key).cloned().unwrap_or_else(|| {
                json!({
                    "sent": 0, "delivered": 0, "failed": 0, "bounced": 0
                })
            });
            json!({
                "date": key,
                "sent": entry.get("sent").and_then(Value::as_i64).unwrap_or(0),
                "delivered": entry.get("delivered").and_then(Value::as_i64).unwrap_or(0),
                "failed": entry.get("failed").and_then(Value::as_i64).unwrap_or(0),
                "bounced": entry.get("bounced").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect();

    let totals = sqlx::query(
        "SELECT
            (SELECT COUNT(*)::bigint FROM delivery_queue q JOIN users u ON u.email = q.sender
              WHERE u.tenant_id = $1 AND q.created_at > NOW() - INTERVAL '30 days') AS sent,
            (SELECT COUNT(*)::bigint FROM delivery_queue q JOIN users u ON u.email = q.sender
              WHERE u.tenant_id = $1 AND q.status = 'delivered' AND q.created_at > NOW() - INTERVAL '30 days') AS delivered,
            (SELECT COUNT(*)::bigint FROM delivery_queue q JOIN users u ON u.email = q.sender
              WHERE u.tenant_id = $1 AND q.status = 'failed' AND q.created_at > NOW() - INTERVAL '30 days') AS failed,
            (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM storage_objects WHERE tenant_id = $1) AS storage,
            (SELECT COUNT(*)::bigint FROM email_messages m JOIN users u ON u.id = m.user_id
              WHERE u.tenant_id = $1) AS messages",
    )
    .bind(actor.tenant_id)
    .fetch_one(db)
    .await
    .ok();
    let totals = totals
        .map(|row| {
            json!({
                "sent30d": row.try_get::<i64, _>("sent").unwrap_or(0),
                "delivered30d": row.try_get::<i64, _>("delivered").unwrap_or(0),
                "failed30d": row.try_get::<i64, _>("failed").unwrap_or(0),
                "storageBytes": row.try_get::<i64, _>("storage").unwrap_or(0),
                "messages": row.try_get::<i64, _>("messages").unwrap_or(0),
            })
        })
        .unwrap_or_else(|| json!({}));
    let history = sqlx::query(
        "SELECT day, emails_sent, emails_received, api_requests, storage_bytes, active_users, queue_depth, bounces, spam_blocked, avg_latency_ms, error_rate::float8 AS error_rate
         FROM tenant_usage_daily WHERE tenant_id = $1 ORDER BY day DESC LIMIT $2",
    )
    .bind(actor.tenant_id)
    .bind(days)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let history: Vec<Value> = history
        .iter()
        .map(|row| {
            json!({
                "date": row.try_get::<chrono::NaiveDate, _>("day").map(|v| v.format("%Y-%m-%d").to_string()).unwrap_or_default(),
                "sent": row.try_get::<i32, _>("emails_sent").unwrap_or(0),
                "received": row.try_get::<i32, _>("emails_received").unwrap_or(0),
                "apiRequests": row.try_get::<i32, _>("api_requests").unwrap_or(0),
                "storageBytes": row.try_get::<i64, _>("storage_bytes").unwrap_or(0),
                "activeUsers": row.try_get::<i32, _>("active_users").unwrap_or(0),
                "queueDepth": row.try_get::<i32, _>("queue_depth").unwrap_or(0),
                "bounces": row.try_get::<i32, _>("bounces").unwrap_or(0),
                "spamBlocked": row.try_get::<i32, _>("spam_blocked").unwrap_or(0),
                "avgLatencyMs": row.try_get::<i32, _>("avg_latency_ms").unwrap_or(0),
                "errorRate": row.try_get::<f64, _>("error_rate").unwrap_or(0.0),
            })
        })
        .collect();
    let allowance = tenant_allowance(db, actor.tenant_id, &actor.plan).await;
    let limits = allowance.to_console_limits();
    let sent = totals.get("sent30d").and_then(Value::as_i64).unwrap_or(0);
    let email_limit = limits
        .get("emailsPerMonth")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    ok(json!({
        "success": true,
        "rangeDays": days,
        "plan": actor.plan,
        "limits": limits,
        "totals": totals,
        "usagePercent": if email_limit > 0 { (sent as f64 / email_limit as f64 * 100.0).min(100.0) } else { 0.0 },
        "series": series,
        "history": history,
    }))
}

pub async fn company_audit(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, actor_email AS actor, action, 'platform' AS source, category, severity, details,
                resource_type, created_at
         FROM platform_audit_logs WHERE tenant_id = $1
         UNION ALL
         SELECT a.id, COALESCE(u.email, 'system') AS actor, a.action, 'tenant' AS source,
                a.resource_type AS category, 'info' AS severity, a.details,
                a.resource_type, a.created_at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.tenant_id = $1
         ORDER BY created_at DESC LIMIT 500",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let entries: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "actor": row.try_get::<String, _>("actor").unwrap_or_default(),
                "action": row.try_get::<String, _>("action").unwrap_or_default(),
                "source": row.try_get::<String, _>("source").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "resourceType": row.try_get::<String, _>("resource_type").unwrap_or_default(),
                "details": row.try_get::<Value, _>("details").unwrap_or_else(|_| json!({})),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    ok(json!({ "success": true, "entries": entries }))
}

pub async fn company_security(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let sessions = sqlx::query(
        "SELECT s.id, u.email, s.device_fingerprint, s.ip_address::text AS ip, s.user_agent,
                s.created_at, s.last_active, s.expires_at, s.mfa_verified
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.tenant_id = $1 AND s.is_active AND s.expires_at > NOW()
         ORDER BY s.last_active DESC LIMIT 200",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let sessions: Vec<Value> = sessions
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "device": row.try_get::<String, _>("device_fingerprint").unwrap_or_default(),
                "ip": row.try_get::<Option<String>, _>("ip").ok().flatten(),
                "userAgent": row.try_get::<Option<String>, _>("user_agent").ok().flatten(),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "lastActive": row.try_get::<DateTime<Utc>, _>("last_active").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "expiresAt": row.try_get::<DateTime<Utc>, _>("expires_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "mfaVerified": row.try_get::<bool, _>("mfa_verified").unwrap_or(false),
            })
        })
        .collect();

    let failed = sqlx::query(
        "SELECT f.id, f.email, f.ip_address::text AS ip, f.attempted_at
         FROM failed_login_attempts f
         JOIN users u ON u.email = f.email
         WHERE u.tenant_id = $1 AND f.attempted_at > NOW() - INTERVAL '30 days'
         ORDER BY f.attempted_at DESC LIMIT 100",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let failed: Vec<Value> = failed
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "ip": row.try_get::<Option<String>, _>("ip").ok().flatten(),
                "attemptedAt": row.try_get::<DateTime<Utc>, _>("attempted_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();

    let events = sqlx::query(
        "SELECT id, event_type, severity, ip_address::text AS ip, user_agent, details, created_at
         FROM security_events WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let events: Vec<Value> = events
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "eventType": row.try_get::<String, _>("event_type").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "ip": row.try_get::<Option<String>, _>("ip").ok().flatten(),
                "userAgent": row.try_get::<Option<String>, _>("user_agent").ok().flatten(),
                "details": row.try_get::<Value, _>("details").unwrap_or_else(|_| json!({})),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();

    let api_keys = sqlx::query(
        "SELECT key_prefix, name, last_used_at, expires_at FROM company_api_keys
         WHERE tenant_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 50",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let api_keys: Vec<Value> = api_keys
        .iter()
        .map(|row| {
            json!({
                "prefix": row.try_get::<String, _>("key_prefix").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "lastUsedAt": row.try_get::<Option<DateTime<Utc>>, _>("last_used_at").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({
        "success": true,
        "sessions": sessions,
        "failedLogins": failed,
        "events": events,
        "apiKeys": api_keys,
        "mfaPolicyRequired": false,
        "sessionCount": sessions.len(),
    }))
}

pub async fn list_company_api_keys(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, name, key_prefix, scopes, created_by, last_used_at, expires_at, revoked_at, created_at
         FROM company_api_keys WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let keys: Vec<Value> = rows
        .iter()
        .map(|row| {
            let scopes: Vec<String> = row.try_get("scopes").unwrap_or_default();
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "prefix": row.try_get::<String, _>("key_prefix").unwrap_or_default(),
                "scopes": scopes,
                "createdBy": row.try_get::<String, _>("created_by").unwrap_or_default(),
                "lastUsedAt": row.try_get::<Option<DateTime<Utc>>, _>("last_used_at").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
                "revokedAt": row.try_get::<Option<DateTime<Utc>>, _>("revoked_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
            })
        })
        .collect();
    // The feature flag of the platform decides whether the keys are offered.
    let api_keys_enabled: bool =
        sqlx::query_scalar("SELECT enabled FROM feature_flags WHERE key = 'company.api_keys'")
            .fetch_optional(db)
            .await
            .ok()
            .flatten()
            .unwrap_or(true);

    ok(json!({
        "success": true,
        "keys": keys,
        "apiKeysEnabled": api_keys_enabled,
        "scopes": crate::api_keys::scope_catalog(),
        "presets": crate::api_keys::key_presets(),
    }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCompanyApiKeyRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Option<Vec<String>>,
    #[serde(default)]
    pub expires_in_days: Option<i32>,
}

pub async fn create_company_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<CreateCompanyApiKeyRequest>,
) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let name = payload.name.trim();
    if name.len() < 2 {
        return fail(StatusCode::BAD_REQUEST, "API key name is required.");
    }
    // A key can do everything the workspace allows, so an automation or an
    // assistant can run the team, the domains and the billing without a user
    // session. Each scope is enforced on the API, not just in the console.
    let allowed = [
        "admin.full",
        "mail.send",
        "mail.read",
        "team.read",
        "team.write",
        "domains.read",
        "domains.write",
        "mailboxes.read",
        "mailboxes.write",
        "contacts.read",
        "contacts.write",
        "templates.read",
        "templates.write",
        "signatures.read",
        "signatures.write",
        "audit.read",
        "analytics.read",
    ];
    let scopes: Vec<String> = payload
        .scopes
        .unwrap_or_else(|| vec!["mail.send".to_string()])
        .into_iter()
        .filter(|scope| allowed.contains(&scope.as_str()))
        .collect();
    if scopes.is_empty() {
        return fail(
            StatusCode::BAD_REQUEST,
            "Select at least one valid API scope.",
        );
    }
    let key = format!(
        "vsk_live_{}{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    );
    let prefix: String = key.chars().take(20).collect();
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let expires_at = payload
        .expires_in_days
        .map(|days| Utc::now() + chrono::Duration::days(days.clamp(1, 3650) as i64));
    let result = sqlx::query(
        "INSERT INTO company_api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(actor.tenant_id)
    .bind(name)
    .bind(&prefix)
    .bind(&hash)
    .bind(&scopes)
    .bind(&actor.email)
    .bind(expires_at)
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("company api key create failed: {}", err);
        return fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to create API key.",
        );
    }
    audit(
        db,
        &actor.email,
        &actor.role,
        "company_api_key.created",
        "companies",
        "api_key",
        Some(&prefix),
        Some(actor.tenant_id),
        json!({ "name": name, "scopes": scopes, "expiresAt": expires_at }),
        "warning",
    )
    .await;
    ok(json!({
        "success": true,
        "key": key,
        "prefix": prefix,
        "scopes": scopes,
        "expiresAt": expires_at,
        "message": "Store this key now. It will not be shown again.",
    }))
}

pub async fn revoke_company_api_key(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(key_id): Path<String>,
) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let id = match Uuid::parse_str(&key_id) {
        Ok(value) => value,
        Err(_) => return fail(StatusCode::BAD_REQUEST, "Invalid API key id."),
    };
    let result = sqlx::query(
        "UPDATE company_api_keys SET revoked_at = NOW() WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(actor.tenant_id)
    .execute(db)
    .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &actor.email,
                &actor.role,
                "company_api_key.revoked",
                "companies",
                "api_key",
                Some(&id.to_string()),
                Some(actor.tenant_id),
                json!({}),
                "warning",
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => fail(StatusCode::NOT_FOUND, "Active API key not found."),
        Err(_) => fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to revoke API key.",
        ),
    }
}

pub async fn company_billing(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, invoice_number, plan, billing_cycle, amount_paise, currency, status, issued_at, due_at, paid_at, gateway, payment_ref, line_items
         FROM company_invoices WHERE tenant_id = $1 ORDER BY issued_at DESC LIMIT 100",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let invoices: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "number": row.try_get::<String, _>("invoice_number").unwrap_or_default(),
                "plan": row.try_get::<String, _>("plan").unwrap_or_default(),
                "billingCycle": row.try_get::<String, _>("billing_cycle").unwrap_or_else(|_| "monthly".to_string()),
                "amountPaise": row.try_get::<i64, _>("amount_paise").unwrap_or(0),
                "currency": row.try_get::<String, _>("currency").unwrap_or_else(|_| "INR".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "paid".to_string()),
                "issuedAt": row.try_get::<DateTime<Utc>, _>("issued_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "dueAt": row.try_get::<Option<DateTime<Utc>>, _>("due_at").ok().flatten().map(|v| v.to_rfc3339()),
                "paidAt": row.try_get::<Option<DateTime<Utc>>, _>("paid_at").ok().flatten().map(|v| v.to_rfc3339()),
                "gateway": row.try_get::<String, _>("gateway").unwrap_or_default(),
                "paymentRef": row.try_get::<Option<String>, _>("payment_ref").ok().flatten(),
                "lineItems": row.try_get::<Value, _>("line_items").unwrap_or_else(|_| json!([])),
            })
        })
        .collect();
    let total_paid: i64 = rows
        .iter()
        .filter(|row| row.try_get::<String, _>("status").as_deref().unwrap_or("") == "paid")
        .map(|row| row.try_get::<i64, _>("amount_paise").unwrap_or(0))
        .sum();
    let next_invoice = rows
        .iter()
        .filter(|row| row.try_get::<String, _>("status").as_deref().unwrap_or("") != "paid")
        .filter_map(|row| {
            row.try_get::<Option<DateTime<Utc>>, _>("due_at")
                .ok()
                .flatten()
        })
        .min();
    let allowance = tenant_allowance(db, actor.tenant_id, &actor.plan).await;
    ok(json!({
        "success": true,
        "plan": actor.plan,
        "status": actor.company_status,
        "limits": allowance.to_console_limits(),
        "summary": {
            "totalPaidPaise": total_paid,
            "invoiceCount": invoices.len(),
            "nextInvoiceAt": next_invoice.map(|value| value.to_rfc3339()),
            "currency": "INR",
        },
        "catalog": [
            { "key": "free", "name": "Free", "monthlyPaise": 0, "annualPaise": 0, "contactOnly": false, "negotiated": false, "limits": plan_limits("free") },
            { "key": "starter", "name": "Starter", "monthlyPaise": 29900, "annualPaise": 301400, "contactOnly": false, "negotiated": false, "limits": plan_limits("starter") },
            { "key": "business", "name": "Business", "monthlyPaise": 99900, "annualPaise": 1007000, "contactOnly": false, "negotiated": false, "limits": plan_limits("business") },
            { "key": "enterprise", "name": "Enterprise", "monthlyPaise": 249900, "annualPaise": 2519000, "contactOnly": true, "negotiated": true, "limits": plan_limits("enterprise") }
        ],
        "invoices": invoices,
        "paymentGateway": {
            "configured": !state.config.razorpay_key_id.is_empty(),
            "provider": "razorpay"
        }
    }))
}

pub async fn company_integrations(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let domains = sqlx::query(
        "SELECT id, domain_name, verification_status, verification_method, dns_records, mx_records,
                spf_record, dkim_record, dmarc_record, created_at, verified_at
         FROM custom_domains WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(actor.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let domains: Vec<Value> = domains
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain_name").unwrap_or_default(),
                "status": row.try_get::<String, _>("verification_status").unwrap_or_else(|_| "pending".to_string()),
                "method": row.try_get::<Option<String>, _>("verification_method").ok().flatten(),
                "dnsRecords": row.try_get::<Value, _>("dns_records").unwrap_or_else(|_| json!([])),
                "mxRecords": row.try_get::<Value, _>("mx_records").unwrap_or_else(|_| json!([])),
                "spfRecord": row.try_get::<Option<String>, _>("spf_record").ok().flatten(),
                "dkimRecord": row.try_get::<Option<String>, _>("dkim_record").ok().flatten(),
                "dmarcRecord": row.try_get::<Option<String>, _>("dmarc_record").ok().flatten(),
                "addedAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "verifiedAt": row.try_get::<Option<DateTime<Utc>>, _>("verified_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();
    let flags = sqlx::query(
        "SELECT key, name, enabled FROM feature_flags WHERE key LIKE 'company.%' ORDER BY key",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let flags: Vec<Value> = flags
        .iter()
        .map(|row| {
            json!({
                "key": row.try_get::<String, _>("key").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "enabled": row.try_get::<bool, _>("enabled").unwrap_or(false),
            })
        })
        .collect();
    let key_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM company_api_keys WHERE tenant_id = $1 AND revoked_at IS NULL",
    )
    .bind(actor.tenant_id)
    .fetch_one(db)
    .await
    .unwrap_or(0);
    let tenant_settings: Value = sqlx::query_scalar("SELECT settings FROM tenants WHERE id = $1")
        .bind(actor.tenant_id)
        .fetch_one(db)
        .await
        .unwrap_or_else(|_| json!({}));
    let verified_domains = domains
        .iter()
        .filter(|domain| domain.get("status").and_then(Value::as_str) == Some("verified"))
        .count();
    let smtp_enabled = tenant_settings
        .get("smtp")
        .and_then(|value| value.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let outbound_configured = verified_domains > 0 || smtp_enabled;
    let inbound_configured = verified_domains > 0;
    ok(json!({
        "success": true,
        "domains": domains,
        "features": flags,
        "apiKeys": key_count,
        "mailboxes": {
            "outboundConfigured": outbound_configured,
            "inboundConfigured": inbound_configured,
            "provider": "VelisMail Delivery Engine"
        },
        "webhooks": tenant_settings.get("webhooks").cloned().unwrap_or_else(|| json!([])),
        "smtp": tenant_settings.get("smtp").cloned().unwrap_or_else(|| json!({ "enabled": false })),
    }))
}

pub async fn company_announcements(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let _actor = match authorize_company(&state, &headers).await {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let db = match pool(&state) {
        Ok(db) => db,
        Err(response) => return response,
    };
    let rows = sqlx::query(
        "SELECT id, title, body, severity, audience, published_at, expires_at
         FROM announcements
         WHERE status = 'published'
           AND (published_at IS NULL OR published_at <= NOW())
           AND (expires_at IS NULL OR expires_at > NOW())
           AND audience IN ('all','companies')
         ORDER BY published_at DESC NULLS LAST LIMIT 20",
    )
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "title": row.try_get::<String, _>("title").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "audience": row.try_get::<String, _>("audience").unwrap_or_else(|_| "all".to_string()),
                "publishedAt": row.try_get::<Option<DateTime<Utc>>, _>("published_at").ok().flatten().map(|v| v.to_rfc3339()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();
    ok(json!({ "success": true, "announcements": items }))
}

#[cfg(test)]
mod team_request_tests {
    use super::*;

    #[test]
    fn partial_team_updates_deserialize_without_omitted_fields() {
        let member: CompanyMemberUpdateRequest =
            serde_json::from_str(r#"{"role":"admin"}"#).expect("role-only member update");
        assert_eq!(member.role.as_deref(), Some("admin"));
        assert!(member.status.is_none());

        let member: CompanyMemberUpdateRequest =
            serde_json::from_str(r#"{"status":"suspended"}"#).expect("status-only member update");
        assert!(member.role.is_none());
        assert_eq!(member.status.as_deref(), Some("suspended"));

        let platform: UpdatePlatformAdminRequest =
            serde_json::from_str(r#"{"status":"suspended"}"#).expect("status-only admin update");
        assert!(platform.role.is_none());
        assert_eq!(platform.status.as_deref(), Some("suspended"));

        let added: AddPlatformAdminRequest =
            serde_json::from_str(r#"{"email":"admin@example.com","role":"member_manager"}"#)
                .expect("add without a display name");
        assert!(added.display_name.is_none());

        let action: PlatformUserAction =
            serde_json::from_str(r#"{"action":"set_role","role":"viewer"}"#)
                .expect("user action without a reason");
        assert!(action.reason.is_none());
    }
}
