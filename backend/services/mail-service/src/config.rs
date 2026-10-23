use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct MailConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub jwt_secret: String,
    pub platform_resend_api_key: String,
    pub platform_from_email: String,
    pub platform_from_name: String,
    pub base_domain: String,
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

        let base_domain = std::env::var("BASE_DOMAIN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "velismail.online".to_string());
        let platform_from_email = std::env::var("PLATFORM_FROM_EMAIL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("no-reply@{base_domain}"));
        let platform_from_name = std::env::var("PLATFORM_FROM_NAME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "VelisMail".to_string());
        let jwt_secret = required_env("JWT_SECRET")?;
        velismail_common::config::require_strong_secret("JWT_SECRET", &jwt_secret)?;

        Ok(Self {
            host: std::env::var("MAIL_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            db_url: required_env("DATABASE_URL")?,
            jwt_secret,
            platform_resend_api_key: required_env("PLATFORM_RESEND_API_KEY")?,
            platform_from_email,
            platform_from_name,
            base_domain,
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
