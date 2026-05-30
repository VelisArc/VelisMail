//! DKIM signing and verification using ED25519 via ring.
//!
//! Implements relaxed/relaxed canonicalization for both header and body,
//! producing DKIM-Signature headers compliant with RFC 6376.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ring::signature::{Ed25519KeyPair, UnparsedPublicKey, ED25519};

/// DKIM signing configuration.
pub struct DkimSigner {
    selector: String,
    domain: String,
    key_pair: Ed25519KeyPair,
}

impl DkimSigner {
    /// Create a new DKIM signer from a PEM-encoded ED25519 private key.
    pub fn new(selector: &str, domain: &str, private_key_pem: &str) -> Result<Self> {
        let der = pem_to_der(private_key_pem)?;
        let key_pair = Ed25519KeyPair::from_pkcs8(&der)
            .map_err(|e| anyhow!("Invalid ED25519 private key: {}", e))?;

        Ok(Self {
            selector: selector.to_string(),
            domain: domain.to_string(),
            key_pair,
        })
    }

    /// Sign an email message, returning the DKIM-Signature header value.
    ///
    /// `headers_to_sign` — which headers to include (e.g., `["from", "to", "subject", "date"]`)
    /// `header_block` — the raw email headers
    /// `body` — the raw email body
    pub fn sign(
        &self,
        headers_to_sign: &[&str],
        header_block: &str,
        body: &str,
    ) -> Result<String> {
        let canonicalized_body = canonicalize_body_relaxed(body);
        let body_hash = {
            let digest = ring::digest::digest(&ring::digest::SHA256, canonicalized_body.as_bytes());
            BASE64.encode(digest.as_ref())
        };

        let timestamp = chrono::Utc::now().timestamp();

        // Build the DKIM-Signature header without the b= value
        let dkim_header_prefix = format!(
            "v=1; a=ed25519-sha256; c=relaxed/relaxed; d={domain}; s={selector}; \
             h={signed_headers}; bh={body_hash}; t={timestamp}; b=",
            domain = self.domain,
            selector = self.selector,
            signed_headers = headers_to_sign.join(":"),
            body_hash = body_hash,
            timestamp = timestamp,
        );

        // Canonicalize headers for signing
        let mut sign_input = String::new();
        for header_name in headers_to_sign {
            if let Some(value) = extract_header(header_block, header_name) {
                let canonical = canonicalize_header_relaxed(header_name, &value);
                sign_input.push_str(&canonical);
                sign_input.push_str("\r\n");
            }
        }
        // Add DKIM-Signature header itself (without trailing CRLF)
        sign_input.push_str(&format!(
            "dkim-signature:{}",
            canonicalize_header_value_relaxed(&dkim_header_prefix)
        ));

        let signature = self.key_pair.sign(sign_input.as_bytes());
        let encoded_sig = BASE64.encode(signature.as_ref());

        Ok(format!(
            "DKIM-Signature: {dkim_header_prefix}{encoded_sig}"
        ))
    }
}

/// Verify a DKIM signature on an inbound email.
pub fn verify_dkim_signature(
    dkim_header: &str,
    header_block: &str,
    body: &str,
    public_key_der: &[u8],
) -> Result<bool> {
    // Parse the DKIM-Signature fields
    let fields = parse_dkim_fields(dkim_header);

    let algorithm = fields.get("a").map(|s| s.as_str()).unwrap_or("");
    if algorithm != "ed25519-sha256" {
        return Err(anyhow!("Unsupported DKIM algorithm: {}", algorithm));
    }

    let signed_headers_str = fields.get("h").ok_or_else(|| anyhow!("Missing h= tag"))?;
    let body_hash_expected = fields.get("bh").ok_or_else(|| anyhow!("Missing bh= tag"))?;
    let signature_b64 = fields.get("b").ok_or_else(|| anyhow!("Missing b= tag"))?;

    // Verify body hash
    let canonicalized_body = canonicalize_body_relaxed(body);
    let body_digest = ring::digest::digest(&ring::digest::SHA256, canonicalized_body.as_bytes());
    let computed_bh = BASE64.encode(body_digest.as_ref());
    if computed_bh != *body_hash_expected {
        return Ok(false);
    }

    // Rebuild signing input
    let signed_headers: Vec<&str> = signed_headers_str.split(':').collect();
    let mut sign_input = String::new();
    for header_name in &signed_headers {
        if let Some(value) = extract_header(header_block, header_name.trim()) {
            let canonical = canonicalize_header_relaxed(header_name.trim(), &value);
            sign_input.push_str(&canonical);
            sign_input.push_str("\r\n");
        }
    }

    // Add DKIM-Signature header without b= value
    let dkim_without_b = dkim_header
        .splitn(2, "b=")
        .next()
        .unwrap_or(dkim_header);
    sign_input.push_str(&format!(
        "dkim-signature:{}",
        canonicalize_header_value_relaxed(&format!("{}b=", dkim_without_b))
    ));

    // Verify signature
    let sig_bytes = BASE64
        .decode(signature_b64)
        .map_err(|e| anyhow!("Invalid base64 signature: {}", e))?;

    let public_key = UnparsedPublicKey::new(&ED25519, public_key_der);
    match public_key.verify(sign_input.as_bytes(), &sig_bytes) {
        Ok(()) => Ok(true),
        Err(_) => Ok(false),
    }
}

