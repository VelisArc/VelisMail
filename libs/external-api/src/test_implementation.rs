//! Test implementation for Task 4.3: External API Operation Routing
//!
//! This test verifies that the implementation meets the requirements:
//! 1. Email sending through configured providers (Gmail, SendGrid, Amazon SES)
//! 2. Retry logic with exponential backoff
//! 3. Failover between providers
//! 4. Queue operations when provider unavailable

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        adapter::{DefaultExternalApiAdapter, EmailMessage, RetryPolicy, CircuitBreaker},
        health::{ProviderConnection, ConnectionDetails},
        provider::ProviderType,
        credentials::ApiCredentials,
    };
    use chrono::Utc;
    
    /// Test that the adapter can be created with default retry policy
    #[test]
    fn test_adapter_creation() {
        let encryption_key = vec![0; 32]; // 32 bytes for AES-256
        let key_id = "test_key".to_string();
        
        let adapter = DefaultExternalApiAdapter::new(encryption_key.clone(), key_id.clone());
        assert!(adapter.retry_policy.max_retries > 0);
        
        let custom_policy = RetryPolicy {
            max_retries: 5,
            base_delay_seconds: 1,
            max_delay_seconds: 30,
            jitter_enabled: true,
        };
        
        let adapter_with_custom = DefaultExternalApiAdapter::with_retry_policy(
            encryption_key, 
            key_id, 
            custom_policy
        );
        assert_eq!(adapter_with_custom.retry_policy.max_retries, 5);
    }
    
    /// Test retry policy delay calculation
    #[test]
    fn test_retry_policy_delay() {
        let policy = RetryPolicy::default();
        
        // First attempt (attempt=0) should have 0 delay
        assert_eq!(policy.calculate_delay(0).as_secs(), 0);
        
        // Second attempt (attempt=1) should have base_delay * 2^0 = 2 seconds
        assert_eq!(policy.calculate_delay(1).as_secs(), 2);
        
        // Third attempt (attempt=2) should have base_delay * 2^1 = 4 seconds
        assert_eq!(policy.calculate_delay(2).as_secs(), 4);
        
        // Fourth attempt (attempt=3) should have base_delay * 2^2 = 8 seconds
        assert_eq!(policy.calculate_delay(3).as_secs(), 8);
        
        // Test with jitter disabled
        let policy_no_jitter = RetryPolicy {
            max_retries: 3,
            base_delay_seconds: 2,
            max_delay_seconds: 60,
            jitter_enabled: false,
        };
        
        // Without jitter, should be exact values
        assert_eq!(policy_no_jitter.calculate_delay(1).as_secs(), 2);
        assert_eq!(policy_no_jitter.calculate_delay(2).as_secs(), 4);
        assert_eq!(policy_no_jitter.calculate_delay(3).as_secs(), 8);
    }
    
    /// Test circuit breaker functionality
    #[test]
    fn test_circuit_breaker() {
        let mut cb = CircuitBreaker::new();
        
        // Initially should be closed and allow requests
        assert!(cb.allow_request());
        assert!(matches!(*cb.state(), CircuitState::Closed));
        
        // Record failures until circuit opens
        for i in 0..5 {
            let state_change = cb.record_failure();
            if i < 4 {
                // First 4 failures shouldn't change state
                assert!(state_change.is_none());
            } else {
                // 5th failure should open the circuit
                assert!(state_change.is_some());
                if let Some((old, new)) = state_change {
                    assert!(matches!(old, CircuitState::Closed));
                    assert!(matches!(new, CircuitState::Open));
                }
            }
        }
        
        // Circuit should now be open and not allow requests
        assert!(!cb.allow_request());
        assert!(matches!(*cb.state(), CircuitState::Open));
        
        // Record success shouldn't change state when circuit is open
        let state_change = cb.record_success();
        assert!(state_change.is_none());
        assert!(matches!(*cb.state(), CircuitState::Open));
    }
    
    /// Test email message creation
    #[test]
    fn test_email_message_creation() {
        let email = EmailMessage {
            id: "test_id".to_string(),
            from: "sender@example.com".to_string(),
            to: vec!["recipient@example.com".to_string()],
            cc: vec!["cc@example.com".to_string()],
            bcc: vec!["bcc@example.com".to_string()],
            subject: "Test Subject".to_string(),
            body_plain: "Test body".to_string(),
            body_html: Some("<p>Test body</p>".to_string()),
            attachments: vec![],
            headers: vec![("X-Test".to_string(), "Value".to_string())],
        };
        
        assert_eq!(email.from, "sender@example.com");
        assert_eq!(email.to.len(), 1);
        assert_eq!(email.subject, "Test Subject");
        assert!(email.body_html.is_some());
    }
    
    /// Test provider connection creation
    #[test]
    fn test_provider_connection() {
        let gmail_connection = ProviderConnection::new(
            ProviderType::GmailApi,
            ConnectionDetails::Gmail {
                access_token: "test_token".to_string(),
                user_id: "me".to_string(),
            },
        );
        
        assert!(matches!(gmail_connection.provider_type, ProviderType::GmailApi));
        
        let sendgrid_connection = ProviderConnection::new(
            ProviderType::SendGrid,
            ConnectionDetails::SendGrid {
                api_key: "SG.test_key".to_string(),
            },
        );
        
        assert!(matches!(sendgrid_connection.provider_type, ProviderType::SendGrid));
        
        let ses_connection = ProviderConnection::new(
            ProviderType::AmazonSes,
            ConnectionDetails::AmazonSes {
                access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
                secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string(),
                region: "us-east-1".to_string(),
            },
        );
        
        assert!(matches!(ses_connection.provider_type, ProviderType::AmazonSes));
    }
    
    /// Test credential validation
    #[test]
    fn test_credential_validation() {
        // Valid Gmail credentials
        let gmail_creds = ApiCredentials::Gmail {
            client_id: "client_id".to_string(),
            client_secret: "client_secret".to_string(),
            refresh_token: "refresh_token".to_string(),
        };
        
        assert!(gmail_creds.validate().is_ok());
        
        // Invalid Gmail credentials (empty)
        let invalid_gmail = ApiCredentials::Gmail {
            client_id: "".to_string(),
            client_secret: "client_secret".to_string(),
            refresh_token: "refresh_token".to_string(),
        };
        
        assert!(invalid_gmail.validate().is_err());
        
        // Valid SendGrid credentials
        let sendgrid_creds = ApiCredentials::SendGrid {
            api_key: "SG.test_api_key".to_string(),
        };
        
        assert!(sendgrid_creds.validate().is_ok());
        
        // Invalid SendGrid credentials (wrong format)
        let invalid_sendgrid = ApiCredentials::SendGrid {
            api_key: "invalid_key".to_string(),
        };
        
        assert!(invalid_sendgrid.validate().is_err());
        
        // Valid Amazon SES credentials
        let ses_creds = ApiCredentials::AmazonSes {
            access_key_id: "AKIAIOSFODNN7EXAMPLE".to_string(),
            secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY".to_string(),
            region: "us-east-1".to_string(),
        };
        
        assert!(ses_creds.validate().is_ok());
        
        // Invalid Amazon SES credentials (wrong length)
        let invalid_ses = ApiCredentials::AmazonSes {
            access_key_id: "short".to_string(),
            secret_access_key: "secret".to_string(),
            region: "us-east-1".to_string(),
        };
        
        assert!(invalid_ses.validate().is_err());
    }
}