use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;
use velismail_common::UserId;

pub struct AccountLockManager {
    db: PgPool,
    redis: Option<Arc<redis::Client>>,
    max_failed_attempts: u32,
    lockout_duration_minutes: i64,
    window_duration_minutes: i64,
}

impl AccountLockManager {
    pub fn new(
        db: PgPool,
        redis: Option<Arc<redis::Client>>,
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

    pub async fn record_failed_attempt(
        &self,
        user_id: Option<UserId>,
        email: &str,
        ip_address: &str,
    ) -> Result<()> {
        let now = Utc::now();
        let attempt_id = Uuid::new_v4();

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

        if let Some(ref redis) = self.redis {
            let redis_key = self.failed_attempts_key(email);
            match redis.get_multiplexed_async_connection().await {
                Ok(mut conn) => {
                    let _ = redis::cmd("ZADD")
                        .arg(&redis_key)
                        .arg(now.timestamp())
                        .arg(attempt_id.to_string())
                        .query_async::<()>(&mut conn)
                        .await;
                    let _ = redis::cmd("EXPIRE")
                        .arg(&redis_key)
                        .arg(self.window_duration_minutes * 60)
                        .query_async::<()>(&mut conn)
                        .await;
                }
                Err(err) => {
                    tracing::warn!(
                        "redis unavailable while recording failed login for {}; database record kept: {}",
                        email,
                        err
                    );
                }
            }
        }

        Ok(())
    }

    pub async fn is_account_locked(&self, email: &str) -> Result<bool> {
        let window_start = Utc::now() - Duration::minutes(self.window_duration_minutes);
        let lockout_cutoff = Utc::now() - Duration::minutes(self.lockout_duration_minutes);

        if let Some(ref redis) = self.redis {
            let redis_key = self.failed_attempts_key(email);
            match redis.get_multiplexed_async_connection().await {
                Ok(mut conn) => {
                    let count: u32 = redis::cmd("ZCOUNT")
                        .arg(&redis_key)
                        .arg(window_start.timestamp())
                        .arg("+inf")
                        .query_async(&mut conn)
                        .await?;
                    if count < self.max_failed_attempts {
                        return Ok(false);
                    }
                    // The threshold is only reached recently; the lock lasts
                    // for LOCKOUT_DURATION after the newest failure.
                    let latest: Vec<String> = redis::cmd("ZREVRANGE")
                        .arg(&redis_key)
                        .arg(0)
                        .arg(0)
                        .arg("WITHSCORES")
                        .query_async(&mut conn)
                        .await
                        .unwrap_or_default();
                    let newest = latest
                        .get(1)
                        .and_then(|value| value.parse::<f64>().ok())
                        .unwrap_or(0.0) as i64;
                    return Ok(newest > 0 && newest > lockout_cutoff.timestamp());
                }
                Err(err) => {
                    tracing::warn!(
                        "redis unavailable while checking account lock for {}; falling back to database: {}",
                        email,
                        err
                    );
                }
            }
        }

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM failed_login_attempts WHERE email = $1 AND attempted_at >= $2",
        )
        .bind(email)
        .bind(window_start)
        .fetch_one(&self.db)
        .await?;
        if count < self.max_failed_attempts as i64 {
            return Ok(false);
        }

        let newest: Option<DateTime<Utc>> = sqlx::query_scalar(
            "SELECT MAX(attempted_at) FROM failed_login_attempts WHERE email = $1",
        )
        .bind(email)
        .fetch_one(&self.db)
        .await?;
        Ok(newest.is_some_and(|last| last > lockout_cutoff))
    }

    pub async fn clear_failed_attempts(&self, email: &str) -> Result<()> {
        if let Some(ref redis) = self.redis {
            let redis_key = self.failed_attempts_key(email);
            match redis.get_multiplexed_async_connection().await {
                Ok(mut conn) => {
                    let _ = redis::cmd("DEL")
                        .arg(&redis_key)
                        .query_async::<()>(&mut conn)
                        .await;
                }
                Err(err) => {
                    tracing::warn!(
                        "redis unavailable while clearing failed login cache for {}; continuing database cleanup: {}",
                        email,
                        err
                    );
                }
            }
        }

        // A successful authentication resets the counter completely. Deleting
        // only the entries older than the window left recent failures behind,
        // so an account could stay one attempt away from another lockout.
        sqlx::query("DELETE FROM failed_login_attempts WHERE email = $1")
            .bind(email)
            .execute(&self.db)
            .await?;

        Ok(())
    }

    pub async fn get_lockout_expiry(&self, email: &str) -> Result<Option<DateTime<Utc>>> {
        if !self.is_account_locked(email).await? {
            return Ok(None);
        }

        if let Some(ref redis) = self.redis {
            let redis_key = self.failed_attempts_key(email);
            if let Ok(mut conn) = redis.get_multiplexed_async_connection().await {
                let scores: Vec<i64> = redis::cmd("ZRANGE")
                    .arg(&redis_key)
                    .arg(0)
                    .arg(self.max_failed_attempts as isize - 1)
                    .arg("WITHSCORES")
                    .query_async(&mut conn)
                    .await
                    .unwrap_or_default();
                if let Some(last_score) = scores.last() {
                    let lockout_start =
                        DateTime::<Utc>::from_timestamp(*last_score, 0).unwrap_or_else(Utc::now);
                    let lockout_end =
                        lockout_start + Duration::minutes(self.lockout_duration_minutes);
                    return Ok(Some(lockout_end));
                }
            }
        }

        Ok(Some(
            Utc::now() + Duration::minutes(self.lockout_duration_minutes),
        ))
    }

    pub async fn get_failed_attempts_count(&self, email: &str) -> Result<u32> {
        if let Some(ref redis) = self.redis {
            let redis_key = self.failed_attempts_key(email);
            if let Ok(mut conn) = redis.get_multiplexed_async_connection().await {
                let window_start = Utc::now() - Duration::minutes(self.window_duration_minutes);
                let count: u32 = redis::cmd("ZCOUNT")
                    .arg(&redis_key)
                    .arg(window_start.timestamp())
                    .arg("+inf")
                    .query_async(&mut conn)
                    .await
                    .unwrap_or(0);
                return Ok(count);
            }
        }

        let window_start = Utc::now() - Duration::minutes(self.window_duration_minutes);
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM failed_login_attempts WHERE email = $1 AND attempted_at >= $2",
        )
        .bind(email)
        .bind(window_start)
        .fetch_one(&self.db)
        .await?;
        Ok(count as u32)
    }

    fn failed_attempts_key(&self, email: &str) -> String {
        format!("failed_attempts:{}", email)
    }
}
