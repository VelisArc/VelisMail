//! Error types for external API operations

use thiserror::Error;

/// Result type for external API operations
pub type ExternalApiResult<T> = Result<T, ExternalApiError>;

/// External API error types
#[derive(Error, Debug)]
pub enum ExternalApiError {
    /// Credential validation error
    #[error("Validation error: {0}")]
    ValidationError(String),

    /// Encryption/decryption error
    #[error("Encryption error: {0}")]
    EncryptionError(String),

    /// Decryption error
    #[error("Decryption error: {0}")]
    DecryptionError(String),

    /// Provider connection error
    #[error("Connection error: {0}")]
    ConnectionError(String),

    /// Provider authentication error
    #[error("Authentication error: {0}")]
    AuthenticationError(String),

    /// Provider rate limit exceeded
    #[error("Rate limit exceeded: {0}")]
    RateLimitExceeded(String),

    /// Provider unavailable
    #[error("Provider unavailable: {0}")]
    ProviderUnavailable(String),

    /// Unsupported provider type
    #[error("Unsupported provider: {0}")]
    UnsupportedProvider(String),

    /// Unsupported operation for provider
    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    /// Network error
    #[error("Network error: {0}")]
    NetworkError(String),

    /// Timeout error
    #[error("Timeout error: {0}")]
    TimeoutError(String),

    /// Invalid response from provider
    #[error("Invalid response: {0}")]
    InvalidResponse(String),

    /// Configuration error
    #[error("Configuration error: {0}")]
    ConfigurationError(String),

    /// Internal error
    #[error("Internal error: {0}")]
    InternalError(String),
}

impl ExternalApiError {
    /// Check if error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(self, ExternalApiError::NetworkError(_)
            | ExternalApiError::TimeoutError(_)
            | ExternalApiError::RateLimitExceeded(_)
            | ExternalApiError::ProviderUnavailable(_))
    }

    /// Get HTTP status code for the error
    pub fn http_status_code(&self) -> u16 {
        match self {
            ExternalApiError::ValidationError(_) => 400,
            ExternalApiError::AuthenticationError(_) => 401,
            ExternalApiError::RateLimitExceeded(_) => 429,
            ExternalApiError::ProviderUnavailable(_) => 503,
            ExternalApiError::UnsupportedProvider(_)
            | ExternalApiError::UnsupportedOperation(_) => 501,
            _ => 500,
        }
    }
}
