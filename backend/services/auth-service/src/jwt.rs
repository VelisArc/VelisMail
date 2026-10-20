//! JWT token management

use anyhow::Result;
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use velismail_common::{Claims, SecurityLevel, UserId, UserRole};

pub struct JwtManager {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    expiry_seconds: i64,
}

impl JwtManager {
    pub fn new(secret: &str, expiry_seconds: i64) -> Result<Self> {
        Ok(Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            expiry_seconds,
        })
    }

    pub fn generate_access_token(
        &self,
        user_id: UserId,
        tenant_id: &str,
        email: &str,
        role: UserRole,
        device_id: &str,
        mfa_verified: bool,
    ) -> Result<String> {
        let now = Utc::now();
        let claims = Claims {
            sub: user_id.clone(),
            tenant_id: tenant_id.to_string(),
            email: email.to_string(),
            iat: now.timestamp(),
            exp: (now + chrono::Duration::seconds(self.expiry_seconds)).timestamp(),
            nbf: now.timestamp(),
            jti: uuid::Uuid::new_v4().to_string(),
            role,
            mfa_verified,
            device_id: device_id.to_string(),
            security_level: if mfa_verified {
                SecurityLevel::High
            } else {
                SecurityLevel::Standard
            },
        };

        Ok(encode(&Header::default(), &claims, &self.encoding_key)?)
    }

    pub fn validate_token(&self, token: &str) -> Result<Claims> {
        let validation = Validation {
            validate_aud: false,
            ..Default::default()
        };
        let data = decode::<Claims>(token, &self.decoding_key, &validation)?;
        Ok(data.claims)
    }

    pub fn generate_refresh_token() -> Result<String> {
        use velismail_crypto::random::random_token;
        random_token(64)
    }

    pub fn hash_refresh_token(token: &str) -> String {
        use ring::digest::{digest, SHA256};
        let d = digest(&SHA256, token.as_bytes());
        hex::encode(d.as_ref())
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenPairResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
    pub mfa_required: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guards against jsonwebtoken being built without a crypto provider. If
    /// neither the `aws_lc_rs` nor `rust_crypto` feature is enabled, signing
    /// panics at runtime inside a request handler instead of failing at build
    /// time, which previously surfaced as a 502 on `/auth/login`.
    #[test]
    fn access_tokens_round_trip() {
        let manager =
            JwtManager::new("test-secret-at-least-32-bytes-long", 3600).expect("create JwtManager");
        let user_id = UserId(uuid::Uuid::new_v4());
        let token = manager
            .generate_access_token(
                user_id.clone(),
                "00000000-0000-0000-0000-000000000000",
                "test@example.com",
                UserRole::User,
                "test-device",
                false,
            )
            .expect("sign access token");
        let claims = manager.validate_token(&token).expect("verify access token");
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, "test@example.com");
    }
}
