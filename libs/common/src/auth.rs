//! Authentication types and claims

use crate::types::UserId;
use chrono::{DateTime, Utc};
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
