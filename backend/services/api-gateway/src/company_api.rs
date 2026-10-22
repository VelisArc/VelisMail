//! Company workspace API.
//!
//! This is the *customer* ecosystem: a company that bought VelisMail as an
//! email service. It is deliberately separate from the platform control plane
//! in `admin.rs`, which belongs to the VelisMail operator and manages every
//! company on the platform.
//!
//! Every route resolves the tenant from the verified session (never from the
//! request body), so a company can only ever read and write its own data:
//! team, domains, mailboxes, queue, audit trail, templates, contacts, contact
//! groups and signatures.

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
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use uuid::Uuid;
use velismail_common::Claims;

/// The error body every workspace endpoint returns.
pub type ApiError = (StatusCode, Json<Value>);
/// Handlers return a `Result` so `?` can be used for the shared helpers.
pub type ApiResult = Result<(StatusCode, Json<Value>), ApiError>;

pub(crate) fn ok(value: Value) -> ApiResult {
    Ok((StatusCode::OK, Json(value)))
}

pub(crate) fn fail(status: StatusCode, message: &str) -> ApiError {
    (status, Json(json!({ "success": false, "error": message })))
}

/// The gateway database. Workspace endpoints refuse to run without it.
pub(crate) fn db_pool(state: &AppState) -> Result<&PgPool, ApiError> {
    state.db.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "success": false,
                "error": "The workspace database is not connected."
            })),
        )
    })
}

/// Read the bearer token of a request.
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

/// Verify the bearer token and return its claims.
fn session_claims(state: &AppState, headers: &HeaderMap) -> Result<Claims, ApiError> {
    let secret = state.config.jwt_secret.as_deref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "success": false,
                "error": "JWT authentication is not configured on the gateway."
            })),
        )
    })?;
    let token = headers
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
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "success": false, "error": "Missing bearer token." })),
            )
        })?;

    let validation = Validation {
        validate_aud: false,
        leeway: 120,
        ..Default::default()
    };
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "success": false,
                "error": "Invalid or expired bearer token."
            })),
        )
    })
}

/// The resolved caller inside a company workspace.
pub struct WorkspaceContext {
    pub tenant_id: Uuid,
    pub user_id: Uuid,
    pub email: String,
    pub role: String,
    pub plan: String,
}

impl WorkspaceContext {
    /// Workspace owners and admins may change team, billing and security
    /// settings. Members and viewers are read-only.
    pub fn can_manage(&self) -> bool {
        self.role == "owner" || self.role == "admin"
    }

    fn require_manage(&self) -> Result<(), ApiError> {
        if self.can_manage() {
            Ok(())
        } else {
            Err(fail(
                StatusCode::FORBIDDEN,
                "Only workspace owners and admins can perform this action.",
            ))
        }
    }
}

fn normalize_email(value: &str) -> String {
    value.trim().to_lowercase()
}

/// Resolve the caller's company workspace from the verified session.
pub(crate) async fn workspace_context(
    state: &AppState,
    headers: &HeaderMap,
) -> Result<WorkspaceContext, ApiError> {
    // A workspace API key authenticates on its own and is bound to one
    // company, so an integration or an assistant can run the workspace
    // without a user session.
    if let Some(token) = bearer_token(headers) {
        if token.starts_with(crate::api_keys::API_KEY_PREFIX) {
            return match crate::api_keys::resolve(state, &token).await {
                Ok(key) => Ok(WorkspaceContext {
                    tenant_id: key.tenant_id,
                    user_id: key.tenant_id,
                    email: key.created_by.clone(),
                    role: "owner".to_string(),
                    plan: "Business".to_string(),
                }),
                Err(_) => Err((
                    StatusCode::UNAUTHORIZED,
                    Json(json!({
                        "success": false,
                        "error": "This API key is not valid."
                    })),
                )),
            };
        }
    }

    let claims = session_claims(state, headers)?;
    let db = db_pool(state)?;

    let user = sqlx::query(
        "SELECT id, tenant_id, email, display_name, status, settings
         FROM users WHERE id = $1",
    )
    .bind(claims.sub.0)
    .fetch_optional(db)
    .await
    .map_err(|_| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to load the account.",
        )
    })?
    .ok_or_else(|| fail(StatusCode::NOT_FOUND, "Account not found."))?;

    let status: String = user
        .try_get("status")
        .unwrap_or_else(|_| "active".to_string());
    if status != "active" {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "This account is suspended. Contact a company administrator.",
        ));
    }

    let email: String = user.try_get("email").map_err(|_| {
        fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to load the account.",
        )
    })?;
    let email = normalize_email(&email);
    let _settings: Value = user.try_get("settings").unwrap_or_else(|_| json!({}));

    // The tenant stored on the account is authoritative; the JWT tenant is
    // only a fallback for accounts that were provisioned before the tenant
    // column existed.
    let tenant_id: Uuid = match user.try_get::<Option<Uuid>, _>("tenant_id") {
        Ok(Some(value)) if value != Uuid::nil() => value,
        _ => Uuid::parse_str(&claims.tenant_id).unwrap_or(Uuid::nil()),
    };
    if tenant_id == Uuid::nil() {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "This account is not attached to a company workspace yet.",
        ));
    }

    // The plan belongs to the workspace. It is never read from the account
    // settings, because a client can write those.
    let plan: String = sqlx::query_scalar("SELECT plan_tier FROM tenants WHERE id = $1")
        .bind(tenant_id)
        .fetch_optional(db)
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "free".to_string());

    let membership = sqlx::query(
        "SELECT role, status FROM company_members
         WHERE tenant_id = $1 AND LOWER(email) = LOWER($2)
         LIMIT 1",
    )
    .bind(tenant_id)
    .bind(&email)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let mut role = membership
        .as_ref()
        .and_then(|row| row.try_get::<String, _>("role").ok())
        .unwrap_or_default();
    if role.is_empty() {
        // The role always comes from the explicit membership record. It is
        // never derived from the email domain or from client-supplied
        // settings, otherwise anybody with a mail address on a company domain
        // would inherit that access.
        role = "member".to_string();
    }
    if let Some(row) = membership.as_ref() {
        let member_status: String = row
            .try_get("status")
            .unwrap_or_else(|_| "active".to_string());
        if member_status != "active" {
            return Err(fail(
                StatusCode::FORBIDDEN,
                "Your company membership is not active. Contact a company administrator.",
            ));
        }
    }

    Ok(WorkspaceContext {
        tenant_id,
        user_id: claims.sub.0,
        email,
        role,
        plan,
    })
}