// ── Canonicalization helpers ────────────────────────────────

fn canonicalize_body_relaxed(body: &str) -> String {
    let lines: Vec<String> = body
        .lines()
        .map(|line| {
            // Reduce WSP sequences to single SP, remove trailing WSP
            let folded: String = line
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            folded.trim_end().to_string()
        })
        .collect();

    // Remove trailing empty lines
    let trimmed: Vec<&str> = {
        let mut v: Vec<&str> = lines.iter().map(|s| s.as_str()).collect();
        while v.last() == Some(&"") {
            v.pop();
        }
        v
    };

    let mut result = trimmed.join("\r\n");
    result.push_str("\r\n");
    result
}

fn canonicalize_header_relaxed(name: &str, value: &str) -> String {
    format!(
        "{}:{}",
        name.to_lowercase(),
        canonicalize_header_value_relaxed(value)
    )
}

fn canonicalize_header_value_relaxed(value: &str) -> String {
    // Unfold, reduce WSP, trim
    let unfolded = value.replace("\r\n", "").replace('\n', "");
    let parts: Vec<&str> = unfolded.split_whitespace().collect();
    parts.join(" ").trim().to_string()
}

fn extract_header<'a>(headers: &'a str, name: &str) -> Option<String> {
    let lower_name = name.to_lowercase();
    for line in headers.lines() {
        if let Some((hname, hvalue)) = line.split_once(':') {
            if hname.trim().to_lowercase() == lower_name {
                return Some(hvalue.to_string());
            }
        }
    }
    None
}

fn parse_dkim_fields(header_value: &str) -> std::collections::HashMap<String, String> {
    let mut fields = std::collections::HashMap::new();
    // Remove "DKIM-Signature:" prefix if present
    let value = header_value
        .strip_prefix("DKIM-Signature:")
        .unwrap_or(header_value)
        .trim();

    for part in value.split(';') {
        let trimmed = part.trim();
        if let Some((key, val)) = trimmed.split_once('=') {
            fields.insert(key.trim().to_string(), val.trim().to_string());
        }
    }
    fields
}

fn pem_to_der(pem: &str) -> Result<Vec<u8>> {
    let content: String = pem
        .lines()
        .filter(|line| !line.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");
    BASE64
        .decode(&content)
        .map_err(|e| anyhow!("Invalid PEM base64: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_body_canonicalization() {
        let body = "Hello  World  \n  test  \n\n\n";
        let canonical = canonicalize_body_relaxed(body);
        assert!(canonical.ends_with("\r\n"));
        assert!(!canonical.ends_with("\r\n\r\n"));
    }

    #[test]
    fn test_header_canonicalization() {
        let result = canonicalize_header_relaxed("Subject", "  Hello   World  ");
        assert_eq!(result, "subject:Hello World");
    }

    #[test]
    fn test_parse_dkim_fields() {
        let header = "v=1; a=ed25519-sha256; d=example.com; s=sel; b=abc";
        let fields = parse_dkim_fields(header);
        assert_eq!(fields.get("v").unwrap(), "1");
        assert_eq!(fields.get("a").unwrap(), "ed25519-sha256");
        assert_eq!(fields.get("d").unwrap(), "example.com");
    }
}
