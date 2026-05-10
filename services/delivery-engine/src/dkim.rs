// DKIM signing primitives for the delivery pipeline.
#![allow(dead_code)]
//! DKIM signing implementation

use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use ring::digest::{digest, SHA256};

/// DKIM signature generator
pub struct DkimSigner {
    private_key: Vec<u8>,
    selector: String,
    domain: String,
}

impl DkimSigner {
    pub fn new(private_key_pem: &str, selector: &str, domain: &str) -> Result<Self> {
        if private_key_pem.trim().is_empty() {
            bail!("DKIM_PRIVATE_KEY is required");
        }

        Ok(Self {
            private_key: private_key_pem.as_bytes().to_vec(),
            selector: selector.to_string(),
            domain: domain.to_string(),
        })
    }

    /// Sign an email message
    pub fn sign(&self, headers: &str, body: &str) -> Result<String> {
        // Canonicalize headers and body (relaxed/relaxed)
        let _canonicalized_headers = self.canonicalize_headers(headers);
        let canonicalized_body = self.canonicalize_body(body);

        // Hash the body
        let body_hash = digest(&SHA256, canonicalized_body.as_bytes());
        let body_hash_b64 = BASE64_STANDARD.encode(body_hash.as_ref());

        // Build the signed headers
        let _dkim_header = format!(
            "DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d={}; s={};\r\n\
             h=From:To:Subject:Date:Message-ID;\r\n\
             bh={};\r\n\
             b=",
            self.domain, self.selector, body_hash_b64
        );

        if self.private_key.is_empty() {
            bail!("DKIM signing is unavailable because the private key was not loaded");
        }

        bail!("DKIM RSA signing is disabled until private-key signing is wired to a vetted crypto implementation")
    }

    fn canonicalize_headers(&self, headers: &str) -> String {
        // Preserve headers until full relaxed canonicalization is enabled.
        headers.to_string()
    }

    fn canonicalize_body(&self, body: &str) -> String {
        // Remove trailing whitespace, limit to max 75 CRLFs
        body.trim_end()
            .lines()
            .take(75)
            .collect::<Vec<_>>()
            .join("\r\n")
    }
}