/// Record a company-scoped audit entry.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn audit(
    db: &PgPool,
    actor: &str,
    role: &str,
    action: &str,
    resource_type: &str,
    resource_id: Option<&str>,
    tenant_id: Uuid,
    details: Value,
) {
    let _ = sqlx::query(
        "INSERT INTO platform_audit_logs
         (actor_email, actor_role, action, category, resource_type, resource_id, tenant_id, details, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'info')",
    )
    .bind(actor)
    .bind(role)
    .bind(action)
    .bind("company")
    .bind(resource_type)
    .bind(resource_id)
    .bind(tenant_id)
    .bind(details)
    .execute(db)
    .await;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInviteRequest {
    pub email: String,
    #[serde(default = "default_role")]
    pub role: String,
    pub expires_in_hours: Option<i64>,
}

fn default_role() -> String {
    "member".to_string()
}

/// Submit a feedback note from a workspace to the control plane.
pub async fn submit_feedback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<Value>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let subject = payload
        .get("subject")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let body = payload
        .get("body")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if subject.is_empty() || body.is_empty() {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Subject and message are required.",
        ));
    }
    let category = payload
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("general")
        .to_string();
    let priority = payload
        .get("priority")
        .and_then(|v| v.as_str())
        .unwrap_or("medium")
        .to_string();
    let image = payload
        .get("imageBase64")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    if let Some(img) = &image {
        if img.len() > 7_000_000 {
            return Err(fail(
                StatusCode::BAD_REQUEST,
                "Image is too large (max ~5 MB).",
            ));
        }
    }

    let result = sqlx::query(
        "INSERT INTO feedback (tenant_id, user_id, user_email, subject, body, category, priority, image_base64)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id",
    )
    .bind(context.tenant_id)
    .bind(context.user_id)
    .bind(&context.email)
    .bind(&subject)
    .bind(&body)
    .bind(&category)
    .bind(&priority)
    .bind(&image)
    .fetch_one(db)
    .await;

    match result {
        Ok(row) => {
            let id: Uuid = row.try_get("id").unwrap_or(Uuid::nil());
            ok(json!({ "success": true, "id": id.to_string() }))
        }
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save feedback.",
        )),
    }
}

/// List the feedback notes submitted by this workspace.
pub async fn list_feedback(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;
    let rows = sqlx::query(
        "SELECT id, subject, body, category, priority, status, reply, has_image, created_at, updated_at, resolved_at
         FROM (
            SELECT id, subject, body, category, priority, status, reply,
                   (image_base64 IS NOT NULL) AS has_image,
                   created_at, updated_at, resolved_at
            FROM feedback
            WHERE tenant_id = $1
         ) t
         ORDER BY created_at DESC
         LIMIT 100",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();
    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "category": row.try_get::<String, _>("category").unwrap_or_else(|_| "general".to_string()),
                "priority": row.try_get::<String, _>("priority").unwrap_or_else(|_| "medium".to_string()),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "open".to_string()),
                "reply": row.try_get::<Option<String>, _>("reply").ok().flatten(),
                "hasImage": row.try_get::<bool, _>("has_image").unwrap_or(false),
                "createdAt": row.try_get::<DateTime<Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "updatedAt": row.try_get::<DateTime<Utc>, _>("updated_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                "resolvedAt": row.try_get::<Option<DateTime<Utc>>, _>("resolved_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();
    ok(json!({ "success": true, "feedback": items }))
}
pub async fn list_team(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let members = sqlx::query(
        "SELECT cm.id, cm.user_id, cm.email, cm.display_name, cm.role, cm.status,
                cm.invited_by, cm.joined_at, cm.last_active_at, u.settings
         FROM company_members cm
         LEFT JOIN users u ON u.id = cm.user_id
         WHERE cm.tenant_id = $1
         ORDER BY CASE cm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                  LOWER(cm.email)",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let members: Vec<Value> = members
        .iter()
        .map(|row| {
            let member_status: String = row
                .try_get::<String, _>("status")
                .unwrap_or_else(|_| "active".to_string());
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "userId": row.try_get::<Option<Uuid>, _>("user_id").ok().flatten().map(|v| v.to_string()),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "name": row.try_get::<String, _>("display_name").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_else(|_| "member".to_string()),
                // The console speaks in pending, active, expired and revoked.
                "status": match member_status.as_str() {
                    "active" => "active",
                    "invited" => "pending",
                    "suspended" => "expired",
                    "removed" => "revoked",
                    other => other,
                },
                "invitedBy": row.try_get::<Option<String>, _>("invited_by").ok().flatten(),
                "joinedAt": row.try_get::<Option<DateTime<Utc>>, _>("joined_at").ok().flatten().map(|v| v.to_rfc3339()),
                "lastActiveAt": row.try_get::<Option<DateTime<Utc>>, _>("last_active_at").ok().flatten().map(|v| v.to_rfc3339()),
                "plan": context.plan,
            })
        })
        .collect();

    let invitations = sqlx::query(
        "SELECT id, email, role, invited_by, status, expires_at, created_at
         FROM workspace_invitations
         WHERE tenant_id = $1
         ORDER BY created_at DESC",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let invitations: Vec<Value> = invitations
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "role": row.try_get::<String, _>("role").unwrap_or_else(|_| "member".to_string()),
                "invitedBy": row.try_get::<String, _>("invited_by").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_else(|_| "pending".to_string()),
                "expiresAt": row.try_get::<Option<DateTime<Utc>>, _>("expires_at").ok().flatten().map(|v| v.to_rfc3339()),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    let active_members = members
        .iter()
        .filter(|member| member.get("status").and_then(Value::as_str) == Some("active"))
        .count();

    let allowance = crate::admin::tenant_allowance(db, context.tenant_id, &context.plan).await;

    ok(json!({
        "success": true,
        "members": members,
        "invitations": invitations,
        "seatLimit": {
            "used": active_members,
            "max": allowance.seats,
            "capped": allowance.seats > 0,
        },
    }))
}

pub async fn create_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<WorkspaceInviteRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let email = normalize_email(&payload.email);
    if !email.contains('@') {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "A valid email address is required.",
        ));
    }
    let role = payload.role.trim().to_lowercase();
    if !matches!(role.as_str(), "admin" | "member" | "viewer") {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "Invitations can only be created for admin, member or viewer roles.",
        ));
    }

    let expires_at =
        Utc::now() + chrono::Duration::hours(payload.expires_in_hours.unwrap_or(168).clamp(1, 720));

    // The seat limit of the workspace is enforced. An invitation is refused
    // when the seats are used up.
    let allowance = crate::admin::tenant_allowance(db, context.tenant_id, &context.plan).await;
    if allowance.seats > 0 {
        let seats_used: i64 = sqlx::query_scalar(
            "SELECT COUNT(*)::bigint FROM company_members
             WHERE tenant_id = $1 AND status IN ('active', 'invited')",
        )
        .bind(context.tenant_id)
        .fetch_one(db)
        .await
        .unwrap_or(0);
        if seats_used >= allowance.seats {
            return Err(fail(
                StatusCode::CONFLICT,
                &format!(
                    "All {} seats of this workspace are in use. Remove a member or raise the seat limit first.",
                    allowance.seats
                ),
            ));
        }
    }

    let result = sqlx::query(
        "INSERT INTO workspace_invitations (tenant_id, email, role, invited_by, status, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (tenant_id, email) WHERE status = 'pending'
         DO UPDATE SET role = EXCLUDED.role, expires_at = EXCLUDED.expires_at
         RETURNING id",
    )
    .bind(context.tenant_id)
    .bind(&email)
    .bind(&role)
    .bind(&context.email)
    .bind(expires_at)
    .fetch_optional(db)
    .await;

    let invitation_id = match result {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        Ok(None) => None,
        Err(_) => {
            return Err(fail(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Unable to create the invitation.",
            ))
        }
    };

    audit(
        db,
        &context.email,
        &context.role,
        "company.invitation_created",
        "team",
        invitation_id.map(|id| id.to_string()).as_deref(),
        context.tenant_id,
        json!({ "email": email, "role": role }),
    )
    .await;

    ok(json!({
        "success": true,
        "id": invitation_id.map(|id| id.to_string()),
        "email": email,
        "role": role,
        "expiresAt": expires_at.to_rfc3339(),
    }))
}

