//! Mail request models used by the SMTP dispatch route.

use serde::Deserialize;

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
}
