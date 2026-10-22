//! VelisMail Common Types and Utilities
//!
//! Shared types used across all VelisMail services.

pub mod auth;
pub mod config;
pub mod error;
pub mod health;
pub mod middleware;
pub mod plans;
pub mod response;
pub mod tenant;
pub mod traffic;
pub mod types;

/// Install a process-wide rustls crypto provider.
///
/// `sqlx`, `redis` and `reqwest` can each enable a different rustls provider
/// feature. rustls refuses to guess when more than one is compiled in, so the
/// first TLS connection panics unless a provider is installed explicitly.
pub fn init_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

pub use auth::*;
pub use config::*;
pub use error::*;
pub use health::*;
pub use middleware::*;
pub use plans::*;
pub use response::*;
pub use tenant::*;
pub use traffic::*;
pub use types::*;