pub async fn revoke_invitation(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let invitation_id = Uuid::parse_str(&id)
        .map_err(|_| fail(StatusCode::BAD_REQUEST, "Invalid invitation id."))?;
    let result = sqlx::query(
        "UPDATE workspace_invitations SET status = 'revoked'
         WHERE id = $1 AND tenant_id = $2 AND status = 'pending'",
    )
    .bind(invitation_id)
    .bind(context.tenant_id)
    .execute(db)
    .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &context.email,
                &context.role,
                "company.invitation_revoked",
                "team",
                Some(&invitation_id.to_string()),
                context.tenant_id,
                json!({}),
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => Err(fail(StatusCode::NOT_FOUND, "Pending invitation not found.")),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to revoke the invitation.",
        )),
    }
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainRequest {
    pub domain: String,
}

pub async fn create_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<DomainRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

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

    // A workspace can own several domains. An existing domain may only be
    // re-used by the same workspace - it is never moved away from its owner.
    let existing = sqlx::query(
        "SELECT id, tenant_id, dns_records FROM custom_domains
         WHERE LOWER(domain_name) = LOWER($1) LIMIT 1",
    )
    .bind(&domain)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    if let Some(row) = existing {
        let owner: Option<Uuid> = row.try_get("tenant_id").ok();
        if owner != Some(context.tenant_id) {
            return Err(fail(
                StatusCode::CONFLICT,
                "That domain is already connected to another company.",
            ));
        }
        let domain_id: Option<Uuid> = row.try_get("id").ok();
        // The ownership proof is stored with the domain, so it can be shown
        // again instead of an empty value.
        let stored_records: Value = row.try_get("dns_records").unwrap_or_else(|_| json!([]));
        let verification_token = stored_records
            .as_array()
            .and_then(|records| {
                records
                    .iter()
                    .find(|record| {
                        record
                            .get("name")
                            .and_then(Value::as_str)
                            .map(|name| name.to_lowercase().contains("velismail-verif"))
                            .unwrap_or(false)
                    })
                    .and_then(|record| record.get("value").and_then(Value::as_str))
                    .map(|value| value.to_string())
            })
            .unwrap_or_default();
        return ok(json!({
            "success": true,
            "id": domain_id.map(|value| value.to_string()),
            "domain": domain,
            "verificationToken": verification_token,
            "existing": true,
        }));
    }

    let verification_token = Uuid::new_v4().to_string();
    let result = sqlx::query(
        "INSERT INTO custom_domains (tenant_id, domain_name, verification_status, verification_method, dns_records, mx_records)
         VALUES ($1, $2, 'pending', 'dns', $3, '[]'::jsonb)
         ON CONFLICT (domain_name) DO NOTHING
         RETURNING id",
    )
    .bind(context.tenant_id)
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

    let domain_id = match result {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        Ok(None) => None,
        Err(_) => {
            return Err(fail(
                StatusCode::CONFLICT,
                "That domain is already connected to another company.",
            ))
        }
    };
    if domain_id.is_none() {
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to add the domain.",
        ));
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.domain_added",
        "domain",
        domain_id.map(|value| value.to_string()).as_deref(),
        context.tenant_id,
        json!({ "domain": domain }),
    )
    .await;

    ok(json!({
        "success": true,
        "id": domain_id.map(|value| value.to_string()),
        "domain": domain,
        "verificationToken": verification_token,
    }))
}

pub async fn list_domains(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT cd.id, cd.domain_name, cd.verification_status, cd.verification_method,
                cd.dns_records, cd.mx_records, cd.spf_record, cd.dkim_record, cd.dmarc_record,
                cd.created_at, cd.verified_at,
                (SELECT COUNT(*)::bigint FROM business_mailboxes bm
                 WHERE bm.domain = cd.domain_name AND bm.tenant_id = cd.tenant_id) AS mailboxes
         FROM custom_domains cd
         WHERE cd.tenant_id = $1
         ORDER BY cd.created_at ASC, cd.id ASC",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let domains: Vec<Value> = rows
        .iter()
        .enumerate()
        .map(|(index, row)| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain_name").unwrap_or_default(),
                // The first domain of the workspace is the primary one. The
                // business endpoints use the same rule, so the console and the
                // setup gate always talk about the same domain.
                "primary": index == 0,
                "status": row.try_get::<String, _>("verification_status").unwrap_or_else(|_| "pending".to_string()),
                "method": row.try_get::<Option<String>, _>("verification_method").ok().flatten(),
                "dnsRecords": row.try_get::<Value, _>("dns_records").unwrap_or_else(|_| json!([])),
                "mxRecords": row.try_get::<Value, _>("mx_records").unwrap_or_else(|_| json!([])),
                "spfRecord": row.try_get::<Option<String>, _>("spf_record").ok().flatten(),
                "dkimRecord": row.try_get::<Option<String>, _>("dkim_record").ok().flatten(),
                "dmarcRecord": row.try_get::<Option<String>, _>("dmarc_record").ok().flatten(),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "verifiedAt": row.try_get::<Option<DateTime<Utc>>, _>("verified_at").ok().flatten().map(|v| v.to_rfc3339()),
                "mailboxes": row.try_get::<i64, _>("mailboxes").unwrap_or(0),
            })
        })
        .collect();

    ok(json!({ "success": true, "domains": domains }))
}

// ---------------------------------------------------------------------------
// Mailboxes
// ---------------------------------------------------------------------------

pub async fn list_mailboxes(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT bm.id, bm.domain, bm.address, bm.display_name, bm.kind, bm.aliases,
                bm.active, bm.source, bm.created_at, bm.last_used_at
         FROM business_mailboxes bm
         WHERE bm.tenant_id = $1
         ORDER BY bm.domain, bm.address",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let mailboxes: Vec<Value> = rows
        .iter()
        .map(|row| {
            // The aliases are stored as text, so they are parsed instead of
            // being read as a document.
            let aliases: Value = row
                .try_get::<Option<String>, _>("aliases")
                .ok()
                .flatten()
                .and_then(|value| serde_json::from_str::<Value>(&value).ok())
                .unwrap_or_else(|| json!([]));
            let kind: String = row
                .try_get::<String, _>("kind")
                .unwrap_or_else(|_| "mailbox".to_string());
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain").unwrap_or_default(),
                "address": row.try_get::<String, _>("address").unwrap_or_default(),
                "displayName": row.try_get::<String, _>("display_name").unwrap_or_default(),
                // The console knows primary, mailbox, alias and shared.
                "kind": match kind.as_str() {
                    "primary" | "alias" | "shared" => kind.clone(),
                    _ => "mailbox".to_string(),
                },
                "aliases": aliases,
                "active": row.try_get::<bool, _>("active").unwrap_or(true),
                "source": row.try_get::<String, _>("source").unwrap_or_else(|_| "custom".to_string()),
                "createdAt": row.try_get::<Option<String>, _>("created_at").ok().flatten(),
                "lastUsedAt": row.try_get::<Option<String>, _>("last_used_at").ok().flatten(),
            })
        })
        .collect();

    ok(json!({ "success": true, "mailboxes": mailboxes }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxRequest {
    pub domain: String,
    pub address: String,
    pub display_name: String,
    #[serde(default = "default_mailbox_kind")]
    pub kind: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default = "default_true")]
    pub active: bool,
}

fn default_mailbox_kind() -> String {
    "user".to_string()
}

fn default_true() -> bool {
    true
}

