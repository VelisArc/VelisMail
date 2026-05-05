//! Gateway configuration

use anyhow::Result;

#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub host: String,
    pub port: u16,
    pub rate_limit_per_minute: u64,
    /// Allowed CORS origins (comma-separated). Falls back to permissive in dev.
    pub frontend_url: String,
    /// JWT secret for gateway-level token verification on protected routes.
    pub jwt_secret: String,
    // Internal service URLs
    pub auth_service_url: String,
    pub mail_service_url: String,
    pub storage_service_url: String,
    pub tenant_service_url: String,
    pub security_service_url: String,
}

impl GatewayConfig {
    pub fn from_env() -> Result<Self> {
        let port = std::env::var("PORT")
            .ok()
            .and_then(|p| p.parse().ok())
            .or_else(|| std::env::var("GATEWAY_PORT").ok().and_then(|p| p.parse().ok()))
            .unwrap_or(3000);

        Ok(Self {
            host: std::env::var("GATEWAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port,
            rate_limit_per_minute: std::env::var("RATE_LIMIT_PER_MINUTE")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(100),
            frontend_url: std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "https://velismail.online".to_string()),
            jwt_secret: std::env::var("JWT_SECRET").unwrap_or_default(),
            auth_service_url: std::env::var("AUTH_SERVICE_URL")
                .unwrap_or_else(|_| "http://auth-service:3001".to_string()),
            mail_service_url: std::env::var("MAIL_SERVICE_URL")
                .unwrap_or_else(|_| "http://mail-service:3002".to_string()),
            storage_service_url: std::env::var("STORAGE_SERVICE_URL")
                .unwrap_or_else(|_| "http://storage-service:3003".to_string()),
            tenant_service_url: std::env::var("TENANT_SERVICE_URL")
                .unwrap_or_else(|_| "http://tenant-service:3004".to_string()),
            security_service_url: std::env::var("SECURITY_SERVICE_URL")
                .unwrap_or_else(|_| "http://security-service:3005".to_string()),
        })
    }
}
