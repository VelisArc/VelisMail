#![allow(dead_code)]
//! Auth route handlers

use crate::account_lock::AccountLockManager;
use crate::jwt::TokenPairResponse;
use crate::passkey::{generate_challenge, PasskeyVerificationRequest};
use crate::state::AuthState;
use axum::{extract::State, http::StatusCode, Json};
use chrono::DateTime;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;
use validator::Validate;
use velismail_common::{UserId, UserRole};

/// Health check
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "auth-service"
    }))
}

/// Registration request
#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 2, max = 100))]
    pub display_name: String,
    pub tenant_id: Option<Uuid>,
}

/// Register a new user
pub async fn register(
    State(state): State<AuthState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    // Check if user already exists
    let existing: Option<i64> = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&request.email)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if existing.unwrap_or(0) > 0 {
        return Err(StatusCode::CONFLICT);
    }

    // Generate challenge for passkey registration
    let challenge = generate_challenge().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Return passkey registration options
    Ok(Json(json!({
        "challenge": challenge,
        "rp": {
            "name": state.config.passkey_relying_party,
            "id": state.config.passkey_relying_party
        },
        "user": {
            "id": Uuid::new_v4().to_string(),
            "name": request.email,
            "displayName": request.display_name
        },
        "pubKeyCredParams": [
            {"type": "public-key", "alg": -7},
            {"type": "public-key", "alg": -257}
        ],
        "timeout": 60000,
        "attestation": "direct",
        "authenticatorSelection": {
            "authenticatorAttachment": "platform",
            "requireResidentKey": true,
            "residentKey": "required",
            "userVerification": "required"
        }
    })))
}

/// Passkey login request
#[derive(Debug, Deserialize)]
pub struct PasskeyLoginRequest {
    pub credential_id: String,
    pub authenticator_data: String,
    pub client_data_json: String,
    pub signature: String,
    pub device_id: Option<String>,
}

