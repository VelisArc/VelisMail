//! Authentication types and claims

use crate::error::AuthError;
use crate::types::UserId;
use axum::http::HeaderMap;
use chrono::{DateTime, Utc};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// JWT Claims
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: UserId,
    pub tenant_id: String,
    pub email: String,
    pub iat: i64,
    pub exp: i64,
    pub nbf: i64,
    pub jti: String,
    pub role: UserRole,
    pub mfa_verified: bool,
    pub device_id: String,
    pub security_level: SecurityLevel,
    /// Firebase UID for accounts that authenticated through Google/Firebase.
    /// Absent on password and OTP sessions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firebase_uid: Option<String>,
}

/// User roles
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum UserRole {
    SuperAdmin,
    TenantAdmin,
    User,
    ReadOnly,
    ServiceAccount,
}

/// Security clearance levels
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub enum SecurityLevel {
    Low,
    Standard,
    High,
    Maximum,
}

/// Session information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: Uuid,
    pub user_id: UserId,
    pub tenant_id: String,
    pub device_fingerprint: String,
    pub ip_address: String,
    pub user_agent: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
    pub is_active: bool,
    pub mfa_verified: bool,
}

/// Device fingerprint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceFingerprint {
    pub device_id: Uuid,
    pub user_id: UserId,
    pub platform: String,
    pub browser: String,
    pub os: String,
    pub is_trusted: bool,
    pub registered_at: DateTime<Utc>,
    pub last_seen: DateTime<Utc>,
}

/// Passkey registration request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasskeyRegisterRequest {
    pub email: String,
    pub display_name: String,
    pub public_key: Vec<u8>,
    pub credential_id: Vec<u8>,
    pub device_info: DeviceInfo,
}

/// Passkey login request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasskeyLoginRequest {
    pub credential_id: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub client_data_json: String,
    pub signature: Vec<u8>,
    pub device_id: Option<String>,
}

/// ZKP login request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZKPLoginRequest {
    pub commitment: Vec<u8>,
    pub proof: Vec<u8>,
    pub challenge_response: Vec<u8>,
}

/// Device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub platform: String,
    pub browser: String,
    pub os: String,
    pub has_tpm: bool,
    pub has_secure_enclave: bool,
}

/// Token pair (access + refresh)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPair {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

/// Refresh token request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
    pub device_id: String,
}

/// Extract a bearer token from request headers.
pub fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Validate a JWT and return its claims.
///
/// Internal services bind to loopback and are only reachable through the
/// gateway, but they still verify the token so a misconfigured proxy or a
/// local process cannot bypass authentication.
pub fn validate_bearer(headers: &HeaderMap, secret: &str) -> Result<Claims, AuthError> {
    let token = bearer_token(headers).ok_or(AuthError::InvalidToken)?;
    if secret.trim().is_empty() {
        return Err(AuthError::InvalidToken);
    }

    let validation = Validation {
        validate_aud: false,
        leeway: 30,
        ..Default::default()
    };

    decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &validation,
    )
    .map(|data| data.claims)
    .map_err(|error| match error.kind() {
        jsonwebtoken::errors::ErrorKind::ExpiredSignature => AuthError::TokenExpired,
        _ => AuthError::InvalidToken,
    })
}
