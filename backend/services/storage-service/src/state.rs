use crate::config::StorageConfig;
use crate::encryption::StorageEncryption;
use crate::local_storage::LocalStorage;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct StorageState {
    pub config: StorageConfig,
    pub db: PgPool,
    pub storage: Arc<LocalStorage>,
    pub encryption: Arc<StorageEncryption>,
}

impl StorageState {
    pub async fn new(config: StorageConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;

        let storage = LocalStorage::new(&config.storage_root)?;

        let encryption = StorageEncryption::new(&config.encryption_key)?;

        Ok(Self {
            config,
            db,
            storage: Arc::new(storage),
            encryption: Arc::new(encryption),
        })
    }
}
