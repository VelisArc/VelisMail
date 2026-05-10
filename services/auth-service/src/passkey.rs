// generate_challenge() is used by handlers; the rest awaits browser-side integration.
#![allow(dead_code)]
//! Passkey (WebAuthn) authentication — partial scaffolding.
//!
//! WARNING: The previous implementation of `verify_signature` returned
//! `Ok(true)` unconditionally which is a catastrophic security bug (any
//! signature was accepted). It has been replaced with an explicit error so
//! the API layer can only respond with 501 NOT_IMPLEMENTED. A full WebAuthn
//! stack (ECDSA P-256 / EdDSA verification, challenge store, counter checks,
//! RP ID hash validation) must be implemented before turning this on.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct PasskeyVerificationRequest {
    pub credential_id: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub client_data_json: String,
    pub signature: Vec<u8>,
    pub user_handle: Option<Vec<u8>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PasskeyRegistrationRequest {
    pub email: String,
    pub display_name: String,
    pub public_key: Vec<u8>,
    pub credential_id: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub client_data_json: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredPasskey {
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: i64,
    pub user_id: uuid::Uuid,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClientData {
    #[serde(rename = "type")]
    pub typ: String,
    pub challenge: String,
    pub origin: String,
    #[serde(rename = "crossOrigin")]
    pub cross_origin: Option<bool>,
}

/// Verify a passkey authentication assertion.
///
/// NOT PRODUCTION READY — returns an error until a real ECDSA/EdDSA
/// verification path lands.
pub fn verify_passkey_assertion(
    request: &PasskeyVerificationRequest,
    _stored_passkey: &StoredPasskey,
    expected_origin: &str,
    _expected_rp_id: &str,
) -> Result<bool> {
    let client_data: ClientData = serde_json::from_str(&request.client_data_json)?;

    if client_data.origin != expected_origin {
        return Ok(false);
    }
    if client_data.typ != "webauthn.get" {
        return Ok(false);
    }

    Err(anyhow!(
        "WebAuthn signature verification requires the passkey verifier to be enabled. Use password login."
    ))
}

/// Generate a WebAuthn challenge (base64url, no padding).
pub fn generate_challenge() -> Result<String> {
    use velismail_crypto::random::random_bytes;
    let bytes = random_bytes(32)?;
    Ok(URL_SAFE_NO_PAD.encode(&bytes))
}
