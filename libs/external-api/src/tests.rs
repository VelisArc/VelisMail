//! Tests for external API adapter component

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prelude::*;
    use chrono::Utc;

    /// Test credential validation for Gmail API
    #[test]
    fn test_gmail_credential_validation() {
        let valid_credentials = ApiCredentials::Gmail {
            client_id: "test_client_id".to_string(),
            client_secret: "test_client_secret".to_string(),
            refresh_token: "test_refresh_token".to_string(),
        };

        assert!(valid_credentials.validate().is_ok());

        let invalid_credentials = ApiCredentials::Gmail {
            client_id: "".to_string(),
            client_secret: "test_client_secret".to_string(),
            refresh_token: "test_refresh_token".to_string(),
        };

        assert!(invalid_credentials.validate().is_err());
    }

    /// Test credential validation for SendGrid
    #[test]
    fn test_sendgrid_credential_validation() {
        let valid_credentials = ApiCredentials::SendGrid {
            api_key: "SG.test_api_key".to_string(),
        };

        assert!(valid_credentials.validate().is_ok());

        let invalid_credentials = ApiCredentials::SendGrid {
            api_key: "".to_string(),
        };

        assert!(invalid_credentials.validate().is_err());
    }

    /// Test credential validation for Amazon SES
    #[test]
    fn test_ses_credential_validation() {
        let valid_credentials = ApiCredentials::AmazonSes {
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string(),
            region: "us-east-1".to_string(),
        };

        assert!(valid_credentials.validate().is_ok());

        let invalid_credentials = ApiCredentials::AmazonSes {
            access_key_id: "".to_string(),
            secret_access_key: "test".to_string(),
            region: "us-east-1".to_string(),
        };

        assert!(invalid_credentials.validate().is_err());
    }

    /// Test provider entity creation and usage tracking
    #[test]
    fn test_provider_entity() {
        let tenant_id = uuid::Uuid::new_v4();
        let provider_type = ProviderType::GmailApi;
        let credentials = EncryptedCredentials {
            encrypted_data: "test".to_string(),
            algorithm: "AES-256-GCM".to_string(),
            key_id: "test_key".to_string(),
            iv: None,
        };

        let mut provider = ExternalApiProvider::new(
            tenant_id,
            provider_type,
            credentials,
            1,    // priority
            1000, // daily limit
        );

        assert_eq!(provider.used_today, 0);
        assert!(provider.has_capacity());
        assert_eq!(provider.remaining_capacity(), 1000);

        provider.record_usage();
        assert_eq!(provider.used_today, 1);
        assert_eq!(provider.remaining_capacity(), 999);

        assert!(provider.is_usable());
    }

    /// Test provider capacity limits
    #[test]
    fn test_provider_capacity() {
        let tenant_id = uuid::Uuid::new_v4();
        let provider = ExternalApiProvider {
            id: uuid::Uuid::new_v4(),
            tenant_id,
            provider_type: ProviderType::SendGrid,
            credentials: EncryptedCredentials {
                encrypted_data: "test".to_string(),
                algorithm: "AES-256-GCM".to_string(),
                key_id: "test_key".to_string(),
                iv: None,
            },
            status: ProviderStatus::Active,
            priority: 1,
            daily_limit: 5,
            used_today: 5,
            last_used: None,
            failure_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        assert!(!provider.has_capacity());
        assert_eq!(provider.remaining_capacity(), 0);
        assert!(!provider.is_usable());
    }

    /// Test provider failure tracking
    #[test]
    fn test_provider_failure_tracking() {
        let tenant_id = uuid::Uuid::new_v4();
        let mut provider = ExternalApiProvider {
            id: uuid::Uuid::new_v4(),
            tenant_id,
            provider_type: ProviderType::AmazonSes,
            credentials: EncryptedCredentials {
                encrypted_data: "test".to_string(),
                algorithm: "AES-256-GCM".to_string(),
                key_id: "test_key".to_string(),
                iv: None,
            },
            status: ProviderStatus::Active,
            priority: 1,
            daily_limit: 100,
            used_today: 0,
            last_used: None,
            failure_count: 0,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        assert_eq!(provider.failure_count, 0);
        assert!(matches!(provider.status, ProviderStatus::Active));

        // Record failures
        for i in 0..5 {
            provider.record_failure();
            assert_eq!(provider.failure_count, i + 1);
        }

        // After 5 failures, should be marked as unavailable
        assert!(matches!(provider.status, ProviderStatus::Unavailable));

        // Reset failures
        provider.reset_failures();
        assert_eq!(provider.failure_count, 0);
        assert!(matches!(provider.status, ProviderStatus::Active));
    }

    /// Test health status
    #[test]
    fn test_health_status() {
        let healthy = HealthStatus::healthy(100);
        assert!(healthy.is_healthy());
        assert!(healthy.is_available());

        let unhealthy = HealthStatus::unhealthy("Test error".to_string());
        assert!(!unhealthy.is_healthy());
        assert!(!unhealthy.is_available());

        let rate_limited = HealthStatus::rate_limited(Utc::now() + chrono::Duration::minutes(1));
        assert!(!rate_limited.is_healthy());
        assert!(!rate_limited.is_available());
        assert!(rate_limited.rate_limited);
    }

    /// Test provider type capabilities
    #[test]
    fn test_provider_type_capabilities() {
        assert!(ProviderType::GmailApi.supports_receiving());
        assert!(ProviderType::GmailApi.supports_webhooks());

        assert!(!ProviderType::SendGrid.supports_receiving());
        assert!(ProviderType::SendGrid.supports_webhooks());

        assert!(ProviderType::AmazonSes.supports_receiving());
        assert!(ProviderType::AmazonSes.supports_webhooks());
    }
}
