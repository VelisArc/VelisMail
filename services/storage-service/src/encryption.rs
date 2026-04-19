//! Storage encryption (AES-256-GCM)

use anyhow::Result;
use velismail_crypto::aes::EncryptionKey;

/// Storage encryption manager
pub struct StorageEncryption {
    key: EncryptionKey,
}

impl StorageEncryption {
    pub fn new(key_bytes: &str) -> Result<Self> {
        // Ensure key is 32 bytes for AES-256
        let key_bytes = if key_bytes.len() >= 32 {
            key_bytes.as_bytes()[..32].to_vec()
        } else {
            // Pad with zeros
            let mut padded = vec![0u8; 32];
            padded[..key_bytes.len()].copy_from_slice(key_bytes.as_bytes());
            padded
        };

        let key = EncryptionKey::new(&key_bytes)?;

        Ok(Self { key })
    }

    /// Encrypt data before storing
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>> {
        self.key.encrypt(plaintext, None)
    }

    /// Decrypt data after retrieving
    pub fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        self.key.decrypt(ciphertext, None)
    }
}

