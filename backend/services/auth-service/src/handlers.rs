//! Auth route handlers
//!
//! This module exposes the working password-based auth flow (register / login)
//! plus compatibility aliases used by deployed clients.

use crate::jwt::TokenPairResponse;
use crate::mfa::{
    build_otpauth_uri, create_mfa_challenge, create_recovery_token, decode_mfa_challenge,
    decode_recovery_token, generate_totp_secret, verify_totp_code, EncryptedTotpSecret,
    TOTP_ISSUER,
};
use crate::state::AuthState;
use argon2::password_hash::{rand_core::OsRng, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, PasswordHash};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Extension, Json,
};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;
use std::net::IpAddr;
use uuid::Uuid;
use validator::Validate;
use velismail_common::{UserId, UserRole};
use velismail_email::EmailMessage;

/// Health check
pub async fn health_check(
    State(state): State<AuthState>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    let db_healthy = sqlx::query("SELECT 1").execute(&state.db).await.is_ok();

    let redis_healthy = if let Some(redis) = &state.redis {
        // Redis is an external dependency; a dead network path must not make
        // the health endpoint hang.
        tokio::time::timeout(
            std::time::Duration::from_secs(2),
            redis.get_multiplexed_async_connection(),
        )
        .await
        .map(|result| result.is_ok())
        .unwrap_or(false)
    } else {
        false
    };

    // Redis is an optional accelerator with a PostgreSQL fallback, so it is
    // reported but does not make the service unready.
    let redis_status = state.redis.as_ref().map(|_| redis_healthy);
    let health = velismail_common::HealthResponse::new(
        "auth-service",
        env!("CARGO_PKG_VERSION"),
        db_healthy,
        redis_status,
        None,
    );
    let healthy = db_healthy;
    let status = if healthy {
        axum::http::StatusCode::OK
    } else {
        axum::http::StatusCode::SERVICE_UNAVAILABLE
    };
    (
        status,
        Json(
            serde_json::to_value(health)
                .unwrap_or_else(|_| json!({"status": "UNHEALTHY", "service": "auth-service"})),
        ),
    )
}

