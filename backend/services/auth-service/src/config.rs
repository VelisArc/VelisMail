//! Auth service configuration

use anyhow::{Context, Result};

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
    pub db_url: String,
    pub redis_url: Option<String>,
    pub max_failed_attempts: u32,
    pub lockout_duration_minutes: i64,
    pub failed_attempt_window_minutes: i64,
    pub otp_signing_secret: String,
    pub otp_ttl_seconds: i64,
    pub platform_resend_api_key: String,
    pub platform_from_email: String,
    pub platform_from_name: String,
    pub otp_from_email: String,
    pub otp_from_name: String,
}

fn required_env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("missing required environment variable {name}"))
}

impl AuthConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("AUTH_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3001);

        let base_domain = std::env::var("BASE_DOMAIN")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "velismail.online".to_string());
        let platform_from_email = std::env::var("PLATFORM_FROM_EMAIL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("no-reply@{base_domain}"));
        let platform_from_name = std::env::var("PLATFORM_FROM_NAME")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "VelisMail".to_string());

        Ok(Self {
            host: std::env::var("AUTH_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            jwt_secret: required_env("JWT_SECRET")?,
            jwt_expiry_seconds: std::env::var("JWT_EXPIRY_SECONDS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3600),
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
            db_url: required_env("DATABASE_URL")?,
            redis_url: std::env::var("REDIS_URL")
                .ok()
                .filter(|v| !v.trim().is_empty()),
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
            otp_signing_secret: required_env("OTP_SIGNING_SECRET")?,
            otp_ttl_seconds: std::env::var("OTP_TTL_SECONDS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(600)
                .clamp(600, 3600),
            platform_resend_api_key: required_env("PLATFORM_RESEND_API_KEY")?,
            platform_from_email: platform_from_email.clone(),
            platform_from_name: platform_from_name.clone(),
            otp_from_email: std::env::var("OTP_FROM_EMAIL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(platform_from_email),
            otp_from_name: std::env::var("OTP_FROM_NAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(platform_from_name),
        })
    }
}
