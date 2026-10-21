//! Domain DNS requirements.
//!
//! The customer has to publish a handful of records before the domain can
//! send or receive mail. The exact records - including the record *name* and
//! the value - come from the mail provider, and every one of them is checked
//! against the live DNS so the console can say precisely what is still
//! missing instead of guessing.

use serde_json::Value;
use std::time::Duration;
use tokio::time::timeout;

/// A record the customer has to publish.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsRequirement {
    /// MX or TXT.
    pub record_type: String,
    /// The name to enter in the DNS provider (`@` for the root domain).
    pub name: String,
    /// The fully qualified host the record lives on.
    pub host: String,
    /// The value to publish.
    pub value: String,
    /// The TTL to use.
    pub ttl: u32,
    /// What the record is for.
    pub purpose: String,
    /// verified, missing, mismatch or pending.
    pub status: String,
    /// What the DNS currently returns.
    pub actual: String,
    /// How the published value is compared: `exact` or `prefix`.
    pub match_mode: String,
}

const DNS_TIMEOUT: Duration = Duration::from_secs(8);

fn normalize(value: &str) -> String {
    value
        .trim()
        .trim_end_matches('.')
        .trim_matches('"')
        .replace("\" \"", "")
        .to_ascii_lowercase()
}

/// Resolve a host for a record name: `@` and an empty name mean the root.
pub fn host_for(domain: &str, name: &str) -> String {
    let name = name.trim().trim_end_matches('.');
    if name.is_empty() || name == "@" {
        domain.trim().trim_end_matches('.').to_ascii_lowercase()
    } else {
        format!(
            "{}.{}",
            name.trim_end_matches('.').to_ascii_lowercase(),
            domain.trim().trim_end_matches('.').to_ascii_lowercase()
        )
    }
}

