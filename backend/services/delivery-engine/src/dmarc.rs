//! DMARC policy evaluation per RFC 7489.
//!
//! Evaluates DMARC alignment between SPF and DKIM results.

use crate::spf::SpfResult;
use serde::{Deserialize, Serialize};

/// DMARC policy action
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DmarcPolicy {
    None,
    Quarantine,
    Reject,
}

impl std::fmt::Display for DmarcPolicy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DmarcPolicy::None => write!(f, "none"),
            DmarcPolicy::Quarantine => write!(f, "quarantine"),
            DmarcPolicy::Reject => write!(f, "reject"),
        }
    }
}

/// DMARC alignment mode
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AlignmentMode {
    Strict,  // s
    Relaxed, // r (default)
}

/// Parsed DMARC record
#[derive(Debug, Clone)]
pub struct DmarcRecord {
    pub policy: DmarcPolicy,
    pub subdomain_policy: Option<DmarcPolicy>,
    pub spf_alignment: AlignmentMode,
    pub dkim_alignment: AlignmentMode,
    pub percentage: u8,
    pub rua: Option<String>,
    pub ruf: Option<String>,
}

/// DMARC evaluation result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmarcResult {
    pub result: String,
    pub policy: DmarcPolicy,
    pub spf_aligned: bool,
    pub dkim_aligned: bool,
    pub details: String,
}

/// Parse a DMARC TXT record.
pub fn parse_dmarc_record(record: &str) -> Result<DmarcRecord, String> {
    let trimmed = record.trim();
    if !trimmed.starts_with("v=DMARC1") {
        return Err("Not a valid DMARC record (must start with v=DMARC1)".to_string());
    }

    let mut policy = DmarcPolicy::None;
    let mut subdomain_policy = None;
    let mut spf_alignment = AlignmentMode::Relaxed;
    let mut dkim_alignment = AlignmentMode::Relaxed;
    let mut percentage = 100u8;
    let mut rua = None;
    let mut ruf = None;

    for part in trimmed.split(';') {
        let part = part.trim();
        if let Some((key, value)) = part.split_once('=') {
            let key = key.trim();
            let value = value.trim();
            match key {
                "p" => {
                    policy = match value {
                        "none" => DmarcPolicy::None,
                        "quarantine" => DmarcPolicy::Quarantine,
                        "reject" => DmarcPolicy::Reject,
                        _ => DmarcPolicy::None,
                    };
                }
                "sp" => {
                    subdomain_policy = Some(match value {
                        "none" => DmarcPolicy::None,
                        "quarantine" => DmarcPolicy::Quarantine,
                        "reject" => DmarcPolicy::Reject,
                        _ => DmarcPolicy::None,
                    });
                }
                "aspf" => {
                    spf_alignment = if value == "s" {
                        AlignmentMode::Strict
                    } else {
                        AlignmentMode::Relaxed
                    };
                }
                "adkim" => {
                    dkim_alignment = if value == "s" {
                        AlignmentMode::Strict
                    } else {
                        AlignmentMode::Relaxed
                    };
                }
                "pct" => {
                    percentage = value.parse().unwrap_or(100);
                }
                "rua" => rua = Some(value.to_string()),
                "ruf" => ruf = Some(value.to_string()),
                _ => {}
            }
        }
    }

    Ok(DmarcRecord {
        policy,
        subdomain_policy,
        spf_alignment,
        dkim_alignment,
        percentage,
        rua,
        ruf,
    })
}

/// Check DMARC alignment between the From domain and SPF/DKIM domains.
///
/// `from_domain` — the domain in the RFC 5322 From header
/// `spf_domain` — the domain that passed SPF (MAIL FROM domain)
/// `dkim_domain` — the d= domain from a passing DKIM signature
/// `spf_result` — the SPF check result
/// `dkim_pass` — whether DKIM verification passed
pub fn evaluate_dmarc(
    dmarc_record: &str,
    from_domain: &str,
    spf_domain: Option<&str>,
    dkim_domain: Option<&str>,
    spf_result: &SpfResult,
    dkim_pass: bool,
) -> DmarcResult {
    let record = match parse_dmarc_record(dmarc_record) {
        Ok(r) => r,
        Err(e) => {
            return DmarcResult {
                result: "permerror".to_string(),
                policy: DmarcPolicy::None,
                spf_aligned: false,
                dkim_aligned: false,
                details: format!("DMARC record parse error: {}", e),
            };
        }
    };

    // Check SPF alignment
    let spf_aligned = if *spf_result == SpfResult::Pass {
        if let Some(spf_dom) = spf_domain {
            check_alignment(from_domain, spf_dom, record.spf_alignment)
        } else {
            false
        }
    } else {
        false
    };

    // Check DKIM alignment
    let dkim_aligned = if dkim_pass {
        if let Some(dkim_dom) = dkim_domain {
            check_alignment(from_domain, dkim_dom, record.dkim_alignment)
        } else {
            false
        }
    } else {
        false
    };

    // DMARC passes if either SPF or DKIM is aligned
    let pass = spf_aligned || dkim_aligned;

    DmarcResult {
        result: if pass {
            "pass".to_string()
        } else {
            "fail".to_string()
        },
        policy: if pass {
            DmarcPolicy::None
        } else {
            record.policy.clone()
        },
        spf_aligned,
        dkim_aligned,
        details: if pass {
            format!(
                "DMARC pass for {} (SPF aligned: {}, DKIM aligned: {})",
                from_domain, spf_aligned, dkim_aligned
            )
        } else {
            format!(
                "DMARC fail for {} — action: {} (SPF aligned: {}, DKIM aligned: {})",
                from_domain, record.policy, spf_aligned, dkim_aligned
            )
        },
    }
}

/// Check domain alignment.
fn check_alignment(from_domain: &str, auth_domain: &str, mode: AlignmentMode) -> bool {
    let from = from_domain.to_lowercase();
    let auth = auth_domain.to_lowercase();

    match mode {
        AlignmentMode::Strict => from == auth,
        AlignmentMode::Relaxed => {
            // Relaxed: organizational domains must match
            let from_org = organizational_domain(&from);
            let auth_org = organizational_domain(&auth);
            from_org == auth_org
        }
    }
}

/// Extract the organizational domain (simplified: last two labels).
fn organizational_domain(domain: &str) -> String {
    let parts: Vec<&str> = domain.split('.').collect();
    if parts.len() <= 2 {
        domain.to_string()
    } else {
        parts[parts.len() - 2..].join(".")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_dmarc_record() {
        let record = "v=DMARC1; p=reject; adkim=s; aspf=r; pct=100; rua=mailto:dmarc@example.com";
        let parsed = parse_dmarc_record(record).unwrap();
        assert_eq!(parsed.policy, DmarcPolicy::Reject);
        assert_eq!(parsed.dkim_alignment, AlignmentMode::Strict);
        assert_eq!(parsed.spf_alignment, AlignmentMode::Relaxed);
        assert_eq!(parsed.percentage, 100);
    }

    #[test]
    fn test_alignment_relaxed() {
        assert!(check_alignment(
            "mail.example.com",
            "example.com",
            AlignmentMode::Relaxed
        ));
        assert!(!check_alignment(
            "mail.example.com",
            "example.com",
            AlignmentMode::Strict
        ));
    }

    #[test]
    fn test_evaluate_dmarc_pass() {
        let record = "v=DMARC1; p=reject";
        let result = evaluate_dmarc(
            record,
            "example.com",
            Some("example.com"),
            None,
            &SpfResult::Pass,
            false,
        );
        assert_eq!(result.result, "pass");
        assert!(result.spf_aligned);
    }
}
