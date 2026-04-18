//! Auth service configuration

use anyhow::Result;

#[derive(Clone, Debug)]
pub struct AuthConfig {
    pub host: String,
    pub port: u16,
    pub jwt_secret: String,
    pub jwt_expiry_seconds: i64,
    pub refresh_token_expiry_days: i64,
    pub rate_limit_per_minute: u64,
    pub max_sessions_per_user: u32,
    pub require_mfa: bool,
    pub passkey_relying_party: String,
    pub passkey_origin: String,
    pub db_url: String,
    pub redis_url: String,
    pub max_failed_attempts: u32,
    pub lockout_duration_minutes: i64,
    pub failed_attempt_window_minutes: i64,
}

impl AuthConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            host: std::env::var("AUTH_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: std::env::var("AUTH_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3001),
            jwt_secret: std::env::var("JWT_SECRET")
                .unwrap_or_else(|_| "change-me-in-production".to_string()),
            jwt_expiry_seconds: std::env::var("JWT_EXPIRY_SECONDS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3600), // 1 hour
            refresh_token_expiry_days: std::env::var("REFRESH_TOKEN_EXPIRY_DAYS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(30),
            rate_limit_per_minute: std::env::var("AUTH_RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(60),
            max_sessions_per_user: std::env::var("MAX_SESSIONS_PER_USER")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5),
            require_mfa: std::env::var("REQUIRE_MFA")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(false),
            passkey_relying_party: std::env::var("PASSKEY_RELYING_PARTY")
                .unwrap_or_else(|_| "velismail.com".to_string()),
            passkey_origin: std::env::var("PASSKEY_ORIGIN")
                .unwrap_or_else(|_| "https://velismail.com".to_string()),
            db_url: std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                "postgres://postgres:postgres@localhost:5432/velismail_auth".to_string()
            }),
            redis_url: std::env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            max_failed_attempts: std::env::var("MAX_FAILED_ATTEMPTS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5),
            lockout_duration_minutes: std::env::var("LOCKOUT_DURATION_MINUTES")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(15),
            failed_attempt_window_minutes: std::env::var("FAILED_ATTEMPT_WINDOW_MINUTES")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(15),
        })
    }
}
