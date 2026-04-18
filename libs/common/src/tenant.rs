//! Multi-tenant system types

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use crate::types::TenantId;

/// Tenant information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tenant {
    pub id: TenantId,
    pub name: String,
    pub domain: String,
    pub status: TenantStatus,
    pub plan: TenantPlan,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub settings: TenantSettings,
    pub limits: TenantLimits,
}

/// Tenant status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TenantStatus {
    Active,
    Suspended,
    PendingVerification,
    Deleted,
}

/// Tenant subscription plan
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TenantPlan {
    Free,
    Starter,
    Business,
    Enterprise,
}

/// Tenant configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantSettings {
    pub max_users: u32,
    pub max_storage_per_user_gb: u32,
    pub custom_domains: Vec<String>,
    pub enable_e2ee: bool,
    pub enable_ai_filter: bool,
    pub retention_days: u32,
    pub require_mfa: bool,
    pub allowed_ip_ranges: Option<Vec<String>>,
    pub sso_enabled: bool,
    pub audit_log_enabled: bool,
}

impl Default for TenantSettings {
    fn default() -> Self {
        Self {
            max_users: 10,
            max_storage_per_user_gb: 5,
            custom_domains: vec![],
            enable_e2ee: true,
            enable_ai_filter: true,
            retention_days: 30,
            require_mfa: false,
            allowed_ip_ranges: None,
            sso_enabled: false,
            audit_log_enabled: false,
        }
    }
}

/// Tenant limits and quotas
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantLimits {
    pub max_emails_per_day: u32,
    pub max_attachment_size_mb: u32,
    pub max_recipients_per_email: u32,
    pub api_rate_limit: u32,
    pub storage_quota_gb: u64,
}

impl TenantLimits {
    pub fn for_plan(plan: &TenantPlan) -> Self {
        match plan {
            TenantPlan::Free => Self {
                max_emails_per_day: 100,
                max_attachment_size_mb: 10,
                max_recipients_per_email: 5,
                api_rate_limit: 60,
                storage_quota_gb: 5,
            },
            TenantPlan::Starter => Self {
                max_emails_per_day: 1000,
                max_attachment_size_mb: 25,
                max_recipients_per_email: 50,
                api_rate_limit: 300,
                storage_quota_gb: 50,
            },
            TenantPlan::Business => Self {
                max_emails_per_day: 10000,
                max_attachment_size_mb: 50,
                max_recipients_per_email: 100,
                api_rate_limit: 1000,
                storage_quota_gb: 500,
            },
            TenantPlan::Enterprise => Self {
                max_emails_per_day: u32::MAX,
                max_attachment_size_mb: 100,
                max_recipients_per_email: 500,
                api_rate_limit: 10000,
                storage_quota_gb: u64::MAX,
            },
        }
    }
}

/// Domain verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DomainVerification {
    pub domain: String,
    pub tenant_id: TenantId,
    pub verification_token: String,
    pub verified: bool,
    pub dns_records: Vec<DNSRecord>,
    pub created_at: DateTime<Utc>,
}

/// DNS record for verification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DNSRecord {
    pub record_type: String, // TXT, CNAME, MX
    pub name: String,
    pub value: String,
    pub ttl: u32,
}

/// Tenant admin
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantAdmin {
    pub id: Uuid,
    pub tenant_id: TenantId,
    pub user_id: Uuid,
    pub role: AdminRole,
    pub permissions: Vec<Permission>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AdminRole {
    Owner,
    Admin,
    Moderator,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Permission {
    ManageUsers,
    ManageDomains,
    ManageBilling,
    ViewAuditLogs,
    ManageSettings,
    SuspendUsers,
}

/// Tenant context for requests
#[derive(Debug, Clone)]
pub struct TenantContext {
    pub tenant_id: TenantId,
    pub user_id: uuid::Uuid,
    pub role: crate::auth::UserRole,
    pub permissions: Vec<Permission>,
}
