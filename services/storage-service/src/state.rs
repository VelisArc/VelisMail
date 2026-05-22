use crate::config::StorageConfig;
use crate::encryption::StorageEncryption;
use crate::s3_client::S3Client;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct StorageState {
    pub config: StorageConfig,
    pub db: PgPool,
    pub s3: Arc<S3Client>,
    pub encryption: Arc<StorageEncryption>,
}

impl StorageState {
    pub async fn new(config: StorageConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;

        let s3 = S3Client::new(
            &config.s3_endpoint,
            &config.s3_region,
            &config.s3_access_key,
            &config.s3_secret_key,
            &config.s3_bucket,
        )
        .await?;

        let encryption = StorageEncryption::new(&config.encryption_key)?;

        Ok(Self {
            config,
            db,
            s3: Arc::new(s3),
            encryption: Arc::new(encryption),
        })
    }
}
