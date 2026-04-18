//! Tests for authentication types

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    use chrono::{Utc, Duration};

    #[test]
    fn test_claims_creation() {
        let user_id = UserId(Uuid::new_v4());
        let now = Utc::now();
        
        let claims = Claims {
            sub: user_id.clone(),
            tenant_id: "tenant-123".to_string(),
            email: "user@example.com".to_string(),
            iat: now.timestamp(),
            exp: (now + Duration::hours(1)).timestamp(),
            nbf: now.timestamp(),
            jti: Uuid::new_v4().to_string(),
            role: UserRole::User,
            mfa_verified: true,
            device_id: "device-123".to_string(),
            security_level: SecurityLevel::High,
        };
        
        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.email, "user@example.com");
        assert_eq!(claims.role, UserRole::User);
        assert!(claims.mfa_verified);
        assert_eq!(claims.security_level, SecurityLevel::High);
    }

    #[test]
    fn test_user_role_ordering() {
        use UserRole::*;
        
        // Test equality
        assert_eq!(User, User);
        assert_ne!(User, Admin);
        
        // Test pattern matching
        match UserRole::SuperAdmin {
            SuperAdmin => assert!(true),
            _ => assert!(false),
        }
    }

    #[test]
    fn test_security_level_ordering() {
        use SecurityLevel::*;
        
        assert!(Low < Standard);
        assert!(Standard < High);
        assert!(High < Maximum);
        assert_eq!(Low, Low);
        assert_ne!(Low, Maximum);
    }

    #[test]
    fn test_session_creation() {
        let session_id = Uuid::new_v4();
        let user_id = UserId(Uuid::new_v4());
        let now = Utc::now();
        
        let session = Session {
            session_id,
            user_id: user_id.clone(),
            tenant_id: "tenant-123".to_string(),
            device_fingerprint: "fingerprint-123".to_string(),
            ip_address: "192.168.1.1".to_string(),
            user_agent: Some("Mozilla/5.0".to_string()),
            created_at: now,
            expires_at: now + Duration::hours(24),
            last_active: now,
            is_active: true,
            mfa_verified: false,
        };
        
        assert_eq!(session.user_id, user_id);
        assert!(session.is_active);
        assert!(!session.mfa_verified);
    }

    #[test]
    fn test_device_fingerprint() {
        let device_id = Uuid::new_v4();
        let user_id = UserId(Uuid::new_v4());
        let now = Utc::now();
        
        let fingerprint = DeviceFingerprint {
            device_id,
            user_id: user_id.clone(),
            platform: "Windows".to_string(),
            browser: "Chrome".to_string(),
            os: "Windows 10".to_string(),
            is_trusted: true,
            registered_at: now,
            last_seen: now,
        };
        
        assert_eq!(fingerprint.user_id, user_id);
        assert!(fingerprint.is_trusted);
        assert_eq!(fingerprint.platform, "Windows");
    }

    #[test]
    fn test_token_pair() {
        let token_pair = TokenPair {
            access_token: "access-token-123".to_string(),
            refresh_token: "refresh-token-123".to_string(),
            expires_in: 3600,
            token_type: "Bearer".to_string(),
        };
        
        assert_eq!(token_pair.access_token, "access-token-123");
        assert_eq!(token_pair.refresh_token, "refresh-token-123");
        assert_eq!(token_pair.expires_in, 3600);
        assert_eq!(token_pair.token_type, "Bearer");
    }

    #[test]
    fn test_passkey_register_request_serialization() {
        let request = PasskeyRegisterRequest {
            email: "user@example.com".to_string(),
            display_name: "User Name".to_string(),
            public_key: vec![1, 2, 3, 4],
            credential_id: vec![5, 6, 7, 8],
            device_info: DeviceInfo {
                platform: "Windows".to_string(),
                browser: "Chrome".to_string(),
                os: "Windows 10".to_string(),
                has_tpm: true,
                has_secure_enclave: false,
            },
        };
        
        // Test serialization
        let json = serde_json::to_string(&request).unwrap();
        let parsed: PasskeyRegisterRequest = serde_json::from_str(&json).unwrap();
        
        assert_eq!(parsed.email, "user@example.com");
        assert_eq!(parsed.display_name, "User Name");
    }
}