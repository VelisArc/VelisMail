use crate::config::TenantConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;

#[derive(Clone, FromRef)]
pub struct TenantState {
    pub config: TenantConfig,
    pub db: PgPool,
}

impl TenantState {
    pub async fn new(config: TenantConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;

        Ok(Self { config, db })
    }
}
