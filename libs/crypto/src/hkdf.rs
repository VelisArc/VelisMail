//! HKDF (HMAC-based Key Derivation Function)

use anyhow::Result;
use ring::hkdf::{self, Salt};

/// Derive a key using HKDF-SHA256
pub fn derive_key(ikm: &[u8], salt: &[u8], info: &[u8], length: usize) -> Result<Vec<u8>> {
    let salt = Salt::new(hkdf::HKDF_SHA256, salt);
    let prk = salt.extract(ikm);

    // Create binding to avoid temporary value being dropped
    let info_binding = [info];
    let prk_expanded = prk
        .expand(&info_binding, SimpleKeyType(length))
        .map_err(|_| anyhow::anyhow!("HKDF expand failed"))?;

    let mut result = vec![0u8; length];
    prk_expanded
        .fill(&mut result)
        .map_err(|_| anyhow::anyhow!("HKDF fill failed"))?;

    Ok(result)
}

/// Simple key type implementation for HKDF
struct SimpleKeyType(usize);

impl ring::hkdf::KeyType for SimpleKeyType {
    fn len(&self) -> usize {
        self.0
    }
}

/// Derive an encryption key (32 bytes)
pub fn derive_encryption_key(ikm: &[u8], salt: &[u8], info: &[u8]) -> Result<Vec<u8>> {
    derive_key(ikm, salt, info, 32)
}

/// Derive a MAC key (32 bytes)
pub fn derive_mac_key(ikm: &[u8], salt: &[u8], info: &[u8]) -> Result<Vec<u8>> {
    derive_key(ikm, salt, info, 32)
}

