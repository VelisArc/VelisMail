//! Provider health checking and monitoring
//!
//! Provides health checking functionality for external API providers
//! with detailed status reporting.

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use crate::provider::{ProviderType, ProviderStatus};

/// Detailed health status of an external API provider
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthStatus {
    /// Overall provider status
    pub status: ProviderStatus,
    /// Timestamp of last health check
    pub last_checked: DateTime<Utc>,
    /// Response time in milliseconds
    pub response_time_ms: Option<u64>,
    /// Error message if unhealthy
    pub error: Option<String>,
    /// Whether the provider is rate limited
    pub rate_limited: bool,
    /// When rate limiting expires (if applicable)
    pub rate_limit_reset: Option<DateTime<Utc>>,
    /// Available capacity percentage (0-100)
    pub capacity_percent: u8,
    /// Provider-specific metrics
    pub metrics: serde_json::Value,
}

impl HealthStatus {
    /// Create a new healthy status
    pub fn healthy(response_time_ms: u64) -> Self {
        Self {
            status: ProviderStatus::Active,
            last_checked: Utc::now(),
            response_time_ms: Some(response_time_ms),
            error: None,
            rate_limited: false,
            rate_limit_reset: None,
            capacity_percent: 100,
            metrics: serde_json::json!({}),
        }
    }
    
    /// Create a new unhealthy status with error
    pub fn unhealthy(error: String) -> Self {
        Self {
            status: ProviderStatus::Unavailable,
            last_checked: Utc::now(),
            response_time_ms: None,
            error: Some(error),
            rate_limited: false,
            rate_limit_reset: None,
            capacity_percent: 0,
            metrics: serde_json::json!({}),
        }
    }
    
    /// Create a rate limited status
    pub fn rate_limited(reset_time: DateTime<Utc>) -> Self {
        Self {
            status: ProviderStatus::RateLimited,
            last_checked: Utc::now(),
            response_time_ms: None,
            error: Some("Rate limit exceeded".to_string()),
            rate_limited: true,
            rate_limit_reset: Some(reset_time),
            capacity_percent: 0,
            metrics: serde_json::json!({}),
        }
    }
    
    /// Check if the provider is healthy
    pub fn is_healthy(&self) -> bool {
        matches!(self.status, ProviderStatus::Active | ProviderStatus::Testing)
    }
    
    /// Check if the provider is available for use
    pub fn is_available(&self) -> bool {
        self.is_healthy() && !self.rate_limited && self.capacity_percent > 0
    }
}

/// Health check configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckConfig {
    /// Interval between health checks in seconds
    pub check_interval_seconds: u64,
    /// Timeout for health check requests in milliseconds
    pub timeout_ms: u64,
    /// Number of consecutive failures before marking as unhealthy
    pub failure_threshold: u32,
    /// Number of consecutive successes before marking as healthy
    pub success_threshold: u32,
    /// Whether to perform deep health checks (more thorough but slower)
    pub deep_check: bool,
}

impl Default for HealthCheckConfig {
    fn default() -> Self {
        Self {
            check_interval_seconds: 60, // 1 minute
            timeout_ms: 5000, // 5 seconds
            failure_threshold: 3,
            success_threshold: 2,
            deep_check: false,
        }
    }
}

/// Health checker trait for provider-specific health checks
#[async_trait::async_trait]
pub trait HealthChecker {
    /// Perform a health check on the provider
    async fn check_health(&self) -> HealthStatus;
    
    /// Perform a quick health check (lighter than full check)
    async fn quick_health_check(&self) -> HealthStatus;
    
    /// Get provider-specific metrics
    async fn get_metrics(&self) -> serde_json::Value;
}

/// Provider connection information for health checking
#[derive(Debug, Clone)]
pub struct ProviderConnection {
    /// Provider type
    pub provider_type: ProviderType,
    /// Provider-specific connection details
    pub connection_details: ConnectionDetails,
    /// Health check configuration
    pub health_config: HealthCheckConfig,
}