pub async fn create_mailbox(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<MailboxRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let domain = payload.domain.trim().to_lowercase();
    let address = payload.address.trim().to_lowercase();
    if domain.is_empty() || !address.ends_with(&format!("@{}", domain)) {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "The mailbox address must belong to the selected domain.",
        ));
    }

    let owned: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM custom_domains WHERE tenant_id = $1 AND domain_name = $2)",
    )
    .bind(context.tenant_id)
    .bind(&domain)
    .fetch_one(db)
    .await
    .unwrap_or(false);
    if !owned {
        return Err(fail(
            StatusCode::FORBIDDEN,
            "That domain does not belong to this company.",
        ));
    }

    let id = format!("mbx_{}", Uuid::new_v4().simple());
    let aliases = serde_json::to_string(&payload.aliases).unwrap_or_else(|_| "[]".to_string());
    let result = sqlx::query(
        "INSERT INTO business_mailboxes
         (id, tenant_id, domain, address, display_name, kind, aliases, active, source, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'custom', $9)
         ON CONFLICT (domain, address) DO UPDATE
         SET display_name = EXCLUDED.display_name,
             kind = EXCLUDED.kind,
             aliases = EXCLUDED.aliases,
             active = EXCLUDED.active,
             tenant_id = EXCLUDED.tenant_id",
    )
    .bind(&id)
    .bind(context.tenant_id)
    .bind(&domain)
    .bind(&address)
    .bind(payload.display_name.trim())
    .bind(payload.kind.trim())
    .bind(&aliases)
    .bind(payload.active)
    .bind(crate::business_mailboxes::now_string())
    .execute(db)
    .await;

    if let Err(err) = result {
        tracing::warn!("mailbox insert failed for {address}: {err}");
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Unable to create the mailbox: {err}"),
        ));
    }

    // The mail path reads the mailbox from the business database of the
    // company. Without it the mailbox shows up in the console but cannot send.
    if let Some(business_db) = tenant_business_db_url(db, context.tenant_id).await {
        match crate::routes::business_mailbox_pool(&business_db).await {
            Ok(pool) => {
                let mailbox = crate::business_mailboxes::MailboxValues {
                    id: &id,
                    domain: &domain,
                    address: &address,
                    display_name: payload.display_name.trim(),
                    kind: payload.kind.trim(),
                    aliases: &aliases,
                    active: payload.active,
                    source: "custom",
                };
                if let Err(err) = crate::business_mailboxes::upsert(&pool, &mailbox).await {
                    tracing::warn!(
                        "mailbox {address} was not written to the business database: {err}"
                    );
                }
            }
            Err(err) => {
                tracing::warn!("business database unreachable for {address}: {err}");
            }
        }
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.mailbox_created",
        "mailboxes",
        Some(&address),
        context.tenant_id,
        json!({ "domain": domain }),
    )
    .await;

    ok(json!({ "success": true, "id": id, "address": address }))
}

#[derive(Debug, Deserialize)]
pub struct MailboxDeleteQuery {
    pub domain: String,
    pub address: String,
}

pub async fn delete_mailbox(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MailboxDeleteQuery>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let result = sqlx::query(
        "DELETE FROM business_mailboxes
         WHERE tenant_id = $1 AND domain = $2 AND address = $3",
    )
    .bind(context.tenant_id)
    .bind(query.domain.trim().to_lowercase())
    .bind(query.address.trim().to_lowercase())
    .execute(db)
    .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &context.email,
                &context.role,
                "company.mailbox_deleted",
                "mailboxes",
                Some(&query.address),
                context.tenant_id,
                json!({ "domain": query.domain }),
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => Err(fail(StatusCode::NOT_FOUND, "Mailbox not found.")),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to delete the mailbox.",
        )),
    }
}

// ---------------------------------------------------------------------------
// Delivery queue
// ---------------------------------------------------------------------------

/// The console speaks in queued, sending, sent, failed and deferred.
fn queue_status_to_console(status: &str) -> &'static str {
    match status.trim().to_ascii_lowercase().as_str() {
        "pending" | "queued" => "queued",
        "processing" | "sending" => "sending",
        "retry" | "deferred" => "deferred",
        "delivered" | "sent" => "sent",
        _ => "failed",
    }
}

/// The database states that belong to a console filter.
fn queue_status_filter_to_db(value: &str) -> Vec<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "queued" => vec!["pending", "queued"],
        "sending" => vec!["processing", "sending"],
        "sent" => vec!["delivered", "sent"],
        "deferred" => vec!["retry", "deferred"],
        "failed" => vec!["failed", "dead_letter"],
        _ => Vec::new(),
    }
}

pub async fn list_queue(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let status = params.get("status").cloned().unwrap_or_default();
    let status_states = queue_status_filter_to_db(&status);
    let limit: i64 = params
        .get("limit")
        .and_then(|value| value.parse().ok())
        .unwrap_or(100)
        .clamp(1, 500);

    let rows = sqlx::query(
        "SELECT q.id, q.message_id, q.sender, q.recipient, q.subject, q.status, q.priority,
                q.retry_count, q.max_retries, q.last_error, q.next_retry_at, q.delivered_at, q.created_at
         FROM delivery_queue q
         JOIN users u ON LOWER(u.email) = LOWER(q.sender)
         WHERE u.tenant_id = $1
           AND ($2 = '' OR q.status = ANY($3))
         ORDER BY q.created_at DESC
         LIMIT $4",
    )
    .bind(context.tenant_id)
    .bind(&status)
    .bind(&status_states)
    .bind(limit)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let items: Vec<Value> = rows
        .iter()
        .map(|row| {
            let queue_status: String = row
                .try_get::<String, _>("status")
                .unwrap_or_else(|_| "pending".to_string());
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "messageId": row.try_get::<String, _>("message_id").unwrap_or_default(),
                "from": row.try_get::<String, _>("sender").unwrap_or_default(),
                "to": row.try_get::<String, _>("recipient").unwrap_or_default(),
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "status": queue_status_to_console(&queue_status),
                "priority": row.try_get::<String, _>("priority").unwrap_or_default(),
                "retries": row.try_get::<i32, _>("retry_count").unwrap_or(0),
                "maxRetries": row.try_get::<i32, _>("max_retries").unwrap_or(0),
                "error": row.try_get::<Option<String>, _>("last_error").ok().flatten(),
                "queuedAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "deliveredAt": row.try_get::<Option<DateTime<Utc>>, _>("delivered_at").ok().flatten().map(|v| v.to_rfc3339()),
                "nextRetryAt": row.try_get::<Option<DateTime<Utc>>, _>("next_retry_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({ "success": true, "items": items }))
}

// ---------------------------------------------------------------------------
// Audit trail
// ---------------------------------------------------------------------------

pub async fn list_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let limit: i64 = params
        .get("limit")
        .and_then(|value| value.parse().ok())
        .unwrap_or(200)
        .clamp(1, 1000);

    let rows = sqlx::query(
        "SELECT id, actor_email, actor_role, action, category, resource_type, resource_id,
                details, severity, created_at
         FROM platform_audit_logs
         WHERE tenant_id = $1
         ORDER BY created_at DESC
         LIMIT $2",
    )
    .bind(context.tenant_id)
    .bind(limit)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let entries: Vec<Value> = rows
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
                "details": row.try_get::<Value, _>("details").unwrap_or_else(|_| json!({})),
                "severity": row.try_get::<String, _>("severity").unwrap_or_else(|_| "info".to_string()),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({ "success": true, "entries": entries }))
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

pub async fn list_templates(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT id, name, subject, body, usage_count, created_at, updated_at
         FROM business_templates
         WHERE tenant_id = $1
         ORDER BY updated_at DESC",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let templates: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "usageCount": row.try_get::<i32, _>("usage_count").unwrap_or(0),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "updatedAt": row.try_get::<Option<DateTime<Utc>>, _>("updated_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({ "success": true, "templates": templates }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRequest {
    pub name: String,
    pub subject: String,
    pub body: String,
}

pub async fn create_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<TemplateRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let name = payload.name.trim().to_string();
    if name.len() < 2 {
        return Err(fail(StatusCode::BAD_REQUEST, "Template name is required."));
    }

    let row = sqlx::query(
        "INSERT INTO business_templates (tenant_id, user_id, name, subject, body)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, name) DO UPDATE
         SET subject = EXCLUDED.subject, body = EXCLUDED.body, updated_at = NOW()
         RETURNING id",
    )
    .bind(context.tenant_id)
    .bind(context.user_id)
    .bind(&name)
    .bind(payload.subject.trim())
    .bind(payload.body.clone())
    .fetch_optional(db)
    .await;

    let id = match row {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        _ => None,
    };
    if id.is_none() {
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to save the template.",
        ));
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.template_saved",
        "templates",
        id.map(|value| value.to_string()).as_deref(),
        context.tenant_id,
        json!({ "name": name }),
    )
    .await;

    ok(json!({ "success": true, "id": id.map(|value| value.to_string()) }))
}

pub async fn delete_template(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let template_id =
        Uuid::parse_str(&id).map_err(|_| fail(StatusCode::BAD_REQUEST, "Invalid template id."))?;
    let result = sqlx::query("DELETE FROM business_templates WHERE id = $1 AND tenant_id = $2")
        .bind(template_id)
        .bind(context.tenant_id)
        .execute(db)
        .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &context.email,
                &context.role,
                "company.template_deleted",
                "templates",
                Some(&template_id.to_string()),
                context.tenant_id,
                json!({}),
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => Err(fail(StatusCode::NOT_FOUND, "Template not found.")),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to delete the template.",
        )),
    }
}

