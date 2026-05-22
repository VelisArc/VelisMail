use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct StorageConfig {
    pub host: String,
    pub port: u16,
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
    pub db_url: String,
    pub max_file_size_mb: u32,
    pub encryption_key: String,
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
            s3_endpoint: std::env::var("S3_ENDPOINT").unwrap_or_default(),
            s3_region: std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".to_string()),
            s3_access_key: std::env::var("S3_ACCESS_KEY").unwrap_or_default(),
            s3_secret_key: std::env::var("S3_SECRET_KEY").unwrap_or_default(),
            s3_bucket: std::env::var("S3_BUCKET").unwrap_or_else(|_| "velismail".to_string()),
            db_url: required_env("DATABASE_URL")?,
            max_file_size_mb: std::env::var("MAX_FILE_SIZE_MB")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(50),
            encryption_key: required_env("ENCRYPTION_KEY")?,
        })
    }
}
