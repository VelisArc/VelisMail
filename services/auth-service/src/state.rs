use crate::account_lock::AccountLockManager;
use crate::config::AuthConfig;
use crate::jwt::JwtManager;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

#[derive(Clone, FromRef)]
pub struct AuthState {
    pub config: AuthConfig,
    pub db: PgPool,
    pub redis: Option<Arc<redis::Client>>,
    pub jwt_manager: Arc<JwtManager>,
    pub account_lock: Arc<AccountLockManager>,
    pub rate_limiter: Arc<Semaphore>,
}

impl AuthState {
    pub async fn new(config: AuthConfig) -> Result<Self> {
        let db = PgPool::connect(&config.db_url).await?;

        let redis = match &config.redis_url {
            Some(url) => redis::Client::open(url.clone())
                .map(|c| Some(Arc::new(c)))
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        "Redis connection failed (auth will fall back to Postgres): {e}"
                    );
                    None
                }),
            None => None,
        };

        let jwt_manager = Arc::new(JwtManager::new(
            &config.jwt_secret,
            config.jwt_expiry_seconds,
        )?);
        let account_lock = Arc::new(AccountLockManager::new(
            db.clone(),
            redis.clone(),
            config.max_failed_attempts,
            config.lockout_duration_minutes,
            config.failed_attempt_window_minutes,
        ));
        let rate_limit_capacity = config.rate_limit_per_minute.max(1) as usize;
        let rate_limiter = Arc::new(Semaphore::new(rate_limit_capacity));
        {
            let limiter = rate_limiter.clone();
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let available = limiter.available_permits();
                    if available < rate_limit_capacity {
                        limiter.add_permits(rate_limit_capacity - available);
                    }
                }
            });
        }

        Ok(Self {
            config,
            db,
            redis,
            jwt_manager,
            account_lock,
            rate_limiter,
        })
    }
}
