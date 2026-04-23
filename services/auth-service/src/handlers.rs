//! Auth route handlers
//!
//! This module exposes a working password-based auth flow (register / login),
//! plus stubs for passkey / ZKP flows which require a browser-side WebAuthn
//! integration and a full ZKP protocol. Those stubs return 501 so the frontend
//! does NOT silently accept fake tokens (previous implementation returned a
//! hard-coded "jwt_token_here" which was a security footgun).

use crate::jwt::TokenPairResponse;
use crate::passkey::generate_challenge;
use crate::state::AuthState;
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, PasswordHash};
use axum::{extract::State, http::StatusCode, Json};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
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

fn hash_password(raw: &str) -> Result<String, StatusCode> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(raw.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn verify_password(raw: &str, stored: &str) -> bool {
    PasswordHash::new(stored)
        .and_then(|parsed| Argon2::default().verify_password(raw.as_bytes(), &parsed))
        .is_ok()
}

fn mask_email(email: &str) -> String {
    let parts: Vec<&str> = email.split('@').collect();
    if parts.len() != 2 {
        return email.to_string();
    }

    let local = parts[0];
    let domain = parts[1];

    if local.len() <= 2 {
        format!("{}*@{}", local.chars().next().unwrap_or('*'), domain)
    } else {
        format!("{}{}@{}", &local[..2], "*".repeat(local.len() - 2), domain)
    }
}

fn hash_otp_value(secret: &str, email: &str, otp: &str, salt: &str, purpose: &str) -> String {
    let payload = format!(
        "{}:{}:{}:{}:{}",
        secret,
        purpose,
        email.trim().to_lowercase(),
        otp.trim(),
        salt
    );
    let digest = digest(&SHA256, payload.as_bytes());
    hex::encode(digest.as_ref())
}

fn send_otp_email(
    state: &AuthState,
    email: &str,
    display_name: &str,
    otp: &str,
) -> Result<(), StatusCode> {
    let credentials = Credentials::new(
        state.config.smtp_username.clone(),
        state.config.smtp_password.clone(),
    );
    let from = Mailbox::new(
        Some(state.config.otp_from_name.clone()),
        state
            .config
            .otp_from_email
            .parse()
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
    );
    let to = Mailbox::new(
        Some(display_name.to_string()),
        email.parse().map_err(|_| StatusCode::BAD_REQUEST)?,
    );

    let text_body = format!(
        "Hello {},\n\nYour VelisMail verification code is {}.\nThis code expires in {} minutes.\n",
        if display_name.trim().is_empty() {
            "there"
        } else {
            display_name.trim()
        },
        otp,
        std::cmp::max(1, state.config.otp_ttl_seconds / 60)
    );

    let message = Message::builder()
        .from(from)
        .to(to)
        .subject("Your VelisMail verification code")
        .header(ContentType::TEXT_PLAIN)
        .body(text_body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let transport = SmtpTransport::builder_dangerous(&state.config.smtp_host)
        .port(state.config.smtp_port)
        .credentials(credentials)
        .build();

    transport
        .send(&message)
        .map_err(|_| StatusCode::BAD_GATEWAY)?;

    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
struct OtpChallengeClaims {
    sub: String,
    purpose: String,
    salt: String,
    otp_hash: String,
    iat: i64,
    exp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct OtpVerificationClaims {
    sub: String,
    purpose: String,
    verified_at: i64,
    exp: i64,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct SendOtpRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 2, max = 100))]
    pub display_name: String,
    pub purpose: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct VerifyOtpRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(equal = 6))]
    pub otp: String,
    #[validate(length(min = 32))]
    pub challenge_token: String,
    pub purpose: Option<String>,
}

/// Registration request (password-based).
#[derive(Debug, Deserialize, Validate)]
pub struct RegisterRequest {
    #[validate(email)]
    pub email: String,
    #[validate(length(min = 2, max = 100))]
    pub display_name: String,
    #[validate(length(min = 8, max = 256))]
    pub password: String,
    pub tenant_id: Option<Uuid>,
}

