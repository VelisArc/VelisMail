//! Cryptographically secure random number generation
//!
//! All functions in this module use `ring::rand::SystemRandom` (OS-level CSPRNG)
//! to guarantee cryptographic strength. Never use UUID or pseudo-RNG for
//! security-critical values like OTPs, session tokens, or nonces.

use anyhow::Result;
use ring::rand::{SecureRandom, SystemRandom};

/// Thread-safe CSPRNG instance reused across calls.
fn system_rng() -> &'static SystemRandom {
    use std::sync::OnceLock;
    static RNG: OnceLock<SystemRandom> = OnceLock::new();
    RNG.get_or_init(SystemRandom::new)
}

/// Generate cryptographically secure random bytes.
pub fn random_bytes(length: usize) -> Result<Vec<u8>> {
    let mut bytes = vec![0u8; length];
    system_rng()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("CSPRNG: random bytes generation failed"))?;
    Ok(bytes)
}

/// Generate a random token as a hex-encoded string.
///
/// `byte_length` is the number of random bytes; the returned string is twice
/// as long (2 hex chars per byte). For a 64-char token, pass `byte_length = 32`.
pub fn random_token(byte_length: usize) -> Result<String> {
    let bytes = random_bytes(byte_length)?;
    Ok(bytes.iter().map(|b| format!("{:02x}", b)).collect())
}

/// Generate a random challenge for authentication protocols (WebAuthn, ZKP).
pub fn random_challenge(length: usize) -> Result<Vec<u8>> {
    random_bytes(length)
}

/// Generate a cryptographically secure numeric OTP code.
///
/// Uses rejection sampling on CSPRNG bytes to produce a uniformly distributed
/// OTP in the range `[10^(digits-1), 10^digits - 1]` (i.e., never starts with
/// zero). This is the industry-standard approach for secure OTP generation.
///
/// # Panics
/// Panics if `digits` is 0 or greater than 9 (u32 overflow).
pub fn generate_otp(digits: usize) -> Result<String> {
    assert!(digits > 0 && digits <= 9, "OTP digits must be 1..=9");

    let upper_bound = 10u32.pow(digits as u32);
    let lower_bound = 10u32.pow((digits - 1) as u32);
    let range = upper_bound - lower_bound;

    // Rejection sampling to avoid modulo bias
    let mut buf = [0u8; 4];
    loop {
        system_rng()
            .fill(&mut buf)
            .map_err(|_| anyhow::anyhow!("CSPRNG: OTP generation failed"))?;
        let raw = u32::from_le_bytes(buf);
        // Only accept values that fall within a multiple of `range` to avoid bias
        if raw < (u32::MAX - (u32::MAX % range)) {
            let otp_value = lower_bound + (raw % range);
            return Ok(format!("{:0>width$}", otp_value, width = digits));
        }
    }
}

/// Generate a URL-safe base64-encoded session token.
///
/// Default length of 48 bytes produces a 64-character base64 string with
/// 384 bits of entropy — sufficient for session identifiers per OWASP
/// Session Management guidelines.
pub fn generate_session_token(byte_length: usize) -> Result<String> {
    let bytes = random_bytes(byte_length)?;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otp_has_correct_length() {
        for digits in 4..=8 {
            let otp = generate_otp(digits).unwrap();
            assert_eq!(otp.len(), digits, "OTP should be {digits} digits");
            assert!(otp.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn otp_never_starts_with_zero() {
        for _ in 0..200 {
            let otp = generate_otp(6).unwrap();
            assert_ne!(otp.chars().next().unwrap(), '0');
        }
    }

    #[test]
    fn random_token_correct_length() {
        let token = random_token(32).unwrap();
        assert_eq!(token.len(), 64);
    }

    #[test]
    fn session_token_is_nonempty() {
        let token = generate_session_token(48).unwrap();
        assert!(!token.is_empty());
        assert!(token.len() >= 48); // base64 expands
    }
}
