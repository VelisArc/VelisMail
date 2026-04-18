//! Core data types for VelisMail

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use validator::Validate;

/// Email address type with validation
#[derive(Debug, Clone, Serialize, Deserialize, Validate)]
pub struct Email {
    #[validate(email)]
    pub address: String,
    pub display_name: Option<String>,
}

/// User ID wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct UserId(pub Uuid);

/// Tenant ID wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TenantId(pub Uuid);

/// Email ID wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct EmailId(pub Uuid);

/// Message status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum MessageStatus {
    Draft,
    Sent,
    Delivered,
    Read,
    Failed,
    Bounced,
}

/// Mailbox folder type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FolderType {
    Inbox,
    Sent,
    Draft,
    Trash,
    Spam,
    Archive,
    Custom(String),
}

/// Priority levels for email delivery
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum Priority {
    Low,
    Normal,
    High,
    Critical,
}

/// Encryption status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum EncryptionStatus {
    None,
    TLS,
    E2EE,
}

/// Audit log entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditLog {
    pub id: Uuid,
    pub tenant_id: TenantId,
    pub user_id: UserId,
    pub action: String,
    pub resource: String,
    pub timestamp: DateTime<Utc>,
    pub ip_address: String,
    pub user_agent: Option<String>,
    pub details: Option<serde_json::Value>,
}

/// Pagination parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pagination {
    pub page: u32,
    pub per_page: u32,
    pub total: u64,
}

impl Pagination {
    pub fn new(page: u32, per_page: u32, total: u64) -> Self {
        Self {
            page,
            per_page,
            total,
        }
    }

    pub fn offset(&self) -> u32 {
        (self.page - 1) * self.per_page
    }
}
