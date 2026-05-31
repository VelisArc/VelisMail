use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct DeliveryConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub redis_url: Option<String>,
    pub dkim_private_key: Option<String>,
    pub dkim_selector: String,
    pub spf_record: Option<String>,
    pub dmarc_domain: Option<String>,
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub queue_retry_max: u32,
    pub queue_retry_backoff_seconds: u64,
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

        Ok(Self {
            host: std::env::var("DELIVERY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            db_url: required_env("DATABASE_URL")?,
            redis_url: std::env::var("REDIS_URL").ok().filter(|v| !v.trim().is_empty()),
            dkim_private_key: std::env::var("DKIM_PRIVATE_KEY")
                .ok()
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
            smtp_host: std::env::var("SMTP_HOST")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            smtp_port: std::env::var("SMTP_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(587),
            queue_retry_max: std::env::var("QUEUE_RETRY_MAX")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5),
            queue_retry_backoff_seconds: std::env::var("QUEUE_RETRY_BACKOFF_SECS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(60),
        })
    }
}
