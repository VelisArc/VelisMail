//! Shared traffic-management utilities.
//!
//! * Trusted-proxy aware client IP extraction.
//! * In-process fixed-window rate limiting (per IP / tenant / route class).
//! * Lightweight Prometheus metrics used by the API gateway.
//! * Validation for user-supplied ("bring your own") PostgreSQL URLs to
//!   prevent SSRF against the VM's private network and cloud metadata service.

use axum::http::HeaderMap;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Maximum accepted length for a user-supplied database URL.
const MAX_DATABASE_URL_LEN: usize = 2048;

/// Extract the real client IP from proxy headers.
///
/// Caddy runs on the same host and always *appends* the peer address to
/// `X-Forwarded-For`. Taking the **last** entry prevents a client from
/// spoofing an arbitrary first entry. When the direct peer is not a trusted
/// proxy (loopback/private address) headers are ignored entirely.
pub fn client_ip(headers: &HeaderMap, peer: Option<IpAddr>) -> IpAddr {
    let peer_is_trusted = peer.map(is_trusted_proxy).unwrap_or(false);

    if peer_is_trusted {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.rsplit(',').next())
            .and_then(parse_ip)
        {
            return ip;
        }
        if let Some(ip) = headers
            .get("x-real-ip")
            .and_then(|value| value.to_str().ok())
            .and_then(parse_ip)
        {
            return ip;
        }
    }

    peer.unwrap_or(IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
}

fn parse_ip(value: &str) -> Option<IpAddr> {
    let value = value.trim().trim_matches('"');
    if let Ok(ip) = value.parse::<IpAddr>() {
        return Some(ip);
    }
    // `host:port` / `[v6]:port`
    if value.starts_with('[') {
        return value
            .strip_prefix('[')
            .and_then(|rest| rest.split(']').next())
            .and_then(|host| host.parse().ok());
    }
    if value.matches(':').count() == 1 {
        return value.split(':').next().and_then(|host| host.parse().ok());
    }
    None
}

/// Whether an address belongs to a trusted reverse proxy.
///
/// The native deployment terminates TLS with Caddy on the same host, so only
/// loopback is trusted by default. Trusting every RFC1918 address would let
/// another VM on the same private network spoof `X-Forwarded-For` and bypass
/// per-IP rate limits.
pub fn is_trusted_proxy(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6
                    .to_ipv4_mapped()
                    .map(|v4| v4.is_loopback())
                    .unwrap_or(false)
        }
    }
}

/// A single fixed-window bucket.
struct Bucket {
    count: u32,
    reset_at: Instant,
}

/// Result of a rate-limit check.
#[derive(Debug, Clone, Copy)]
pub struct RateLimitDecision {
    pub allowed: bool,
    pub limit: u32,
    pub remaining: u32,
    pub retry_after_seconds: u64,
}

/// Simple, dependency-free fixed-window limiter.
///
/// Fixed windows are intentionally used instead of a token bucket: they are
/// cheap, predictable, and return exact `Retry-After` values. State is bounded
/// by evicting expired buckets once the map grows beyond `max_keys`.
pub struct RateLimiter {
    limit: u32,
    window: Duration,
    max_keys: usize,
    buckets: Mutex<HashMap<String, Bucket>>,
}

