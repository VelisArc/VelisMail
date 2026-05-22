//! Auth route handlers
//!
//! This module exposes the working password-based auth flow (register / login)
//! plus compatibility aliases used by deployed clients.

use crate::jwt::TokenPairResponse;
use crate::state::AuthState;
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, PasswordHash};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
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
use std::net::IpAddr;
use uuid::Uuid;
use validator::Validate;
use velismail_common::{UserId, UserRole};

/// Health check
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "auth-service",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

fn request_ip(headers: &HeaderMap) -> String {
    let candidate = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|value| value.to_str().ok())
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .unwrap_or("0.0.0.0")
        .trim()
        .trim_matches('"')
        .to_string();

    let without_port = candidate
        .strip_prefix('[')
        .and_then(|value| value.split(']').next())
        .map(str::to_string)
        .or_else(|| {
            if candidate.matches(':').count() == 1 {
                candidate.split(':').next().map(str::to_string)
            } else {
                Some(candidate.clone())
            }
        })
        .unwrap_or(candidate);

    without_port
        .parse::<IpAddr>()
        .map(|ip| ip.to_string())
        .unwrap_or_else(|_| "0.0.0.0".to_string())
}

fn request_user_agent(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(512).collect())
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

async fn send_otp_email(
    state: &AuthState,
    email: &str,
    display_name: &str,
    otp: &str,
) -> Result<(), StatusCode> {
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

    if let Some(api_key) = state.config.platform_resend_api_key.as_deref() {
        let from = format!(
            "{} <{}>",
            state.config.otp_from_name,
            state.config.otp_from_email
        );
        let response = reqwest::Client::new()
            .post("https://api.resend.com/emails")
            .bearer_auth(api_key)
            .json(&json!({
                "from": from,
                "to": [email],
                "subject": "Your VelisMail verification code",
                "text": text_body,
            }))
            .send()
            .await
            .map_err(|err| {
                tracing::error!("otp resend delivery request failed for {}: {}", email, err);
                StatusCode::BAD_GATEWAY
            })?;

        if response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::error!(
            "otp resend delivery rejected for {} with status {}: {}",
            email,
            status,
            body
        );
        return Err(StatusCode::BAD_GATEWAY);
    }

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

    let message = Message::builder()
        .from(from)
        .to(to)
        .subject("Your VelisMail verification code")
        .header(ContentType::TEXT_PLAIN)
        .body(text_body)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let transport_builder = match state.config.smtp_port {
        465 => SmtpTransport::relay(&state.config.smtp_host).map_err(|err| {
            tracing::error!(
                "smtp relay builder failed for host {}:{}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                err
            );
            StatusCode::BAD_GATEWAY
        })?,
        587 => SmtpTransport::starttls_relay(&state.config.smtp_host).map_err(|err| {
            tracing::error!(
                "smtp starttls builder failed for host {}:{}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                err
            );
            StatusCode::BAD_GATEWAY
        })?,
        _ => SmtpTransport::builder_dangerous(&state.config.smtp_host).port(state.config.smtp_port),
    };

    let transport = transport_builder.credentials(credentials).build();

    transport
        .send(&message)
        .map_err(|err| {
            tracing::error!(
                "otp smtp send failed via {}:{} as {} from {} to {}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                state.config.smtp_username,
                state.config.otp_from_email,
                email,
                err
            );
            StatusCode::BAD_GATEWAY
        })?;

    Ok(())
}

