//! Mail request and response models.

use serde::{Deserialize, Serialize};

/// Create email request — supports plain text, HTML, and multipart.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEmailRequest {
    pub to: Vec<String>,
    pub cc: Option<Vec<String>>,
    pub bcc: Option<Vec<String>>,
    pub subject: String,
    pub body: String,
    pub html_body: Option<String>,
    pub from: Option<String>,
    pub from_name: Option<String>,
    /// RFC 5322 Reply-To header
    pub reply_to: Option<String>,
    /// RFC 5322 In-Reply-To header (Message-ID of the email being replied to)
    pub in_reply_to: Option<String>,
    /// RFC 5322 References header (chain of Message-IDs for threading)
    pub references: Option<Vec<String>>,
}

/// Email update request for PATCH operations.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailUpdateRequest {
    pub is_read: Option<bool>,
    pub is_starred: Option<bool>,
    pub folder: Option<String>,
}

/// Email move request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailMoveRequest {
    pub target_folder: String,
}

/// Full-text email search request.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSearchRequest {
    pub query: String,
    pub folder: Option<String>,
    pub from: Option<String>,
    pub to: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub has_attachment: Option<bool>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

/// Folder statistics.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStats {
    pub name: String,
    pub total: i64,
    pub unread: i64,
}

/// Pagination query parameters for email listing.
#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginationQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}
