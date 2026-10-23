use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct DeliveryConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub redis_url: Option<String>,
    pub jwt_secret: String,
    pub dkim_private_key: Option<String>,
    pub dkim_selector: String,
    pub spf_record: Option<String>,
    pub dmarc_domain: Option<String>,
    pub queue_retry_max: u32,
    pub queue_retry_backoff_seconds: u64,
    pub queue_concurrency: usize,
    pub queue_poll_seconds: u64,
    pub platform_resend_api_key: Option<String>,
    pub platform_from_name: String,
}

fn required_env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("missing required environment variable {name}"))
}

impl DeliveryConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("DELIVERY_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3005);
        let jwt_secret = required_env("JWT_SECRET")?;
        velismail_common::config::require_strong_secret("JWT_SECRET", &jwt_secret)?;

        Ok(Self {
            host: std::env::var("DELIVERY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            db_url: required_env("DATABASE_URL")?,
            redis_url: std::env::var("REDIS_URL")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            jwt_secret,
            dkim_private_key: std::env::var("DKIM_PRIVATE_KEY")
                .ok()
                // Environment files cannot contain literal newlines. Accept a
                // PEM stored on one line with "\n" escapes.
                .map(|value| value.replace("\\n", "\n"))
                .filter(|v| !v.trim().is_empty()),
            dkim_selector: std::env::var("DKIM_SELECTOR")
                .ok()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| "velismail".to_string()),
            spf_record: std::env::var("SPF_RECORD")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            dmarc_domain: std::env::var("DMARC_DOMAIN")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            queue_retry_max: std::env::var("QUEUE_RETRY_MAX")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5),
            queue_retry_backoff_seconds: std::env::var("QUEUE_RETRY_BACKOFF_SECS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(60),
            queue_concurrency: std::env::var("QUEUE_CONCURRENCY")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(16)
                .clamp(1, 128),
            queue_poll_seconds: std::env::var("QUEUE_POLL_SECONDS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5)
                .clamp(1, 300),
            platform_resend_api_key: std::env::var("PLATFORM_RESEND_API_KEY")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            platform_from_name: std::env::var("PLATFORM_FROM_NAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "VelisMail".to_string()),
        })
    }
}
