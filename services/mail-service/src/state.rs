use crate::config::MailConfig;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;

#[derive(Clone, FromRef)]
pub struct MailState {
    pub config: MailConfig,
    pub db: PgPool,
}

impl MailState {
    pub async fn new(config: MailConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;
        sqlx::migrate!("./migrations").run(&db).await?;
        Ok(Self { config, db })
    }
}
