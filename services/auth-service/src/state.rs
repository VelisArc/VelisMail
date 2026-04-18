//! Auth service state

use crate::config::AuthConfig;
use crate::jwt::JwtManager;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct AuthState {
    pub config: AuthConfig,
    pub db: PgPool,
    pub redis: Arc<redis::Client>,
    pub jwt_manager: Arc<JwtManager>,
}

impl AuthState {
    pub async fn new(config: AuthConfig) -> Result<Self> {
        // Create database pool
        let db = PgPool::connect(&config.db_url).await?;

        // Create Redis connection
        let redis = Arc::new(redis::Client::open(config.redis_url.clone())?);

        // Create JWT manager
        let jwt_manager = Arc::new(JwtManager::new(
            &config.jwt_secret,
            config.jwt_expiry_seconds,
        )?);

        // Run migrations
        sqlx::migrate!("./migrations").run(&db).await?;

        Ok(Self {
            config,
            db,
            redis,
            jwt_manager,
        })
    }
}
