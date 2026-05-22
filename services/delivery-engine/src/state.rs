use crate::config::DeliveryConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;

#[derive(Clone, FromRef)]
pub struct DeliveryState {
    pub config: DeliveryConfig,
    pub db: PgPool,
}

impl DeliveryState {
    pub async fn new(config: DeliveryConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;
        sqlx::migrate!("./migrations").run(&db).await?;
        Ok(Self { config, db })
    }
}
