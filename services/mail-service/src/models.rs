// Shared mail models retained for persisted mail routes.
#![allow(dead_code)]
//! Mail models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use velismail_common::{FolderType, MessageStatus};

/// Email message
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailMessage {
    pub id: Uuid,
    pub thread_id: Uuid,
    pub from: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_plain: Option<String>,
    pub body_html: Option<String>,
    pub status: MessageStatus,
    pub folder: FolderType,
    pub is_starred: bool,
    pub is_read: bool,
    pub has_attachments: bool,
    pub labels: Vec<String>,
    pub sent_at: Option<DateTime<Utc>>,
    pub received_at: Option<DateTime<Utc>>,
    pub size_bytes: i64,
    pub headers: serde_json::Value,
}

/// Create email request
#[derive(Debug, Clone, Deserialize)]
pub struct CreateEmailRequest {
    pub to: Vec<String>,
    pub cc: Option<Vec<String>>,
    pub bcc: Option<Vec<String>>,
    pub subject: String,
    pub body: String,
    pub from: Option<String>,
    pub from_name: Option<String>,
    pub html_body: Option<String>,
    pub attachment_ids: Option<Vec<Uuid>>,
    pub schedule_send_at: Option<DateTime<Utc>>,
}

/// Draft email
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Draft {
    pub id: Uuid,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body: Option<String>,
    pub html_body: Option<String>,
    pub updated_at: DateTime<Utc>,
}

/// Mailbox folder
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailboxFolder {
    pub id: Uuid,
    pub name: String,
    pub folder_type: FolderType,
    pub parent_id: Option<Uuid>,
    pub message_count: i64,
    pub unread_count: i64,
}

/// Label
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: Uuid,
    pub name: String,
    pub color: String,
}

/// Email thread
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailThread {
    pub id: Uuid,
    pub subject: String,
    pub participants: Vec<String>,
    pub message_count: i64,
    pub last_message_at: DateTime<Utc>,
    pub messages: Vec<EmailMessage>,
}

/// Batch operation request
#[derive(Debug, Clone, Deserialize)]
pub struct BatchOperationRequest {
    pub email_ids: Vec<Uuid>,
}

/// Batch move request
#[derive(Debug, Clone, Deserialize)]
pub struct BatchMoveRequest {
    pub email_ids: Vec<Uuid>,
    pub target_folder: FolderType,
}

/// Batch label request
#[derive(Debug, Clone, Deserialize)]
pub struct BatchLabelRequest {
    pub email_ids: Vec<Uuid>,
    pub label_ids: Vec<Uuid>,
}
