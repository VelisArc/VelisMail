//! External API Adapter Component for VelisMail
//!
//! This module provides the external API adapter component that enables
//! integration with external email service providers (Gmail API, SendGrid, Amazon SES).
//!
//! ## Features
//! - Provider connection management
//! - Credential validation and secure storage
//! - Provider health checking
//! - Failover between providers
//! - Retry logic with exponential backoff
//!
//! ## Requirements
//! - Requirement 2.1: WHEN a user provides External_API_Provider credentials, THE Platform SHALL validate and store them securely
//! - Requirement 2.2: THE Platform SHALL support at least three External_API_Provider types (Gmail API, SendGrid, Amazon SES)
//! - Requirement 2.3: WHILE processing email operations, THE Platform SHALL route requests through the configured External_API_Provider
//! - Requirement 2.4: IF an External_API_Provider becomes unavailable, THEN THE Platform SHALL queue operations and retry with exponential backoff
//! - Requirement 2.5: WHERE multiple External_API_Providers are configured, THE Platform SHALL allow failover between providers

mod provider;
mod credentials;
mod health;
mod adapter;
mod error;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod property_tests;

pub use provider::*;
pub use credentials::*;
pub use health::*;
pub use adapter::*;
pub use error::*;

/// Re-export common types for convenience
pub mod prelude {
    pub use crate::{
        ExternalApiAdapter, ExternalApiProvider, ProviderType, ApiCredentials,
        ProviderConnection, HealthStatus, SendResult, EmailMessage,
        ExternalApiError, ExternalApiResult,
    };
}