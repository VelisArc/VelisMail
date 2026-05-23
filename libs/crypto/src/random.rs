//! Cryptographically secure random number generation

use anyhow::Result;
use ring::rand::{SecureRandom, SystemRandom};

/// Generate cryptographically secure random bytes
pub fn random_bytes(length: usize) -> Result<Vec<u8>> {
    let mut bytes = vec![0u8; length];
    let rng = SystemRandom::new();
    rng.fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("Random bytes generation failed"))?;
    Ok(bytes)
}

/// Generate a random token (hex string)
pub fn random_token(length: usize) -> Result<String> {
    let bytes = random_bytes(length)?;
    Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Generate a random challenge (for authentication)
pub fn random_challenge(length: usize) -> Result<Vec<u8>> {
    random_bytes(length)
}
