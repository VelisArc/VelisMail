//! External API Provider types and entity
//!
//! Defines the provider types (Gmail API, SendGrid, Amazon SES) and
//! the provider entity with its fields.

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use crate::credentials::EncryptedCredentials;

/// External API Provider types supported by the platform
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProviderType {
    /// Google Gmail API
    GmailApi,
    /// SendGrid API
    SendGrid,
    /// Amazon Simple Email Service (SES)
    AmazonSes,
    /// Other email service providers (for future extensibility)
    Other(String),
}

impl ProviderType {
    /// Get the display name for the provider type
    pub fn display_name(&self) -> &str {
        match self {
            ProviderType::GmailApi => "Gmail API",
            ProviderType::SendGrid => "SendGrid",
            ProviderType::AmazonSes => "Amazon SES",
            ProviderType::Other(name) => name,
        }
    }
    
    /// Get the API base URL for the provider
    pub fn api_base_url(&self) -> &str {
        match self {
            ProviderType::GmailApi => "https://gmail.googleapis.com",
            ProviderType::SendGrid => "https://api.sendgrid.com",
            ProviderType::AmazonSes => "https://email.us-east-1.amazonaws.com",
            ProviderType::Other(_) => "",
        }
    }
    
    /// Check if the provider supports receiving emails
    pub fn supports_receiving(&self) -> bool {
        match self {
            ProviderType::GmailApi => true,
            ProviderType::SendGrid => false, // SendGrid is send-only
            ProviderType::AmazonSes => true,
            ProviderType::Other(_) => false, // Unknown for custom providers
        }
    }
    
    /// Check if the provider supports webhooks
    pub fn supports_webhooks(&self) -> bool {
        match self {
            ProviderType::GmailApi => true, // Push notifications
            ProviderType::SendGrid => true,  // Event webhooks
            ProviderType::AmazonSes => true,  // SNS notifications
            ProviderType::Other(_) => false,
        }
    }
}

/// Provider status indicating operational state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProviderStatus {
    /// Provider is active and healthy
    Active,
    /// Provider is temporarily unavailable
    Unavailable,
    /// Provider has exceeded rate limits
    RateLimited,
    /// Provider credentials are invalid
    InvalidCredentials,
    /// Provider is disabled by administrator
    Disabled,
    /// Provider is in testing mode
    Testing,
}

/// External API Provider Entity
///
/// Represents a configured external email service provider with
/// credentials, status, and usage tracking.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalApiProvider {
    /// Unique identifier for the provider configuration
    pub id: Uuid,
    /// Tenant ID that owns this provider configuration
    pub tenant_id: Uuid,
    /// Type of external provider (Gmail API, SendGrid, Amazon SES)
    pub provider_type: ProviderType,
    /// Encrypted provider credentials
    pub credentials: EncryptedCredentials,
    /// Current operational status of the provider
    pub status: ProviderStatus,
    /// Priority for failover (lower number = higher priority)
    pub priority: u8,
    /// Daily email sending limit
    pub daily_limit: u32,
    /// Number of emails sent today
    pub used_today: u32,
    /// Last time the provider was used
    pub last_used: Option<DateTime<Utc>>,
    /// Number of consecutive failures
    pub failure_count: u32,
    /// When the provider was created
    pub created_at: DateTime<Utc>,
    /// When the provider was last updated
    pub updated_at: DateTime<Utc>,
}

impl ExternalApiProvider {
    /// Create a new provider configuration
    pub fn new(
        tenant_id: Uuid,
        provider_type: ProviderType,
        credentials: EncryptedCredentials,
        priority: u8,
        daily_limit: u32,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            tenant_id,
            provider_type,
            credentials,
            status: ProviderStatus::Active,
            priority,
            daily_limit,
            used_today: 0,
            last_used: None,
            failure_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }
    
    /// Check if the provider has available capacity for today
    pub fn has_capacity(&self) -> bool {
        self.used_today < self.daily_limit
    }
    
    /// Get remaining capacity for today
    pub fn remaining_capacity(&self) -> u32 {
        self.daily_limit.saturating_sub(self.used_today)
    }
    
    /// Increment usage count and update last used timestamp
    pub fn record_usage(&mut self) {
        self.used_today = self.used_today.saturating_add(1);
        self.last_used = Some(Utc::now());
        self.updated_at = Utc::now();
    }
    
    /// Record a failure and update status if needed
    pub fn record_failure(&mut self) {
        self.failure_count = self.failure_count.saturating_add(1);
        self.updated_at = Utc::now();
        
        // If too many failures, mark as unavailable
        if self.failure_count >= 5 {
            self.status = ProviderStatus::Unavailable;
        }
    }
    
    /// Reset failure count and restore status if needed
    pub fn reset_failures(&mut self) {
        self.failure_count = 0;
        if matches!(self.status, ProviderStatus::Unavailable | ProviderStatus::RateLimited) {
            self.status = ProviderStatus::Active;
        }
        self.updated_at = Utc::now();
    }
    
    /// Check if the provider is currently usable
    pub fn is_usable(&self) -> bool {
        matches!(self.status, ProviderStatus::Active | ProviderStatus::Testing) && 
        self.has_capacity()
    }
}