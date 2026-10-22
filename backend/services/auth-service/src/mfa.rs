//! TOTP (Time-based One-Time Password) Authenticator Module
//!
//! Implements RFC 6238 TOTP with SHA-1 HMAC, base32 encoding/decoding,
//! and AES-256-GCM encryption for secret storage.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ring::{
    aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN},
    digest::{digest, SHA256},
    hmac::{self, Key, HMAC_SHA1_FOR_LEGACY_USE_ONLY},
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub const TOTP_ISSUER: &str = "VelisMail";
const TOTP_ALGORITHM: &str = "SHA1";
const TOTP_DIGITS: u32 = 6;
const TOTP_PERIOD: u64 = 30;
const TOTP_SKEW_WINDOW: i64 = 1; // Allow ±1 time step

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Encrypted TOTP secret storage format: "v1:<base64(nonce + ciphertext + tag)>"
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedTotpSecret(pub String);

impl EncryptedTotpSecret {
    pub fn new(plaintext: &str, encryption_key: &str) -> Result<Self> {
        let key = derive_encryption_key(encryption_key);
        let unbound = UnboundKey::new(&AES_256_GCM, &key)
            .map_err(|_| anyhow!("Failed to create encryption key"))?;
        let cipher = LessSafeKey::new(unbound);

        let mut nonce_bytes = [0u8; NONCE_LEN];
        SystemRandom::new()
            .fill(&mut nonce_bytes)
            .map_err(|_| anyhow!("Failed to generate nonce"))?;

        let mut in_out = plaintext.as_bytes().to_vec();
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        cipher
            .seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
            .map_err(|_| anyhow!("Encryption failed"))?;

        let mut payload = nonce_bytes.to_vec();
        payload.extend(in_out);
        Ok(Self(format!("v1:{}", BASE64.encode(payload))))
    }

    pub fn decrypt(&self, encryption_key: &str) -> Option<String> {
        let encoded = self.0.strip_prefix("v1:")?;
        let bytes = BASE64.decode(encoded).ok()?;
        if bytes.len() < NONCE_LEN + 16 {
            return None;
        }
        let (nonce_bytes, ciphertext) = bytes.split_at(NONCE_LEN);
        let key = derive_encryption_key(encryption_key);
        let unbound = UnboundKey::new(&AES_256_GCM, &key).ok()?;
        let cipher = LessSafeKey::new(unbound);
        let nonce = Nonce::try_assume_unique_for_key(nonce_bytes).ok()?;
        let mut in_out = ciphertext.to_vec();
        let plaintext = cipher
            .open_in_place(nonce, Aad::empty(), &mut in_out)
            .ok()?;
        String::from_utf8(plaintext.to_vec()).ok()
    }
}

fn derive_encryption_key(material: &str) -> [u8; 32] {
    let hash = digest(&SHA256, material.as_bytes());
    let mut key = [0u8; 32];
    key.copy_from_slice(hash.as_ref());
    key
}

/// Generate a new TOTP secret (20 random bytes, base32 encoded without padding)
pub fn generate_totp_secret() -> Result<String> {
    let mut bytes = [0u8; 20];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow!("Failed to generate random bytes"))?;
    Ok(base32_encode(&bytes))
}

/// Base32 encode (RFC 4648, no padding)
pub fn base32_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() * 8).div_ceil(5));
    let mut buffer: u32 = 0;
    let mut bits = 0;

    for &byte in data {
        buffer = (buffer << 8) | (byte as u32);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            let idx = (buffer >> bits) & 0x1F;
            out.push(BASE32_ALPHABET[idx as usize] as char);
        }
    }

    if bits > 0 {
        let idx = (buffer << (5 - bits)) & 0x1F;
        out.push(BASE32_ALPHABET[idx as usize] as char);
    }

    out
}

/// Base32 decode (RFC 4648, case-insensitive, ignores padding and whitespace)
pub fn base32_decode(encoded: &str) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut buffer: u32 = 0;
    let mut bits = 0;

    for c in encoded.chars() {
        let val = match c {
            'A'..='Z' => (c as u32) - ('A' as u32),
            'a'..='z' => (c as u32) - ('a' as u32),
            '2'..='7' => (c as u32) - ('2' as u32) + 26,
            '=' | ' ' | '\t' | '\n' | '\r' => continue,
            _ => return Err(anyhow!("Invalid base32 character: {}", c)),
        };
        buffer = (buffer << 5) | val;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u8);
        }
    }
    Ok(out)
}

/// Build otpauth:// URI for QR code
pub fn build_otpauth_uri(secret: &str, email: &str, issuer: &str) -> String {
    let label = format!("{}:{}", issuer, email);
    let encoded_label = percent_encode(&label);
    format!(
        "otpauth://totp/{}?secret={}&issuer={}&algorithm={}&digits={}&period={}",
        encoded_label,
        secret,
        percent_encode(issuer),
        TOTP_ALGORITHM,
        TOTP_DIGITS,
        TOTP_PERIOD
    )
}

/// Simple percent encoding for URI components
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
            out.push(c);
        } else {
            for byte in c.to_string().as_bytes() {
                out.push_str(&format!("%{:02X}", byte));
            }
        }
    }
    out
}

