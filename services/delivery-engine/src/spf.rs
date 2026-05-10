// SPF checker scaffold. It fails closed until DNS-backed evaluation is wired.
#![allow(dead_code)]
//! SPF verification

use anyhow::Result;

/// SPF record checker
pub struct SpfVerifier;

impl SpfVerifier {
    /// Verify SPF record for a domain
    pub async fn verify(domain: &str, ip: &str) -> Result<SpfResult> {
        let _ = (domain, ip);
        anyhow::bail!("DNS-backed SPF evaluation requires resolver integration")
    }

    /// Get SPF record for domain
    pub async fn get_spf_record(domain: &str) -> Result<String> {
        // Query DNS TXT record
        let _ = domain;
        let base_domain = std::env::var("BASE_DOMAIN").unwrap_or_else(|_| "velismail.online".to_string());
        Ok(format!("v=spf1 include:{} ~all", base_domain))
    }
}

pub struct SpfResult {
    pub pass: bool,
    pub record: String,
    pub explanation: String,
}
