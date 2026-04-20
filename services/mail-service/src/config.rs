//! Mail service configuration

use anyhow::Result;

#[derive(Clone, Debug)]
pub struct MailConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub redis_url: String,
    pub nats_url: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub max_attachment_size_mb: u32,
    pub undo_send_window_seconds: u32,
    pub emails_per_page: u32,
}

impl MailConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            host: std::env::var("MAIL_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("MAIL_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3002),
            db_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:postgres@localhost:5432/velismail_mail".to_string()
            }),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            nats_url: std::env::var("NATS_URL")
                .unwrap_or_else(|_| "nats://localhost:4222".to_string()),
            smtp_host: std::env::var("SMTP_HOST")
                .unwrap_or_else(|_| "smtp.velismail.online".to_string()),
            smtp_port: std::env::var("SMTP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(587),
            smtp_username: std::env::var("SMTP_USERNAME")
                .unwrap_or_else(|_| "noreply@velismail.online".to_string()),
            smtp_password: std::env::var("SMTP_PASSWORD")
                .unwrap_or_else(|_| "change-me".to_string()),
            max_attachment_size_mb: std::env::var("MAX_ATTACHMENT_SIZE_MB")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(25),
            undo_send_window_seconds: std::env::var("UNDO_SEND_WINDOW")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(30),
            emails_per_page: std::env::var("EMAILS_PER_PAGE")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(50),
        })
    }
}
