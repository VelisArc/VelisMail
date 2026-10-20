//! Resend email delivery shared by VelisMail services.
//!
//! VelisMail uses Resend for platform mail (OTP, password reset, feedback,
//! and the backend relay). This crate keeps that integration in one place so
//! services do not duplicate HTTP request and error handling code.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use std::time::Duration;
use thiserror::Error;

const DEFAULT_RESEND_BASE_URL: &str = "https://api.resend.com";
const DEFAULT_TIMEOUT_SECONDS: u64 = 20;

/// Errors returned by the Resend client.
#[derive(Debug, Error)]
pub enum EmailError {
    #[error("email configuration error: {0}")]
    Configuration(String),

    #[error("invalid email message: {0}")]
    InvalidMessage(String),

    #[error("email network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("email provider rejected the request with status {status}: {body}")]
    Rejected { status: u16, body: String },

    #[error("email provider returned an invalid response: {0}")]
    InvalidResponse(String),
}

pub type EmailResult<T> = Result<T, EmailError>;

/// A file attached to an outbound email. `content` must be base64 encoded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailAttachment {
    pub filename: String,
    pub content: String,
    pub content_type: Option<String>,
}

/// Provider-neutral outbound email message.
#[derive(Debug, Clone, Default)]
pub struct EmailMessage {
    pub from: String,
    pub from_name: Option<String>,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub text: String,
    pub html: Option<String>,
    pub reply_to: Option<String>,
    pub headers: BTreeMap<String, String>,
    pub attachments: Vec<EmailAttachment>,
}

impl EmailMessage {
    /// Validate the message before it is sent to a provider.
    pub fn validate(&self) -> EmailResult<()> {
        if self.from.trim().is_empty() {
            return Err(EmailError::InvalidMessage(
                "sender address is required".to_string(),
            ));
        }
        if !is_plausible_email(&self.from) {
            return Err(EmailError::InvalidMessage(format!(
                "invalid sender address '{}'",
                self.from
            )));
        }
        if self.to.is_empty() {
            return Err(EmailError::InvalidMessage(
                "at least one recipient is required".to_string(),
            ));
        }
        if self.to.iter().any(|address| !is_plausible_email(address)) {
            return Err(EmailError::InvalidMessage(
                "one or more recipient addresses are invalid".to_string(),
            ));
        }
        if self.cc.iter().any(|address| !is_plausible_email(address)) {
            return Err(EmailError::InvalidMessage(
                "one or more CC addresses are invalid".to_string(),
            ));
        }
        if self.bcc.iter().any(|address| !is_plausible_email(address)) {
            return Err(EmailError::InvalidMessage(
                "one or more BCC addresses are invalid".to_string(),
            ));
        }
        if self.subject.trim().is_empty() {
            return Err(EmailError::InvalidMessage(
                "subject is required".to_string(),
            ));
        }
        if contains_header_break(&self.subject) {
            return Err(EmailError::InvalidMessage(
                "subject must not contain line breaks".to_string(),
            ));
        }
        if self.text.trim().is_empty() && self.html.as_deref().unwrap_or("").trim().is_empty() {
            return Err(EmailError::InvalidMessage(
                "a text or HTML body is required".to_string(),
            ));
        }
        if let Some(reply_to) = self.reply_to.as_deref() {
            if !is_plausible_email(reply_to) {
                return Err(EmailError::InvalidMessage(
                    "reply-to address is invalid".to_string(),
                ));
            }
        }
        for (name, value) in &self.headers {
            if name.trim().is_empty() || contains_header_break(name) {
                return Err(EmailError::InvalidMessage(
                    "email header name is invalid".to_string(),
                ));
            }
            if contains_header_break(value) {
                return Err(EmailError::InvalidMessage(format!(
                    "email header '{name}' contains a line break"
                )));
            }
        }
        for attachment in &self.attachments {
            if attachment.filename.trim().is_empty() {
                return Err(EmailError::InvalidMessage(
                    "attachment filename is required".to_string(),
                ));
            }
            if attachment.content.trim().is_empty() {
                return Err(EmailError::InvalidMessage(format!(
                    "attachment '{}' has no content",
                    attachment.filename
                )));
            }
        }

        Ok(())
    }
}

/// Result returned after Resend accepts an email.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailReceipt {
    pub id: Option<String>,
}

/// Small, cloneable Resend API client.
#[derive(Clone)]
pub struct ResendClient {
    api_key: String,
    base_url: String,
    http: reqwest::Client,
}

impl fmt::Debug for ResendClient {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResendClient")
            .field("base_url", &self.base_url)
            .field("api_key", &"[redacted]")
            .finish()
    }
}

impl ResendClient {
    /// Create a client with the production Resend API endpoint.
    pub fn new(api_key: impl Into<String>) -> EmailResult<Self> {
        let api_key = api_key.into();
        if api_key.trim().is_empty() {
            return Err(EmailError::Configuration(
                "PLATFORM_RESEND_API_KEY is required".to_string(),
            ));
        }

        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(DEFAULT_TIMEOUT_SECONDS))
            .pool_max_idle_per_host(4)
            .build()?;

