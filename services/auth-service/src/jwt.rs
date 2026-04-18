//! JWT token management

use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey};
use serde::{Deserialize, Serialize};
use chrono::Utc;
use anyhow::Result;
use velismail_common::{Claims, UserId, UserRole, SecurityLevel};

/// JWT token manager
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

    /// Generate access token
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
            sub: user_id,
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

        let token = encode(&Header::default(), &claims, &self.encoding_key)?;
        Ok(token)
    }

    /// Validate and decode access token
    pub fn validate_token(&self, token: &str) -> Result<Claims> {
        let token_data = decode::<Claims>(
            token,
            &self.decoding_key,
            &Validation::default(),
        )?;

        Ok(token_data.claims)
    }

    /// Generate refresh token (random string, stored in DB)
    pub fn generate_refresh_token() -> Result<String> {
        use velismail_crypto::random::random_token;
        random_token(64)
    }

    /// Hash refresh token for storage
    pub fn hash_refresh_token(token: &str) -> String {
        use ring::digest::{digest, SHA256};
        let digest = digest(&SHA256, token.as_bytes());
        hex::encode(digest.as_ref())
    }
}

/// Token pair response
#[derive(Debug, Serialize, Deserialize)]
pub struct TokenPairResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub token_type: String,
}

// Need hex crate - add to workspace
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_generation() {
        let manager = JwtManager::new("test-secret", 3600).unwrap();
        let user_id = UserId(uuid::Uuid::new_v4());

        let token = manager.generate_access_token(
            user_id,
            "tenant-123",
            "user@example.com",
            UserRole::User,
            "device-123",
            true,
        ).unwrap();

        let claims = manager.validate_token(&token).unwrap();
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, "user@example.com");
        assert!(claims.mfa_verified);
    }
}
