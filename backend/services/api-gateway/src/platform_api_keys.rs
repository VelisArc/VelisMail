//! Platform API keys - the control plane counterpart of a workspace key.
//!
//! A workspace key runs one company. A platform key runs the control plane:
//! it reads every company, every user, every support ticket and every
//! investigation, changes a plan, turns a feature flag and sends a broadcast.
//! That is what an assistant needs to monitor the whole ecosystem, upgrade
//! accounts and repair what is broken - without a browser session.
//!
//! The key is bound to the platform rather than to a tenant and carries the
//! scopes the operator granted. The scope is enforced on the API, per route,
//! and an endpoint that is not part of the platform API is refused outright:
//! a key never falls back to "allowed because it is unknown".

use crate::state::AppState;
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

/// Every platform key starts with this prefix.
pub const PLATFORM_API_KEY_PREFIX: &str = "vsk_plat_";

/// A verified platform key.
#[derive(Debug, Clone)]
pub struct PlatformApiKeyContext {
    pub key_id: Uuid,
    pub created_by: String,
    pub scopes: Vec<String>,
}

impl PlatformApiKeyContext {
    /// True when the key carries the scope, or the full access scope.
    pub fn allows(&self, scope: &str) -> bool {
        self.scopes
            .iter()
            .any(|value| value == "*" || value == "platform.full" || value == scope)
    }
}

/// Why a key was rejected.
#[derive(Debug)]
pub enum PlatformKeyError {
    Unknown,
    Revoked,
    Expired,
    Unavailable,
}

/// Resolve and verify a platform key.
pub async fn resolve(
    state: &AppState,
    token: &str,
) -> Result<PlatformApiKeyContext, PlatformKeyError> {
    let Some(db) = state.db.as_ref() else {
        return Err(PlatformKeyError::Unavailable);
    };

    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let record = sqlx::query(
        "SELECT id, scopes, created_by, revoked_at, expires_at
         FROM platform_api_keys WHERE key_hash = $1",
    )
    .bind(&hash)
    .fetch_optional(db)
    .await
    .map_err(|_| PlatformKeyError::Unavailable)?
    .ok_or(PlatformKeyError::Unknown)?;

    if record
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at")
        .ok()
        .flatten()
        .is_some()
    {
        return Err(PlatformKeyError::Revoked);
    }
    if let Some(expires_at) = record
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("expires_at")
        .ok()
        .flatten()
    {
        if expires_at <= chrono::Utc::now() {
            return Err(PlatformKeyError::Expired);
        }
    }

    Ok(PlatformApiKeyContext {
        key_id: record.try_get("id").unwrap_or_else(|_| Uuid::nil()),
        created_by: record.try_get("created_by").unwrap_or_default(),
        scopes: record.try_get("scopes").unwrap_or_default(),
    })
}

/// The scope a platform route needs.
///
/// `None` means the route is not part of the platform API. A platform key is
/// refused on such a route instead of being let through, so an endpoint that
/// is added later can never be reached with a key by accident.
pub fn required_scope(method: &str, path: &str) -> Option<&'static str> {
    let route = path.strip_prefix("/admin/platform").unwrap_or(path);
    match (method, route) {
        ("GET", "/me") | ("GET", "/overview") | ("GET", "/analytics") | ("GET", "/system") => {
            Some("platform.read")
        }
        ("GET", "/companies") => Some("platform.companies.read"),
        ("GET", p) if p.starts_with("/companies/") => Some("platform.companies.read"),
        ("PATCH", p) if p.starts_with("/companies/") => Some("platform.companies.write"),
        ("POST", p) if p.starts_with("/companies/") => Some("platform.companies.write"),
        ("GET", "/users") => Some("platform.users.read"),
        ("POST", p) if p.starts_with("/users/") => Some("platform.users.write"),
        ("GET", "/support") => Some("platform.support.read"),
        ("PATCH", p) if p.starts_with("/support/") => Some("platform.support.write"),
        ("GET", "/investigations") => Some("platform.investigations.read"),
        ("POST", "/investigations") => Some("platform.investigations.write"),
        ("GET", p) if p.starts_with("/investigations/") => Some("platform.investigations.read"),
        ("PATCH", p) if p.starts_with("/investigations/") => Some("platform.investigations.write"),
        ("POST", p) if p.starts_with("/investigations/") => Some("platform.investigations.write"),
        ("GET", "/audit") => Some("platform.audit.read"),
        ("GET", "/team") => Some("platform.team.read"),
        ("POST", "/team") => Some("platform.team.write"),
        ("PATCH", p) if p.starts_with("/team/") => Some("platform.team.write"),
        ("GET", "/billing") => Some("platform.billing.read"),
        ("GET", "/feature-flags") => Some("platform.flags.read"),
        ("PATCH", "/feature-flags") => Some("platform.flags.write"),
        ("GET", "/announcements") => Some("platform.announcements.read"),
        ("POST", "/announcements") => Some("platform.announcements.write"),
        ("PATCH", p) if p.starts_with("/announcements/") => Some("platform.announcements.write"),
        ("POST", "/broadcast") => Some("platform.broadcast"),
        ("GET", "/broadcast") | ("GET", "/broadcasts") | ("GET", "/broadcast/senders") => {
            Some("platform.broadcast")
        }
        ("GET", "/settings") => Some("platform.settings.read"),
        ("PATCH", "/settings") => Some("platform.settings.write"),
        ("GET", "/api-keys") => Some("platform.keys.read"),
        ("POST", "/api-keys") => Some("platform.keys.write"),
        ("DELETE", p) if p.starts_with("/api-keys/") => Some("platform.keys.write"),
        // The feedback channel is part of the control plane, so a platform key
        // has to be able to read, answer and escalate a complaint.
        ("GET", "/feedback") => Some("platform.feedback.read"),
        ("PATCH", p) if p.starts_with("/feedback") => Some("platform.feedback.write"),
        ("POST", p) if p.starts_with("/feedback") => Some("platform.feedback.write"),
        _ => None,
    }
}

