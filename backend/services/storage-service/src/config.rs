use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct StorageConfig {
    pub host: String,
    pub port: u16,
    pub storage_root: String,
    pub db_url: String,
    pub jwt_secret: String,
    pub max_file_size_mb: u32,
    pub encryption_key: String,
    pub default_quota_bytes: i64,
}

fn required_env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("missing required environment variable {name}"))
}

impl StorageConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("STORAGE_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3003);

        Ok(Self {
            host: std::env::var("STORAGE_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            storage_root: std::env::var("STORAGE_ROOT")
                .unwrap_or_else(|_| "/var/lib/velismail/storage".to_string()),
            db_url: required_env("DATABASE_URL")?,
            jwt_secret: required_env("JWT_SECRET")?,
            max_file_size_mb: std::env::var("MAX_FILE_SIZE_MB")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(50),
            encryption_key: required_env("ENCRYPTION_KEY")?,
            default_quota_bytes: std::env::var("DEFAULT_QUOTA_BYTES")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5_368_709_120), // 5GB default
        })
    }
}
