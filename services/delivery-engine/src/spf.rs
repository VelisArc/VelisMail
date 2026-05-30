//! SPF record parsing and IP authorization checking.
//!
//! Evaluates SPF policies per RFC 7208 to determine whether a sending IP
//! is authorized for a domain.

use serde::{Deserialize, Serialize};
use std::net::IpAddr;

/// SPF check result per RFC 7208
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SpfResult {
    Pass,
    Fail,
    SoftFail,
    Neutral,
    None,
    TempError,
    PermError,
}

impl std::fmt::Display for SpfResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SpfResult::Pass => write!(f, "pass"),
            SpfResult::Fail => write!(f, "fail"),
            SpfResult::SoftFail => write!(f, "softfail"),
            SpfResult::Neutral => write!(f, "neutral"),
            SpfResult::None => write!(f, "none"),
            SpfResult::TempError => write!(f, "temperror"),
            SpfResult::PermError => write!(f, "permerror"),
        }
    }
}

/// Parsed SPF mechanism
#[derive(Debug, Clone)]
pub enum SpfMechanism {
    All,
    Ip4(String),
    Ip6(String),
    A(Option<String>),
    Mx(Option<String>),
    Include(String),
    Redirect(String),
}

/// SPF qualifier
#[derive(Debug, Clone, Copy)]
pub enum SpfQualifier {
    Pass,     // +
    Fail,     // -
    SoftFail, // ~
    Neutral,  // ?
}

/// A parsed SPF directive (qualifier + mechanism)
#[derive(Debug, Clone)]
pub struct SpfDirective {
    pub qualifier: SpfQualifier,
    pub mechanism: SpfMechanism,
}

/// Parse an SPF record string into directives.
pub fn parse_spf_record(record: &str) -> Result<Vec<SpfDirective>, String> {
    let trimmed = record.trim();
    if !trimmed.starts_with("v=spf1") {
        return Err("Not a valid SPF record (must start with v=spf1)".to_string());
    }

    let mut directives = Vec::new();

    for token in trimmed.split_whitespace().skip(1) {
        let (qualifier, mechanism_str) = match token.chars().next() {
            Some('+') => (SpfQualifier::Pass, &token[1..]),
            Some('-') => (SpfQualifier::Fail, &token[1..]),
            Some('~') => (SpfQualifier::SoftFail, &token[1..]),
            Some('?') => (SpfQualifier::Neutral, &token[1..]),
            _ => (SpfQualifier::Pass, token), // default qualifier is +
        };

        let mechanism = if mechanism_str == "all" {
            SpfMechanism::All
        } else if let Some(cidr) = mechanism_str.strip_prefix("ip4:") {
            SpfMechanism::Ip4(cidr.to_string())
        } else if let Some(cidr) = mechanism_str.strip_prefix("ip6:") {
            SpfMechanism::Ip6(cidr.to_string())
        } else if mechanism_str == "a" {
            SpfMechanism::A(None)
        } else if let Some(domain) = mechanism_str.strip_prefix("a:") {
            SpfMechanism::A(Some(domain.to_string()))
        } else if mechanism_str == "mx" {
            SpfMechanism::Mx(None)
        } else if let Some(domain) = mechanism_str.strip_prefix("mx:") {
            SpfMechanism::Mx(Some(domain.to_string()))
        } else if let Some(domain) = mechanism_str.strip_prefix("include:") {
            SpfMechanism::Include(domain.to_string())
        } else if let Some(domain) = mechanism_str.strip_prefix("redirect=") {
            SpfMechanism::Redirect(domain.to_string())
        } else {
            continue; // Skip unknown mechanisms
        };

        directives.push(SpfDirective {
            qualifier,
            mechanism,
        });
    }

    Ok(directives)
}