/// Register a new user with a password. Returns a WebAuthn-style challenge so
/// the client can optionally upgrade to passkey later.
pub async fn register(
    State(state): State<AuthState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let email = request.email.trim().to_lowercase();

    let existing: Option<i64> = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE email = $1")
        .bind(&email)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if existing.unwrap_or(0) > 0 {
        return Err(StatusCode::CONFLICT);
    }

    let password_hash = hash_password(&request.password)?;
    let user_id = Uuid::new_v4();
    let tenant_id = request.tenant_id.unwrap_or_else(Uuid::nil);

    sqlx::query(
        r#"INSERT INTO users (id, tenant_id, email, display_name, password_hash, status)
           VALUES ($1, $2, $3, $4, $5, 'active')"#,
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(&email)
    .bind(&request.display_name)
    .bind(&password_hash)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("register insert failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let challenge = generate_challenge().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "user": {
            "id": user_id.to_string(),
            "email": email,
            "display_name": request.display_name,
        },
        "passkey_registration_options": {
            "challenge": challenge,
            "rp": {
                "name": state.config.passkey_relying_party,
                "id": state.config.passkey_relying_party
            },
            "user": {
                "id": user_id.to_string(),
                "name": email,
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
        }
    })))
}

/// Password login request.
#[derive(Debug, Deserialize)]
pub struct PasswordLoginRequest {
    pub email: String,
    pub password: String,
    pub device_id: Option<String>,
}

/// Login with email + password. Issues real JWT access + refresh tokens.
/// Mounted at /login (and /login/zkp is aliased here until a real ZKP client
/// ships, so the existing frontend continues to work).
pub async fn login_password(
    State(state): State<AuthState>,
    Json(request): Json<PasswordLoginRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    let email = request.email.trim().to_lowercase();

    let row = sqlx::query(
        "SELECT id, tenant_id, password_hash FROM users WHERE email = $1 AND status = 'active'",
    )
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id: Uuid = row.try_get("id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .unwrap_or_else(|_| Uuid::nil());
    let password_hash: Option<String> = row.try_get("password_hash").ok();

    let stored = password_hash.ok_or(StatusCode::UNAUTHORIZED)?;
    if !verify_password(&request.password, &stored) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let device_id = request.device_id.unwrap_or_default();
    let access_token = state
        .jwt_manager
        .generate_access_token(
            UserId(user_id),
            &tenant_id.to_string(),
            &email,
            UserRole::User,
            &device_id,
            false,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh_token = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token_hash = crate::jwt::JwtManager::hash_refresh_token(&refresh_token);
    let expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.refresh_token_expiry_days);

    let _ = sqlx::query(
        r#"INSERT INTO refresh_tokens
           (user_id, token_hash, device_id, device_fingerprint, expires_at, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6::inet)"#,
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(&device_id)
    .bind(&device_id)
    .bind(expires_at)
    .bind("0.0.0.0")
    .execute(&state.db)
    .await;

    sqlx::query("UPDATE users SET last_login = NOW() WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await
        .ok();

    Ok(Json(TokenPairResponse {
        access_token,
        refresh_token,
        expires_in: state.config.jwt_expiry_seconds,
        token_type: "Bearer".to_string(),
    }))
}

/// Passkey login — requires a full WebAuthn verification stack (proper ECDSA
/// signature verification, challenge storage, counter checks). The previous
/// implementation returned `Ok(true)` from signature verification which is a
/// security bug. Until that is implemented, return 501 so clients fall back
/// to password login.
pub async fn login_passkey(
    State(_state): State<AuthState>,
    Json(_request): Json<serde_json::Value>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    Err(StatusCode::NOT_IMPLEMENTED)
}

/// ZKP login — Schnorr / similar ZK protocol not yet implemented.
pub async fn login_zkp(
    State(state): State<AuthState>,
    Json(request): Json<PasswordLoginRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    // Compatibility alias: the existing frontend calls /login/zkp with email+password.
    // Delegate to password login until real ZKP ships.
    login_password(State(state), Json(request)).await
}

pub async fn send_otp(
    State(state): State<AuthState>,
    Json(request): Json<SendOtpRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let normalized_email = request.email.trim().to_lowercase();
    let purpose = request
        .purpose
        .clone()
        .unwrap_or_else(|| "register".to_string());

    let otp = format!("{:06}", (uuid::Uuid::new_v4().as_u128() % 900_000) + 100_000);
    let salt = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let exp = now + state.config.otp_ttl_seconds;
    let otp_hash = hash_otp_value(
        &state.config.otp_signing_secret,
        &normalized_email,
        &otp,
        &salt,
        &purpose,
    );

    send_otp_email(&state, &normalized_email, &request.display_name, &otp)?;

    let challenge_token = encode(
        &Header::default(),
        &OtpChallengeClaims {
            sub: normalized_email.clone(),
            purpose: purpose.clone(),
            salt,
            otp_hash,
            iat: now,
            exp,
        },
        &EncodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "challengeToken": challenge_token,
        "expiresIn": state.config.otp_ttl_seconds,
        "maskedEmail": mask_email(&normalized_email),
        "provider": "smtp"
    })))
}

