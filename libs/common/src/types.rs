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

/// Thread ID wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ThreadId(pub Uuid);

/// Attachment ID wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct AttachmentId(pub Uuid);

/// Domain ID wrapper
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct DomainId(pub Uuid);

/// Email Message with RFC 5322 compliance and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailMessage {
    pub id: EmailId,
    pub tenant_id: TenantId,
    pub user_id: UserId,
    pub thread_id: ThreadId,
    pub from_address: String,
    pub from_name: Option<String>,
    pub to_addresses: Vec<String>,
    pub cc_addresses: Option<Vec<String>>,
    pub bcc_addresses: Option<Vec<String>>,
    pub reply_to: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<Vec<String>>,
    pub message_id: String,
    pub subject: String,
    pub body_plain: Option<String>,
    pub body_html: Option<String>,
    pub status: MessageStatus,
    pub encryption: EncryptionStatus,
    pub folder: FolderType,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub size_bytes: i64,
    pub sent_at: Option<DateTime<Utc>>,
    pub received_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

/// Email Thread for conversation views
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailThread {
    pub id: ThreadId,
    pub tenant_id: TenantId,
    pub subject: String,
    pub messages: Vec<EmailMessage>,
    pub last_message_at: DateTime<Utc>,
    pub message_count: u32,
}

/// Contact Entry for address book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactEntry {
    pub id: Uuid,
    pub tenant_id: TenantId,
    pub user_id: UserId,
    pub email: String,
    pub name: Option<String>,
    pub phone: Option<String>,
    pub notes: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Categorization and tagging options
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum Label {
    Important,
    Work,
    Personal,
    Receipt,
    Travel,
    Custom(String),
}