// ---------------------------------------------------------------------------
// Mail groups
// ---------------------------------------------------------------------------

pub async fn list_groups(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;
    let domain = params
        .get("domain")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    let rows = sqlx::query(
        "SELECT id, domain, name, address, members, created_at, updated_at
         FROM business_mail_groups
         WHERE tenant_id = $1 AND ($2 = '' OR domain = $2)
         ORDER BY domain, name",
    )
    .bind(context.tenant_id)
    .bind(&domain)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let groups: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "domain": row.try_get::<String, _>("domain").unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "address": row.try_get::<String, _>("address").unwrap_or_default(),
                "members": row.try_get::<Vec<String>, _>("members").unwrap_or_default(),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "updatedAt": row.try_get::<Option<DateTime<Utc>>, _>("updated_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({ "success": true, "groups": groups }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupRequest {
    pub domain: String,
    pub name: String,
    pub address: String,
    #[serde(default)]
    pub members: Vec<String>,
}

pub async fn create_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<GroupRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let domain = payload.domain.trim().to_lowercase();
    let name = payload.name.trim().to_string();
    let address = payload.address.trim().to_lowercase();
    if domain.is_empty() || name.is_empty() || address.is_empty() {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "A group needs a domain, a name and an address.",
        ));
    }

    let row = sqlx::query(
        "INSERT INTO business_mail_groups (tenant_id, domain, name, address, members)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, address) DO UPDATE
         SET name = EXCLUDED.name,
             domain = EXCLUDED.domain,
             members = EXCLUDED.members,
             updated_at = NOW()
         RETURNING id",
    )
    .bind(context.tenant_id)
    .bind(&domain)
    .bind(&name)
    .bind(&address)
    .bind(payload.members.clone())
    .fetch_optional(db)
    .await;

    let id = match row {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        _ => None,
    };
    if id.is_none() {
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to save the group.",
        ));
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.group_saved",
        "groups",
        id.map(|value| value.to_string()).as_deref(),
        context.tenant_id,
        json!({ "address": address }),
    )
    .await;

    ok(json!({ "success": true, "id": id.map(|value| value.to_string()) }))
}

pub async fn delete_group(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let group_id =
        Uuid::parse_str(&id).map_err(|_| fail(StatusCode::BAD_REQUEST, "Invalid group id."))?;
    let result = sqlx::query("DELETE FROM business_mail_groups WHERE id = $1 AND tenant_id = $2")
        .bind(group_id)
        .bind(context.tenant_id)
        .execute(db)
        .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &context.email,
                &context.role,
                "company.group_deleted",
                "groups",
                Some(&group_id.to_string()),
                context.tenant_id,
                json!({}),
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => Err(fail(StatusCode::NOT_FOUND, "Group not found.")),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to delete the group.",
        )),
    }
}

// ---------------------------------------------------------------------------
// Domain DNS requirements
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct DomainQuery {
    pub domain: String,
}

#[derive(Debug, Deserialize)]
pub struct DomainIdPath {
    pub id: String,
}

/// Everything the console needs to know about the DNS of one domain.
struct DnsReport {
    provider: String,
    sending_domain: String,
    records: Vec<crate::domain_dns::DnsRequirement>,
    complete: bool,
    missing: Vec<String>,
    message: String,
}

impl DnsReport {
    fn to_json(&self, domain: &str, domain_status: &str) -> Value {
        json!({
            "success": true,
            "domain": domain,
            "provider": self.provider,
            "sendingDomain": self.sending_domain,
            "domainStatus": domain_status,
            "complete": self.complete,
            "records": self.records,
            "missing": self.missing,
            "message": self.message,
        })
    }
}