/// Compute HOTP (HMAC-based One-Time Password) per RFC 4226
fn hotp(secret: &[u8], counter: u64) -> String {
    let key = Key::new(HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret);
    let counter_bytes = counter.to_be_bytes();
    let tag = hmac::sign(&key, &counter_bytes);
    let tag_bytes = tag.as_ref();

    let offset = (tag_bytes[19] & 0x0F) as usize;
    let binary = ((tag_bytes[offset] & 0x7F) as u32) << 24
        | (tag_bytes[offset + 1] as u32) << 16
        | (tag_bytes[offset + 2] as u32) << 8
        | (tag_bytes[offset + 3] as u32);

    let otp = binary % 1_000_000;
    format!("{:06}", otp)
}

/// Verify a 6-digit TOTP code with ±1 time step skew
pub fn verify_totp_code(secret_b32: &str, code: &str, now: Option<u64>) -> bool {
    let secret = match base32_decode(secret_b32) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let code = code.trim().replace(' ', "");
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    let now = now.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    });
    let time_step = now / TOTP_PERIOD;

    for offset in -TOTP_SKEW_WINDOW..=TOTP_SKEW_WINDOW {
        let counter = (time_step as i64 + offset) as u64;
        let expected = hotp(&secret, counter);
        let equal = expected.len() == code.len()
        && expected
            .as_bytes()
            .iter()
            .zip(code.as_bytes().iter())
            .all(|(a, b)| a == b);
    if equal {
            return true;
        }
    }
    false
}

/// MFA Challenge Claims (for login challenge and recovery)
#[derive(Debug, Serialize, Deserialize)]
pub struct MfaChallengeClaims {
    pub sub: String,     // user_id
    pub purpose: String, // "mfa_login", "mfa_recovery"
    pub exp: i64,
    pub iat: i64,
}

/// Recovery Token Claims (for authenticator replacement)
#[derive(Debug, Serialize, Deserialize)]
pub struct RecoveryTokenClaims {
    pub sub: String,     // user_id
    pub purpose: String, // "mfa_recovery_replace"
    pub exp: i64,
    pub iat: i64,
}

/// Create MFA challenge token (signed with OTP signing secret)
pub fn create_mfa_challenge(
    signing_secret: &str,
    user_id: &str,
    purpose: &str,
    ttl_seconds: i64,
) -> Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = MfaChallengeClaims {
        sub: user_id.to_string(),
        purpose: purpose.to_string(),
        iat: now,
        exp: now + ttl_seconds,
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(signing_secret.as_bytes()),
    )
    .map_err(|e| anyhow!("Failed to encode MFA challenge: {}", e))
}

/// Decode and validate MFA challenge token
pub fn decode_mfa_challenge(signing_secret: &str, token: &str) -> Option<MfaChallengeClaims> {
    let validation = jsonwebtoken::Validation {
        validate_aud: false,
        leeway: 60,
        ..Default::default()
    };
    jsonwebtoken::decode::<MfaChallengeClaims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(signing_secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|t| t.claims)
}

/// Create recovery replacement token
pub fn create_recovery_token(
    signing_secret: &str,
    user_id: &str,
    ttl_seconds: i64,
) -> Result<String> {
    let now = chrono::Utc::now().timestamp();
    let claims = RecoveryTokenClaims {
        sub: user_id.to_string(),
        purpose: "mfa_recovery_replace".to_string(),
        iat: now,
        exp: now + ttl_seconds,
    };
    jsonwebtoken::encode(
        &jsonwebtoken::Header::default(),
        &claims,
        &jsonwebtoken::EncodingKey::from_secret(signing_secret.as_bytes()),
    )
    .map_err(|e| anyhow!("Failed to encode recovery token: {}", e))
}

/// Decode recovery token
pub fn decode_recovery_token(signing_secret: &str, token: &str) -> Option<RecoveryTokenClaims> {
    let validation = jsonwebtoken::Validation {
        validate_aud: false,
        leeway: 60,
        ..Default::default()
    };
    jsonwebtoken::decode::<RecoveryTokenClaims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(signing_secret.as_bytes()),
        &validation,
    )
    .ok()
    .map(|t| t.claims)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_totp_verify() {
        // Test with a known secret
        let secret = "JBSWY3DPEHPK3PXP"; // base32 for "Hello!"
                                         // We can't easily test without knowing the time, but we can verify the functions don't panic
        assert!(!verify_totp_code(secret, "000000", Some(0)));
    }

    #[test]
    fn test_base32_roundtrip() {
        let original = b"Hello, World!";
        let encoded = base32_encode(original);
        let decoded = base32_decode(&encoded).unwrap();
        assert_eq!(original.to_vec(), decoded);
    }

    #[test]
    fn test_otpauth_uri() {
        let uri = build_otpauth_uri("SECRET", "user@example.com", "VelisMail");
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains("secret=SECRET"));
        assert!(uri.contains("issuer=VelisMail"));
    }

    #[test]
    fn test_encryption_roundtrip() {
        let secret = "JBSWY3DPEHPK3PXP";
        let key = "test-encryption-key-32-bytes!!";
        let encrypted = EncryptedTotpSecret::new(secret, key).unwrap();
        let decrypted = encrypted.decrypt(key).unwrap();
        assert_eq!(secret, decrypted);
    }

    #[test]
    fn test_encryption_different_keys() {
        let secret = "JBSWY3DPEHPK3PXP";
        let key1 = "test-encryption-key-32-bytes!!";
        let key2 = "different-key-32-bytes-long!!!";
        let encrypted = EncryptedTotpSecret::new(secret, key1).unwrap();
        assert!(encrypted.decrypt(key2).is_none());
    }
}
