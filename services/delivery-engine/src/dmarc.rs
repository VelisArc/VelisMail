// DMARC checker scaffold. It fails closed until DNS-backed evaluation is wired.
#![allow(dead_code)]
//! DMARC policy checking

use anyhow::Result;

pub struct DmarcChecker;

impl DmarcChecker {
    /// Check DMARC policy for a domain
    pub async fn check(domain: &str, spf_pass: bool, dkim_pass: bool) -> Result<DmarcResult> {
        let _ = (domain, spf_pass, dkim_pass);
        anyhow::bail!("DNS-backed DMARC evaluation requires resolver integration")
    }
}

pub struct DmarcResult {
    pub pass: bool,
    pub policy: String,
    pub subdomain_policy: String,
    pub pct: u8,
}
