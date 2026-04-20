//! Tenant service configuration

use anyhow::Result;

#[derive(Clone, Debug)]
pub struct TenantConfig {
    pub host: String,
    pub port: u16,
    pub db_url: String,
    pub redis_url: String,
}

impl TenantConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            host: std::env::var("TENANT_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("TENANT_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3004),
            db_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:postgres@localhost:5432/velismail_tenant".to_string()
            }),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
        })
    }
}