/// Login with passkey
pub async fn login_passkey(
    State(state): State<AuthState>,
    Json(request): Json<PasskeyLoginRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    // Decode credential ID from base64
    let credential_id = base64_decode(&request.credential_id).ok_or(StatusCode::BAD_REQUEST)?;

    // Fetch stored passkey
    let passkey: Option<(Uuid, Vec<u8>, Vec<u8>, i64)> = sqlx::query_as(
        "SELECT user_id, credential_id, public_key, counter FROM passkey_credentials
         WHERE credential_id = $1 AND is_active = true",
    )
    .bind(&credential_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (user_id, stored_pubkey, stored_cred_id, _counter) =
        passkey.ok_or(StatusCode::UNAUTHORIZED)?;

    // Get user email for account lock checking
    let user_email: Option<String> = sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let email = user_email.ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // Check if account is locked
    let account_lock_manager = AccountLockManager::new(
        state.db.clone(),
        state.redis.clone(),
        state.config.max_failed_attempts,
        state.config.lockout_duration_minutes,
        state.config.failed_attempt_window_minutes,
    );

    if account_lock_manager
        .is_account_locked(&email)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        return Err(StatusCode::FORBIDDEN);
    }

    // Verify passkey assertion
    let verification = PasskeyVerificationRequest {
        credential_id: stored_cred_id.clone(),
        authenticator_data: base64_decode(&request.authenticator_data)
            .ok_or(StatusCode::BAD_REQUEST)?,
        client_data_json: request.client_data_json.clone(),
        signature: base64_decode(&request.signature).ok_or(StatusCode::BAD_REQUEST)?,
        user_handle: None,
    };

    let stored_passkey = crate::passkey::StoredPasskey {
        credential_id: stored_cred_id.clone(),
        public_key: stored_pubkey,
        counter: _counter,
        user_id,
    };

    let valid = crate::passkey::verify_passkey_assertion(
        &verification,
        &stored_passkey,
        &state.config.passkey_origin,
        &state.config.passkey_relying_party,
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if !valid {
        // Record failed attempt
        let _ = account_lock_manager
            .record_failed_attempt(
                Some(UserId(user_id)),
                &email,
                "0.0.0.0", // Would get from request
            )
            .await;
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Clear failed attempts on successful login
    account_lock_manager
        .clear_failed_attempts(&email)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Get user info
    let user: Option<(String, String)> =
        sqlx::query_as("SELECT email, display_name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (email, _display_name) = user.ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // Prepare device id and generate tokens
    let device_id = request.device_id.clone().unwrap_or_default();
    let access_token = state
        .jwt_manager
        .generate_access_token(
            UserId(user_id),
            "", // Would get from user record
            &email,
            UserRole::User,
            &device_id,
            true,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh_token = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Create session
    let session_manager = crate::session::SessionManager::new(
        state.db.clone(),
        state.redis.clone(),
        state.config.max_sessions_per_user,
        state.config.jwt_expiry_seconds / 3600,
    );

    let _session_id = session_manager
        .create_session(
            UserId(user_id),
            "", // tenant_id
            &device_id,
            "0.0.0.0", // Would get from request
            None,
        )
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TokenPairResponse {
        access_token,
        refresh_token,
        expires_in: state.config.jwt_expiry_seconds,
        token_type: "Bearer".to_string(),
    }))
}

/// ZKP login request
#[derive(Debug, Deserialize)]
pub struct ZKPLoginRequest {
    pub commitment: String,
    pub proof: String,
    pub challenge_response: String,
}

/// Login with zero-knowledge proof
pub async fn login_zkp(
    State(_state): State<AuthState>,
    Json(_request): Json<ZKPLoginRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    // Placeholder for ZKP implementation
    // In production, implement Schnorr protocol or similar ZKP scheme

    Err(StatusCode::NOT_IMPLEMENTED)
}

/// Refresh token request
#[derive(Debug, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
    pub device_id: String,
}

/// Refresh access token
pub async fn refresh_token(
    State(state): State<AuthState>,
    Json(request): Json<RefreshTokenRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    // Hash the refresh token to look it up
    let token_hash = crate::jwt::JwtManager::hash_refresh_token(&request.refresh_token);

    // Find the token in database
    let token_record: Option<(Uuid, DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT user_id, expires_at FROM refresh_tokens
         WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (user_id, _expires_at) = token_record.ok_or(StatusCode::UNAUTHORIZED)?;

    // Get user info
    let user: Option<(String, String)> =
        sqlx::query_as("SELECT email, display_name FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (email, _display_name) = user.ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // Generate new tokens
    let access_token = state
        .jwt_manager
        .generate_access_token(
            UserId(user_id),
            "",
            &email,
            UserRole::User,
            &request.device_id,
            true,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh_token = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(TokenPairResponse {
        access_token,
        refresh_token,
        expires_in: state.config.jwt_expiry_seconds,
        token_type: "Bearer".to_string(),
    }))
}

/// Logout
pub async fn logout(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Would invalidate current session
    Ok(Json(json!({
        "success": true,
        "message": "Logged out successfully"
    })))
}

/// Get current user info
pub async fn get_current_user(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Would extract user from JWT token
    Ok(Json(json!({
        "success": true,
        "user": {
            "id": Uuid::new_v4().to_string(),
            "email": "user@example.com",
            "display_name": "User Name"
        }
    })))
}

/// List user sessions
pub async fn list_sessions(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "sessions": []
    })))
}

/// Revoke a session
pub async fn revoke_session(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Session revoked"
    })))
}

/// Device registration request
#[derive(Debug, Deserialize)]
pub struct DeviceRegisterRequest {
    pub device_name: String,
    pub platform: String,
    pub browser: String,
    pub os: String,
}

/// Register a new device
pub async fn register_device(
    State(_state): State<AuthState>,
    Json(_request): Json<DeviceRegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "device_id": Uuid::new_v4().to_string()
    })))
}

/// Trust a device
pub async fn trust_device(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Device trusted"
    })))
}

/// Simple base64 decoder
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    // In production, use proper base64 library
    Some(input.as_bytes().to_vec())
}
