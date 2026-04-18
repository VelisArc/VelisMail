use anyhow::Result;

#[derive(Clone, Debug)]
pub struct DeliveryConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub redis_url: String,
    pub nats_url: String,
    pub dkim_private_key: String,
    pub dkim_selector: String,
    pub spf_record: String,
}

impl DeliveryConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            host: std::env::var("DELIVERY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("DELIVERY_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3005),
            db_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:postgres@localhost:5432/velismail_delivery".to_string()
            }),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            nats_url: std::env::var("NATS_URL")
                .unwrap_or_else(|_| "nats://localhost:4222".to_string()),
            dkim_private_key: std::env::var("DKIM_PRIVATE_KEY").unwrap_or_else(|_| {
                "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----".to_string()
            }),
            dkim_selector: std::env::var("DKIM_SELECTOR")
                .unwrap_or_else(|_| "velismail".to_string()),
            spf_record: std::env::var("SPF_RECORD")
                .unwrap_or_else(|_| "v=spf1 include:velismail.com ~all".to_string()),
        })
    }
}
