//! Tenant service state

use crate::config::TenantConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct TenantState {
    pub config: TenantConfig,
    pub db: PgPool,
    pub redis: Arc<redis::Client>,
}

impl TenantState {
    pub async fn new(config: TenantConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;
        let client = redis::Client::open(config.redis_url.clone())?;
        let redis = Arc::new(client);

        sqlx::migrate!("./migrations").run(&db).await?;

        Ok(Self { config, db, redis })
    }
}