/// Read the DNS of a domain and check every record against the live DNS.
async fn build_dns_report(
    state: &AppState,
    db: &PgPool,
    tenant_id: Uuid,
    domain: &str,
) -> DnsReport {
    // The provider credentials live on the account that owns the workspace.
    // The owner of the company is preferred, because that is the account that
    // holds the sending credentials.
    let row = sqlx::query(
        "SELECT u.settings FROM users u
         JOIN company_members cm ON cm.user_id = u.id AND cm.tenant_id = $1 AND cm.status = 'active'
         ORDER BY (cm.role = 'owner') DESC, cm.created_at ASC
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let settings: Value = row
        .as_ref()
        .and_then(|row| row.try_get::<Value, _>("settings").ok())
        .unwrap_or_else(|| json!({}));
    let provider = settings
        .get("businessMailProvider")
        .and_then(Value::as_str)
        .unwrap_or("resend")
        .to_string();
    // The domain may be served by the customer's own provider account or by
    // the platform provider. Both are looked up so the records always match
    // the account that actually sends the mail.
    let customer_key = settings
        .get("businessApiKey")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let api_key = if customer_key.is_empty() {
        state.config.platform_resend_api_key.trim().to_string()
    } else {
        customer_key
    };

    let (sending_domain, mut records) = crate::domain_dns::requirements(
        &state.http_client,
        &provider,
        &api_key,
        domain,
        &state.config.spf_record,
        &state.config.dkim_selector,
    )
    .await;

    // A verified domain no longer returns its records from the provider, so
    // the copy that was stored when the domain was added is merged in. The
    // live DNS check below still decides whether each record is active.
    let stored = sqlx::query(
        "SELECT dns_records, mx_records FROM custom_domains
         WHERE tenant_id = $1 AND LOWER(domain_name) = LOWER($2) LIMIT 1",
    )
    .bind(tenant_id)
    .bind(domain)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    if let Some(row) = stored {
        let dns_records: Value = row.try_get("dns_records").unwrap_or_else(|_| json!([]));
        let mx_records: Value = row.try_get("mx_records").unwrap_or_else(|_| json!([]));
        let mut stored_records = crate::domain_dns::from_stored(&dns_records, &mx_records, domain);
        stored_records.retain(|record| {
            !records.iter().any(|existing| {
                existing.host.eq_ignore_ascii_case(&record.host)
                    && existing.record_type == record.record_type
            })
        });
        records.append(&mut stored_records);
    }

    let records = crate::domain_dns::verify(&state.http_client, records).await;
    let complete = crate::domain_dns::is_complete(&records);
    let missing: Vec<String> = records
        .iter()
        .filter(|record| record.status != "verified")
        .map(|record| {
            format!(
                "{} {} ({})",
                record.record_type, record.name, record.purpose
            )
        })
        .collect();
    let message = if complete {
        "Every DNS record is published and active. The domain can send and receive mail."
            .to_string()
    } else {
        format!(
            "{} DNS record(s) still need attention. Publish them and run the check again.",
            missing.len()
        )
    };

    DnsReport {
        provider,
        sending_domain,
        records,
        complete,
        missing,
        message,
    }
}

/// The exact DNS records a domain has to publish, with the live status of
/// each one. The console uses this to tell the customer what is missing
/// instead of guessing.
pub async fn dns_requirements(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<DomainQuery>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let domain = query
        .domain
        .trim()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if domain.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "A domain is required."));
    }

    let report = build_dns_report(&state, db, context.tenant_id, &domain).await;
    let mut domain_status: String = sqlx::query_scalar(
        "SELECT verification_status FROM custom_domains
         WHERE tenant_id = $1 AND LOWER(domain_name) = LOWER($2) LIMIT 1",
    )
    .bind(context.tenant_id)
    .bind(&domain)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "pending".to_string());

    // Read-through repair: if the published records are already complete the
    // stored status is simply out of date. Without this the setup gate can
    // keep a fully configured workspace closed until someone presses verify.
    if report.complete && domain_status != "verified" {
        let _ = sqlx::query(
            "UPDATE custom_domains
             SET verification_status = 'verified',
                 verified_at = COALESCE(verified_at, NOW())
             WHERE tenant_id = $1 AND LOWER(domain_name) = LOWER($2)",
        )
        .bind(context.tenant_id)
        .bind(&domain)
        .execute(db)
        .await;
        domain_status = "verified".to_string();
    }

    ok(report.to_json(&domain, &domain_status))
}

/// Check a domain against the live DNS and store the result.
///
/// The domain only counts as verified when every record - the sending
/// records, the receiving MX and the DMARC policy - is published and active.
pub async fn verify_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<DomainIdPath>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let row = sqlx::query(
        "SELECT domain_name FROM custom_domains WHERE tenant_id = $1 AND id::text = $2 LIMIT 1",
    )
    .bind(context.tenant_id)
    .bind(&path.id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let domain = match row {
        Some(row) => row
            .try_get::<String, _>("domain_name")
            .unwrap_or_default()
            .to_ascii_lowercase(),
        None => {
            return Err(fail(
                StatusCode::NOT_FOUND,
                "That domain is not connected to your company.",
            ))
        }
    };

    let report = build_dns_report(&state, db, context.tenant_id, &domain).await;

    // Store what is published, so the console and the deliverability score
    // show the real records instead of an empty state.
    let spf = report
        .records
        .iter()
        .find(|record| record.match_mode == "spf" && record.status == "verified")
        .map(|record| record.actual.clone());
    let dkim = report
        .records
        .iter()
        .find(|record| record.match_mode == "exists" && record.status == "verified")
        .map(|record| record.value.clone());
    let dmarc = report
        .records
        .iter()
        .find(|record| record.match_mode == "prefix" && record.status == "verified")
        .map(|record| record.value.clone());
    let mx: Vec<Value> = report
        .records
        .iter()
        .filter(|record| record.record_type == "MX")
        .map(|record| {
            json!({
                "type": "MX",
                "name": record.name,
                "value": record.actual,
                "ttl": record.ttl,
                "status": record.status,
            })
        })
        .collect();
    let mut dns: Vec<Value> = report
        .records
        .iter()
        .filter(|record| record.record_type == "TXT")
        .map(|record| {
            json!({
                "type": "TXT",
                "name": record.name,
                "value": record.actual,
                "ttl": record.ttl,
                "status": record.status,
            })
        })
        .collect();

    // The ownership proof stays with the domain. It is the token the customer
    // published, so it is never replaced by the live mail records.
    let stored_records: Value = sqlx::query_scalar(
        "SELECT dns_records FROM custom_domains WHERE tenant_id = $1 AND id::text = $2",
    )
    .bind(context.tenant_id)
    .bind(&path.id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| json!([]));
    if let Some(entries) = stored_records.as_array() {
        for entry in entries {
            let is_ownership = entry
                .get("name")
                .and_then(Value::as_str)
                .map(|name| name.to_lowercase().contains("velismail-verif"))
                .unwrap_or(false);
            if is_ownership {
                dns.push(entry.clone());
            }
        }
    }

    let status = if report.complete {
        "verified"
    } else {
        "pending"
    };
    let _ = sqlx::query(
        "UPDATE custom_domains
         SET verification_status = $1,
             verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END,
             spf_record = COALESCE($2, spf_record),
             dkim_record = COALESCE($3, dkim_record),
             dmarc_record = COALESCE($4, dmarc_record),
             dns_records = $5,
             mx_records = $6
         WHERE tenant_id = $7 AND id::text = $8",
    )
    .bind(status)
    .bind(spf)
    .bind(dkim)
    .bind(dmarc)
    .bind(json!(dns))
    .bind(json!(mx))
    .bind(context.tenant_id)
    .bind(&path.id)
    .execute(db)
    .await;

    // A verified domain gets its sending mailboxes, in the central index and
    // in the business database, so the first mail is accepted.
    if report.complete {
        for (address, kind, display_name) in [
            (format!("admin@{domain}"), "primary", "VelisMail"),
            (format!("postmaster@{domain}"), "user", "Postmaster"),
        ] {
            let mailbox_id = format!("mbx_{}", Uuid::new_v4().simple());
            let mailbox = crate::business_mailboxes::MailboxValues {
                id: &mailbox_id,
                domain: &domain,
                address: &address,
                display_name,
                kind,
                aliases: "[]",
                active: true,
                source: "system",
            };
            if let Err(err) =
                crate::business_mailboxes::upsert_central(db, context.tenant_id, &mailbox).await
            {
                tracing::warn!("mailbox {address} was not indexed: {err}");
            }
            if let Some(business_db) = tenant_business_db_url(db, context.tenant_id).await {
                match crate::routes::business_mailbox_pool(&business_db).await {
                    Ok(pool) => {
                        if let Err(err) = crate::business_mailboxes::upsert(&pool, &mailbox).await {
                            tracing::warn!(
                                "mailbox {address} was not written to the business database: {err}"
                            );
                        }
                    }
                    Err(err) => {
                        tracing::warn!("business database unreachable for {address}: {err}");
                    }
                }
            }
        }
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.domain_verified",
        "domain",
        Some(&path.id),
        context.tenant_id,
        json!({ "domain": domain, "complete": report.complete, "missing": report.missing }),
    )
    .await;

    ok(report.to_json(&domain, status))
}

