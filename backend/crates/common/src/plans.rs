//! The allowance of every plan.
//!
//! One table for the whole platform: the tenant service uses it when it
//! provisions a tenant, and the console uses it to show what a workspace has
//! included. The console used to keep a second, hand written copy of these
//! numbers, which is how the two drifted apart and how a workspace ended up
//! shown a limit that was never enforced.

use serde_json::{json, Value};

/// What a plan includes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanAllowance {
    /// People with access to the workspace.
    pub seats: i64,
    /// Mail sent per month.
    pub monthly_emails: i64,
    /// Mail sent per day.
    pub emails_per_day: i64,
    /// Database storage in megabytes.
    pub storage_mb: i64,
    /// API requests per minute.
    pub api_rate_limit_per_minute: i64,
    /// Domains the workspace may connect.
    pub max_domains: i64,
    /// Templates the workspace may keep.
    pub max_templates: i64,
    /// Largest attachment in megabytes.
    pub max_attachment_size_mb: i64,
}

impl PlanAllowance {
    /// The allowance as the tenant limits document.
    ///
    /// This is exactly what the tenant service stores on the tenant, so the
    /// console shows the limit that is actually enforced.
    pub fn to_limits(self) -> Value {
        json!({
            "max_users": self.seats,
            "max_storage_mb": self.storage_mb,
            "max_emails_per_day": self.emails_per_day,
            "monthly_email_limit": self.monthly_emails,
            "max_attachment_size_mb": self.max_attachment_size_mb,
            "api_rate_limit_per_minute": self.api_rate_limit_per_minute,
            "max_domains": self.max_domains,
            "max_templates": self.max_templates,
        })
    }

    /// The allowance in the shape the console shows it.
    pub fn to_console_limits(self) -> Value {
        json!({
            "seats": self.seats,
            "emailsPerMonth": self.monthly_emails,
            "storageBytes": self.storage_mb * 1024 * 1024,
            "apiRequestsPerMinute": self.api_rate_limit_per_minute,
            "maxDomains": self.max_domains,
        })
    }
}

/// The allowance of a plan. Unknown plans fall back to the free allowance.
pub fn plan_allowance(plan: &str) -> PlanAllowance {
    match plan.trim().to_lowercase().as_str() {
        "starter" => PlanAllowance {
            seats: 15,
            monthly_emails: 150_000,
            emails_per_day: 150_000,
            storage_mb: 10_240,
            api_rate_limit_per_minute: 120,
            max_domains: 3,
            max_templates: 25,
            max_attachment_size_mb: 25,
        },
        "business" => PlanAllowance {
            seats: 75,
            monthly_emails: 750_000,
            emails_per_day: 750_000,
            storage_mb: 51_200,
            api_rate_limit_per_minute: 500,
            max_domains: 10,
            max_templates: 9_999,
            max_attachment_size_mb: 50,
        },
        "enterprise" | "premium" => PlanAllowance {
            seats: 9_999,
            monthly_emails: 3_000_000,
            emails_per_day: 3_000_000,
            storage_mb: 512_000,
            api_rate_limit_per_minute: 2_000,
            max_domains: 9_999,
            max_templates: 9_999,
            max_attachment_size_mb: 100,
        },
        _ => PlanAllowance {
            seats: 3,
            monthly_emails: 3_000,
            emails_per_day: 100,
            storage_mb: 500,
            api_rate_limit_per_minute: 30,
            max_domains: 1,
            max_templates: 3,
            max_attachment_size_mb: 5,
        },
    }
}

/// The plan allowance, with the limits a tenant stored itself taking over.
///
/// A tenant that was provisioned with a custom allowance keeps it; every
/// other tenant gets the allowance of its plan.
pub fn effective_allowance(plan: &str, stored_limits: &Value) -> PlanAllowance {
    let base = plan_allowance(plan);
    let read = |key: &str, fallback: i64| -> i64 {
        stored_limits
            .get(key)
            .and_then(Value::as_i64)
            .unwrap_or(fallback)
    };
    PlanAllowance {
        seats: read("max_users", base.seats),
        monthly_emails: read("monthly_email_limit", base.monthly_emails),
        emails_per_day: read("max_emails_per_day", base.emails_per_day),
        storage_mb: read("max_storage_mb", base.storage_mb),
        api_rate_limit_per_minute: read(
            "api_rate_limit_per_minute",
            base.api_rate_limit_per_minute,
        ),
        max_domains: read("max_domains", base.max_domains),
        max_templates: read("max_templates", base.max_templates),
        max_attachment_size_mb: read("max_attachment_size_mb", base.max_attachment_size_mb),
    }
}
