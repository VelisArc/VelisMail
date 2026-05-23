use anyhow::Result;

#[derive(Clone, Debug)]
pub struct TenantConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
}

impl TenantConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("TENANT_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3004);

        Ok(Self {
            host: std::env::var("TENANT_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            db_url: std::env::var("DATABASE_URL")
                .expect("DATABASE_URL must be set in environment"),
        })
    }
}
