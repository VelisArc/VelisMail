use crate::config::DeliveryConfig;
use anyhow::Result;
use async_nats::Client as NatsClient;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct DeliveryState {
    pub config: DeliveryConfig,
    pub db: PgPool,
    pub redis: Arc<redis::Client>,
    pub nats: NatsClient,
}

impl DeliveryState {
    pub async fn new(config: DeliveryConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;
        let redis = Arc::new(redis::Client::open(config.redis_url.clone())?);
        let nats = if let Some(creds_path) = &config.nats_creds {
            async_nats::ConnectOptions::with_credentials_file(creds_path)
                .await?
                .connect(&config.nats_url)
                .await?
        } else {
            async_nats::connect(&config.nats_url).await?
        };

        sqlx::migrate!("./migrations").run(&db).await?;

        Ok(Self {
            config,
            db,
            redis,
            nats,
        })
    }
}