async fn reserve_daily_otp_send(
    state: &AuthState,
    email: &str,
    purpose: &str,
) -> Result<(), StatusCode> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS otp_rate_limits (
            email TEXT NOT NULL,
            purpose TEXT NOT NULL,
            day DATE NOT NULL,
            count INTEGER NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (email, purpose, day)
        )",
    )
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = sqlx::query(
        "INSERT INTO otp_rate_limits (email, purpose, day, count, updated_at)
         VALUES ($1, $2, CURRENT_DATE, 1, NOW())
         ON CONFLICT (email, purpose, day)
         DO UPDATE SET count = otp_rate_limits.count + 1, updated_at = NOW()
         WHERE otp_rate_limits.count < 3
         RETURNING count",
    )
    .bind(email)
    .bind(purpose)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if row.is_none() {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

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
    pub email: Option<String>,
    pub identifier: Option<String>,
    pub display_name: Option<String>,
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
    #[validate(email)]
    pub recovery_email: Option<String>,
    pub verification_token: Option<String>,
    pub tenant_id: Option<Uuid>,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ResetPasswordRequest {
    pub identifier: String,
    #[validate(length(min = 32))]
    pub verification_token: String,
    #[validate(length(min = 8, max = 256))]
    pub new_password: String,
}

#[derive(Debug, Deserialize, Validate)]
#[serde(rename_all = "camelCase")]
pub struct ChangePasswordRequest {
    pub identifier: String,
    #[validate(length(min = 1))]
    pub current_password: String,
    #[validate(length(min = 8, max = 256))]
    pub new_password: String,
}

fn ensure_registration_recovery_verified(
    state: &AuthState,
    recovery_email: Option<&str>,
    verification_token: Option<&str>,
) -> Result<(), StatusCode> {
    let Some(recovery_email) = recovery_email else {
        return Ok(());
    };

    let token = verification_token
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let mut validation = Validation::default();
    validation.validate_aud = false;
    validation.leeway = 120;
    let decoded = decode::<OtpVerificationClaims>(
        token,
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if decoded.claims.purpose != "register" || decoded.claims.sub != recovery_email {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(())
}

/// Register a new user with a password.
pub async fn register(
    State(state): State<AuthState>,
    Json(request): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let email = request.email.trim().to_lowercase();
    let recovery_email = request
        .recovery_email
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());

    ensure_registration_recovery_verified(
        &state,
        recovery_email.as_deref(),
        request.verification_token.as_deref(),
    )?;

    let existing: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND recovery_email = $2)",
    )
        .bind(&email)
        .bind(recovery_email.as_deref())
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
        r#"INSERT INTO users (
               id,
               tenant_id,
               email,
               recovery_email,
               recovery_email_verified,
               display_name,
               password_hash,
               status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')"#,
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(&email)
    .bind(recovery_email.as_deref())
    .bind(recovery_email.is_some())
    .bind(&request.display_name)
    .bind(&password_hash)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("register insert failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(json!({
        "success": true,
        "user": {
            "id": user_id.to_string(),
            "email": email,
            "recovery_email": recovery_email,
            "display_name": request.display_name,
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
pub async fn login_password(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(request): Json<PasswordLoginRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    login_password_inner(state, headers, request).await
}

async fn login_password_inner(
    state: AuthState,
    headers: HeaderMap,
    request: PasswordLoginRequest,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    let submitted_identifier = request.email.trim().to_lowercase();
    let identifier = if submitted_identifier.contains('@') {
        submitted_identifier
    } else {
        format!("admin@{}", submitted_identifier.trim_matches('.'))
    };
    let ip_address = request_ip(&headers);
    let user_agent = request_user_agent(&headers);

    match state.account_lock.is_account_locked(&identifier).await {
        Ok(true) => return Err(StatusCode::TOO_MANY_REQUESTS),
        Ok(false) => {}
        Err(err) => {
            tracing::warn!(
                "account lock check unavailable for {}; continuing with password verification: {}",
                identifier,
                err
            );
        }
    }

    let row = sqlx::query(
        "SELECT id, tenant_id, email, password_hash
         FROM users
         WHERE (email = $1 OR recovery_email = $1) AND status = 'active'
         ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .bind(&identifier)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let Some(row) = row else {
        if let Err(err) = state
            .account_lock
            .record_failed_attempt(None, &identifier, &ip_address)
            .await
        {
            tracing::warn!(
                "failed login attempt record unavailable for {}; returning unauthorized: {}",
                identifier,
                err
            );
        }
        return Err(StatusCode::UNAUTHORIZED);
    };
    let user_id: Uuid = row.try_get("id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .unwrap_or_else(|_| Uuid::nil());
    let email: String = row.try_get("email").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let password_hash: Option<String> = row.try_get("password_hash").ok();

    let stored = password_hash.ok_or(StatusCode::UNAUTHORIZED)?;
    if !verify_password(&request.password, &stored) {
        if let Err(err) = state
            .account_lock
            .record_failed_attempt(Some(UserId(user_id)), &identifier, &ip_address)
            .await
        {
            tracing::warn!(
                "failed login attempt record unavailable for {}; returning unauthorized: {}",
                identifier,
                err
            );
        }
        return Err(StatusCode::UNAUTHORIZED);
    }

    if let Err(err) = state.account_lock.clear_failed_attempts(&identifier).await {
        tracing::warn!(
            "failed login attempt cleanup unavailable for {}; continuing login: {}",
            identifier,
            err
        );
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

    sqlx::query(
        "UPDATE sessions
         SET is_active = false
         WHERE id IN (
             SELECT id FROM sessions
             WHERE user_id = $1 AND is_active = true
             ORDER BY last_active ASC
             OFFSET $2
         )",
    )
    .bind(user_id)
    .bind(state.config.max_sessions_per_user.saturating_sub(1) as i64)
    .execute(&state.db)
    .await
    .ok();

    let session_id = Uuid::new_v4();
    let session_expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.refresh_token_expiry_days);
    sqlx::query(
        r#"INSERT INTO sessions
           (id, user_id, tenant_id, device_fingerprint, ip_address, user_agent, expires_at, mfa_verified)
           VALUES ($1, $2, $3, $4, $5::inet, $6, $7, $8)"#,
    )
    .bind(session_id)
    .bind(user_id)
    .bind(tenant_id.to_string())
    .bind(&device_id)
    .bind(&ip_address)
    .bind(user_agent)
    .bind(session_expires_at)
    .bind(false)
    .execute(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("session insert failed for user {}: {}", user_id, err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

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
        mfa_required: state.config.require_mfa,
    }))
}

pub async fn send_otp(
    State(state): State<AuthState>,
    Json(request): Json<SendOtpRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let purpose = request
        .purpose
        .clone()
        .unwrap_or_else(|| "register".to_string());
    let requested_email = request
        .email
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let requested_identifier = request
        .identifier
        .as_deref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());

    let (normalized_email, display_name) = if purpose == "password_reset" {
        let identifier = requested_identifier
            .or(requested_email.clone())
            .ok_or(StatusCode::BAD_REQUEST)?;
        let row = sqlx::query(
            "SELECT email, recovery_email, display_name
             FROM users
             WHERE (email = $1 OR recovery_email = $1) AND status = 'active'
             ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
             LIMIT 1",
        )
        .bind(&identifier)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

        let recovery_email: Option<String> = row.try_get("recovery_email").ok();
        let recovery_email = recovery_email
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .ok_or(StatusCode::BAD_REQUEST)?;
        let display_name: String = row.try_get("display_name").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        (recovery_email, display_name)
    } else {
        let normalized_email = requested_email.ok_or(StatusCode::BAD_REQUEST)?;
        let display_name = request
            .display_name
            .clone()
            .unwrap_or_else(|| "VelisMail user".to_string());
        if display_name.trim().len() < 2 || display_name.trim().len() > 100 {
            return Err(StatusCode::BAD_REQUEST);
        }
        (normalized_email, display_name)
    };

    reserve_daily_otp_send(&state, &normalized_email, &purpose).await?;

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

    send_otp_email(&state, &normalized_email, &display_name, &otp).await?;

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
        "provider": if state.config.smtp_host.to_lowercase().contains("brevo") {
            "brevo-smtp"
        } else {
            "smtp"
        }
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

    let mut validation = Validation::default();
    validation.validate_aud = false;
    let token = decode::<OtpChallengeClaims>(
        &request.challenge_token,
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if token.claims.purpose != purpose {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let verification_email = if purpose == "password_reset" && token.claims.sub != normalized_email {
        let row = sqlx::query(
            "SELECT recovery_email
             FROM users
             WHERE (email = $1 OR recovery_email = $1) AND status = 'active'
             ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
             LIMIT 1",
        )
        .bind(&normalized_email)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

        let recovery_email: Option<String> = row.try_get("recovery_email").ok();
        let recovery_email = recovery_email
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .ok_or(StatusCode::UNAUTHORIZED)?;
        if recovery_email != token.claims.sub {
            return Err(StatusCode::UNAUTHORIZED);
        }
        recovery_email
    } else {
        if token.claims.sub != normalized_email {
            return Err(StatusCode::UNAUTHORIZED);
        }
        normalized_email.clone()
    };

    let expected_hash = hash_otp_value(
        &state.config.otp_signing_secret,
        &verification_email,
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
            sub: verification_email,
            purpose,
            verified_at: chrono::Utc::now().timestamp(),
            exp: chrono::Utc::now().timestamp() + state.config.otp_ttl_seconds,
        },
        &EncodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
    )
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "verificationToken": verification_token,
        "expiresIn": state.config.otp_ttl_seconds
    })))
}

