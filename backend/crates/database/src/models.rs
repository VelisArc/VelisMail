//! Database models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;
use velismail_common::*;

/// User model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub status: UserStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_login: Option<DateTime<Utc>>,
    pub storage_used_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserStatus {
    Active,
    Suspended,
    Deleted,
}

/// Email message model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EmailMessage {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub user_id: Uuid,
    pub thread_id: Uuid,
    pub from_address: String,
    pub to_addresses: Vec<String>,
    pub cc_addresses: Vec<String>,
    pub bcc_addresses: Vec<String>,
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
    pub headers: serde_json::Value,
}

/// Email attachment model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Attachment {
    pub id: Uuid,
    pub message_id: Uuid,
    pub user_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
    pub is_inline: bool,
    pub content_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Mailbox folder model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MailboxFolder {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub folder_type: FolderType,
    pub parent_id: Option<Uuid>,
    pub message_count: i64,
    pub unread_count: i64,
    pub created_at: DateTime<Utc>,
}

/// Label model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Label {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub color: String,
    pub created_at: DateTime<Utc>,
}

/// Email label mapping
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EmailLabel {
    pub id: Uuid,
    pub message_id: Uuid,
    pub label_id: Uuid,
}

/// Passkey credential
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PasskeyCredential {
    pub id: Uuid,
    pub user_id: Uuid,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: u64,
    pub device_type: String,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

/// Refresh token model
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub token_hash: String,
    pub device_id: String,
    pub device_fingerprint: String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub revoked: bool,
    pub ip_address: String,
}