fn request_ip(headers: &HeaderMap) -> String {
    let candidate = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        // Caddy appends the real peer address; the last entry cannot be
        // spoofed by the client. Prefer it over the first entry.
        .and_then(|value| value.rsplit(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
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

/// Resolve the company workspace for an email address, creating it when the
/// domain does not have one yet. Every authenticated account belongs to a
/// tenant so the company administration console and platform analytics stay
/// tenant-scoped.
async fn resolve_or_create_tenant(
    state: &AuthState,
    email: &str,
    auth_provider: &str,
) -> Result<Uuid, StatusCode> {
    let email_domain = email
        .split('@')
        .nth(1)
        .unwrap_or("velismail.online")
        .to_lowercase();
    let existing = sqlx::query(
        "SELECT id FROM tenants
         WHERE deleted_at IS NULL
           AND (organization_email = $1 OR LOWER(SPLIT_PART(organization_email, '@', 2)) = $2)
         ORDER BY created_at ASC
         LIMIT 1",
    )
    .bind(email)
    .bind(&email_domain)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(row) = existing {
        return row
            .try_get("id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR);
    }

    let slug = format!(
        "{}-{}",
        email_domain.replace(|ch: char| !ch.is_ascii_alphanumeric(), "-"),
        &Uuid::new_v4().simple().to_string()[..6]
    );
    let row = sqlx::query(
        "INSERT INTO tenants (organization_name, organization_email, plan_tier, status, settings, limits)
         VALUES ($1, $2, 'free', 'active', jsonb_build_object('domain', $3, 'authProvider', $4), '{}'::jsonb)
         ON CONFLICT (organization_email) DO UPDATE SET updated_at = NOW()
         RETURNING id",
    )
    .bind(&email_domain)
    .bind(email)
    .bind(&email_domain)
    .bind(auth_provider)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = row
        .try_get("id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let _ = sqlx::query(
        "INSERT INTO tenant_profiles (tenant_id, slug, legal_name, billing_email, technical_email)
         VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (tenant_id) DO NOTHING",
    )
    .bind(tenant_id)
    .bind(&slug)
    .bind(&email_domain)
    .bind(email)
    .execute(&state.db)
    .await;
    Ok(tenant_id)
}

/// Keep the normalized membership tables in sync with a user's account. The
/// stored role is never downgraded, and a suspended membership stays
/// suspended - only a workspace owner or the platform can change that.
async fn sync_company_membership(
    state: &AuthState,
    tenant_id: Uuid,
    user_id: Uuid,
    email: &str,
    display_name: &str,
    role: &str,
) {
    let _ = sqlx::query(
        "INSERT INTO company_members (tenant_id, user_id, email, display_name, role, status, joined_at, last_active_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
         ON CONFLICT (tenant_id, email) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             display_name = CASE WHEN EXCLUDED.display_name = '' THEN company_members.display_name ELSE EXCLUDED.display_name END,
             last_active_at = NOW(),
             role = CASE
                 WHEN company_members.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner'
                 WHEN company_members.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin'
                 ELSE company_members.role
             END",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(email)
    .bind(display_name)
    .bind(role)
    .execute(&state.db)
    .await;
    let _ = sqlx::query(
        "INSERT INTO tenant_users (tenant_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, user_id) DO UPDATE
         SET role = CASE
                 WHEN tenant_users.role = 'owner' OR EXCLUDED.role = 'owner' THEN 'owner'
                 WHEN tenant_users.role = 'admin' OR EXCLUDED.role = 'admin' THEN 'admin'
                 ELSE tenant_users.role
             END,
             updated_at = NOW()",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(role)
    .execute(&state.db)
    .await;
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
) -> Result<(), velismail_common::AppError> {
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

    let message = EmailMessage {
        from: state.config.otp_from_email.clone(),
        from_name: Some(state.config.otp_from_name.clone()),
        to: vec![email.to_string()],
        subject: "Your VelisMail verification code".to_string(),
        text: text_body,
        ..EmailMessage::default()
    };

    state.email_client.send(&message).await.map_err(|err| {
        tracing::error!("otp delivery failed for {}: {}", email, err);
        velismail_common::AppError::MailDelivery(err.to_string())
    })?;

    Ok(())
}

async fn reserve_daily_otp_send(
    state: &AuthState,
    email: &str,
    purpose: &str,
) -> Result<(), velismail_common::AppError> {
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
    .await?;

    if row.is_none() {
        return Err(velismail_common::AppError::RateLimitExceeded);
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
#[serde(rename_all = "camelCase")]
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
    pub phone_country_code: Option<String>,
    pub phone_number: Option<String>,
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

    let validation = Validation {
        validate_aud: false,
        leeway: 120,
        ..Default::default()
    };
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
    // The workspace of a new account is never taken from the request. A
    // client-supplied tenant id would let anyone join another company.
    let tenant_id = resolve_or_create_tenant(&state, &email, "otp").await?;

    // Process optional phone fields
    let phone_country_code = request
        .phone_country_code
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());
    let phone_number = request
        .phone_number
        .as_deref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty());

    // Validate phone fields: both must be provided together
    if phone_country_code.is_some() ^ phone_number.is_some() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Normalize phone number to E.164 format
    let phone_e164 = match (phone_country_code, phone_number) {
        (Some(cc), Some(num)) => {
            let digits: String = num.chars().filter(|c| c.is_ascii_digit()).collect();
            if digits.len() < 6 || digits.len() > 15 || !cc.starts_with('+') {
                return Err(StatusCode::BAD_REQUEST);
            }
            Some(format!("{}{}", cc, digits))
        }
        _ => None,
    };

    let member_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*)::bigint FROM users WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&state.db)
            .await
            .unwrap_or(0);
    // The first account of a workspace owns it; everyone else joins as a member.
    let workspace_role = if member_count == 0 { "owner" } else { "member" };
    let client_role = if member_count == 0 { "admin" } else { "member" };
    let settings = json!({
        "role": client_role,
        "plan": "Free",
        "billingCycle": "monthly",
        "accountType": "business",
        "isSetupComplete": false,
        "authProvider": "otp",
    });

    sqlx::query(
        r#"INSERT INTO users (
               id,
               tenant_id,
               email,
               recovery_email,
               recovery_email_verified,
               display_name,
               password_hash,
               status,
               settings,
               phone_country_code,
               phone_number,
               phone_e164
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $11)"#,
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(&email)
    .bind(recovery_email.as_deref())
    .bind(recovery_email.is_some())
    .bind(&request.display_name)
    .bind(&password_hash)
    .bind(&settings)
    .bind(phone_country_code)
    .bind(phone_number)
    .bind(phone_e164)
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("register insert failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    sync_company_membership(
        &state,
        tenant_id,
        user_id,
        &email,
        &request.display_name,
        workspace_role,
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "user": {
            "id": user_id.to_string(),
            "email": email,
            "recovery_email": recovery_email,
            "display_name": request.display_name,
            "tenant_id": tenant_id,
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

/// Login with email + password. Issues real JWT access + refresh tokens, or MFA challenge if TOTP enabled.
pub async fn login_password(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(request): Json<PasswordLoginRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    login_password_inner(state, headers, request).await
}

async fn login_password_inner(
    state: AuthState,
    headers: HeaderMap,
    request: PasswordLoginRequest,
) -> Result<Json<serde_json::Value>, StatusCode> {
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
        "SELECT id, tenant_id, email, password_hash, recovery_email, recovery_email_verified, totp_enabled, display_name
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
    let user_id: Uuid = row
        .try_get("id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = row.try_get("tenant_id").unwrap_or_else(|_| Uuid::nil());
    let email: String = row
        .try_get("email")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let password_hash: Option<String> = row.try_get("password_hash").ok();
    let recovery_email: Option<String> = row.try_get("recovery_email").ok().flatten();
    let recovery_verified: bool = row.try_get("recovery_email_verified").unwrap_or(false);
    let totp_enabled: bool = row.try_get("totp_enabled").unwrap_or(false);

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

    // If TOTP is enabled, return MFA challenge instead of tokens
    if totp_enabled {
        let mfa_token = create_mfa_challenge(
            &state.config.otp_signing_secret,
            &user_id.to_string(),
            "mfa_login",
            300, // 5 minutes
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let recovery_email_masked = recovery_email
            .filter(|_| recovery_verified)
            .map(|e| mask_email(&e));

        return Ok(Json(json!({
            "success": true,
            "mfa_required": true,
            "mfa_token": mfa_token,
            "recovery_email_masked": recovery_email_masked,
        })));
    }

    let device_id = request.device_id.unwrap_or_default();
    let tokens = issue_tokens_for_user(
        &state,
        user_id,
        tenant_id,
        &email,
        &device_id,
        &ip_address,
        user_agent,
        false, // mfa_verified = false when TOTP not enabled
    )
    .await?;

    Ok(Json(json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_in": tokens.expires_in,
        "token_type": tokens.token_type,
        "mfa_required": tokens.mfa_required,
    })))
}

pub async fn send_otp(
    State(state): State<AuthState>,
    Json(request): Json<SendOtpRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
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
            .ok_or_else(|| {
                velismail_common::AppError::BadRequest("Missing identifier".to_string())
            })?;
        let row = sqlx::query(
            "SELECT email, recovery_email, display_name
             FROM users
             WHERE (email = $1 OR recovery_email = $1) AND status = 'active'
             ORDER BY CASE WHEN email = $1 THEN 0 ELSE 1 END
             LIMIT 1",
        )
        .bind(&identifier)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| velismail_common::AppError::NotFound("User not found".to_string()))?;

        let recovery_email: Option<String> = row.try_get("recovery_email").ok();
        let recovery_email = recovery_email
            .map(|value| value.trim().to_lowercase())
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                velismail_common::AppError::BadRequest("No recovery email set".to_string())
            })?;
        let display_name: String = row
            .try_get("display_name")
            .map_err(|_| velismail_common::AppError::Internal)?;
        (recovery_email, display_name)
    } else {
        let normalized_email = requested_email.ok_or_else(|| {
            velismail_common::AppError::BadRequest("Email is required".to_string())
        })?;
        let display_name = request
            .display_name
            .clone()
            .unwrap_or_else(|| "VelisMail user".to_string());
        if display_name.trim().len() < 2 || display_name.trim().len() > 100 {
            return Err(velismail_common::AppError::BadRequest(
                "Invalid display name".to_string(),
            ));
        }
        (normalized_email, display_name)
    };

    reserve_daily_otp_send(&state, &normalized_email, &purpose).await?;

    let otp = velismail_crypto::random::generate_otp(6)
        .map_err(|_| velismail_common::AppError::Internal)?;
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
    .map_err(|_| velismail_common::AppError::Internal)?;

    Ok(Json(json!({
        "success": true,
        "challengeToken": challenge_token,
        "expiresIn": state.config.otp_ttl_seconds,
        "maskedEmail": mask_email(&normalized_email),
        "provider": "resend"
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

    let validation = Validation {
        validate_aud: false,
        ..Default::default()
    };
    let token = decode::<OtpChallengeClaims>(
        &request.challenge_token,
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| StatusCode::UNAUTHORIZED)?;

    if token.claims.purpose != purpose {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let verification_email = if purpose == "password_reset" && token.claims.sub != normalized_email
    {
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
    let validation = Validation {
        validate_aud: false,
        ..Default::default()
    };
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

    let user_id: Uuid = row
        .try_get("id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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

    let user_id: Uuid = row
        .try_get("id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
    headers: HeaderMap,
    Json(request): Json<RefreshTokenRequest>,
) -> Result<Json<TokenPairResponse>, StatusCode> {
    let token_hash = crate::jwt::JwtManager::hash_refresh_token(&request.refresh_token);

    let row = sqlx::query(
        "SELECT user_id, mfa_verified FROM refresh_tokens
         WHERE token_hash = $1 AND revoked = false AND expires_at > NOW()",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let row = row.ok_or(StatusCode::UNAUTHORIZED)?;
    let user_id: Uuid = row
        .try_get("user_id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token_mfa_verified: bool = row.try_get("mfa_verified").unwrap_or(false);

    // A suspended, deactivated or deleted account never gets a new token.
    let user = sqlx::query(
        "SELECT email, tenant_id, totp_enabled FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;
    let email: String = user
        .try_get("email")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = user.try_get("tenant_id").unwrap_or_else(|_| Uuid::nil());
    let totp_enabled: bool = user.try_get("totp_enabled").unwrap_or(false);

    // If user has TOTP enabled but refresh token wasn't issued with MFA, reject
    if totp_enabled && !token_mfa_verified {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // New access token should have mfa_verified = token_mfa_verified (preserve the flag)
    let access_token = state
        .jwt_manager
        .generate_access_token(
            UserId(user_id),
            &tenant_id.to_string(),
            &email,
            UserRole::User,
            &request.device_id,
            token_mfa_verified,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Rotate: revoke old, insert new with same mfa_verified flag
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
           (user_id, token_hash, device_id, device_fingerprint, expires_at, ip_address, mfa_verified)
           VALUES ($1, $2, $3, $4, $5, $6::inet, $7)"#,
    )
    .bind(user_id)
    .bind(&new_hash)
    .bind(&request.device_id)
    .bind(&request.device_id)
    .bind(expires_at)
    .bind(request_ip(&headers))
    .bind(token_mfa_verified)
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
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let user_id = claims.sub.0;
    let device_id = claims.device_id;

    // 1. Fetch active session IDs
    let sessions: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM sessions WHERE user_id = $1 AND device_fingerprint = $2 AND is_active = true"
    )
    .bind(user_id)
    .bind(&device_id)
    .fetch_all(&state.db)
    .await?;

    // 2. Revoke sessions in DB
    sqlx::query(
        "UPDATE sessions SET is_active = false WHERE user_id = $1 AND device_fingerprint = $2 AND is_active = true"
    )
    .bind(user_id)
    .bind(&device_id)
    .execute(&state.db)
    .await?;

    // 3. Revoke refresh tokens in DB
    sqlx::query(
        "UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND device_id = $2 AND revoked = false"
    )
    .bind(user_id)
    .bind(&device_id)
    .execute(&state.db)
    .await?;

    // 4. Clear Redis cache
    if let Some(redis_client) = &state.redis {
        if let Ok(mut conn) = redis_client.get_multiplexed_async_connection().await {
            for sid in sessions {
                let key = velismail_database::keys::session(&sid.to_string());
                let _: Result<(), _> = redis::cmd("DEL").arg(key).query_async(&mut conn).await;
            }
        }
    }

    Ok(Json(json!({
        "success": true,
        "message": "Logged out successfully"
    })))
}

/// Helper to issue access + refresh tokens with optional MFA verification flag
#[allow(clippy::too_many_arguments)]
async fn issue_tokens_for_user(
    state: &AuthState,
    user_id: Uuid,
    tenant_id: Uuid,
    email: &str,
    device_id: &str,
    ip_address: &str,
    user_agent: Option<String>,
    mfa_verified: bool,
) -> Result<TokenPairResponse, StatusCode> {
    let access_token = state
        .jwt_manager
        .generate_access_token(
            UserId(user_id),
            &tenant_id.to_string(),
            email,
            UserRole::User,
            device_id,
            mfa_verified,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let refresh_token = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token_hash = crate::jwt::JwtManager::hash_refresh_token(&refresh_token);
    let expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.refresh_token_expiry_days);

    sqlx::query(
        r#"INSERT INTO refresh_tokens
           (user_id, token_hash, device_id, device_fingerprint, expires_at, ip_address, mfa_verified)
           VALUES ($1, $2, $3, $4, $5, $6::inet, $7)"#,
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(device_id)
    .bind(device_id)
    .bind(expires_at)
    .bind(ip_address)
    .bind(mfa_verified)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
    .bind(device_id)
    .bind(ip_address)
    .bind(user_agent)
    .bind(session_expires_at)
    .bind(mfa_verified)
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

    Ok(TokenPairResponse {
        access_token,
        refresh_token,
        expires_in: state.config.jwt_expiry_seconds,
        token_type: "Bearer".to_string(),
        mfa_required: state.config.require_mfa,
    })
}

/// Revoke all refresh tokens for a user (used when enabling/disabling MFA)
async fn revoke_all_refresh_tokens(state: &AuthState, user_id: Uuid) {
    sqlx::query("UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false")
        .bind(user_id)
        .execute(&state.db)
        .await
        .ok();
}

#[derive(Debug, Deserialize)]
pub struct MfaCodeRequest {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct MfaDisableRequest {
    pub password: Option<String>,
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct MfaVerifyRequest {
    pub mfa_token: String,
    pub code: String,
    pub device_id: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MfaRecoverySendRequest {
    pub mfa_token: String,
}

#[derive(Debug, Deserialize)]
pub struct MfaRecoveryVerifyRequest {
    pub mfa_token: String,
    pub challenge_token: String,
    pub otp: String,
}

#[derive(Debug, Deserialize)]
pub struct MfaRecoveryCompleteRequest {
    pub recovery_token: String,
    pub code: String,
    pub device_id: Option<String>,
}

/// Start MFA setup - returns secret and otpauth URI for QR code
pub async fn mfa_setup(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let user_id = claims.sub.0;

    let row = sqlx::query(
        "SELECT email, recovery_email, recovery_email_verified, totp_enabled, display_name
         FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?
    .ok_or(velismail_common::AppError::NotFound(
        "User not found".to_string(),
    ))?;

    let totp_enabled: bool = row.try_get("totp_enabled").unwrap_or(false);
    if totp_enabled {
        return Err(velismail_common::AppError::BadRequest(
            "Authenticator is already enabled.".to_string(),
        ));
    }

    let recovery_email: Option<String> = row.try_get("recovery_email").ok().flatten();
    let recovery_verified: bool = row.try_get("recovery_email_verified").unwrap_or(false);
    let email: String = row
        .try_get("email")
        .map_err(|_| velismail_common::AppError::Internal)?;
    let _display_name: String = row
        .try_get("display_name")
        .map_err(|_| velismail_common::AppError::Internal)?;

    if recovery_email.is_none() || !recovery_verified {
        return Err(velismail_common::AppError::BadRequest(
            "Add and verify a recovery email before enabling the authenticator.".to_string(),
        ));
    }

    let secret = generate_totp_secret().map_err(|_| velismail_common::AppError::Internal)?;
    let encrypted = EncryptedTotpSecret::new(&secret, &state.config.otp_signing_secret)
        .map_err(|_| velismail_common::AppError::Internal)?;

    sqlx::query("UPDATE users SET totp_pending_secret = $1, updated_at = NOW() WHERE id = $2")
        .bind(&encrypted.0)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| velismail_common::AppError::Internal)?;

    let otpauth_url = build_otpauth_uri(&secret, &email, TOTP_ISSUER);

    Ok(Json(json!({
        "success": true,
        "secret": secret,
        "otpauth_url": otpauth_url,
    })))
}

/// Enable MFA after verifying the setup code
pub async fn mfa_enable(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    headers: HeaderMap,
    Json(request): Json<MfaCodeRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let user_id = claims.sub.0;
    let device_id = claims.device_id.clone();
    let ip_address = request_ip(&headers);
    let user_agent = request_user_agent(&headers);

    if request.code.trim().len() != 6 || !request.code.chars().all(|c| c.is_ascii_digit()) {
        return Err(velismail_common::AppError::BadRequest(
            "Invalid code format. Enter the 6-digit code.".to_string(),
        ));
    }

    let row = sqlx::query(
        "SELECT email, tenant_id, totp_pending_secret, totp_enabled
         FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?
    .ok_or(velismail_common::AppError::NotFound(
        "User not found".to_string(),
    ))?;

    let totp_enabled: bool = row.try_get("totp_enabled").unwrap_or(false);
    if totp_enabled {
        return Err(velismail_common::AppError::BadRequest(
            "Authenticator is already enabled.".to_string(),
        ));
    }

    let pending_secret_enc: Option<String> = row.try_get("totp_pending_secret").ok().flatten();
    let pending_secret_enc = pending_secret_enc.ok_or_else(|| {
        velismail_common::AppError::BadRequest(
            "No pending authenticator setup. Start setup first.".to_string(),
        )
    })?;

    let secret = EncryptedTotpSecret(pending_secret_enc.clone())
        .decrypt(&state.config.otp_signing_secret)
        .ok_or_else(|| velismail_common::AppError::Internal)?;

    if !verify_totp_code(&secret, &request.code, None) {
        return Err(velismail_common::AppError::Unauthorized(
            "Invalid authenticator code.".to_string(),
        ));
    }

    // Move pending secret to active, enable TOTP
    sqlx::query(
        "UPDATE users SET totp_secret = $1, totp_pending_secret = NULL, totp_enabled = TRUE, totp_confirmed_at = NOW(), updated_at = NOW() WHERE id = $2",
    )
    .bind(&pending_secret_enc)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?;

    // Revoke all old refresh tokens (issued without MFA)
    revoke_all_refresh_tokens(&state, user_id).await;

    // Issue new tokens with mfa_verified = true
    let email: String = row
        .try_get("email")
        .map_err(|_| velismail_common::AppError::Internal)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .map_err(|_| velismail_common::AppError::Internal)?;
    let tokens = issue_tokens_for_user(
        &state,
        user_id,
        tenant_id,
        &email,
        &device_id,
        &ip_address,
        user_agent,
        true,
    )
    .await
    .map_err(|_| velismail_common::AppError::Internal)?;

    Ok(Json(json!({
        "success": true,
        "totp_enabled": true,
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_in": tokens.expires_in,
        "token_type": tokens.token_type,
        "mfa_required": tokens.mfa_required,
    })))
}

/// Disable MFA - requires password and current authenticator code
pub async fn mfa_disable(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    headers: HeaderMap,
    Json(request): Json<MfaDisableRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let user_id = claims.sub.0;
    let device_id = claims.device_id.clone();
    let ip_address = request_ip(&headers);
    let user_agent = request_user_agent(&headers);

    let row = sqlx::query(
        "SELECT email, tenant_id, password_hash, totp_secret, totp_enabled
         FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?
    .ok_or(velismail_common::AppError::NotFound(
        "User not found".to_string(),
    ))?;

    let totp_enabled: bool = row.try_get("totp_enabled").unwrap_or(false);
    if !totp_enabled {
        return Err(velismail_common::AppError::BadRequest(
            "Authenticator is not enabled.".to_string(),
        ));
    }

    let password_hash: Option<String> = row.try_get("password_hash").ok().flatten();
    if let Some(hash) = password_hash {
        if request.password.is_none() || !verify_password(&request.password.unwrap(), &hash) {
            return Err(velismail_common::AppError::Unauthorized(
                "Current password is incorrect.".to_string(),
            ));
        }
    }

    let secret_enc: Option<String> = row.try_get("totp_secret").ok().flatten();
    let secret_enc = secret_enc.ok_or_else(|| velismail_common::AppError::Internal)?;

    let secret = EncryptedTotpSecret(secret_enc)
        .decrypt(&state.config.otp_signing_secret)
        .ok_or_else(|| velismail_common::AppError::Internal)?;

    if !verify_totp_code(&secret, &request.code, None) {
        return Err(velismail_common::AppError::Unauthorized(
            "Invalid authenticator code.".to_string(),
        ));
    }

    // Disable TOTP
    sqlx::query(
        "UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = FALSE, totp_confirmed_at = NULL, updated_at = NOW() WHERE id = $1",
    )
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?;

    // Revoke all refresh tokens and issue new ones with mfa_verified = false
    revoke_all_refresh_tokens(&state, user_id).await;

    let email: String = row
        .try_get("email")
        .map_err(|_| velismail_common::AppError::Internal)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .map_err(|_| velismail_common::AppError::Internal)?;
    let tokens = issue_tokens_for_user(
        &state,
        user_id,
        tenant_id,
        &email,
        &device_id,
        &ip_address,
        user_agent,
        false,
    )
    .await
    .map_err(|_| velismail_common::AppError::Internal)?;

    Ok(Json(json!({
        "success": true,
        "totp_enabled": false,
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_in": tokens.expires_in,
        "token_type": tokens.token_type,
        "mfa_required": tokens.mfa_required,
    })))
}

/// Verify MFA code during login (when authenticator is enabled)
pub async fn mfa_verify(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(request): Json<MfaVerifyRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let device_id = request.device_id.unwrap_or_else(|| "web".to_string());
    let ip_address = request_ip(&headers);
    let user_agent = request_user_agent(&headers);

    let challenge = decode_mfa_challenge(&state.config.otp_signing_secret, &request.mfa_token)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if challenge.purpose != "mfa_login" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = Uuid::parse_str(&challenge.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let row = sqlx::query(
        "SELECT email, tenant_id, totp_secret, totp_enabled, status
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let status: String = row
        .try_get("status")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if status != "active" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let totp_enabled: bool = row.try_get("totp_enabled").unwrap_or(false);
    if !totp_enabled {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let secret_enc: Option<String> = row.try_get("totp_secret").ok().flatten();
    let secret_enc = secret_enc.ok_or(StatusCode::UNAUTHORIZED)?;

    let secret = EncryptedTotpSecret(secret_enc)
        .decrypt(&state.config.otp_signing_secret)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if !verify_totp_code(&secret, &request.code, None) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let email: String = row
        .try_get("email")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let tokens = issue_tokens_for_user(
        &state,
        user_id,
        tenant_id,
        &email,
        &device_id,
        &ip_address,
        user_agent,
        true,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_in": tokens.expires_in,
        "token_type": tokens.token_type,
        "mfa_required": tokens.mfa_required,
    })))
}

/// Send recovery OTP to recovery email when authenticator is lost
pub async fn mfa_recovery_send_otp(
    State(state): State<AuthState>,
    Json(request): Json<MfaRecoverySendRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let challenge = decode_mfa_challenge(&state.config.otp_signing_secret, &request.mfa_token)
        .ok_or_else(|| {
            velismail_common::AppError::Unauthorized("Invalid MFA challenge".to_string())
        })?;

    if challenge.purpose != "mfa_login" {
        return Err(velismail_common::AppError::Unauthorized(
            "Invalid challenge".to_string(),
        ));
    }

    let user_id =
        Uuid::parse_str(&challenge.sub).map_err(|_| velismail_common::AppError::Internal)?;

    let row = sqlx::query(
        "SELECT email, recovery_email, recovery_email_verified, display_name, totp_enabled
         FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?
    .ok_or_else(|| velismail_common::AppError::NotFound("User not found".to_string()))?;

    let totp_enabled: bool = row.try_get("totp_enabled").unwrap_or(false);
    if !totp_enabled {
        return Err(velismail_common::AppError::BadRequest(
            "Authenticator is not enabled for this account.".to_string(),
        ));
    }

    let recovery_email: Option<String> = row.try_get("recovery_email").ok().flatten();
    let recovery_verified: bool = row.try_get("recovery_email_verified").unwrap_or(false);
    let recovery_email = recovery_email.ok_or_else(|| {
        velismail_common::AppError::BadRequest(
            "No recovery email set. Cannot recover authenticator.".to_string(),
        )
    })?;

    if !recovery_verified {
        return Err(velismail_common::AppError::BadRequest(
            "Recovery email is not verified. Cannot recover authenticator.".to_string(),
        ));
    }

    let display_name: String = row
        .try_get("display_name")
        .map_err(|_| velismail_common::AppError::Internal)?;

    // Rate limit
    reserve_daily_otp_send(&state, &recovery_email, "mfa_recovery").await?;

    // Generate OTP
    let otp = velismail_crypto::random::generate_otp(6)
        .map_err(|_| velismail_common::AppError::Internal)?;
    let salt = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    let exp = now + state.config.otp_ttl_seconds;
    let otp_hash = hash_otp_value(
        &state.config.otp_signing_secret,
        &recovery_email,
        &otp,
        &salt,
        "mfa_recovery",
    );

    // Send OTP email
    send_otp_email(&state, &recovery_email, &display_name, &otp).await?;

    // Create challenge token for OTP verification
    let challenge_token = encode(
        &Header::default(),
        &OtpChallengeClaims {
            sub: recovery_email.clone(),
            purpose: "mfa_recovery".to_string(),
            salt,
            otp_hash,
            iat: now,
            exp,
        },
        &EncodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
    )
    .map_err(|_| velismail_common::AppError::Internal)?;

    Ok(Json(json!({
        "success": true,
        "challenge_token": challenge_token,
        "expires_in": state.config.otp_ttl_seconds,
        "masked_email": mask_email(&recovery_email),
    })))
}

/// Verify recovery OTP and generate new TOTP setup secret
pub async fn mfa_recovery_verify(
    State(state): State<AuthState>,
    Json(request): Json<MfaRecoveryVerifyRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let mfa_challenge = decode_mfa_challenge(&state.config.otp_signing_secret, &request.mfa_token)
        .ok_or_else(|| {
            velismail_common::AppError::Unauthorized("Invalid MFA challenge".to_string())
        })?;

    if mfa_challenge.purpose != "mfa_login" {
        return Err(velismail_common::AppError::Unauthorized(
            "Invalid challenge".to_string(),
        ));
    }

    let user_id =
        Uuid::parse_str(&mfa_challenge.sub).map_err(|_| velismail_common::AppError::Internal)?;

    // Verify OTP challenge
    let validation = Validation {
        validate_aud: false,
        leeway: 60,
        ..Default::default()
    };
    let otp_challenge = decode::<OtpChallengeClaims>(
        &request.challenge_token,
        &DecodingKey::from_secret(state.config.otp_signing_secret.as_bytes()),
        &validation,
    )
    .map_err(|_| {
        velismail_common::AppError::Unauthorized("Invalid or expired challenge".to_string())
    })?;

    if otp_challenge.claims.purpose != "mfa_recovery" {
        return Err(velismail_common::AppError::Unauthorized(
            "Invalid challenge purpose".to_string(),
        ));
    }

    // Verify OTP
    let expected_hash = hash_otp_value(
        &state.config.otp_signing_secret,
        &otp_challenge.claims.sub,
        &request.otp,
        &otp_challenge.claims.salt,
        "mfa_recovery",
    );

    if expected_hash != otp_challenge.claims.otp_hash {
        return Err(velismail_common::AppError::Unauthorized(
            "Invalid recovery code.".to_string(),
        ));
    }

    // Get user and recovery email
    let row = sqlx::query(
        "SELECT email, recovery_email, recovery_email_verified, totp_enabled
         FROM users WHERE id = $1 AND status = 'active'",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| velismail_common::AppError::Internal)?
    .ok_or_else(|| velismail_common::AppError::NotFound("User not found".to_string()))?;

    let recovery_email: Option<String> = row.try_get("recovery_email").ok().flatten();
    let recovery_verified: bool = row.try_get("recovery_email_verified").unwrap_or(false);
    let recovery_email = recovery_email.ok_or_else(|| {
        velismail_common::AppError::BadRequest("No recovery email set.".to_string())
    })?;

    if !recovery_verified || otp_challenge.claims.sub != recovery_email {
        return Err(velismail_common::AppError::Unauthorized(
            "Recovery email mismatch.".to_string(),
        ));
    }

    // Generate new TOTP secret (store as pending, keep old active until complete)
    let new_secret = generate_totp_secret().map_err(|_| velismail_common::AppError::Internal)?;
    let new_encrypted = EncryptedTotpSecret::new(&new_secret, &state.config.otp_signing_secret)
        .map_err(|_| velismail_common::AppError::Internal)?;

    sqlx::query("UPDATE users SET totp_pending_secret = $1, updated_at = NOW() WHERE id = $2")
        .bind(&new_encrypted.0)
        .bind(user_id)
        .execute(&state.db)
        .await
        .map_err(|_| velismail_common::AppError::Internal)?;

    // Create recovery completion token (10 min expiry)
    let recovery_token =
        create_recovery_token(&state.config.otp_signing_secret, &user_id.to_string(), 600)
            .map_err(|_| velismail_common::AppError::Internal)?;

    let email_for_uri: String = row
        .try_get("email")
        .map_err(|_| velismail_common::AppError::Internal)?;
    let otpauth_url = build_otpauth_uri(&new_secret, &email_for_uri, TOTP_ISSUER);

    Ok(Json(json!({
        "success": true,
        "recovery_token": recovery_token,
        "secret": new_secret,
        "otpauth_url": otpauth_url,
        "recovery_email": recovery_email,
    })))
}

/// Complete recovery - verify new TOTP code and activate new authenticator
pub async fn mfa_recovery_complete(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(request): Json<MfaRecoveryCompleteRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let device_id = request.device_id.unwrap_or_else(|| "web".to_string());
    let ip_address = request_ip(&headers);
    let user_agent = request_user_agent(&headers);

    let recovery_token =
        decode_recovery_token(&state.config.otp_signing_secret, &request.recovery_token)
            .ok_or(StatusCode::UNAUTHORIZED)?;

    if recovery_token.purpose != "mfa_recovery_replace" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = Uuid::parse_str(&recovery_token.sub).map_err(|_| StatusCode::UNAUTHORIZED)?;

    let row = sqlx::query(
        "SELECT email, tenant_id, totp_pending_secret, totp_enabled, status
         FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let status: String = row
        .try_get("status")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if status != "active" {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let pending_secret_enc: Option<String> = row.try_get("totp_pending_secret").ok().flatten();
    let pending_secret_enc = pending_secret_enc.ok_or(StatusCode::UNAUTHORIZED)?;

    let secret = EncryptedTotpSecret(pending_secret_enc.clone())
        .decrypt(&state.config.otp_signing_secret)
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if !verify_totp_code(&secret, &request.code, None) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Activate new secret
    sqlx::query(
        "UPDATE users SET totp_secret = $1, totp_pending_secret = NULL, totp_enabled = TRUE, totp_confirmed_at = NOW(), updated_at = NOW() WHERE id = $2",
    )
    .bind(&pending_secret_enc)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Revoke all old refresh tokens
    revoke_all_refresh_tokens(&state, user_id).await;

    // Issue new tokens with mfa_verified = true
    let email: String = row
        .try_get("email")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Uuid = row
        .try_get("tenant_id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let tokens = issue_tokens_for_user(
        &state,
        user_id,
        tenant_id,
        &email,
        &device_id,
        &ip_address,
        user_agent,
        true,
    )
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "access_token": tokens.access_token,
        "refresh_token": tokens.refresh_token,
        "expires_in": tokens.expires_in,
        "token_type": tokens.token_type,
        "mfa_required": tokens.mfa_required,
    })))
}

pub async fn get_current_user(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = claims.sub.0;

    let user = sqlx::query(
        "SELECT u.id, u.tenant_id, u.email, u.recovery_email, u.recovery_email_verified,
                u.display_name, u.status, u.totp_enabled,
                u.phone_country_code, u.phone_number, u.phone_e164, u.phone_verified,
                u.settings, u.created_at, u.updated_at, u.last_login,
                (SELECT cm.role FROM company_members cm
                 WHERE cm.tenant_id = u.tenant_id AND cm.email = u.email
                   AND cm.status = 'active'
                 LIMIT 1) AS company_role
         FROM users u
         WHERE u.id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await
    .map_err(|e| {
        tracing::error!("get_current_user query failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    let id: Uuid = user
        .try_get("id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let tenant_id: Option<Uuid> = user.try_get("tenant_id").ok();
    let email: String = user
        .try_get("email")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let recovery_email: Option<String> = user.try_get("recovery_email").ok();
    let recovery_email_verified: bool = user.try_get("recovery_email_verified").unwrap_or(false);
    let totp_enabled: bool = user.try_get("totp_enabled").unwrap_or(false);
    let phone_country_code: Option<String> = user.try_get("phone_country_code").ok().flatten();
    let phone_number: Option<String> = user.try_get("phone_number").ok().flatten();
    let phone_e164: Option<String> = user.try_get("phone_e164").ok().flatten();
    let phone_verified: bool = user.try_get("phone_verified").unwrap_or(false);
    let display_name: String = user
        .try_get("display_name")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let status: String = user
        .try_get("status")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut settings: serde_json::Value = user
        .try_get::<Option<serde_json::Value>, _>("settings")
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let company_role: Option<String> = user
        .try_get::<Option<String>, _>("company_role")
        .ok()
        .flatten();
    if let Some(role) = company_role.as_deref() {
        let client_role = match role {
            "owner" | "admin" => "admin",
            "viewer" => "viewer",
            "member" => "member",
            _ => "",
        };
        if !client_role.is_empty() {
            settings["role"] = json!(client_role);
            settings["companyRole"] = json!(role);
        }
    }
    let created_at: chrono::DateTime<chrono::Utc> = user
        .try_get("created_at")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let updated_at: chrono::DateTime<chrono::Utc> = user
        .try_get("updated_at")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let last_login: Option<chrono::DateTime<chrono::Utc>> = user.try_get("last_login").ok();

    // The control-plane switch is shown to platform staff. The gateway stays
    // authoritative - this only tells the client what to render.
    let firebase_uid = settings
        .get("firebaseUid")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let email_lower = email.to_lowercase();
    let is_platform_admin = firebase_uid
        .as_ref()
        .map(|uid| {
            state
                .config
                .platform_owner_uids
                .iter()
                .any(|allowed| allowed == uid)
        })
        .unwrap_or(false)
        || state.config.platform_owner_emails.contains(&email_lower)
        || sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS (SELECT 1 FROM platform_admins WHERE email = $1 AND status = 'active')",
        )
        .bind(&email)
        .fetch_one(&state.db)
        .await
        .unwrap_or(false);

    Ok(Json(json!({
        "success": true,
        "user": {
            "id": id,
            "tenant_id": tenant_id,
            "email": email,
            "recovery_email": recovery_email,
            "recovery_email_verified": recovery_email_verified,
            "totp_enabled": totp_enabled,
            "phone_country_code": phone_country_code,
            "phone_number": phone_number,
            "phone_e164": phone_e164,
            "phone_verified": phone_verified,
            "display_name": display_name,
            "status": status,
            "settings": settings,
            "created_at": created_at,
            "updated_at": updated_at,
            "last_login": last_login,
            "firebase_uid": firebase_uid,
            "is_platform_admin": is_platform_admin,
        }
    })))
}

/// The account settings a client may change on its own.
///
/// The role, the platform flag, the plan and the tenant belong to the
/// platform. A browser that could write them would be able to promote itself
/// to a platform administrator, so they are never taken from the request.
const WRITABLE_SETTINGS: &[&str] = &[
    "displayName",
    "profileImageUrl",
    "emailLogoUrl",
    "recoveryEmail",
    "recoveryEmailVerified",
    "pendingRecoveryEmail",
    "businessProfile",
    "businessDbUrl",
    "businessApiKey",
    "businessMailProvider",
    "businessMailProviderEndpoint",
    "businessMailWebhookSecret",
    "businessDomain",
    "businessDomainVerified",
    "businessMailboxAddress",
    "isBusinessSetupComplete",
    "dkimStatus",
    "spfStatus",
    "dmarcStatus",
    "customDomain",
    "mailProvider",
    "mailProviderEndpoint",
    "apiKey",
    "isSetupComplete",
];

pub async fn update_account(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user_id = claims.sub.0;

    // Only the known settings are written. Everything else in the request is
    // dropped instead of being merged into the account.
    let allowed = request
        .as_object()
        .ok_or(StatusCode::BAD_REQUEST)?
        .iter()
        .filter(|(key, _)| WRITABLE_SETTINGS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect::<serde_json::Map<String, serde_json::Value>>();
    if allowed.is_empty() {
        return Ok(Json(json!({
            "success": true,
            "message": "Nothing to update."
        })));
    }
    let settings_json = serde_json::to_string(&serde_json::Value::Object(allowed))
        .unwrap_or_else(|_| "{}".to_string());

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
        tracing::error!(
            "revoke_other_sessions failed for user {}: {}",
            claims.sub.0,
            err
        );
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

#[derive(Debug, Deserialize)]
pub struct TrustDeviceRequest {
    pub device_id: Uuid,
}

pub async fn register_device(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    Json(req): Json<DeviceRegisterRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let device_id = Uuid::new_v4();
    let user_id = claims.sub.0;

    sqlx::query(
        r#"INSERT INTO devices
           (id, user_id, device_name, platform, browser, os, fingerprint, is_trusted)
           VALUES ($1, $2, $3, $4, $5, $6, $7, false)"#,
    )
    .bind(device_id)
    .bind(user_id)
    .bind(&req.device_name)
    .bind(&req.platform)
    .bind(&req.browser)
    .bind(req.os)
    .bind(device_id.to_string())
    .execute(&state.db)
    .await?;

    Ok(Json(json!({
        "success": true,
        "device_id": device_id.to_string()
    })))
}

pub async fn trust_device(
    State(state): State<AuthState>,
    Extension(claims): Extension<velismail_common::Claims>,
    Json(req): Json<TrustDeviceRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let user_id = claims.sub.0;

    // Verify device belongs to authenticated user
    let row = sqlx::query("SELECT id FROM devices WHERE id = $1 AND user_id = $2")
        .bind(req.device_id)
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

    let Some(_) = row else {
        return Err(velismail_common::AppError::Forbidden(
            "Device not registered to user".to_string(),
        ));
    };

    // Update is_trusted = true
    sqlx::query("UPDATE devices SET is_trusted = true, last_seen = NOW() WHERE id = $1")
        .bind(req.device_id)
        .execute(&state.db)
        .await?;

    // Log trust event in audit trail
    tracing::info!(
        target: "audit_trail",
        user_id = %user_id,
        device_id = %req.device_id,
        "Device marked as trusted by user"
    );

    Ok(Json(json!({
        "success": true,
        "message": "Device trusted"
    })))
}

#[derive(Debug, Deserialize)]
pub struct FeedbackPayload {
    pub name: String,
    pub email: String,
    pub r#type: String,
    pub message: String,
}

pub async fn feedback(
    State(state): State<AuthState>,
    Json(payload): Json<FeedbackPayload>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    if payload.name.trim().is_empty()
        || payload.email.trim().is_empty()
        || payload.message.trim().is_empty()
    {
        return Err(velismail_common::AppError::BadRequest(
            "Name, email, and message are required".to_string(),
        ));
    }

    let support_email = "support@velismail.online";
    let text_body = format!(
        "New Feedback Submission from VelisMail App\n\n\
         Name: {}\n\
         Email: {}\n\
         Type: {}\n\n\
         Message:\n{}\n",
        payload.name.trim(),
        payload.email.trim(),
        payload.r#type.trim(),
        payload.message.trim()
    );

    let subject = format!("[Feedback] {} from {}", payload.r#type, payload.name);

    let message = EmailMessage {
        from: state.config.otp_from_email.clone(),
        from_name: Some(state.config.otp_from_name.clone()),
        to: vec![support_email.to_string()],
        subject,
        text: text_body,
        ..EmailMessage::default()
    };

    state.email_client.send(&message).await.map_err(|err| {
        tracing::error!("feedback delivery failed: {}", err);
        velismail_common::AppError::MailDelivery(err.to_string())
    })?;

    Ok(Json(json!({
        "success": true,
        "message": "Feedback submitted successfully"
    })))
}

// ---------------------------------------------------------------------------
// Firebase / Google sign-in
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirebaseLoginRequest {
    pub id_token: String,
    pub device_id: Option<String>,
    pub tenant_slug: Option<String>,
}

async fn verify_firebase_id_token(
    state: &AuthState,
    id_token: &str,
) -> Result<serde_json::Value, StatusCode> {
    let api_key = state
        .config
        .firebase_web_api_key
        .as_deref()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE)?;
    let url = format!(
        "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={}",
        api_key
    );
    let response = reqwest::Client::new()
        .post(url)
        .json(&json!({ "idToken": id_token }))
        .send()
        .await
        .map_err(|err| {
            tracing::error!("firebase token verification failed: {}", err);
            StatusCode::BAD_GATEWAY
        })?;
    if !response.status().is_success() {
        tracing::warn!(
            "firebase rejected an ID token with status {}",
            response.status()
        );
        return Err(StatusCode::UNAUTHORIZED);
    }
    let body: serde_json::Value = response.json().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    body.get("users")
        .and_then(|users| users.get(0))
        .cloned()
        .ok_or(StatusCode::UNAUTHORIZED)
}

pub async fn firebase_login(
    State(state): State<AuthState>,
    headers: HeaderMap,
    Json(request): Json<FirebaseLoginRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let id_token = request.id_token.trim();
    if id_token.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let identity = verify_firebase_id_token(&state, id_token).await?;
    let firebase_uid = identity
        .get("localId")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    let email = identity
        .get("email")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    if firebase_uid.is_empty() || email.is_empty() || !email.contains('@') {
        return Err(StatusCode::BAD_REQUEST);
    }

    let display_name = identity
        .get("displayName")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            email
                .split('@')
                .next()
                .unwrap_or("VelisMail user")
                .to_string()
        });
    let photo_url = identity
        .get("photoUrl")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let email_verified = identity
        .get("emailVerified")
        .and_then(|value| value.as_bool())
        .unwrap_or(true);
    if !email_verified {
        return Err(StatusCode::FORBIDDEN);
    }

    // Resolve (or provision) the company workspace for this email domain.
    let tenant_id: Uuid = resolve_or_create_tenant(&state, &email, "google").await?;

    let existing = sqlx::query(
        "SELECT id, email, display_name, status, settings
         FROM users
         WHERE email = $1 OR settings->>'firebaseUid' = $2
         LIMIT 1",
    )
    .bind(&email)
    .bind(&firebase_uid)
    .fetch_optional(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (user_id, user_status): (Uuid, String) = if let Some(row) = existing {
        let id: Uuid = row
            .try_get("id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let status: String = row
            .try_get("status")
            .unwrap_or_else(|_| "active".to_string());
        if status != "active" {
            return Err(StatusCode::FORBIDDEN);
        }
        let stored_name: String = row.try_get("display_name").unwrap_or_default();
        sqlx::query(
            "UPDATE users
             SET tenant_id = $1,
                 display_name = CASE WHEN $2 = '' THEN display_name ELSE $2 END,
                 settings = COALESCE(settings, '{}'::jsonb)
                            || jsonb_build_object('firebaseUid', $3, 'authProvider', 'google',
                                                  'profileImageUrl', COALESCE($4, settings->>'profileImageUrl')),
                 last_login = NOW(),
                 updated_at = NOW()
             WHERE id = $5",
        )
        .bind(tenant_id)
        .bind(if stored_name.trim().is_empty() {
            display_name.as_str()
        } else {
            ""
        })
        .bind(&firebase_uid)
        .bind(&photo_url)
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        (id, status)
    } else {
        let member_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE tenant_id = $1")
                .bind(tenant_id)
                .fetch_one(&state.db)
                .await
                .unwrap_or(0);
        let role = if member_count == 0 { "admin" } else { "member" };
        let settings = json!({
            "firebaseUid": firebase_uid,
            "authProvider": "google",
            "role": role,
            "plan": "Free",
            "billingCycle": "monthly",
            "accountType": "business",
            "isSetupComplete": false,
            "emailVerified": email_verified,
            "profileImageUrl": photo_url,
        });
        let row = sqlx::query(
            "INSERT INTO users (tenant_id, email, display_name, status, password_hash, settings, last_login)
             VALUES ($1, $2, $3, 'active', NULL, $4, NOW())
             RETURNING id",
        )
        .bind(tenant_id)
        .bind(&email)
        .bind(&display_name)
        .bind(&settings)
        .fetch_one(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let id: Uuid = row
            .try_get("id")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        (id, "active".to_string())
    };

    // Keep the normalized company membership tables in sync.
    //
    // The workspace role comes from an explicit membership row (an invitation
    // or the company console) or from the account that created the
    // workspace. It is never derived from the email domain or from
    // client-supplied settings, otherwise anybody holding a mail address on a
    // company domain would silently join that workspace as an administrator.
    let member_role = sqlx::query_scalar::<_, String>(
        "SELECT COALESCE(
             (SELECT cm.role FROM company_members cm
               WHERE cm.tenant_id = $1
                 AND LOWER(cm.email) = LOWER($3)
                 AND cm.status = 'active'),
             CASE WHEN (SELECT COUNT(*) FROM users WHERE tenant_id = $1) <= 1 THEN 'admin' ELSE 'member' END
         )
         FROM users WHERE id = $2",
    )
    .bind(tenant_id)
    .bind(user_id)
    .bind(&email)
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| "member".to_string());
    sync_company_membership(
        &state,
        tenant_id,
        user_id,
        &email,
        &display_name,
        &member_role,
    )
    .await;

    // Check if user has TOTP enabled - if so, require MFA challenge
    let totp_row = sqlx::query(
        "SELECT totp_enabled, recovery_email, recovery_email_verified FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let totp_enabled: bool = totp_row.try_get("totp_enabled").unwrap_or(false);
    if totp_enabled {
        let mfa_token = create_mfa_challenge(
            &state.config.otp_signing_secret,
            &user_id.to_string(),
            "mfa_login",
            300,
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        let recovery_email: Option<String> = totp_row.try_get("recovery_email").ok().flatten();
        let recovery_verified: bool = totp_row.try_get("recovery_email_verified").unwrap_or(false);
        let recovery_email_masked = recovery_email
            .filter(|_| recovery_verified)
            .map(|e| mask_email(&e));

        return Ok(Json(json!({
            "success": true,
            "mfa_required": true,
            "mfa_token": mfa_token,
            "recovery_email_masked": recovery_email_masked,
        })));
    }

    let device_id = request
        .device_id
        .unwrap_or_else(|| format!("firebase-{firebase_uid}"));
    let access_token = state
        .jwt_manager
        .generate_access_token_with_identity(
            UserId(user_id),
            &tenant_id.to_string(),
            &email,
            UserRole::User,
            &device_id,
            email_verified,
            Some(firebase_uid.clone()),
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let refresh_token = crate::jwt::JwtManager::generate_refresh_token()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token_hash = crate::jwt::JwtManager::hash_refresh_token(&refresh_token);
    let expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.refresh_token_expiry_days);
    let ip_address = request_ip(&headers);
    let user_agent = request_user_agent(&headers);

    let _ = sqlx::query(
        "INSERT INTO refresh_tokens (user_id, token_hash, device_id, device_fingerprint, expires_at, ip_address, mfa_verified)
         VALUES ($1, $2, $3, $4, $5, $6::inet, $7)",
    )
    .bind(user_id)
    .bind(&token_hash)
    .bind(&device_id)
    .bind(&device_id)
    .bind(expires_at)
    .bind(&ip_address)
    .bind(false) // mfa_verified = false for Google login without TOTP
    .execute(&state.db)
    .await;

    let session_expires_at =
        chrono::Utc::now() + chrono::Duration::days(state.config.refresh_token_expiry_days);
    let _ = sqlx::query(
        "INSERT INTO sessions (user_id, tenant_id, device_fingerprint, ip_address, user_agent, expires_at, mfa_verified)
         VALUES ($1, $2, $3, $4::inet, $5, $6, $7)",
    )
    .bind(user_id)
    .bind(tenant_id.to_string())
    .bind(&device_id)
    .bind(&ip_address)
    .bind(&user_agent)
    .bind(session_expires_at)
    .bind(false) // mfa_verified = false
    .execute(&state.db)
    .await;

    Ok(Json(json!({
        "success": true,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": state.config.jwt_expiry_seconds,
        "token_type": "Bearer",
        "mfa_required": false,
        "user": {
            "id": user_id,
            "tenant_id": tenant_id,
            "email": email,
            "display_name": display_name,
            "firebase_uid": firebase_uid,
            "status": user_status,
            "auth_provider": "google"
        }
    })))
}
