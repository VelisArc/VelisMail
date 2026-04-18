//! Mail service state

use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;
use async_nats::Client as NatsClient;
use anyhow::Result;
use crate::config::MailConfig;

#[derive(Clone, FromRef)]
pub struct MailState {
    pub config: MailConfig,
    pub db: PgPool,
    pub redis: Arc<redis::Client>,
    pub nats: NatsClient,
}

impl MailState {
    pub async fn new(config: MailConfig) -> Result<Self> {
        // Create database pool
        let db = PgPool::connect(&config.db_url).await?;

        // Create Redis connection
        let redis = Arc::new(redis::Client::open(config.redis_url.clone())?);

        // Create NATS connection
        let nats = async_nats::connect(&config.nats_url).await?;

        // Run migrations
        sqlx::migrate!("./migrations").run(&db).await?;

        Ok(Self {
            config,
            db,
            redis,
            nats,
        })
    }
}
