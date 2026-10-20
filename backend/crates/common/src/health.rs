//! Standardized health check models and logic

use serde::{Deserialize, Serialize};

/// Status levels for dependencies and services
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DependencyStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

/// Structured health response for all microservices
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: DependencyStatus,
    pub service: String,
    pub version: String,
    pub timestamp: String,
    pub db: DependencyStatus,
    pub redis: Option<DependencyStatus>,
    pub s3: Option<DependencyStatus>,
}

impl HealthResponse {
    /// Helper to build health responses consistently
    pub fn new(
        service: &str,
        version: &str,
        db_healthy: bool,
        redis_healthy: Option<bool>,
        s3_healthy: Option<bool>,
    ) -> Self {
        let db = if db_healthy {
            DependencyStatus::Healthy
        } else {
            DependencyStatus::Unhealthy
        };

        let redis = redis_healthy.map(|h| {
            if h {
                DependencyStatus::Healthy
            } else {
                DependencyStatus::Unhealthy
            }
        });

        let s3 = s3_healthy.map(|h| {
            if h {
                DependencyStatus::Healthy
            } else {
                DependencyStatus::Unhealthy
            }
        });

        let mut status = DependencyStatus::Healthy;
        if db == DependencyStatus::Unhealthy
            || redis.as_ref() == Some(&DependencyStatus::Unhealthy)
            || s3.as_ref() == Some(&DependencyStatus::Unhealthy)
        {
            status = DependencyStatus::Unhealthy;
        } else if redis.as_ref() == Some(&DependencyStatus::Degraded)
            || s3.as_ref() == Some(&DependencyStatus::Degraded)
        {
            status = DependencyStatus::Degraded;
        }

        Self {
            status,
            service: service.to_string(),
            version: version.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            db,
            redis,
            s3,
        }
    }
}
