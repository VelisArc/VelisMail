//! VelisMail Common Types and Utilities
//!
//! Shared types used across all VelisMail services.

pub mod auth;
pub mod error;
pub mod response;
pub mod tenant;
pub mod types;

pub use auth::*;
pub use error::*;
pub use response::*;
pub use tenant::*;
pub use types::*;
