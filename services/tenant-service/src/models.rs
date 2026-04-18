//! Tenant service database models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde_json::Value;

/// Tenant entity
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Tenant {
    pub id: Uuid,
    pub organization_name: String,
    pub organization_email: String,
    pub plan_tier: String,
    pub status: String,
    pub settings: Value,
    pub limits: Value,
    pub billing_info: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Tenant user association
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct TenantUser {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub user_id: Uuid,
    pub role: String,
    pub permissions: Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Custom domain
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct CustomDomain {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub domain_name: String,
    pub verification_status: String,
    pub verification_method: Option<String>,
    pub dns_records: Value,
    pub mx_records: Value,
    pub spf_record: Option<String>,
    pub dkim_record: Option<String>,
    pub dmarc_record: Option<String>,
    pub ssl_certificate: Option<Value>,
    pub created_at: DateTime<Utc>,
    pub verified_at: Option<DateTime<Utc>>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Resource usage tracking
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ResourceUsage {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub period_start: DateTime<Utc>,
    pub period_end: DateTime<Utc>,
    pub emails_sent: i32,
    pub emails_received: i32,
    pub storage_used_bytes: i64,
    pub api_requests: i32,
    pub active_users: i32,
    pub created_at: DateTime<Utc>,
}

/// Audit log
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLog {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub user_id: Option<Uuid>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<Uuid>,
    pub details: Value,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Tenant creation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTenantRequest {
    pub organization_name: String,
    pub organization_email: String,
    pub plan_tier: Option<String>,
    pub initial_settings: Option<Value>,
}

/// Tenant update request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTenantRequest {
    pub organization_name: Option<String>,
    pub organization_email: Option<String>,
    pub plan_tier: Option<String>,
    pub status: Option<String>,
    pub settings: Option<Value>,
    pub limits: Option<Value>,
}

/// Custom domain addition request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddDomainRequest {
    pub domain_name: String,
    pub verification_method: Option<String>,
}

/// Resource limits configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_users: u32,
    pub max_storage_gb: u32,
    pub max_emails_per_day: u32,
    pub max_attachment_size_mb: u32,
    pub api_rate_limit_per_minute: u32,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_users: 10,
            max_storage_gb: 5,
            max_emails_per_day: 1000,
            max_attachment_size_mb: 25,
            api_rate_limit_per_minute: 60,
        }
    }
}

/// Tenant settings configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantSettings {
    pub enable_e2ee: bool,
    pub require_mfa: bool,
    pub audit_log_enabled: bool,
    pub custom_branding: Option<Value>,
    pub allowed_ip_ranges: Option<Vec<String>>,
    pub session_timeout_minutes: u32,
}

impl Default for TenantSettings {
    fn default() -> Self {
        Self {
            enable_e2ee: true,
            require_mfa: false,
            audit_log_enabled: true,
            custom_branding: None,
            allowed_ip_ranges: None,
            session_timeout_minutes: 60,
        }
    }
}

/// Billing information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingInfo {
    pub plan: String,
    pub billing_cycle: String,
    pub payment_method: Option<String>,
    pub next_billing_date: Option<DateTime<Utc>>,
    pub billing_address: Option<Value>,
}

/// Tenant statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantStats {
    pub total_users: u32,
    pub active_users: u32,
    pub storage_used_gb: f64,
    pub emails_sent_today: u32,
    pub emails_received_today: u32,
    pub api_requests_today: u32,
    pub domains_count: u32,
    pub verified_domains_count: u32,
}