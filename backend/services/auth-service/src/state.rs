use crate::account_lock::AccountLockManager;
use crate::config::AuthConfig;
use crate::jwt::JwtManager;
use anyhow::Result;
use axum::extract::FromRef;
use sqlx::PgPool;
use std::sync::Arc;
use velismail_email::ResendClient;

pub type IpRateLimiter = governor::RateLimiter<
    std::net::IpAddr,
    governor::state::keyed::DefaultKeyedStateStore<std::net::IpAddr>,
    governor::clock::DefaultClock,
>;

#[derive(Clone, FromRef)]
pub struct AuthState {
    pub config: AuthConfig,
    pub db: PgPool,
    pub redis: Option<Arc<redis::Client>>,
    pub jwt_manager: Arc<JwtManager>,
    pub account_lock: Arc<AccountLockManager>,
    pub rate_limiter: Arc<IpRateLimiter>,
    /// Per-challenge limiter for OTP guesses. A six digit code has only
    /// 900,000 possibilities, so an unlimited verify endpoint is brute
    /// forceable even with a per-IP request limit.
    pub otp_verify_limiter: Arc<velismail_common::traffic::RateLimiter>,
    pub email_client: Arc<ResendClient>,
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
        let rate_limit_capacity = config.rate_limit_per_minute.max(1) as u32;
        let limit = std::num::NonZeroU32::new(rate_limit_capacity).unwrap();
        let rate_limiter = Arc::new(governor::RateLimiter::keyed(governor::Quota::per_minute(
            limit,
        )));
        let otp_verify_limiter = Arc::new(velismail_common::traffic::RateLimiter::new(
            10,
            std::time::Duration::from_secs(config.otp_ttl_seconds.max(60) as u64),
        ));
        let email_client = Arc::new(ResendClient::new(&config.platform_resend_api_key)?);

        Ok(Self {
            config,
            db,
            redis,
            jwt_manager,
            account_lock,
            rate_limiter,
            otp_verify_limiter,
            email_client,
        })
    }
}