pub async fn reset_password(
    State(state): State<AuthState>,
    Json(request): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let identifier = request.identifier.trim().to_lowercase();
    let mut validation = Validation::default();
    validation.validate_aud = false;
    let token = decode::<OtpVerificationClaims>(
        &request.verification_token,
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if token.claims.purpose != "password_reset" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let row = sqlx::query(
        "SELECT id, recovery_email
         FROM users
         WHERE (email = $1 OR recovery_email = $1) AND status = 'active'
         ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .bind(&identifier)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let user_id: Uuid = row.try_get("id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let recovery_email: Option<String> = row.try_get("recovery_email").ok();
    let normalized_recovery_email = recovery_email
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .ok_or(StatusCode::BAD_REQUEST)?;

    if token.claims.sub != normalized_recovery_email {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let password_hash = hash_password(&request.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "message": "Password updated successfully."
    })))
}

pub async fn change_password(
    State(state): State<AuthState>,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    request.validate().map_err(|_| StatusCode::BAD_REQUEST)?;

    let identifier = request.identifier.trim().to_lowercase();
    let row = sqlx::query(
        "SELECT id, password_hash
         FROM users
         WHERE (email = $1 OR recovery_email = $1) AND status = 'active'
         ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
         LIMIT 1",
    )
    .bind(&identifier)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let user_id: Uuid = row.try_get("id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let stored_hash: Option<String> = row.try_get("password_hash").ok();
    let stored_hash = stored_hash.ok_or(StatusCode::UNAUTHORIZED)?;
    if !verify_password(&request.current_password, &stored_hash) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let password_hash = hash_password(&request.new_password)?;
    sqlx::query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&password_hash)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "message": "Password updated successfully."
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
        mfa_required: state.config.require_mfa,
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
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = claims.sub.0;

    let user = sqlx::query(
        "SELECT id, tenant_id, email, recovery_email, display_name, status, settings, created_at, updated_at, last_login
         FROM users
         WHERE id = $1"
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("get_current_user query failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    let id: Uuid = user.try_get("id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = user.try_get("tenant_id").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let email: String = user.try_get("email").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let recovery_email: Option<String> = user.try_get("recovery_email").ok();
    let display_name: String = user.try_get("display_name").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let status: String = user.try_get("status").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let settings: Option<serde_json::Value> = user.try_get("settings").ok();
    let created_at: chrono::DateTime<chrono::Utc> = user.try_get("created_at").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let updated_at: chrono::DateTime<chrono::Utc> = user.try_get("updated_at").map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let last_login: Option<chrono::DateTime<chrono::Utc>> = user.try_get("last_login").ok();

    Ok(Json(json!({
        "success": true,
        "user": {
            "id": id,
            "tenant_id": tenant_id,
            "email": email,
            "recovery_email": recovery_email,
            "display_name": display_name,
            "status": status,
            "settings": settings.unwrap_or_else(|| json!({})),
            "created_at": created_at,
            "updated_at": updated_at,
            "last_login": last_login,
        }
    })))
}

pub async fn update_account(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = claims.sub.0;

    let settings_json = serde_json::to_string(&request).unwrap_or_else(|_| "{}".to_string());

    sqlx::query("UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE id = $2")
        .bind(settings_json)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("update_account failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(json!({
        "success": true,
        "message": "Account updated successfully"
    })))
}