/// Remove a domain from the workspace.
///
/// The domain row and the mailboxes that belonged to it are removed together,
/// so a deleted domain never reappears in the console after the next refresh.
pub async fn delete_domain(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<DomainIdPath>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let domain: Option<String> = sqlx::query_scalar(
        "SELECT domain_name FROM custom_domains
         WHERE tenant_id = $1 AND id::text = $2 LIMIT 1",
    )
    .bind(context.tenant_id)
    .bind(&path.id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();
    let Some(domain) = domain else {
        return Err(fail(
            StatusCode::NOT_FOUND,
            "That domain is not connected to your company.",
        ));
    };

    let result = sqlx::query("DELETE FROM custom_domains WHERE tenant_id = $1 AND id::text = $2")
        .bind(context.tenant_id)
        .bind(&path.id)
        .execute(db)
        .await;
    match result {
        Ok(done) if done.rows_affected() > 0 => {
            let _ = sqlx::query(
                "DELETE FROM business_mailboxes WHERE tenant_id = $1 AND LOWER(domain) = LOWER($2)",
            )
            .bind(context.tenant_id)
            .bind(&domain)
            .execute(db)
            .await;
            let _ = sqlx::query(
                "DELETE FROM business_mail_groups WHERE tenant_id = $1 AND LOWER(domain) = LOWER($2)",
            )
            .bind(context.tenant_id)
            .bind(&domain)
            .execute(db)
            .await;

            audit(
                db,
                &context.email,
                &context.role,
                "company.domain_deleted",
                "domain",
                Some(&path.id),
                context.tenant_id,
                json!({ "domain": domain }),
            )
            .await;
            ok(json!({ "success": true, "domain": domain }))
        }
        Ok(_) => Err(fail(
            StatusCode::NOT_FOUND,
            "That domain is not connected to your company.",
        )),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to delete the domain.",
        )),
    }
}

/// Whether a domain may send mail right now.
///
/// A domain that is not verified yet is checked against the live DNS, so the
/// customer is told exactly which record is still missing instead of getting
/// a mail that bounces later.
pub(crate) async fn domain_send_readiness(
    state: &AppState,
    db: &PgPool,
    domain: &str,
) -> Option<(bool, Vec<String>, String)> {
    let row = sqlx::query(
        "SELECT tenant_id, verification_status FROM custom_domains
         WHERE LOWER(domain_name) = LOWER($1) LIMIT 1",
    )
    .bind(domain)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()?;
    let tenant_id: Uuid = row.try_get("tenant_id").ok()?;
    let status: String = row
        .try_get::<Option<String>, _>("verification_status")
        .ok()
        .flatten()
        .unwrap_or_else(|| "pending".to_string());
    if status == "verified" {
        return Some((true, Vec::new(), String::new()));
    }

    let report = build_dns_report(state, db, tenant_id, domain).await;
    if report.complete {
        // The records are live, so the stored status was simply out of date.
        let _ = sqlx::query(
            "UPDATE custom_domains SET verification_status = 'verified', verified_at = NOW()
             WHERE tenant_id = $1 AND LOWER(domain_name) = LOWER($2)",
        )
        .bind(tenant_id)
        .bind(domain)
        .execute(db)
        .await;
        return Some((true, Vec::new(), String::new()));
    }
    Some((false, report.missing, report.message))
}

/// The business database of a company.
///
/// The database is configured on the account that owns the workspace, so the
/// owner of the company is asked first.
async fn tenant_business_db_url(db: &PgPool, tenant_id: Uuid) -> Option<String> {
    let row = sqlx::query(
        "SELECT u.settings FROM users u
         JOIN company_members cm ON cm.user_id = u.id AND cm.tenant_id = $1 AND cm.status = 'active'
         ORDER BY (cm.role = 'owner') DESC, cm.created_at ASC
         LIMIT 1",
    )
    .bind(tenant_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten()?;

    let settings: Value = row.try_get::<Value, _>("settings").ok()?;
    settings
        .get("businessDbUrl")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

/// Remove a member from the workspace.
///
/// The membership is marked as removed, so the member loses the access at
/// once and the seat is free again.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveMemberRequest {
    pub email: String,
}

pub async fn remove_team_member(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RemoveMemberRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    context.require_manage()?;
    let db = db_pool(&state)?;

    let email = payload.email.trim().to_lowercase();
    if email.is_empty() {
        return Err(fail(StatusCode::BAD_REQUEST, "A member email is required."));
    }
    if email == context.email {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "You cannot remove yourself from the workspace.",
        ));
    }

    let owner_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM company_members
         WHERE tenant_id = $1 AND role = 'owner' AND status = 'active'",
    )
    .bind(context.tenant_id)
    .fetch_one(db)
    .await
    .unwrap_or(0);
    let target_is_owner: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM company_members
         WHERE tenant_id = $1 AND LOWER(email) = $2 AND role = 'owner')",
    )
    .bind(context.tenant_id)
    .bind(&email)
    .fetch_one(db)
    .await
    .unwrap_or(false);
    if target_is_owner && owner_count <= 1 {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "A workspace needs at least one owner.",
        ));
    }

    let result = sqlx::query(
        "UPDATE company_members SET status = 'removed'
         WHERE tenant_id = $1 AND LOWER(email) = $2 AND status <> 'removed'",
    )
    .bind(context.tenant_id)
    .bind(&email)
    .execute(db)
    .await;
    if let Err(err) = result {
        tracing::error!("could not remove member {email}: {err}");
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to remove the member.",
        ));
    }

    // The sessions of the member are closed, so the access ends at once.
    let _ = sqlx::query(
        "UPDATE sessions SET is_active = false
         WHERE user_id IN (SELECT user_id FROM users WHERE LOWER(email) = $1 AND tenant_id = $2)",
    )
    .bind(&email)
    .bind(context.tenant_id)
    .execute(db)
    .await;

    audit(
        db,
        &context.email,
        &context.role,
        "company.member_removed",
        "team",
        Some(&email),
        context.tenant_id,
        json!({ "email": email }),
    )
    .await;

    ok(json!({ "success": true, "email": email }))
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
pub async fn list_contacts(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let search = params
        .get("search")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let group = params
        .get("group")
        .cloned()
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    let rows = sqlx::query(
        "SELECT id, name, email, phone, company, group_name, notes, is_favorite, created_at, updated_at
         FROM business_contacts
         WHERE tenant_id = $1
           AND ($2 = '' OR LOWER(name) LIKE '%' || $2 || '%' OR LOWER(email) LIKE '%' || $2 || '%' OR LOWER(company) LIKE '%' || $2 || '%')
           AND ($3 = '' OR LOWER(group_name) = $3)
         ORDER BY LOWER(name)",
    )
    .bind(context.tenant_id)
    .bind(&search)
    .bind(&group)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let contacts: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "email": row.try_get::<String, _>("email").unwrap_or_default(),
                "phone": row.try_get::<Option<String>, _>("phone").ok().flatten(),
                "company": row.try_get::<Option<String>, _>("company").ok().flatten(),
                "group": row.try_get::<String, _>("group_name").unwrap_or_default(),
                "notes": row.try_get::<String, _>("notes").unwrap_or_default(),
                "favorite": row.try_get::<bool, _>("is_favorite").unwrap_or(false),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "updatedAt": row.try_get::<Option<DateTime<Utc>>, _>("updated_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    let groups = sqlx::query(
        "SELECT group_name AS name, COUNT(*)::bigint AS count
         FROM business_contacts WHERE tenant_id = $1
         GROUP BY group_name ORDER BY group_name",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let groups: Vec<Value> = groups
        .iter()
        .map(|row| {
            json!({
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "count": row.try_get::<i64, _>("count").unwrap_or(0),
            })
        })
        .collect();

    ok(json!({ "success": true, "contacts": contacts, "groups": groups }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactRequest {
    pub id: Option<String>,
    pub name: String,
    pub email: String,
    pub phone: Option<String>,
    pub company: Option<String>,
    pub group: Option<String>,
    pub notes: Option<String>,
    pub favorite: Option<bool>,
}

pub async fn create_contact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ContactRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let name = payload.name.trim().to_string();
    let email = normalize_email(&payload.email);
    if name.is_empty() || !email.contains('@') {
        return Err(fail(
            StatusCode::BAD_REQUEST,
            "A contact name and a valid email address are required.",
        ));
    }
    let group = payload
        .group
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "General".to_string());

    let row = if let Some(id) = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        // An existing contact is updated in place, so the email can change
        // without leaving a second copy behind.
        sqlx::query(
            "UPDATE business_contacts SET
                name = $3, email = $4, phone = $5, company = $6,
                group_name = $7, notes = $8, is_favorite = $9, updated_at = NOW()
             WHERE tenant_id = $1 AND id::text = $2
             RETURNING id",
        )
        .bind(context.tenant_id)
        .bind(id)
        .bind(&name)
        .bind(&email)
        .bind(
            payload
                .phone
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            payload
                .company
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(&group)
        .bind(payload.notes.as_deref().unwrap_or(""))
        .bind(payload.favorite.unwrap_or(false))
        .fetch_optional(db)
        .await
    } else {
        sqlx::query(
            "INSERT INTO business_contacts
             (tenant_id, name, email, phone, company, group_name, notes, is_favorite, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (tenant_id, email) DO UPDATE
             SET name = EXCLUDED.name,
                 phone = EXCLUDED.phone,
                 company = EXCLUDED.company,
                 group_name = EXCLUDED.group_name,
                 notes = EXCLUDED.notes,
                 is_favorite = EXCLUDED.is_favorite,
                 updated_at = NOW()
             RETURNING id",
        )
        .bind(context.tenant_id)
        .bind(&name)
        .bind(&email)
        .bind(
            payload
                .phone
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(
            payload
                .company
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty()),
        )
        .bind(&group)
        .bind(payload.notes.as_deref().unwrap_or(""))
        .bind(payload.favorite.unwrap_or(false))
        .bind(&context.email)
        .fetch_optional(db)
        .await
    };

    let id = match row {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        _ => None,
    };
    if id.is_none() {
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to save the contact.",
        ));
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.contact_saved",
        "contacts",
        id.map(|value| value.to_string()).as_deref(),
        context.tenant_id,
        json!({ "email": email }),
    )
    .await;

    ok(json!({ "success": true, "id": id.map(|value| value.to_string()) }))
}

pub async fn delete_contact(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let contact_id =
        Uuid::parse_str(&id).map_err(|_| fail(StatusCode::BAD_REQUEST, "Invalid contact id."))?;
    let result = sqlx::query("DELETE FROM business_contacts WHERE id = $1 AND tenant_id = $2")
        .bind(contact_id)
        .bind(context.tenant_id)
        .execute(db)
        .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &context.email,
                &context.role,
                "company.contact_deleted",
                "contacts",
                Some(&contact_id.to_string()),
                context.tenant_id,
                json!({}),
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => Err(fail(StatusCode::NOT_FOUND, "Contact not found.")),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to delete the contact.",
        )),
    }
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

