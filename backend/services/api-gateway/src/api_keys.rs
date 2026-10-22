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
        ("POST", p) if p.starts_with("/domains/") && p.ends_with("/verify") => {
            Some("domains.write")
        }
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

/// Every scope a workspace key can carry, with what it unlocks.
///
/// This is the single source of truth: the console builds its scope picker
/// from it, so an operator can always see exactly which permission a key
/// needs instead of guessing.
pub fn scope_catalog() -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({ "id": "admin.full", "label": "Full workspace access", "detail": "Everything below in a single key. Use it for an assistant that runs the whole workspace.", "risk": "high" }),
        json!({ "id": "team.read", "label": "Read the team", "detail": "List members and pending invitations.", "risk": "low" }),
        json!({ "id": "team.write", "label": "Manage the team", "detail": "Invite, re-role and remove members.", "risk": "medium" }),
        json!({ "id": "domains.read", "label": "Read domains", "detail": "List domains and their DNS records.", "risk": "low" }),
        json!({ "id": "domains.write", "label": "Manage domains", "detail": "Add a domain and trigger its verification.", "risk": "medium" }),
        json!({ "id": "mailboxes.read", "label": "Read mailboxes", "detail": "List the mailboxes of the workspace.", "risk": "low" }),
        json!({ "id": "mailboxes.write", "label": "Manage mailboxes", "detail": "Create and remove mailboxes.", "risk": "medium" }),
        json!({ "id": "mail.read", "label": "Read mail activity", "detail": "Read the delivery queue and the sent mail of the workspace.", "risk": "low" }),
        json!({ "id": "audit.read", "label": "Read the audit trail", "detail": "Read every audited action of the workspace.", "risk": "low" }),
        json!({ "id": "templates.read", "label": "Read templates", "detail": "List the saved templates.", "risk": "low" }),
        json!({ "id": "templates.write", "label": "Manage templates", "detail": "Create, edit and delete templates.", "risk": "medium" }),
        json!({ "id": "contacts.read", "label": "Read contacts", "detail": "List contacts and contact groups.", "risk": "low" }),
        json!({ "id": "contacts.write", "label": "Manage contacts", "detail": "Create and delete contacts.", "risk": "medium" }),
        json!({ "id": "signatures.read", "label": "Read signatures", "detail": "List the saved signatures.", "risk": "low" }),
        json!({ "id": "signatures.write", "label": "Manage signatures", "detail": "Create and delete signatures.", "risk": "medium" }),
    ]
}

/// Ready made key templates.
///
/// Picking a template is faster than picking fifteen scopes by hand, and it
/// makes the intended access of a key obvious to everybody who reads it later.
pub fn key_presets() -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({
            "id": "reporting",
            "name": "Reporting",
            "summary": "Read only access to everything, for a dashboard or an auditor.",
            "detail": "The key can look at the team, domains, mailboxes, mail activity, templates, contacts, signatures and the audit trail. It cannot change anything.",
            "scopes": [
                "team.read", "domains.read", "mailboxes.read", "mail.read",
                "audit.read", "templates.read", "contacts.read", "signatures.read"
            ],
            "recommended": true
        }),
        json!({
            "id": "sending",
            "name": "Sending assistant",
            "summary": "Looks up what it needs to send mail on your behalf.",
            "detail": "The key can read mailboxes, templates, contacts, signatures and the domains, plus the mail activity. It cannot change the workspace.",
            "scopes": [
                "mail.read", "mailboxes.read", "templates.read",
                "contacts.read", "signatures.read", "domains.read"
            ],
            "recommended": true
        }),
        json!({
            "id": "mailboxes",
            "name": "Mailbox operations",
            "summary": "Keeps the mailboxes and the domains in order.",
            "detail": "The key can create and remove mailboxes, add and verify domains and read the team.",
            "scopes": [
                "mailboxes.read", "mailboxes.write", "domains.read", "domains.write", "team.read"
            ],
            "recommended": false
        }),
        json!({
            "id": "workspace",
            "name": "Workspace manager",
            "summary": "Runs the workspace for you, without the owner rights.",
            "detail": "Everything the reporting key can read, plus managing the team, templates, contacts, signatures and mailboxes. It cannot change plans, billing or the API keys.",
            "scopes": [
                "team.read", "team.write", "domains.read", "mailboxes.read", "mailboxes.write",
                "mail.read", "audit.read", "templates.read", "templates.write",
                "contacts.read", "contacts.write", "signatures.read", "signatures.write"
            ],
            "recommended": false
        }),
        json!({
            "id": "full",
            "name": "Full workspace access",
            "summary": "One key that can do everything in the workspace.",
            "detail": "Use it only for an assistant that really runs the whole workspace. Every action of the key is attributed to the company in the audit trail.",
            "scopes": ["admin.full"],
            "recommended": false
        }),
    ]
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
