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

mod adapter;
mod credentials;
mod error;
mod health;

mod provider;

pub use adapter::*;
pub use credentials::*;
pub use error::*;
pub use health::*;
pub use provider::*;

/// Re-export common types for convenience
pub mod prelude {
    pub use crate::{
        ApiCredentials, EmailMessage, ExternalApiAdapter, ExternalApiError, ExternalApiProvider,
        ExternalApiResult, HealthStatus, ProviderConnection, ProviderType, SendResult,
    };
}