pub async fn list_signatures(State(state): State<AppState>, headers: HeaderMap) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let rows = sqlx::query(
        "SELECT id, name, content, is_default, created_at, updated_at
         FROM business_signatures WHERE tenant_id = $1
         ORDER BY is_default DESC, LOWER(name)",
    )
    .bind(context.tenant_id)
    .fetch_all(db)
    .await
    .unwrap_or_default();

    let signatures: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").map(|v| v.to_string()).unwrap_or_default(),
                "name": row.try_get::<String, _>("name").unwrap_or_default(),
                "content": row.try_get::<String, _>("content").unwrap_or_default(),
                "isDefault": row.try_get::<bool, _>("is_default").unwrap_or(false),
                "createdAt": row.try_get::<Option<DateTime<Utc>>, _>("created_at").ok().flatten().map(|v| v.to_rfc3339()),
                "updatedAt": row.try_get::<Option<DateTime<Utc>>, _>("updated_at").ok().flatten().map(|v| v.to_rfc3339()),
            })
        })
        .collect();

    ok(json!({ "success": true, "signatures": signatures }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignatureRequest {
    pub id: Option<String>,
    pub name: String,
    pub content: String,
    pub is_default: Option<bool>,
}

pub async fn create_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SignatureRequest>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let name = payload.name.trim().to_string();
    if name.len() < 2 {
        return Err(fail(StatusCode::BAD_REQUEST, "Signature name is required."));
    }
    if payload.is_default.unwrap_or(false) {
        let _ =
            sqlx::query("UPDATE business_signatures SET is_default = FALSE WHERE tenant_id = $1")
                .bind(context.tenant_id)
                .execute(db)
                .await;
    }

    let row = if let Some(id) = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        sqlx::query(
            "UPDATE business_signatures
             SET name = $3, content = $4, is_default = $5, updated_at = NOW()
             WHERE tenant_id = $1 AND id::text = $2
             RETURNING id",
        )
        .bind(context.tenant_id)
        .bind(id)
        .bind(&name)
        .bind(payload.content.clone())
        .bind(payload.is_default.unwrap_or(false))
        .fetch_optional(db)
        .await
    } else {
        sqlx::query(
            "INSERT INTO business_signatures (tenant_id, user_id, name, content, is_default)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, name) DO UPDATE
             SET content = EXCLUDED.content,
                 is_default = EXCLUDED.is_default,
                 updated_at = NOW()
             RETURNING id",
        )
        .bind(context.tenant_id)
        .bind(context.user_id)
        .bind(&name)
        .bind(payload.content.clone())
        .bind(payload.is_default.unwrap_or(false))
        .fetch_optional(db)
        .await
    };

    let id = match row {
        Ok(Some(row)) => row.try_get::<Uuid, _>("id").ok(),
        _ => None,
    };
    if id.is_none() {
        return Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to save the signature.",
        ));
    }

    audit(
        db,
        &context.email,
        &context.role,
        "company.signature_saved",
        "signatures",
        id.map(|value| value.to_string()).as_deref(),
        context.tenant_id,
        json!({ "name": name }),
    )
    .await;

    ok(json!({ "success": true, "id": id.map(|value| value.to_string()) }))
}

pub async fn delete_signature(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult {
    let context = workspace_context(&state, &headers).await?;
    let db = db_pool(&state)?;

    let signature_id =
        Uuid::parse_str(&id).map_err(|_| fail(StatusCode::BAD_REQUEST, "Invalid signature id."))?;
    let result = sqlx::query("DELETE FROM business_signatures WHERE id = $1 AND tenant_id = $2")
        .bind(signature_id)
        .bind(context.tenant_id)
        .execute(db)
        .await;

    match result {
        Ok(done) if done.rows_affected() > 0 => {
            audit(
                db,
                &context.email,
                &context.role,
                "company.signature_deleted",
                "signatures",
                Some(&signature_id.to_string()),
                context.tenant_id,
                json!({}),
            )
            .await;
            ok(json!({ "success": true }))
        }
        Ok(_) => Err(fail(StatusCode::NOT_FOUND, "Signature not found.")),
        Err(_) => Err(fail(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Unable to delete the signature.",
        )),
    }
}
