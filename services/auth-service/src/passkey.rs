//! Passkey (WebAuthn) authentication

use anyhow::Result;
use ring::digest::{digest, SHA256};
use serde::{Deserialize, Serialize};

/// Passkey verification request
#[derive(Debug, Clone, Deserialize)]
pub struct PasskeyVerificationRequest {
    pub credential_id: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub client_data_json: String,
    pub signature: Vec<u8>,
    pub user_handle: Option<Vec<u8>>,
}

/// Passkey registration request
#[derive(Debug, Clone, Deserialize)]
pub struct PasskeyRegistrationRequest {
    pub email: String,
    pub display_name: String,
    pub public_key: Vec<u8>,
    pub credential_id: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub client_data_json: String,
}

/// Passkey credential stored in database
#[derive(Debug, Clone, Serialize)]
pub struct StoredPasskey {
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: i64,
    pub user_id: uuid::Uuid,
}

/// Verify a passkey authentication assertion
pub fn verify_passkey_assertion(
    request: &PasskeyVerificationRequest,
    stored_passkey: &StoredPasskey,
    expected_origin: &str,
    expected_rp_id: &str,
) -> Result<bool> {
    // Verify client data JSON
    let client_data: ClientData = serde_json::from_str(&request.client_data_json)?;

    // Check challenge
    // In production, verify challenge matches the one we sent

    // Check origin
    if client_data.origin != expected_origin {
        return Ok(false);
    }

    // Check type
    if client_data.typ != "webauthn.get" {
        return Ok(false);
    }

    // Verify signature using the stored public key
    // In production, use proper ECDSA/EdDSA verification
    let signature_valid = verify_signature(
        &stored_passkey.public_key,
        &request.authenticator_data,
        &request.client_data_json,
        &request.signature,
    )?;

    if !signature_valid {
        return Ok(false);
    }

    // Update counter (prevent authenticator cloning)
    // In production, verify counter > stored counter

    Ok(true)
}

/// Verify signature for passkey
fn verify_signature(
    public_key: &[u8],
    authenticator_data: &[u8],
    client_data_json: &str,
    signature: &[u8],
) -> Result<bool> {
    // Create message to verify
    let client_data_hash = digest(&SHA256, client_data_json.as_bytes());
    let mut message = authenticator_data.to_vec();
    message.extend_from_slice(client_data_hash.as_ref());

    // In production, use proper ECDSA verification with the public key
    // This is a simplified placeholder
    let _ = (public_key, signature, message);

    // Placeholder - real implementation would verify ECDSA signature
    Ok(true)
}

/// Client data from WebAuthn
#[derive(Debug, Clone, Deserialize)]
pub struct ClientData {
    #[serde(rename = "type")]
    pub typ: String,
    pub challenge: String,
    pub origin: String,
    #[serde(rename = "crossOrigin")]
    pub cross_origin: Option<bool>,
}

/// Generate a WebAuthn challenge
pub fn generate_challenge() -> Result<String> {
    use velismail_crypto::random::random_bytes;
    let bytes = random_bytes(32)?;
    Ok(base64::encode_config(&bytes, base64::URL_SAFE_NO_PAD))
}

// Simple base64 implementation to avoid extra dependency
mod base64 {
    use std::fmt::Write;

    const STANDARD_CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const URL_SAFE_CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

    pub fn encode_config(bytes: &[u8], _config: Encoding) -> String {
        let mut result = String::new();
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };

            let triple = (b0 << 16) | (b1 << 8) | b2;

            let _ = write!(
                result,
                "{}",
                URL_SAFE_CHARS[((triple >> 18) & 0x3F) as usize] as char
            );
            let _ = write!(
                result,
                "{}",
                URL_SAFE_CHARS[((triple >> 12) & 0x3F) as usize] as char
            );
            if chunk.len() > 1 {
                let _ = write!(
                    result,
                    "{}",
                    URL_SAFE_CHARS[((triple >> 6) & 0x3F) as usize] as char
                );
            }
            if chunk.len() > 2 {
                let _ = write!(
                    result,
                    "{}",
                    URL_SAFE_CHARS[(triple & 0x3F) as usize] as char
                );
            }
        }
        result
    }

    pub struct Encoding;
    pub const URL_SAFE_NO_PAD: Encoding = Encoding;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_challenge_generation() {
        let challenge = generate_challenge().unwrap();
        assert!(!challenge.is_empty());
        assert!(challenge.len() >= 32);
    }
}
