use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct DeliveryConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub dkim_private_key: Option<String>,
    pub dkim_selector: String,
    pub spf_record: Option<String>,
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
        })
    }
}
