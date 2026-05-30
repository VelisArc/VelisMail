//! Error types for VelisMail services

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Application error enum
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),

    #[error("Authentication error: {0}")]
    Auth(#[from] AuthError),

    #[error("Validation error: {0}")]
    Validation(#[from] ValidationError),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("Rate limit exceeded")]
    RateLimitExceeded,

    #[error("Internal server error")]
    Internal,

    #[error("Service unavailable")]
    ServiceUnavailable,

    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Conflict: {0}")]
    Conflict(String),

    #[error("Encryption error: {0}")]
    Encryption(String),

    #[error("Mail delivery failed: {0}")]
    MailDelivery(String),

    #[error("AI engine error: {0}")]
    AIEngine(String),
}

/// Authentication-specific errors
#[derive(Debug, Error)]
pub enum AuthError {
    #[error("Invalid credentials")]
    InvalidCredentials,

    #[error("Token expired")]
    TokenExpired,

    #[error("Invalid token")]
    InvalidToken,

    #[error("Passkey verification failed")]
    PasskeyFailed,

    #[error("ZKP verification failed")]
    ZKPFailed,

    #[error("Account locked")]
    AccountLocked,

    #[error("MFA required")]
    MFARequired,

    #[error("Device not trusted")]
    DeviceNotTrusted,
}

/// Validation error
#[derive(Debug, Error)]
pub struct ValidationError {
    pub field: String,
    pub message: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Validation error on '{}': {}", self.field, self.message)
    }
}

/// Error response for API
#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorResponse {
    pub success: bool,
    pub error: ErrorDetail,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorDetail {
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

impl ErrorResponse {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            success: false,
            error: ErrorDetail {
                code: code.to_string(),
                message: message.to_string(),
                details: None,
            },
            request_id: None,
        }
    }

    pub fn with_details(code: &str, message: &str, details: serde_json::Value) -> Self {
        Self {
            success: false,
            error: ErrorDetail {
                code: code.to_string(),
                message: message.to_string(),
                details: Some(details),
            },
            request_id: None,
        }
    }
}

tokio::task_local! {
    pub static CORRELATION_ID: String;
}

impl axum::response::IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let request_id = CORRELATION_ID.try_with(|id| id.clone()).ok().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let (status, mut error_response) = match &self {
            AppError::NotFound(msg) => (
                axum::http::StatusCode::NOT_FOUND,
                ErrorResponse::new("NOT_FOUND", msg),
            ),
            AppError::Unauthorized(msg) => (
                axum::http::StatusCode::UNAUTHORIZED,
                ErrorResponse::new("UNAUTHORIZED", msg),
            ),
            AppError::Forbidden(msg) => (
                axum::http::StatusCode::FORBIDDEN,
                ErrorResponse::new("FORBIDDEN", msg),
            ),
            AppError::BadRequest(msg) => (
                axum::http::StatusCode::BAD_REQUEST,
                ErrorResponse::new("BAD_REQUEST", msg),
            ),
            AppError::Conflict(msg) => (
                axum::http::StatusCode::CONFLICT,
                ErrorResponse::new("CONFLICT", msg),
            ),
            AppError::RateLimitExceeded => (
                axum::http::StatusCode::TOO_MANY_REQUESTS,
                ErrorResponse::new("RATE_LIMIT_EXCEEDED", "Too many requests"),
            ),
            AppError::ServiceUnavailable => (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                ErrorResponse::new("SERVICE_UNAVAILABLE", "Service temporarily unavailable"),
            ),
            AppError::Validation(err) => {
                let details = serde_json::json!({
                    "field": err.field,
                    "message": err.message
                });
                (
                    axum::http::StatusCode::BAD_REQUEST,
                    ErrorResponse::with_details("VALIDATION_ERROR", &err.to_string(), details),
                )
            }
            AppError::Auth(auth_err) => {
                let (sec_status, code) = match auth_err {
                    AuthError::InvalidCredentials => (axum::http::StatusCode::UNAUTHORIZED, "INVALID_CREDENTIALS"),
                    AuthError::TokenExpired => (axum::http::StatusCode::UNAUTHORIZED, "TOKEN_EXPIRED"),
                    AuthError::InvalidToken => (axum::http::StatusCode::UNAUTHORIZED, "INVALID_TOKEN"),
                    AuthError::PasskeyFailed => (axum::http::StatusCode::UNAUTHORIZED, "PASSKEY_VERIFICATION_FAILED"),
                    AuthError::ZKPFailed => (axum::http::StatusCode::UNAUTHORIZED, "ZKP_VERIFICATION_FAILED"),
                    AuthError::AccountLocked => (axum::http::StatusCode::FORBIDDEN, "ACCOUNT_LOCKED"),
                    AuthError::MFARequired => (axum::http::StatusCode::FORBIDDEN, "MFA_REQUIRED"),
                    AuthError::DeviceNotTrusted => (axum::http::StatusCode::FORBIDDEN, "DEVICE_NOT_TRUSTED"),
                };
                (sec_status, ErrorResponse::new(code, &auth_err.to_string()))
            }
            _ => (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                ErrorResponse::new("INTERNAL_ERROR", "Internal server error"),
            ),
        };

        error_response.request_id = Some(request_id.clone());

        let mut res = (status, axum::Json(error_response)).into_response();
        if let Ok(hv) = axum::http::HeaderValue::from_str(&request_id) {
            res.headers_mut().insert(
                axum::http::header::HeaderName::from_static("x-request-id"),
                hv.clone(),
            );
            res.headers_mut().insert(
                axum::http::header::HeaderName::from_static("x-correlation-id"),
                hv,
            );
        }
        res
    }
}
