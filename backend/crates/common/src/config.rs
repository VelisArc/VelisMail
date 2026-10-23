//! Shared configuration helpers and patterns

use anyhow::{bail, Context, Result};

/// Read a required environment variable, returning an error if missing.
pub fn required_env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("missing required environment variable {name}"))
}

/// Read an optional environment variable, filtering out empty values.
pub fn optional_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}

/// Reject signing/encryption material that is missing, short or still a
/// template value. A weak shared secret lets anybody who can guess it mint a
/// valid session for every account on the platform.
pub fn require_strong_secret(name: &str, value: &str) -> Result<()> {
    let value = value.trim();
    if value.len() < 32 {
        bail!("{name} must be at least 32 characters long");
    }
    let normalized = value.to_ascii_lowercase();
    let placeholders = [
        "replace",
        "generate-a-",
        "changeme",
        "change-me",
        "your-secret",
        "secret-key",
        "example",
        "placeholder",
        "xxxx",
    ];
    if placeholders
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        bail!("{name} is still set to a placeholder value");
    }
    Ok(())
}

/// Consumer mailbox providers (`gmail.com`, `outlook.com`, ...) are not
/// company identities. Sharing one workspace per public domain would let
/// unrelated users see each other's team, templates and contacts, so accounts
/// on these domains always get a private workspace instead.
pub fn is_public_email_domain(domain: &str) -> bool {
    const PUBLIC_DOMAINS: &[&str] = &[
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "yahoo.com",
        "yahoo.co.in",
        "ymail.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "aol.com",
        "proton.me",
        "protonmail.com",
        "pm.me",
        "gmx.com",
        "gmx.net",
        "mail.com",
        "email.com",
        "yandex.com",
        "yandex.ru",
        "zoho.com",
        "fastmail.com",
        "hey.com",
        "tutanota.com",
        "tuta.com",
        "qq.com",
        "163.com",
        "126.com",
        "rediffmail.com",
    ];
    PUBLIC_DOMAINS
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(domain.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_mail_domains_are_not_workspaces() {
        assert!(is_public_email_domain("gmail.com"));
        assert!(is_public_email_domain("GMAIL.COM"));
        assert!(!is_public_email_domain("acme.com"));
        assert!(!is_public_email_domain("velismail.online"));
    }

    #[test]
    fn weak_secrets_are_rejected() {
        assert!(require_strong_secret("JWT_SECRET", "short").is_err());
        assert!(require_strong_secret(
            "JWT_SECRET",
            "generate-a-long-random-secret-at-least-64-chars"
        )
        .is_err());
        assert!(
            require_strong_secret("JWT_SECRET", "8c8f1b0e0d5a4c3b9e2f7a6d1c0b9a8f7e6d5c4b").is_ok()
        );
    }
}
