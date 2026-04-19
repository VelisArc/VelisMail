//! Secure credential storage and validation
//!
//! Provides encrypted credential storage and validation functions
//! for external API providers.

use crate::error::ExternalApiError;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

/// API credentials for external providers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ApiCredentials {
    /// Gmail API OAuth2 credentials
    Gmail {
        client_id: String,
        client_secret: String,
        refresh_token: String,
    },
    /// SendGrid API key
    SendGrid { api_key: String },
    /// Amazon SES credentials
    AmazonSes {
        access_key_id: String,
        secret_access_key: String,
        region: String,
    },
}

impl ApiCredentials {
    /// Validate the credentials for the given provider type
    pub fn validate(&self) -> Result<(), ExternalApiError> {
        match self {
            ApiCredentials::Gmail {
                client_id,
                client_secret,
                refresh_token,
            } => {
                if client_id.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "Gmail client_id cannot be empty".into(),
                    ));
                }
                if client_secret.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "Gmail client_secret cannot be empty".into(),
                    ));
                }
                if refresh_token.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "Gmail refresh_token cannot be empty".into(),
                    ));
                }
                Ok(())
            }
            ApiCredentials::SendGrid { api_key } => {
                if api_key.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "SendGrid API key cannot be empty".into(),
                    ));
                }
                // SendGrid API keys typically start with SG.
                if !api_key.starts_with("SG.") && !api_key.starts_with("SENDGRID_API_KEY=") {
                    return Err(ExternalApiError::ValidationError(
                        "SendGrid API key should start with 'SG.' or 'SENDGRID_API_KEY='".into(),
                    ));
                }
                Ok(())
            }
            ApiCredentials::AmazonSes {
                access_key_id,
                secret_access_key,
                region,
            } => {
                if access_key_id.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "AWS access_key_id cannot be empty".into(),
                    ));
                }
                if secret_access_key.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "AWS secret_access_key cannot be empty".into(),
                    ));
                }
                if region.trim().is_empty() {
                    return Err(ExternalApiError::ValidationError(
                        "AWS region cannot be empty".into(),
                    ));
                }
                // AWS access keys are typically 20 characters
                if access_key_id.len() != 20 {
                    return Err(ExternalApiError::ValidationError(
                        "AWS access_key_id should be 20 characters".into(),
                    ));
                }
                Ok(())
            }
        }
    }

    /// Get the provider type for these credentials
    pub fn provider_type(&self) -> crate::provider::ProviderType {
        match self {
            ApiCredentials::Gmail { .. } => crate::provider::ProviderType::GmailApi,
            ApiCredentials::SendGrid { .. } => crate::provider::ProviderType::SendGrid,
            ApiCredentials::AmazonSes { .. } => crate::provider::ProviderType::AmazonSes,
        }
    }
}

/// Encrypted credentials for secure storage
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedCredentials {
    /// Encrypted credential data (base64 encoded)
    pub encrypted_data: String,
    /// Encryption algorithm used
    pub algorithm: String,
    /// Key ID used for encryption
    pub key_id: String,
    /// Initialization vector (if applicable)
    pub iv: Option<String>,
}

impl EncryptedCredentials {
    /// Create new encrypted credentials from plaintext
    pub fn encrypt(
        credentials: &ApiCredentials,
        key_id: &str,
        encryption_key: &[u8],
    ) -> Result<Self, ExternalApiError> {
        // Serialize credentials to JSON
        let json_data = serde_json::to_string(credentials)
            .map_err(|e| ExternalApiError::EncryptionError(e.to_string()))?;

        // Use AES-GCM for encryption
        use aes_gcm::{
            aead::{Aead, KeyInit, OsRng},
            Aes256Gcm, Nonce,
        };
        use rand::RngCore;

        let cipher = Aes256Gcm::new_from_slice(encryption_key)
            .map_err(|e| ExternalApiError::EncryptionError(e.to_string()))?;

        // Generate random nonce
        let mut nonce_bytes = [0u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt the data
        let ciphertext = cipher
            .encrypt(nonce, json_data.as_bytes())
            .map_err(|e| ExternalApiError::EncryptionError(e.to_string()))?;

        // Combine nonce and ciphertext
        let mut combined = Vec::with_capacity(nonce_bytes.len() + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);

        Ok(Self {
            encrypted_data: STANDARD.encode(&combined),
            algorithm: "AES-256-GCM".to_string(),
            key_id: key_id.to_string(),
            iv: Some(STANDARD.encode(nonce_bytes)),
        })
    }

    /// Decrypt credentials to plaintext
    pub fn decrypt(&self, encryption_key: &[u8]) -> Result<ApiCredentials, ExternalApiError> {
        // Decode base64
        let combined = STANDARD
            .decode(&self.encrypted_data)
            .map_err(|e| ExternalApiError::DecryptionError(e.to_string()))?;

        if combined.len() < 12 {
            return Err(ExternalApiError::DecryptionError(
                "Encrypted data too short".into(),
            ));
        }

        // Extract nonce and ciphertext
        let nonce_bytes = &combined[0..12];
        let ciphertext = &combined[12..];

        // Use AES-GCM for decryption
        use aes_gcm::{
            aead::{Aead, KeyInit},
            Aes256Gcm, Nonce,
        };

        let cipher = Aes256Gcm::new_from_slice(encryption_key)
            .map_err(|e| ExternalApiError::DecryptionError(e.to_string()))?;

        let nonce = Nonce::from_slice(nonce_bytes);

        // Decrypt the data
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| ExternalApiError::DecryptionError(e.to_string()))?;

        // Deserialize JSON back to credentials
        let credentials: ApiCredentials = serde_json::from_slice(&plaintext)
            .map_err(|e| ExternalApiError::DecryptionError(e.to_string()))?;

        Ok(credentials)
    }

    /// Validate the encrypted credentials format
    pub fn validate_format(&self) -> Result<(), ExternalApiError> {
        if self.encrypted_data.trim().is_empty() {
            return Err(ExternalApiError::ValidationError(
                "Encrypted data cannot be empty".into(),
            ));
        }

        if self.algorithm.trim().is_empty() {
            return Err(ExternalApiError::ValidationError(
                "Algorithm cannot be empty".into(),
            ));
        }

        if self.key_id.trim().is_empty() {
            return Err(ExternalApiError::ValidationError(
                "Key ID cannot be empty".into(),
            ));
        }

        // Check if it's valid base64
        STANDARD
            .decode(&self.encrypted_data)
            .map_err(|e| ExternalApiError::ValidationError(format!("Invalid base64: {}", e)))?;

        Ok(())
    }
}
