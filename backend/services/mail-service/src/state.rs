use crate::config::MailConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use velismail_email::ResendClient;

#[derive(Clone, FromRef)]
pub struct MailState {
    pub config: MailConfig,
    pub db: PgPool,
    pub email_client: ResendClient,
}

impl MailState {
    pub async fn new(config: MailConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;
        let email_client = ResendClient::new(&config.platform_resend_api_key)?;

        Ok(Self {
            config,
            db,
            email_client,
        })
    }
}
