//! Bounce handling

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BounceType {
    Hard,
    Soft,
    Transient,
    Complaint,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BounceRecord {
    pub email: String,
    pub bounce_type: BounceType,
    pub reason: String,
    pub timestamp: String,
}

/// Process a bounce notification
pub fn process_bounce(bounce: BounceRecord) {
    match bounce.bounce_type {
        BounceType::Hard => {
            // Hard bounce: remove from mailing list immediately
            // In production: update database
        }
        BounceType::Soft => {
            // Soft bounce: retry a few times
        }
        BounceType::Transient => {
            // Transient: retry with exponential backoff
        }
        BounceType::Complaint => {
            // Spam complaint: flag user and review
        }
    }
}

/// Retry logic for soft bounces
pub struct RetryPolicy {
    pub max_retries: u32,
    pub backoff_seconds: Vec<u64>,
}

impl RetryPolicy {
    pub fn default_soft() -> Self {
        Self {
            max_retries: 3,
            backoff_seconds: vec![300, 900, 3600], // 5min, 15min, 1hr
        }
    }
}