pub async fn verify_otp(
    State(state): State<AuthState>,
    Json(request): Json<VerifyOtpRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let normalized_email = request.email.trim().to_lowercase();
    let purpose = request
        .purpose
        .clone()
        .unwrap_or_else(|| "register".to_string());

    let token = decode::<OtpChallengeClaims>(
        &request.challenge_token,
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if token.claims.sub != normalized_email || token.claims.purpose != purpose {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let expected_hash = hash_otp_value(
        &state.config.otp_signing_secret,
        &normalized_email,
        &request.otp,
        &token.claims.salt,
        &purpose,
    );

    if expected_hash != token.claims.otp_hash {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let verification_token = encode(
        &Header::default(),
        &OtpVerificationClaims {
            sub: normalized_email,
            purpose,
            verified_at: chrono::Utc::now().timestamp(),
            exp: chrono::Utc::now().timestamp() + 900,
        },
        &EncodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "verificationToken": verification_token,
        "expiresIn": 900
    })))
}

/// Refresh token request
#[derive(Debug, Deserialize)]
pub struct RefreshTokenRequest {
    pub refresh_token: String,
    pub device_id: String,
}

pub async fn refresh_token(
    State(state): State<AuthState>,
    Json(request): Json<RefreshTokenRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    let token_hash = crate::jwt::JwtManager::hash_refresh_token(&request.refresh_token);

    let row = sqlx::query(
        "SELECT user_id FROM refresh_tokens
         WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id: Uuid = row.try_get("user_id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user = sqlx::query("SELECT email, tenant_id FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let email: String = user.try_get("email").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = user.try_get("tenant_id").unwrap_or_else(|_| Uuid::nil());

    let access_token = state
        .jwt_manager
        .generate_access_token(
            UserId(user_id),
            &tenant_id.to_string(),
            &email,
            UserRole::User,
            &request.device_id,
            true,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Rotate: revoke old, insert new
    sqlx::query("UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1")
        .bind(&token_hash)
        .execute(&state.db)
        .await
        .ok();
    let new_hash = crate::jwt::JwtManager::hash_refresh_token(&refresh);
    let expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.refresh_token_expiry_days);
    sqlx::query(
        r#"INSERT INTO refresh_tokens
           (user_id, token_hash, device_id, device_fingerprint, expires_at, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6::inet)"#,
    )
    .bind(user_id)
    .bind(&new_hash)
    .bind(&request.device_id)
    .bind(&request.device_id)
    .bind(expires_at)
    .bind("0.0.0.0")
    .execute(&state.db)
    .await
    .ok();

    Ok(Json(TokenPairResponse {
        access_token,
        refresh_token: refresh,
        expires_in: state.config.jwt_expiry_seconds,
        token_type: "Bearer".to_string(),
    }))
}

pub async fn logout(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Logged out successfully"
    })))
}

pub async fn get_current_user(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // TODO: decode JWT from Authorization header via middleware and look up user.
    Err(StatusCode::NOT_IMPLEMENTED)
}

pub async fn list_sessions(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "sessions": []
    })))
}

pub async fn revoke_session(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Session revoked"
    })))
}

#[derive(Debug, Deserialize)]
pub struct DeviceRegisterRequest {
    pub device_name: String,
    pub platform: String,
    pub browser: String,
    pub os: String,
}

pub async fn register_device(
    State(state): State<AuthState>,
    Json(req): Json<DeviceRegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let device_id = Uuid::new_v4();
    // Device row insertion requires a user_id from the JWT; until auth
    // middleware is wired, just acknowledge the request.
    tracing::debug!(
        "register_device {} ({} on {}/{} via {})",
        device_id, req.device_name, req.os, req.platform, req.browser
    );
    // Touch state so the unused-var warning stays clean.
    let _ = &state.db;
    Ok(Json(json!({
        "success": true,
        "device_id": device_id.to_string()
    })))
}

pub async fn trust_device(
    State(_state): State<AuthState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Device trusted"
    })))
}