/// Query DNS over HTTPS.
pub async fn query(
    client: &reqwest::Client,
    host: &str,
    record_type: &str,
) -> Result<Vec<String>, String> {
    let response = timeout(
        DNS_TIMEOUT,
        client
            .get("https://dns.google/resolve")
            .query(&[("name", host), ("type", record_type)])
            .header("accept", "application/dns-json")
            .send(),
    )
    .await
    .map_err(|_| format!("DNS lookup for {host} ({record_type}) timed out."))?
    .map_err(|err| format!("DNS lookup for {host} ({record_type}) failed: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "DNS lookup for {host} ({record_type}) returned status {}.",
            response.status()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| format!("Invalid DNS response for {host}: {err}"))?;

    Ok(payload["Answer"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| item["data"].as_str().map(normalize))
        .collect())
}

/// The inbound MX host of a Resend region, derived from the sending MX.
pub fn resend_inbound_mx_for(sending_mx: &str) -> Option<String> {
    let host = normalize(sending_mx);
    let rest = host.strip_prefix("feedback-smtp.")?;
    let region = rest
        .strip_suffix(".amazonaws.com")
        .or_else(|| rest.strip_suffix(".amazonses.com"))?;
    Some(format!("inbound-smtp.{}.amazonaws.com", region))
}

/// Build the list of records a domain has to publish.
///
/// The provider is the source of truth while a domain is still being set up.
/// Once the provider reports the domain as verified it stops returning the
/// records, so the requirements are then discovered from the live DNS and from
/// the platform's own sending configuration.
pub async fn requirements(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    domain: &str,
    platform_spf: &str,
    dkim_selector: &str,
) -> (String, Vec<DnsRequirement>) {
    let domain = domain.trim().trim_end_matches('.').to_ascii_lowercase();
    let mut records: Vec<DnsRequirement> = Vec::new();

    let mut inbound_mx: Option<String> = None;
    let mut sending_domain = domain.clone();
    let mut provider_records = 0usize;

    if provider.eq_ignore_ascii_case("resend") && !api_key.trim().is_empty() {
        if let Ok(Some(entry)) = fetch_resend_domain(client, api_key, &domain).await {
            sending_domain = entry
                .get("sending_domain")
                .and_then(Value::as_str)
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_else(|| domain.clone());
            for record in entry
                .get("records")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                let record_type = record
                    .get("record_type")
                    .or_else(|| record.get("type"))
                    .and_then(Value::as_str)
                    .unwrap_or("TXT")
                    .to_ascii_uppercase();
                let name = record
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("@")
                    .to_string();
                let value = record
                    .get("value")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if value.is_empty() {
                    continue;
                }
                provider_records += 1;
                let purpose = match record.get("tag").and_then(Value::as_str).unwrap_or("") {
                    "SPF" => "Authorises the sending server for this domain",
                    "DKIM" => "Signs outgoing mail so receivers can verify it",
                    "MX" => "Routes the outgoing mail through the provider",
                    _ => "Required for mail delivery",
                };
                if record_type == "MX" {
                    if let Some(inbound) = resend_inbound_mx_for(&value) {
                        inbound_mx = Some(inbound);
                    }
                }
                records.push(DnsRequirement {
                    record_type: record_type.clone(),
                    name: name.clone(),
                    // Provider record names are relative to the registered
                    // domain, not to the sending subdomain.
                    host: host_for(&domain, &name),
                    value: value.clone(),
                    ttl: 3600,
                    purpose: purpose.to_string(),
                    status: "pending".to_string(),
                    actual: String::new(),
                    match_mode: if record_type == "TXT" && purpose.starts_with("Authorises") {
                        "spf".to_string()
                    } else {
                        "exact".to_string()
                    },
                });
            }
        }
    }

    // The provider no longer returns the records for a verified domain, so the
    // requirements are discovered from the live DNS instead.
    if provider_records == 0 {
        let (host, name) = discover_sending_host(client, &domain).await;
        sending_domain = host.clone();
        if let Some(mx_host) = sending_mx_host(client, &host).await {
            if let Some(inbound) = resend_inbound_mx_for(&mx_host) {
                inbound_mx = Some(inbound);
            }
        }
        let spf_value = if platform_spf.trim().is_empty() {
            "v=spf1 include:amazonses.com ~all".to_string()
        } else {
            platform_spf.trim().to_string()
        };
        records.push(DnsRequirement {
            record_type: "TXT".to_string(),
            name: name.clone(),
            host: host.clone(),
            value: spf_value,
            ttl: 3600,
            purpose: "Authorises the sending server for this domain".to_string(),
            status: "pending".to_string(),
            actual: String::new(),
            match_mode: "spf".to_string(),
        });
        let selector = if dkim_selector.trim().is_empty() {
            "resend".to_string()
        } else {
            dkim_selector.trim().to_string()
        };
        records.push(DnsRequirement {
            record_type: "TXT".to_string(),
            name: format!("{selector}._domainkey"),
            host: format!("{selector}._domainkey.{domain}"),
            value: String::new(),
            ttl: 3600,
            purpose: "Signs outgoing mail so receivers can verify it".to_string(),
            status: "pending".to_string(),
            actual: String::new(),
            match_mode: "exists".to_string(),
        });
    }

    // Receiving. Without this the domain can send but never receive.
    let inbound_host = inbound_mx
        .clone()
        .unwrap_or_else(|| "inbound-smtp.us-east-1.amazonaws.com".to_string());
    records.push(DnsRequirement {
        record_type: "MX".to_string(),
        name: "@".to_string(),
        host: domain.clone(),
        value: inbound_host,
        ttl: 3600,
        purpose: "Enable receiving - inbound mail for this domain".to_string(),
        status: "pending".to_string(),
        actual: String::new(),
        // Any Resend inbound host of the right region is accepted.
        match_mode: "resend_inbound".to_string(),
    });

    // DMARC tells receivers what to do with mail that fails SPF and DKIM.
    records.push(DnsRequirement {
        record_type: "TXT".to_string(),
        name: "_dmarc".to_string(),
        host: format!("_dmarc.{}", domain),
        value: "v=DMARC1; p=quarantine; pct=100; rua=mailto:postmaster@velismail.online"
            .to_string(),
        ttl: 3600,
        purpose: "Policy for receivers when a message fails SPF or DKIM".to_string(),
        status: "pending".to_string(),
        actual: String::new(),
        // Any valid DMARC1 policy is accepted, but only one record may exist.
        match_mode: "prefix".to_string(),
    });

    (sending_domain, records)
}

/// Find the host that actually sends the mail for this domain.
async fn discover_sending_host(client: &reqwest::Client, domain: &str) -> (String, String) {
    for name in ["send", "@"] {
        let host = host_for(domain, name);
        if let Ok(answers) = query(client, &host, "MX").await {
            let has_provider_mx = answers.iter().any(|answer| {
                let mx_host = answer.split_whitespace().last().unwrap_or(answer);
                mx_host.contains("feedback-smtp.")
            });
            if has_provider_mx {
                return (host, name.to_string());
            }
        }
    }
    (domain.to_string(), "@".to_string())
}

