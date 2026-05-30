use crate::config::DeliveryConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct DeliveryState {
    pub config: DeliveryConfig,
    pub db: PgPool,
    pub redis: Option<Arc<redis::Client>>,
}

impl DeliveryState {
    pub async fn new(config: DeliveryConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;

        let redis = match &config.redis_url {
            Some(url) => redis::Client::open(url.clone())
                .map(|c| Some(Arc::new(c)))
                .unwrap_or_else(|e| {
                    tracing::warn!("Redis connection failed for delivery-engine: {e}");
                    None
                }),
            None => None,
        };

        Ok(Self { config, db, redis })
    }
}