pub async fn list_sessions(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let rows = sqlx::query(
        "SELECT id, device_fingerprint, ip_address::text, user_agent, created_at, expires_at, last_active, mfa_verified
         FROM sessions
         WHERE user_id = $1 AND is_active = true AND expires_at > NOW()
         ORDER BY last_active DESC",
    )
    .bind(claims.sub.0)
    .fetch_all(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("list_sessions failed for user {}: {}", claims.sub.0, err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let sessions: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            let id: Uuid = row.get("id");
            let device_fingerprint: String = row.get("device_fingerprint");
            let ip_address: String = row.get("ip_address");
            let user_agent: Option<String> = row.try_get("user_agent").ok();
            let created_at: chrono::DateTime<chrono::Utc> = row.get("created_at");
            let expires_at: chrono::DateTime<chrono::Utc> = row.get("expires_at");
            let last_active: chrono::DateTime<chrono::Utc> = row.get("last_active");
            let mfa_verified: bool = row.get("mfa_verified");
            json!({
                "id": id,
                "deviceFingerprint": device_fingerprint,
                "ipAddress": ip_address,
                "userAgent": user_agent,
                "createdAt": created_at,
                "expiresAt": expires_at,
                "lastActive": last_active,
                "mfaVerified": mfa_verified,
                "current": device_fingerprint == claims.device_id,
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "sessions": sessions
    })))
}

pub async fn revoke_session(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let result = sqlx::query(
        "UPDATE sessions SET is_active = false
         WHERE id = $1 AND user_id = $2 AND is_active = true",
    )
    .bind(id)
    .bind(claims.sub.0)
    .execute(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("revoke_session failed for user {}: {}", claims.sub.0, err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    Ok(Json(json!({
        "success": true,
        "message": "Session revoked"
    })))
}

pub async fn revoke_other_sessions(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let result = sqlx::query(
        "UPDATE sessions SET is_active = false
         WHERE user_id = $1 AND is_active = true AND device_fingerprint <> $2",
    )
    .bind(claims.sub.0)
    .bind(&claims.device_id)
    .execute(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("revoke_other_sessions failed for user {}: {}", claims.sub.0, err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(json!({
        "success": true,
        "revoked": result.rows_affected()
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