        Ok(Self {
            api_key,
            base_url: DEFAULT_RESEND_BASE_URL.to_string(),
            http,
        })
    }

    /// Override the API base URL (useful for local mocks and tests).
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    /// Send an email through Resend.
    pub async fn send(&self, message: &EmailMessage) -> EmailResult<EmailReceipt> {
        message.validate()?;

        let request = ResendRequest::from(message);
        let url = format!("{}/emails", self.base_url);
        let response = self
            .http
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&request)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            tracing::warn!(
                status = status.as_u16(),
                body = %truncate_for_log(&body),
                "Resend rejected an email request"
            );
            return Err(EmailError::Rejected {
                status: status.as_u16(),
                body: truncate_for_log(&body),
            });
        }

        let parsed: ResendResponse = serde_json::from_str(&body).map_err(|error| {
            EmailError::InvalidResponse(format!("{error}: {}", truncate_for_log(&body)))
        })?;

        Ok(EmailReceipt { id: parsed.id })
    }
}

#[derive(Debug, Serialize)]
struct ResendRequest {
    from: String,
    to: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    cc: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    bcc: Vec<String>,
    subject: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    headers: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<ResendAttachment>,
}

#[derive(Debug, Serialize)]
struct ResendAttachment {
    filename: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResendResponse {
    id: Option<String>,
}

impl From<&EmailMessage> for ResendRequest {
    fn from(message: &EmailMessage) -> Self {
        Self {
            from: format_sender(&message.from, message.from_name.as_deref()),
            to: message.to.clone(),
            cc: message.cc.clone(),
            bcc: message.bcc.clone(),
            subject: message.subject.trim().to_string(),
            text: non_empty(message.text.trim()),
            html: message
                .html
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            reply_to: message
                .reply_to
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            headers: message.headers.clone(),
            attachments: message
                .attachments
                .iter()
                .map(|attachment| ResendAttachment {
                    filename: attachment.filename.clone(),
                    content: strip_data_uri(&attachment.content).to_string(),
                    content_type: attachment.content_type.clone(),
                })
                .collect(),
        }
    }
}

fn non_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn format_sender(email: &str, name: Option<&str>) -> String {
    let email = email.trim();
    let name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.replace(['\r', '\n', '"'], " "));

    match name {
        Some(name) => format!("{name} <{email}>"),
        None => email.to_string(),
    }
}

fn strip_data_uri(content: &str) -> &str {
    content
        .find("base64,")
        .map(|index| &content[index + "base64,".len()..])
        .unwrap_or(content)
}

fn contains_header_break(value: &str) -> bool {
    value.contains('\r') || value.contains('\n')
}

fn is_plausible_email(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty() || value.len() > 320 || contains_header_break(value) {
        return false;
    }

    let mut parts = value.split('@');
    let local = parts.next().unwrap_or_default();
    let domain = parts.next().unwrap_or_default();
    if parts.next().is_some() {
        return false;
    }

    !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}

fn truncate_for_log(value: &str) -> String {
    const LIMIT: usize = 500;
    let truncated: String = value.chars().take(LIMIT).collect();
    if truncated.chars().count() == value.chars().count() {
        truncated
    } else {
        format!("{truncated}...")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_message() -> EmailMessage {
        EmailMessage {
            from: "verify@velismail.online".to_string(),
            from_name: Some("VelisMail".to_string()),
            to: vec!["user@example.com".to_string()],
            subject: "Your code".to_string(),
            text: "123456".to_string(),
            ..EmailMessage::default()
        }
    }

    #[test]
    fn accepts_a_minimal_message() {
        assert!(valid_message().validate().is_ok());
    }

    #[test]
    fn rejects_missing_recipient() {
        let mut message = valid_message();
        message.to.clear();
        assert!(message.validate().is_err());
    }

    #[test]
    fn rejects_header_injection() {
        let mut message = valid_message();
        message.subject = "hello\r\nBcc: attacker@example.com".to_string();
        assert!(message.validate().is_err());
    }

    #[test]
    fn formats_sender_name() {
        assert_eq!(
            format_sender("verify@velismail.online", Some("VelisMail")),
            "VelisMail <verify@velismail.online>"
        );
        assert_eq!(
            format_sender("verify@velismail.online", Some("Velis\"Mail")),
            "Velis Mail <verify@velismail.online>"
        );
    }

    #[test]
    fn builds_resend_payload() {
        let message = valid_message();
        let payload = serde_json::to_value(ResendRequest::from(&message)).unwrap();
        assert_eq!(payload["from"], "VelisMail <verify@velismail.online>");
        assert_eq!(payload["to"][0], "user@example.com");
        assert_eq!(payload["text"], "123456");
        assert!(payload.get("html").is_none());
    }

    #[test]
    fn rejects_empty_api_key() {
        assert!(ResendClient::new("").is_err());
    }

    #[test]
    fn strips_data_uri_from_attachments() {
        assert_eq!(
            strip_data_uri("data:text/plain;base64,aGVsbG8="),
            "aGVsbG8="
        );
    }
}