/// Every scope a platform key can carry, with what it unlocks.
///
/// This is the single source of truth: the control plane builds its scope
/// picker from it, so an operator can always see exactly which permission a
/// key needs instead of guessing.
pub fn scope_catalog() -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({ "id": "platform.full", "label": "Full platform access", "detail": "Everything below in a single key. Use it for an assistant that really runs the whole platform.", "risk": "high" }),
        json!({ "id": "platform.read", "label": "Read the control plane", "detail": "The platform overview, the analytics, the revenue and the system health.", "risk": "low" }),
        json!({ "id": "platform.companies.read", "label": "Read companies", "detail": "List every company and open one to see its plan, usage and members.", "risk": "low" }),
        json!({ "id": "platform.companies.write", "label": "Manage companies", "detail": "Move a company to another plan, change its seat limit, suspend or activate it, cut its API keys or close its cases.", "risk": "high" }),
        json!({ "id": "platform.users.read", "label": "Read users", "detail": "List every account of the platform with its plan, status and recovery address.", "risk": "low" }),
        json!({ "id": "platform.users.write", "label": "Manage users", "detail": "Suspend or activate an account, force every session closed or change its role.", "risk": "high" }),
        json!({ "id": "platform.support.read", "label": "Read the feedback", "detail": "Read every support ticket and the feedback the users sent.", "risk": "low" }),
        json!({ "id": "platform.support.write", "label": "Answer the feedback", "detail": "Update and close a support ticket.", "risk": "medium" }),
        json!({ "id": "platform.investigations.read", "label": "Read investigations", "detail": "Read the open and closed investigations of the platform.", "risk": "low" }),
        json!({ "id": "platform.investigations.write", "label": "Run investigations", "detail": "Open an investigation, update it and add events to it.", "risk": "high" }),
        json!({ "id": "platform.audit.read", "label": "Read the audit trail", "detail": "Read every audited action of the control plane.", "risk": "low" }),
        json!({ "id": "platform.team.read", "label": "Read the platform team", "detail": "See which accounts run the control plane and with which role.", "risk": "low" }),
        json!({ "id": "platform.team.write", "label": "Manage the platform team", "detail": "Invite, re-role and remove platform administrators.", "risk": "high" }),
        json!({ "id": "platform.billing.read", "label": "Read the revenue", "detail": "Read the invoices, the revenue and the plan distribution.", "risk": "low" }),
        json!({ "id": "platform.flags.read", "label": "Read feature flags", "detail": "See which features are enabled for which plan.", "risk": "low" }),
        json!({ "id": "platform.flags.write", "label": "Manage feature flags", "detail": "Turn a feature on or off for a plan.", "risk": "medium" }),
        json!({ "id": "platform.announcements.read", "label": "Read announcements", "detail": "Read the announcements published to the platform.", "risk": "low" }),
        json!({ "id": "platform.announcements.write", "label": "Manage announcements", "detail": "Publish and change an announcement.", "risk": "medium" }),
        json!({ "id": "platform.broadcast", "label": "Send a broadcast", "detail": "Send a message to every account on the platform. The platform owner only.", "risk": "high" }),
        json!({ "id": "platform.settings.read", "label": "Read platform settings", "detail": "Read the settings of the control plane.", "risk": "low" }),
        json!({ "id": "platform.settings.write", "label": "Manage platform settings", "detail": "Change the settings of the control plane.", "risk": "high" }),
        json!({ "id": "platform.keys.read", "label": "Read platform keys", "detail": "See the platform keys, their scopes and when they were used last.", "risk": "medium" }),
        json!({ "id": "platform.keys.write", "label": "Manage platform keys", "detail": "Create and revoke the keys that run the control plane.", "risk": "high" }),
        json!({ "id": "platform.feedback.read", "label": "Read the complaints", "detail": "Read the complaints and notes the workspaces sent to the control plane.", "risk": "low" }),
        json!({ "id": "platform.feedback.write", "label": "Answer the complaints", "detail": "Answer a complaint, change its priority and escalate it into an investigation.", "risk": "medium" }),
    ]
}

