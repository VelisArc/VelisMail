#![allow(dead_code)]
//! Attachment handling for email service
//!
//! Implements attachment validation, size limiting, and storage management.

use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Attachment metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub id: Uuid,
    pub email_id: Uuid,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub storage_key: String,
    pub is_inline: bool,
    pub created_at: DateTime<Utc>,
}

/// Attachment configuration
#[derive(Debug, Clone)]
pub struct AttachmentConfig {
    /// Maximum file size in bytes (default: 25 MB)
    pub max_file_size: i64,
    /// Maximum total attachments per email (default: 10)
    pub max_attachments_per_email: usize,
    /// Maximum total size for all attachments in an email (default: 100 MB)
    pub max_total_size_per_email: i64,
    /// Allowed MIME types (empty = all allowed)
    pub allowed_mime_types: Vec<String>,
    /// Blocked file extensions
    pub blocked_extensions: Vec<String>,
}

impl Default for AttachmentConfig {
    fn default() -> Self {
        Self {
            max_file_size: 25 * 1024 * 1024, // 25 MB
            max_attachments_per_email: 10,
            max_total_size_per_email: 100 * 1024 * 1024, // 100 MB
            allowed_mime_types: vec![],                  // All allowed by default
            blocked_extensions: vec![
                "exe".to_string(),
                "bat".to_string(),
                "cmd".to_string(),
                "scr".to_string(),
                "vbs".to_string(),
                "js".to_string(),
                "jar".to_string(),
            ],
        }
    }
}

/// Attachment validation result
#[derive(Debug)]
pub struct AttachmentValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

/// Attachment handler
pub struct AttachmentHandler {
    config: AttachmentConfig,
}

impl AttachmentHandler {
    /// Create a new attachment handler
    pub fn new(config: AttachmentConfig) -> Self {
        Self { config }
    }

    /// Validate a single attachment
    pub fn validate_attachment(
        &self,
        filename: &str,
        content_type: &str,
        size_bytes: i64,
    ) -> Result<()> {
        let mut errors = Vec::new();

        // Check file size
        if size_bytes > self.config.max_file_size {
            errors.push(format!(
                "File size {} bytes exceeds maximum of {} bytes",
                size_bytes, self.config.max_file_size
            ));
        }

        // Check file extension
        if let Some(ext) = get_file_extension(filename) {
            if self.config.blocked_extensions.contains(&ext.to_lowercase()) {
                errors.push(format!("File extension .{} is not allowed", ext));
            }
        }

        // Check MIME type
        if !self.config.allowed_mime_types.is_empty()
            && !self
                .config
                .allowed_mime_types
                .contains(&content_type.to_string())
        {
            errors.push(format!("MIME type {} is not allowed", content_type));
        }

        if !errors.is_empty() {
            return Err(anyhow!(
                "Attachment validation failed: {}",
                errors.join("; ")
            ));
        }

        Ok(())
    }

    /// Validate multiple attachments for an email
    pub fn validate_attachments(
        &self,
        attachments: &[(String, String, i64)], // (filename, content_type, size_bytes)
    ) -> AttachmentValidationResult {
        let mut errors = Vec::new();

        // Check attachment count
        if attachments.len() > self.config.max_attachments_per_email {
            errors.push(format!(
                "Too many attachments: {} (maximum: {})",
                attachments.len(),
                self.config.max_attachments_per_email
            ));
        }

        // Check total size
        let total_size: i64 = attachments.iter().map(|(_, _, size)| size).sum();
        if total_size > self.config.max_total_size_per_email {
            errors.push(format!(
                "Total attachment size {} bytes exceeds maximum of {} bytes",
                total_size, self.config.max_total_size_per_email
            ));
        }

        // Validate each attachment
        for (filename, content_type, size) in attachments {
            if let Err(e) = self.validate_attachment(filename, content_type, *size) {
                errors.push(e.to_string());
            }
        }

        AttachmentValidationResult {
            valid: errors.is_empty(),
            errors,
        }
    }

    /// Generate a storage key for an attachment
    pub fn generate_storage_key(&self, email_id: &Uuid, filename: &str) -> String {
        let timestamp = Utc::now().timestamp_millis();
        format!(
            "attachments/{}/{}/{}",
            email_id,
            timestamp,
            sanitize_filename(filename)
        )
    }
}

/// Get file extension from filename
fn get_file_extension(filename: &str) -> Option<String> {
    filename.split('.').next_back().map(|s| s.to_string())
}

/// Sanitize filename for safe storage
fn sanitize_filename(filename: &str) -> String {
    filename
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