impl RateLimiter {
    pub fn new(limit_per_window: u32, window: Duration) -> Self {
        Self {
            limit: limit_per_window.max(1),
            window,
            max_keys: 50_000,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn per_minute(limit: u32) -> Self {
        Self::new(limit, Duration::from_secs(60))
    }

    pub fn check(&self, key: &str) -> RateLimitDecision {
        let now = Instant::now();
        let mut buckets = match self.buckets.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if buckets.len() > self.max_keys {
            buckets.retain(|_, bucket| bucket.reset_at > now);
        }

        let bucket = buckets.entry(key.to_string()).or_insert(Bucket {
            count: 0,
            reset_at: now + self.window,
        });

        if now >= bucket.reset_at {
            bucket.count = 0;
            bucket.reset_at = now + self.window;
        }

        let retry_after = bucket
            .reset_at
            .saturating_duration_since(now)
            .as_secs()
            .max(1);

        if bucket.count >= self.limit {
            return RateLimitDecision {
                allowed: false,
                limit: self.limit,
                remaining: 0,
                retry_after_seconds: retry_after,
            };
        }

        bucket.count += 1;
        RateLimitDecision {
            allowed: true,
            limit: self.limit,
            remaining: self.limit.saturating_sub(bucket.count),
            retry_after_seconds: 0,
        }
    }

    pub fn limit(&self) -> u32 {
        self.limit
    }
}

/// Atomic counters rendered in Prometheus text format.
#[derive(Default)]
pub struct Metrics {
    pub requests_total: AtomicU64,
    pub requests_in_flight: AtomicU64,
    pub responses_2xx: AtomicU64,
    pub responses_3xx: AtomicU64,
    pub responses_4xx: AtomicU64,
    pub responses_5xx: AtomicU64,
    pub rate_limited_total: AtomicU64,
    pub overload_total: AtomicU64,
    pub upstream_errors_total: AtomicU64,
    pub request_duration_micros_total: AtomicU64,
}

impl Metrics {
    pub fn observe_request(&self) {
        self.requests_total.fetch_add(1, Ordering::Relaxed);
        self.requests_in_flight.fetch_add(1, Ordering::Relaxed);
    }

    pub fn observe_response(&self, status: u16, duration: Duration) {
        self.requests_in_flight.fetch_sub(1, Ordering::Relaxed);
        self.request_duration_micros_total
            .fetch_add(duration.as_micros() as u64, Ordering::Relaxed);
        match status {
            200..=299 => self.responses_2xx.fetch_add(1, Ordering::Relaxed),
            300..=399 => self.responses_3xx.fetch_add(1, Ordering::Relaxed),
            400..=499 => self.responses_4xx.fetch_add(1, Ordering::Relaxed),
            _ => self.responses_5xx.fetch_add(1, Ordering::Relaxed),
        };
    }

    pub fn render_prometheus(&self, service: &str, version: &str) -> String {
        let requests = self.requests_total.load(Ordering::Relaxed);
        let in_flight = self.requests_in_flight.load(Ordering::Relaxed);
        let duration_total = self.request_duration_micros_total.load(Ordering::Relaxed);
        let avg_seconds = if requests == 0 {
            0.0
        } else {
            (duration_total as f64 / requests as f64) / 1_000_000.0
        };

        format!(
            "# HELP velismail_build_info Build information.\n\
# TYPE velismail_build_info gauge\n\
velismail_build_info{{service=\"{service}\",version=\"{version}\"}} 1\n\
# HELP velismail_http_requests_total Total HTTP requests received.\n\
# TYPE velismail_http_requests_total counter\n\
velismail_http_requests_total{{service=\"{service}\"}} {requests}\n\
# HELP velismail_http_requests_in_flight HTTP requests currently being served.\n\
# TYPE velismail_http_requests_in_flight gauge\n\
velismail_http_requests_in_flight{{service=\"{service}\"}} {in_flight}\n\
# HELP velismail_http_responses_total HTTP responses by status class.\n\
# TYPE velismail_http_responses_total counter\n\
velismail_http_responses_total{{service=\"{service}\",class=\"2xx\"}} {}\n\
velismail_http_responses_total{{service=\"{service}\",class=\"3xx\"}} {}\n\
velismail_http_responses_total{{service=\"{service}\",class=\"4xx\"}} {}\n\
velismail_http_responses_total{{service=\"{service}\",class=\"5xx\"}} {}\n\
# HELP velismail_rate_limited_total Requests rejected by rate limiting.\n\
# TYPE velismail_rate_limited_total counter\n\
velismail_rate_limited_total{{service=\"{service}\"}} {}\n\
# HELP velismail_overload_total Requests rejected because the server was at capacity.\n\
# TYPE velismail_overload_total counter\n\
velismail_overload_total{{service=\"{service}\"}} {}\n\
# HELP velismail_upstream_errors_total Upstream proxy failures.\n\
# TYPE velismail_upstream_errors_total counter\n\
velismail_upstream_errors_total{{service=\"{service}\"}} {}\n\
# HELP velismail_http_request_duration_seconds_avg Average request latency.\n\
# TYPE velismail_http_request_duration_seconds_avg gauge\n\
velismail_http_request_duration_seconds_avg{{service=\"{service}\"}} {avg_seconds}\n",
            self.responses_2xx.load(Ordering::Relaxed),
            self.responses_3xx.load(Ordering::Relaxed),
            self.responses_4xx.load(Ordering::Relaxed),
            self.responses_5xx.load(Ordering::Relaxed),
            self.rate_limited_total.load(Ordering::Relaxed),
            self.overload_total.load(Ordering::Relaxed),
            self.upstream_errors_total.load(Ordering::Relaxed),
        )
    }
}

/// Validate a user-supplied PostgreSQL URL before opening a pool.
///
/// Blocks loopback, RFC1918, link-local and cloud-metadata addresses. Set
/// `ALLOW_PRIVATE_BUSINESS_DB=true` only when the deployment intentionally
/// allows a private database host.
pub async fn validate_external_db_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Database URL is empty.".to_string());
    }
    if trimmed.len() > MAX_DATABASE_URL_LEN {
        return Err("Database URL is too long.".to_string());
    }