/// Check if a sender IP matches an SPF record.
///
/// This performs a simplified local check (ip4/ip6/all mechanisms).
/// For full compliance, DNS-dependent mechanisms (a, mx, include) would
/// require async DNS resolution.
pub fn check_ip_against_spf(record: &str, sender_ip: &str) -> SpfResult {
    let ip: IpAddr = match sender_ip.parse() {
        Ok(ip) => ip,
        Err(_) => return SpfResult::PermError,
    };

    let directives = match parse_spf_record(record) {
        Ok(d) => d,
        Err(_) => return SpfResult::PermError,
    };

    for directive in &directives {
        let matches = match &directive.mechanism {
            SpfMechanism::All => true,
            SpfMechanism::Ip4(cidr) => ip_matches_cidr(&ip, cidr),
            SpfMechanism::Ip6(cidr) => ip_matches_cidr(&ip, cidr),
            // DNS-dependent mechanisms — would need async resolution
            SpfMechanism::A(_) | SpfMechanism::Mx(_) | SpfMechanism::Include(_) => false,
            SpfMechanism::Redirect(_) => false,
        };

        if matches {
            return match directive.qualifier {
                SpfQualifier::Pass => SpfResult::Pass,
                SpfQualifier::Fail => SpfResult::Fail,
                SpfQualifier::SoftFail => SpfResult::SoftFail,
                SpfQualifier::Neutral => SpfResult::Neutral,
            };
        }
    }

    SpfResult::Neutral
}

/// Simple CIDR matching for IPv4 and IPv6.
fn ip_matches_cidr(ip: &IpAddr, cidr: &str) -> bool {
    if let Some((network_str, prefix_str)) = cidr.split_once('/') {
        let network: IpAddr = match network_str.parse() {
            Ok(n) => n,
            Err(_) => return false,
        };
        let prefix_len: u32 = match prefix_str.parse() {
            Ok(p) => p,
            Err(_) => return false,
        };

        match (ip, &network) {
            (IpAddr::V4(ip4), IpAddr::V4(net4)) => {
                if prefix_len > 32 {
                    return false;
                }
                let mask = if prefix_len == 0 {
                    0u32
                } else {
                    !0u32 << (32 - prefix_len)
                };
                (u32::from(*ip4) & mask) == (u32::from(*net4) & mask)
            }
            (IpAddr::V6(ip6), IpAddr::V6(net6)) => {
                if prefix_len > 128 {
                    return false;
                }
                let ip_bits = u128::from(*ip6);
                let net_bits = u128::from(*net6);
                let mask = if prefix_len == 0 {
                    0u128
                } else {
                    !0u128 << (128 - prefix_len)
                };
                (ip_bits & mask) == (net_bits & mask)
            }
            _ => false,
        }
    } else {
        // Exact IP match (no CIDR prefix)
        cidr.parse::<IpAddr>().map(|n| *ip == n).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_spf_record() {
        let record = "v=spf1 ip4:192.168.1.0/24 ip4:10.0.0.1 ~all";
        let directives = parse_spf_record(record).unwrap();
        assert_eq!(directives.len(), 3);
    }

    #[test]
    fn test_ip4_match() {
        let record = "v=spf1 ip4:192.168.1.0/24 -all";
        assert_eq!(check_ip_against_spf(record, "192.168.1.100"), SpfResult::Pass);
        assert_eq!(check_ip_against_spf(record, "10.0.0.1"), SpfResult::Fail);
    }

    #[test]
    fn test_exact_ip_match() {
        let record = "v=spf1 ip4:203.0.113.5 -all";
        assert_eq!(check_ip_against_spf(record, "203.0.113.5"), SpfResult::Pass);
        assert_eq!(check_ip_against_spf(record, "203.0.113.6"), SpfResult::Fail);
    }

    #[test]
    fn test_softfail() {
        let record = "v=spf1 ip4:10.0.0.0/8 ~all";
        assert_eq!(check_ip_against_spf(record, "1.2.3.4"), SpfResult::SoftFail);
    }
}
