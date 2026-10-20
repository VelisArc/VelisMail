use crate::config::DeliveryConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;
use velismail_email::ResendClient;

#[derive(Clone, FromRef)]
pub struct DeliveryState {
    pub config: DeliveryConfig,
    pub db: PgPool,
    pub redis: Option<Arc<redis::Client>>,
    pub email_client: Option<Arc<ResendClient>>,
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

        let email_client = match &config.platform_resend_api_key {
            Some(key) => match ResendClient::new(key.clone()) {
                Ok(client) => Some(Arc::new(client)),
                Err(error) => {
                    tracing::error!("Unable to initialise Resend client: {error}");
                    None
                }
            },
            None => {
                tracing::warn!(
                    "PLATFORM_RESEND_API_KEY is not set; queued mail will fail instead of being marked delivered"
                );
                None
            }
        };

        Ok(Self {
            config,
            db,
            redis,
            email_client,
        })
    }
}