/// Ready made key templates for the control plane.
///
/// Picking a template is faster than picking twenty scopes by hand, and it
/// makes the intended access of a key obvious to everybody who reads it later.
pub fn key_presets() -> Vec<serde_json::Value> {
    use serde_json::json;
    vec![
        json!({
            "id": "monitoring",
            "name": "Monitoring",
            "summary": "Reads the whole ecosystem without changing anything.",
            "detail": "The key sees every company, user, feedback ticket, investigation, invoice and the system health. It cannot change a single thing.",
            "scopes": [
                "platform.read", "platform.companies.read", "platform.users.read",
                "platform.support.read", "platform.investigations.read",
                "platform.audit.read", "platform.team.read", "platform.billing.read",
                "platform.flags.read", "platform.announcements.read",
                "platform.settings.read", "platform.keys.read"
            ],
            "recommended": true
        }),
        json!({
            "id": "fleet",
            "name": "Fleet operations",
            "summary": "Upgrades accounts, repairs them and turns features on.",
            "detail": "Everything the monitoring key reads, plus moving a company to another plan, changing its seats, suspending an account, running the feature flags and the platform settings. It cannot talk to the users and cannot create other keys.",
            "scopes": [
                "platform.read", "platform.companies.read", "platform.companies.write",
                "platform.users.read", "platform.users.write", "platform.support.read",
                "platform.investigations.read", "platform.audit.read",
                "platform.billing.read", "platform.flags.read", "platform.flags.write",
                "platform.settings.read", "platform.settings.write"
            ],
            "recommended": true
        }),
        json!({
            "id": "support",
            "name": "Support desk",
            "summary": "Works the feedback queue of the platform.",
            "detail": "The key reads every company and user, reads and answers the support tickets and runs the investigations. It cannot change a plan and cannot send a broadcast.",
            "scopes": [
                "platform.read", "platform.companies.read", "platform.users.read",
                "platform.support.read", "platform.support.write",
                "platform.investigations.read", "platform.investigations.write",
                "platform.audit.read"
            ],
            "recommended": false
        }),
        json!({
            "id": "growth",
            "name": "Growth and announcements",
            "summary": "Publishes announcements and talks to every account.",
            "detail": "The key reads the analytics, the revenue and the companies, publishes announcements and can send a broadcast to every account on the platform.",
            "scopes": [
                "platform.read", "platform.companies.read", "platform.users.read",
                "platform.billing.read", "platform.announcements.read",
                "platform.announcements.write", "platform.broadcast",
                "platform.audit.read"
            ],
            "recommended": false
        }),
        json!({
            "id": "full",
            "name": "Full platform access",
            "summary": "One key that can run the entire control plane.",
            "detail": "Use it only for an assistant that really owns the platform. It can change plans, accounts, flags, settings and the team, and it can broadcast to every account. Every action of the key is attributed to its creator in the audit trail.",
            "scopes": ["platform.full"],
            "recommended": false
        }),
    ]
}

/// The scope ids a platform key may carry.
pub fn allowed_scopes() -> Vec<String> {
    scope_catalog()
        .iter()
        .filter_map(|scope| {
            scope
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .collect()
}

/// Remember when a key was last used so the console can show real usage.
pub fn touch_last_used(state: &AppState, key_id: Uuid) {
    if let Some(db) = state.db.as_ref() {
        let db = db.clone();
        tokio::spawn(async move {
            let _ = sqlx::query("UPDATE platform_api_keys SET last_used_at = NOW() WHERE id = $1")
                .bind(key_id)
                .execute(&db)
                .await;
        });
    }
}
