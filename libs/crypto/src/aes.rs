//! AES-256-GCM encryption for email content
//!
//! Provides authenticated encryption with associated data (AEAD)

use anyhow::{bail, Result};
use ring::aead::{self, Aad, LessSafeKey, UnboundKey};
use ring::rand::{SecureRandom, SystemRandom};

/// Encryption key wrapper
pub struct EncryptionKey {
    key: LessSafeKey,
}

impl EncryptionKey {
    /// Create a new encryption key from raw bytes (must be 32 bytes for AES-256)
    pub fn new(bytes: &[u8]) -> Result<Self> {
        let unbound_key = UnboundKey::new(&aead::AES_256_GCM, bytes)
            .map_err(|_| anyhow::anyhow!("Invalid key size"))?;
        Ok(Self {
            key: LessSafeKey::new(unbound_key),
        })
    }

    /// Generate a random 256-bit key
    pub fn generate() -> Result<Self> {
        let mut bytes = [0u8; 32];
        let rng = SystemRandom::new();
        rng.fill(&mut bytes)
            .map_err(|_| anyhow::anyhow!("Random generation failed"))?;
        Self::new(&bytes)
    }

    /// Encrypt data with AES-256-GCM
    pub fn encrypt(&self, plaintext: &[u8], associated_data: Option<&[u8]>) -> Result<Vec<u8>> {
        let mut in_out = plaintext.to_vec();
        let nonce = aead::Nonce::assume_unique_for_key(random_nonce()?);
        let aad = Aad::from(associated_data.unwrap_or(&[]));

        let tag = self
            .key
            .seal_in_place_separate_tag(nonce, aad, &mut in_out)
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        in_out.extend_from_slice(tag.as_ref());
        Ok(in_out)
    }

    /// Decrypt data with AES-256-GCM
    pub fn decrypt(&self, ciphertext: &[u8], associated_data: Option<&[u8]>) -> Result<Vec<u8>> {
        if ciphertext.len() < 16 {
            bail!("Ciphertext too short");
        }

        let mut in_out = ciphertext.to_vec();
        let (nonce_bytes, encrypted) = in_out.split_at_mut(12);
        let nonce_bytes_copy = nonce_bytes.to_vec();

        let nonce = aead::Nonce::assume_unique_for_key(nonce_bytes_copy.as_slice().try_into()?);
        let aad = Aad::from(associated_data.unwrap_or(&[]));

        let plaintext = self
            .key
            .open_in_place(nonce, aad, encrypted)
            .map_err(|_| anyhow::anyhow!("Decryption failed"))?;

        Ok(plaintext.to_vec())
    }
}

/// Generate a cryptographically secure random nonce
fn random_nonce() -> Result<[u8; 12]> {
    let mut nonce = [0u8; 12];
    let rng = SystemRandom::new();
    rng.fill(&mut nonce)
        .map_err(|_| anyhow::anyhow!("Random generation failed"))?;
    Ok(nonce)
}

/// Encrypted payload structure
#[derive(Debug, Clone)]
pub struct EncryptedPayload {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub tag: Vec<u8>,
}

impl EncryptedPayload {
    pub fn new(nonce: Vec<u8>, ciphertext: Vec<u8>, tag: Vec<u8>) -> Self {
        Self {
            nonce,
            ciphertext,
            tag,
        }
    }

    /// Serialize to bytes (nonce + ciphertext + tag)
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&self.nonce);
        bytes.extend_from_slice(&self.ciphertext);
        bytes.extend_from_slice(&self.tag);
        bytes
    }
}

