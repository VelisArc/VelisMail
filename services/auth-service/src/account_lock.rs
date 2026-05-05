#![allow(dead_code)]
//! Account locking for failed authentication attempts

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;
use velismail_common::UserId;

/// Account lock manager
pub struct AccountLockManager {
    db: PgPool,
    redis: Arc<redis::Client>,
    max_failed_attempts: u32,
    lockout_duration_minutes: i64,
    window_duration_minutes: i64,
}

impl AccountLockManager {
    pub fn new(
        db: PgPool,
        redis: Arc<redis::Client>,
        max_failed_attempts: u32,
        lockout_duration_minutes: i64,
        window_duration_minutes: i64,
    ) -> Self {
        Self {
            db,
            redis,
            max_failed_attempts,
            lockout_duration_minutes,
            window_duration_minutes,
        }
    }

    /// Record a failed login attempt
    pub async fn record_failed_attempt(
        &self,
        user_id: Option<UserId>,
        email: &str,
        ip_address: &str,
    ) -> Result<()> {
        let now = Utc::now();
        let attempt_id = Uuid::new_v4();

        // Store in database
        sqlx::query(
            r#"INSERT INTO failed_login_attempts
               (id, user_id, email, ip_address, attempted_at)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(attempt_id)
        .bind(user_id.map(|id| id.0))
        .bind(email)
        .bind(ip_address)
        .bind(now)
        .execute(&self.db)
        .await?;

        // Also store in Redis for fast checking
        let redis_key = self.failed_attempts_key(email);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;

        // Add to sorted set with timestamp as score
        redis::cmd("ZADD")
            .arg(&redis_key)
            .arg(now.timestamp())
            .arg(attempt_id.to_string())
            .query_async::<_, ()>(&mut conn)
            .await?;

        // Set expiry on the key
        redis::cmd("EXPIRE")
            .arg(&redis_key)
            .arg(self.window_duration_minutes * 60)
            .query_async::<_, ()>(&mut conn)
            .await?;

        Ok(())
    }

    /// Check if account is locked
    pub async fn is_account_locked(&self, email: &str) -> Result<bool> {
        let redis_key = self.failed_attempts_key(email);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;

        // Get count of attempts in the last window
        let window_start = Utc::now() - Duration::minutes(self.window_duration_minutes);
        let count: u32 = redis::cmd("ZCOUNT")
            .arg(&redis_key)
            .arg(window_start.timestamp())
            .arg("+inf")
            .query_async(&mut conn)
            .await?;

        Ok(count >= self.max_failed_attempts)
    }

    /// Clear failed attempts (e.g., after successful login)
    pub async fn clear_failed_attempts(&self, email: &str) -> Result<()> {
        let redis_key = self.failed_attempts_key(email);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;

        redis::cmd("DEL")
            .arg(&redis_key)
            .query_async::<_, ()>(&mut conn)
            .await?;

        // Also clean up old database records
        let cutoff = Utc::now() - Duration::minutes(self.window_duration_minutes);
        sqlx::query("DELETE FROM failed_login_attempts WHERE email = $1 AND attempted_at < $2")
            .bind(email)
            .bind(cutoff)
            .execute(&self.db)
            .await?;

        Ok(())
    }

    /// Get lockout expiry time
    pub async fn get_lockout_expiry(&self, email: &str) -> Result<Option<DateTime<Utc>>> {
        if !self.is_account_locked(email).await? {
            return Ok(None);
        }

        // Find the time of the (max_failed_attempts)th attempt
        let redis_key = self.failed_attempts_key(email);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;

        let scores: Vec<i64> = redis::cmd("ZRANGE")
            .arg(&redis_key)
            .arg(0)
            .arg(self.max_failed_attempts as isize - 1)
            .arg("WITHSCORES")
            .query_async(&mut conn)
            .await?;

        // Get the timestamp of the last (max_failed_attempts)th attempt
        if let Some(last_score) = scores.last() {
            let lockout_start =
                DateTime::<Utc>::from_timestamp(*last_score, 0).unwrap_or_else(Utc::now);
            let lockout_end = lockout_start + Duration::minutes(self.lockout_duration_minutes);
            Ok(Some(lockout_end))
        } else {
            Ok(None)
        }
    }

    /// Get failed attempts count in current window
    pub async fn get_failed_attempts_count(&self, email: &str) -> Result<u32> {
        let redis_key = self.failed_attempts_key(email);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;

        let window_start = Utc::now() - Duration::minutes(self.window_duration_minutes);
        let count: u32 = redis::cmd("ZCOUNT")
            .arg(&redis_key)
            .arg(window_start.timestamp())
            .arg("+inf")
            .query_async(&mut conn)
            .await?;

        Ok(count)
    }

    fn failed_attempts_key(&self, email: &str) -> String {
        format!("failed_attempts:{}", email)
    }
}

/// Failed login attempt record
#[derive(Debug, Clone)]
pub struct FailedLoginAttempt {
    pub id: Uuid,
    pub user_id: Option<Uuid>,
    pub email: String,
    pub ip_address: String,
    pub attempted_at: DateTime<Utc>,
}

