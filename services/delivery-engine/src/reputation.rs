//! IP reputation tracking

use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;

pub struct ReputationTracker {
    db: PgPool,
}

impl ReputationTracker {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Track send reputation for an IP
    pub async fn track_send(&self, ip: &str, success: bool) -> Result<()> {
        sqlx::query(
            r#"INSERT INTO ip_reputation (ip_address, sent_count, success_count, last_seen, updated_at)
               VALUES ($1, 1, $2, NOW(), NOW())
               ON CONFLICT (ip_address) DO UPDATE SET
                 sent_count = ip_reputation.sent_count + 1,
                 success_count = ip_reputation.success_count + $2,
                 last_seen = NOW(),
                 updated_at = NOW()"#,
        )
        .bind(ip)
        .bind(if success { 1 } else { 0 })
        .execute(&self.db)
        .await?;

        Ok(())
    }

    /// Get reputation score (0-100)
    pub async fn get_score(&self, ip: &str) -> Result<f64> {
        let row: Option<(i64, i64)> = sqlx::query_as(
            "SELECT sent_count, success_count FROM ip_reputation WHERE ip_address = $1",
        )
        .bind(ip)
        .fetch_optional(&self.db)
        .await?;

        if let Some((sent, success)) = row {
            if sent == 0 {
                return Ok(50.0); // New IP
            }
            let score = (success as f64 / sent as f64) * 100.0;
            Ok(score)
        } else {
            Ok(50.0) // No data
        }
    }

    /// Check if IP is in warm-up phase
    pub async fn is_warming_up(&self, ip: &str) -> Result<bool> {
        let days_old: Option<i64> = sqlx::query_scalar(
            "SELECT EXTRACT(DAY FROM NOW() - created_at)::integer FROM ip_reputation WHERE ip_address = $1",
        )
        .bind(ip)
        .fetch_optional(&self.db)
        .await?;

        Ok(days_old.map(|d| d < 30).unwrap_or(true))
    }
}
