//! Shared configuration helpers and patterns

use anyhow::{Context, Result};

/// Read a required environment variable, returning an error if missing.
pub fn required_env(name: &str) -> Result<String> {
    std::env::var(name).with_context(|| format!("missing required environment variable {name}"))
}

/// Read an optional environment variable, filtering out empty values.
pub fn optional_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.trim().is_empty())
}
