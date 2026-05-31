use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct MailConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub max_attachment_size_mb: u32,
    pub undo_send_window_seconds: u32,
}

fn required_env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("missing required environment variable {name}"))
}

impl MailConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("MAIL_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3002);

        Ok(Self {
            host: std::env::var("MAIL_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            db_url: required_env("DATABASE_URL")?,
            smtp_host: required_env("SMTP_HOST")?,
            smtp_port: std::env::var("SMTP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(587),
            smtp_username: required_env("SMTP_USERNAME")?,
            smtp_password: required_env("SMTP_PASSWORD")?,
            max_attachment_size_mb: std::env::var("MAX_ATTACHMENT_SIZE_MB")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(25),
            undo_send_window_seconds: std::env::var("UNDO_SEND_WINDOW")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(30),
        })
    }
}
