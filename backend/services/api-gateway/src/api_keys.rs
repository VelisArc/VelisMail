//! Workspace API keys.
//!
//! A workspace key is a bearer credential that authenticates on its own. It is
//! bound to exactly one company, carries the scopes the customer granted and
//! can therefore run the workspace (team, domains, mailboxes, contacts,
//! templates, audit) without a user session - which is what an integration or
//! an assistant needs.

use crate::state::AppState;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

/// Every key starts with this prefix.
pub const API_KEY_PREFIX: &str = "vsk_live_";

/// A verified key.
#[derive(Debug, Clone)]
pub struct ApiKeyContext {
    pub key_id: Uuid,
    pub tenant_id: Uuid,
    pub created_by: String,
    pub scopes: Vec<String>,
}

impl ApiKeyContext {
    /// True when the key carries the scope (or full access).
    pub fn allows(&self, scope: &str) -> bool {
        self.scopes
            .iter()
            .any(|value| value == "*" || value == "admin.full" || value == scope)
    }
}

/// Why a key was rejected.
#[derive(Debug)]
pub enum ApiKeyError {
    Unknown,
    Revoked,
    Expired,
    Unavailable,
}

/// Resolve and verify a workspace API key.
pub async fn resolve(state: &AppState, token: &str) -> Result<ApiKeyContext, ApiKeyError> {
    let Some(db) = state.db.as_ref() else {
        return Err(ApiKeyError::Unavailable);
    };

    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let record = sqlx::query(
        "SELECT id, tenant_id, scopes, created_by, revoked_at, expires_at
         FROM company_api_keys WHERE key_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await
    .map_err(|_| ApiKeyError::Unavailable)?
    .ok_or(ApiKeyError::Unknown)?;

    if record
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
        .ok()
        .flatten()
        .is_some()
    {
        return Err(ApiKeyError::Revoked);
    }
    if let Some(expires_at) = record
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at")
        .ok()
        .flatten()
    {
        if expires_at <= chrono::Utc::now() {
            return Err(ApiKeyError::Expired);
        }
    }

    Ok(ApiKeyContext {
        key_id: record.try_get("id").unwrap_or_else(|_| Uuid::nil()),
        tenant_id: record.try_get("tenant_id").unwrap_or_else(|_| Uuid::nil()),
        created_by: record.try_get("created_by").unwrap_or_default(),
        scopes: record.try_get("scopes").unwrap_or_default(),
    })
}

/// The scopes a workspace route needs. `None` means the route is not part of
/// the key driven workspace API.
pub fn required_scope(method: &str, path: &str) -> Option<&'static str> {
    let route = path.strip_prefix("/company").unwrap_or(path);
    match (method, route) {
        ("GET", "/team") => Some("team.read"),
        ("POST", "/team/invitations") => Some("team.write"),
        ("DELETE", p) if p.starts_with("/team/invitations") => Some("team.write"),
        ("GET", "/domains") => Some("domains.read"),
        ("POST", "/domains") => Some("domains.write"),
        ("GET", "/domains/dns-requirements") => Some("domains.read"),
        ("POST", p) if p.starts_with("/domains/") && p.ends_with("/verify") => Some("domains.write"),
        ("GET", "/mailboxes") => Some("mailboxes.read"),
        ("POST", "/mailboxes") => Some("mailboxes.write"),
        ("DELETE", "/mailboxes") => Some("mailboxes.write"),
        ("GET", "/queue") => Some("mail.read"),
        ("GET", "/audit") => Some("audit.read"),
        ("GET", "/templates") => Some("templates.read"),
        ("POST", "/templates") => Some("templates.write"),
        ("DELETE", p) if p.starts_with("/templates") => Some("templates.write"),
        ("GET", "/contacts") => Some("contacts.read"),
        ("POST", "/contacts") => Some("contacts.write"),
        ("DELETE", p) if p.starts_with("/contacts") => Some("contacts.write"),
        ("GET", "/signatures") => Some("signatures.read"),
        ("POST", "/signatures") => Some("signatures.write"),
        ("DELETE", p) if p.starts_with("/signatures") => Some("signatures.write"),
        _ => None,
    }
}

/// Remember when a key was last used so the console can show real usage.
pub fn touch_last_used(state: &AppState, key_id: Uuid) {
    if let Some(db) = state.db.as_ref() {
        let db = db.clone();
        tokio::spawn(async move {
            let _ = sqlx::query("UPDATE company_api_keys SET last_used_at = NOW() WHERE id = $1")
                .bind(key_id)
                .execute(&db)
                .await;
        });
    }
}
