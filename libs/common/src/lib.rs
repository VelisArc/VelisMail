//! VelisMail Common Types and Utilities
//! 
//! Shared types used across all VelisMail services.

pub mod types;
pub mod error;
pub mod response;
pub mod auth;
pub mod tenant;

pub use types::*;
pub use error::*;
pub use response::*;
pub use auth::*;
pub use tenant::*;
