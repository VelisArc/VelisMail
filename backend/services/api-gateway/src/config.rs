//! Gateway configuration

use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub host: String,
    pub port: u16,
    pub rate_limit_per_minute: u64,
    pub auth_rate_limit_per_minute: u64,
    pub max_body_bytes: usize,
    pub request_timeout_seconds: u64,
    pub max_concurrent_requests: usize,
    pub metrics_token: Option<String>,
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
    // Optional JWT validation for gateway-owned protected routes.
    pub jwt_secret: Option<String>,
    /// Firebase UIDs that are allowed to enter the /admin control plane as
    /// platform owner. Comma-separated; matched against the verified
    /// `firebase_uid` claim.
    pub platform_owner_uids: Vec<String>,
    /// Public Firebase web configuration served to the browser so Google
    /// sign-in works without baking the values into the frontend bundle.
    pub firebase_web_api_key: Option<String>,
    pub firebase_project_id: Option<String>,
    pub firebase_app_id: Option<String>,
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

        let max_body_mb = std::env::var("GATEWAY_MAX_BODY_MB")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(32)
            .clamp(1, 256);

        Ok(Self {
            host: std::env::var("GATEWAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            rate_limit_per_minute: std::env::var("RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|value| *value > 0)
                .unwrap_or(120),
            auth_rate_limit_per_minute: std::env::var("AUTH_RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|value| *value > 0)
                .unwrap_or(20),
            max_body_bytes: max_body_mb * 1024 * 1024,
            request_timeout_seconds: std::env::var("REQUEST_TIMEOUT_SECONDS")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|value| *value >= 5)
                .unwrap_or(60),
            max_concurrent_requests: std::env::var("MAX_CONCURRENT_REQUESTS")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|value| *value >= 16)
                .unwrap_or(256)
                .clamp(16, 2048),
            metrics_token: std::env::var("METRICS_TOKEN")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
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
            db_url: std::env::var("DATABASE_URL")
                .ok()
                .filter(|v| !v.trim().is_empty()),
            jwt_secret: std::env::var("JWT_SECRET")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            platform_owner_uids: std::env::var("PLATFORM_OWNER_UIDS")
                .or_else(|_| std::env::var("PLATFORM_OWNER_FIREBASE_UIDS"))
                .unwrap_or_default()
                .split(',')
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .collect(),
            firebase_web_api_key: std::env::var("FIREBASE_WEB_API_KEY")
                .ok()
                .or_else(|| std::env::var("FIREBASE_API_KEY").ok())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            firebase_project_id: std::env::var("FIREBASE_PROJECT_ID")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            firebase_app_id: std::env::var("FIREBASE_APP_ID")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
        })
    }
}