    let options = <sqlx::postgres::PgConnectOptions as std::str::FromStr>::from_str(trimmed)
        .map_err(|_| "Invalid PostgreSQL connection string.".to_string())?;

    let host = options.get_host().to_string();
    let port = options.get_port();

    if host.eq_ignore_ascii_case("localhost") && !allow_private_database_hosts() {
        return Err("Private database hosts are not allowed.".to_string());
    }

    let allow_private = allow_private_database_hosts();
    let addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| format!("Unable to resolve database host '{host}'."))?;

    let mut resolved_any = false;
    for addr in addrs {
        resolved_any = true;
        if !allow_private && is_blocked_ip(addr.ip()) {
            return Err(
                "Database host resolves to a private or reserved address, which is not allowed."
                    .to_string(),
            );
        }
    }
    if !resolved_any {
        return Err(format!("Unable to resolve database host '{host}'."));
    }

    // Require TLS for public database providers (Neon et al.) unless the URL
    // already specifies a mode. This protects credentials in transit.
    if !trimmed.to_ascii_lowercase().contains("sslmode=") {
        let separator = if trimmed.contains('?') { '&' } else { '?' };
        return Ok(format!("{trimmed}{separator}sslmode=require"));
    }

    Ok(trimmed.to_string())
}

/// Whether private database hosts are explicitly allowed for this deployment.
pub fn allow_private_database_hosts() -> bool {
    std::env::var("ALLOW_PRIVATE_BUSINESS_DB")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        })
        .unwrap_or(false)
}

/// True for loopback, private, link-local, multicast and metadata addresses.
pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || v4.is_multicast()
                || v4.octets()[0] == 0
                || v4.octets()[0] >= 224
                || (v4.octets()[0] == 169 && v4.octets()[1] == 254)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
                || v6
                    .to_ipv4_mapped()
                    .map(|v4| is_blocked_ip(IpAddr::V4(v4)))
                    .unwrap_or(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (name, value) in pairs {
            map.append(
                axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
                HeaderValue::from_str(value).unwrap(),
            );
        }
        map
    }

    #[test]
    fn uses_last_forwarded_for_entry() {
        let headers = headers(&[("x-forwarded-for", "1.1.1.1, 203.0.113.7")]);
        let ip = client_ip(&headers, Some("127.0.0.1".parse().unwrap()));
        assert_eq!(ip, "203.0.113.7".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn ignores_headers_from_untrusted_peer() {
        let headers = headers(&[("x-forwarded-for", "1.1.1.1")]);
        let ip = client_ip(&headers, Some("198.51.100.9".parse().unwrap()));
        assert_eq!(ip, "198.51.100.9".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn rate_limiter_blocks_after_limit() {
        let limiter = RateLimiter::per_minute(2);
        assert!(limiter.check("a").allowed);
        assert!(limiter.check("a").allowed);
        let third = limiter.check("a");
        assert!(!third.allowed);
        assert_eq!(third.remaining, 0);
        assert!(limiter.check("b").allowed);
    }

    #[test]
    fn blocks_private_addresses() {
        assert!(is_blocked_ip("127.0.0.1".parse().unwrap()));
        assert!(is_blocked_ip("10.0.0.5".parse().unwrap()));
        assert!(is_blocked_ip("169.254.169.254".parse().unwrap()));
        assert!(!is_blocked_ip("8.8.8.8".parse().unwrap()));
    }
}