/// The sending MX host of a domain, when it is published.
async fn sending_mx_host(client: &reqwest::Client, host: &str) -> Option<String> {
    let answers = query(client, host, "MX").await.ok()?;
    answers
        .iter()
        .map(|answer| {
            answer
                .split_whitespace()
                .last()
                .unwrap_or(answer)
                .to_string()
        })
        .find(|value| value.contains("feedback-smtp."))
}

/// Fetch a domain entry from the Resend API.
async fn fetch_resend_domain(
    client: &reqwest::Client,
    api_key: &str,
    domain: &str,
) -> Result<Option<Value>, String> {
    let response = timeout(
        DNS_TIMEOUT,
        client
            .get("https://api.resend.com/domains")
            .bearer_auth(api_key)
            .send(),
    )
    .await
    .map_err(|_| "The mail provider did not answer in time.".to_string())?
    .map_err(|err| format!("Could not reach the mail provider: {err}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "The mail provider rejected the domain lookup with status {}.",
            response.status()
        ));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|err| format!("Invalid mail provider response: {err}"))?;

    Ok(payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries.iter().find(|entry| {
                entry
                    .get("name")
                    .or_else(|| entry.get("domain"))
                    .and_then(Value::as_str)
                    .map(|name| name.eq_ignore_ascii_case(domain))
                    .unwrap_or(false)
            })
        })
        .cloned())
}

/// Check every requirement against the live DNS.
pub async fn verify(
    client: &reqwest::Client,
    mut records: Vec<DnsRequirement>,
) -> Vec<DnsRequirement> {
    for record in records.iter_mut() {
        let answers = match query(client, &record.host, &record.record_type).await {
            Ok(answers) => answers,
            Err(err) => {
                record.status = "unknown".to_string();
                record.actual = err;
                continue;
            }
        };
        record.actual = if answers.is_empty() {
            format!(
                "No {} record found for {}.",
                record.record_type, record.host
            )
        } else {
            answers.join(", ")
        };

        if record.record_type == "MX" && record.match_mode == "resend_inbound" {
            // The inbound host depends on the region, so any Resend inbound MX
            // of the domain counts as enabled receiving.
            let found = answers.iter().any(|answer| {
                let host = normalize(answer.split_whitespace().last().unwrap_or(answer));
                host.starts_with("inbound-smtp.") && host.ends_with(".amazonaws.com")
            });
            record.status = if found { "verified" } else { "mismatch" }.to_string();
        } else if record.record_type == "MX" {
            let expected = normalize(
                record
                    .value
                    .split_whitespace()
                    .last()
                    .unwrap_or(&record.value),
            );
            let found = answers.iter().any(|answer| {
                let host = answer.split_whitespace().last().unwrap_or(answer);
                normalize(host) == expected
            });
            record.status = if found { "verified" } else { "mismatch" }.to_string();
        } else if record.match_mode == "prefix" {
            // DMARC: any valid policy is accepted, but a second record on the
            // same host makes the policy ambiguous, so the extra answer is
            // reported as a mismatch.
            let policies = answers
                .iter()
                .filter(|answer| answer.to_lowercase().starts_with("v=dmarc1"))
                .count();
            record.status = if policies == 1 {
                "verified"
            } else {
                "mismatch"
            }
            .to_string();
        } else if record.match_mode == "exists" {
            record.status = if answers.is_empty() {
                "mismatch".to_string()
            } else {
                "verified".to_string()
            };
        } else if record.match_mode == "spf" {
            // SPF: a policy that starts with v=spf1 and authorises the
            // sending service. The exact value may differ, the policy may not.
            let found = answers.iter().any(|answer| {
                let value = answer.to_lowercase();
                value.starts_with("v=spf1") && value.contains("amazonses")
            });
            record.status = if found { "verified" } else { "mismatch" }.to_string();
        } else {
            let expected = normalize(&record.value);
            let found = answers
                .iter()
                .any(|answer| answer == &expected || answer.contains(&expected));
            record.status = if found { "verified" } else { "mismatch" }.to_string();
        }
    }
    records
}

/// True when every record is published and matches.
pub fn is_complete(records: &[DnsRequirement]) -> bool {
    !records.is_empty() && records.iter().all(|record| record.status == "verified")
}
