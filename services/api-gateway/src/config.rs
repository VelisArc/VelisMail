//! Gateway configuration

use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub host: String,
    pub port: u16,
    pub rate_limit_per_minute: u64,
    /// Allowed CORS origins (comma-separated). Falls back to permissive in dev.
    pub frontend_url: String,
    /// Shared OTP signing secret used to validate auth-service OTP verification tokens.
    pub otp_signing_secret: String,
    // Internal service URLs
    pub auth_service_url: String,
    pub mail_service_url: String,
    pub storage_service_url: String,
    pub tenant_service_url: String,
    pub delivery_service_url: String,
    // External APIs
    pub razorpay_key_id: String,
    pub razorpay_key_secret: String,
    // Optional DB for gateway persistence (team invites, inbound routes)
    pub db_url: Option<String>,
}

impl GatewayConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("GATEWAY_PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3000);

        let otp_signing_secret = std::env::var("OTP_SIGNING_SECRET")
            .context("missing required environment variable OTP_SIGNING_SECRET")?;

        Ok(Self {
            host: std::env::var("GATEWAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            rate_limit_per_minute: std::env::var("RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(100),
            frontend_url: std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "https://velismail.online".to_string()),
            otp_signing_secret,
            auth_service_url: std::env::var("AUTH_SERVICE_URL")
                .unwrap_or_else(|_| "http://auth-service:3001".to_string()),
            mail_service_url: std::env::var("MAIL_SERVICE_URL")
                .unwrap_or_else(|_| "http://mail-service:3002".to_string()),
            storage_service_url: std::env::var("STORAGE_SERVICE_URL")
                .unwrap_or_else(|_| "http://storage-service:3003".to_string()),
            tenant_service_url: std::env::var("TENANT_SERVICE_URL")
                .unwrap_or_else(|_| "http://tenant-service:3004".to_string()),
            delivery_service_url: std::env::var("DELIVERY_SERVICE_URL")
                .or_else(|_| std::env::var("SECURITY_SERVICE_URL"))
                .unwrap_or_else(|_| "http://delivery-engine:3005".to_string()),
            razorpay_key_id: std::env::var("RAZORPAY_KEY_ID").unwrap_or_default(),
            razorpay_key_secret: std::env::var("RAZORPAY_KEY_SECRET").unwrap_or_default(),
            db_url: std::env::var("DATABASE_URL").ok().filter(|v| !v.trim().is_empty()),
        })
    }
}