/// Provider-specific connection details
#[derive(Debug, Clone)]
pub enum ConnectionDetails {
    /// Gmail API connection details
    Gmail {
        access_token: String,
        user_id: String,
    },
    /// SendGrid connection details
    SendGrid {
        api_key: String,
    },
    /// Amazon SES connection details
    AmazonSes {
        access_key_id: String,
        secret_access_key: String,
        region: String,
    },
}

impl ProviderConnection {
    /// Create a new provider connection
    pub fn new(
        provider_type: ProviderType,
        connection_details: ConnectionDetails,
    ) -> Self {
        Self {
            provider_type,
            connection_details,
            health_config: HealthCheckConfig::default(),
        }
    }
    
    /// Perform a health check on this connection
    pub async fn check_health(&self) -> HealthStatus {
        match &self.connection_details {
            ConnectionDetails::Gmail { access_token, user_id } => {
                self.check_gmail_health(access_token, user_id).await
            }
            ConnectionDetails::SendGrid { api_key } => {
                self.check_sendgrid_health(api_key).await
            }
            ConnectionDetails::AmazonSes { access_key_id, secret_access_key, region } => {
                self.check_ses_health(access_key_id, secret_access_key, region).await
            }
        }
    }
    
    /// Check Gmail API health
    async fn check_gmail_health(&self, access_token: &str, user_id: &str) -> HealthStatus {
        use reqwest::Client;
        
        let start_time = Utc::now();
        
        // Check Gmail API by making a simple request to get profile
        let client = Client::new();
        let url = format!("https://gmail.googleapis.com/gmail/v1/users/{}/profile", user_id);
        
        match client
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .timeout(std::time::Duration::from_millis(self.health_config.timeout_ms))
            .send()
            .await
        {
            Ok(response) => {
                let end_time = Utc::now();
                let response_time_ms = (end_time - start_time).num_milliseconds() as u64;
                
                if response.status().is_success() {
                    HealthStatus::healthy(response_time_ms)
                } else if response.status() == 429 {
                    // Rate limited
                    let reset_time = Utc::now() + chrono::Duration::minutes(1);
                    HealthStatus::rate_limited(reset_time)
                } else {
                    HealthStatus::unhealthy(format!("Gmail API error: {}", response.status()))
                }
            }
            Err(e) => {
                HealthStatus::unhealthy(format!("Gmail API connection error: {}", e))
            }
        }
    }
    
    /// Check SendGrid API health
    async fn check_sendgrid_health(&self, api_key: &str) -> HealthStatus {
        use reqwest::Client;
        
        let start_time = Utc::now();
        
        // Check SendGrid API by making a simple request to get stats
        let client = Client::new();
        let url = "https://api.sendgrid.com/v3/stats";
        
        match client
            .get(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .timeout(std::time::Duration::from_millis(self.health_config.timeout_ms))
            .send()
            .await
        {
            Ok(response) => {
                let end_time = Utc::now();
                let response_time_ms = (end_time - start_time).num_milliseconds() as u64;
                
                if response.status().is_success() {
                    HealthStatus::healthy(response_time_ms)
                } else if response.status() == 429 {
                    // Rate limited
                    let reset_time = Utc::now() + chrono::Duration::minutes(1);
                    HealthStatus::rate_limited(reset_time)
                } else {
                    HealthStatus::unhealthy(format!("SendGrid API error: {}", response.status()))
                }
            }
            Err(e) => {
                HealthStatus::unhealthy(format!("SendGrid API connection error: {}", e))
            }
        }
    }
    
    /// Check Amazon SES health
    async fn check_ses_health(&self, access_key_id: &str, secret_access_key: &str, region: &str) -> HealthStatus {
        use reqwest::Client;
        
        let start_time = Utc::now();
        
        // For SES, we'd typically use AWS SDK, but for simplicity we'll check with a simple request
        // In production, this would use AWS SDK to check SES service status
        let client = Client::new();
        
        // Note: Actual SES health check would require AWS SigV4 signing
        // This is a simplified version
        HealthStatus::healthy(100) // Placeholder
    }
}