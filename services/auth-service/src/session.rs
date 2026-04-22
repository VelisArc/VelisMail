#![allow(dead_code)]
//! Session management

use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;
use velismail_common::UserId;

/// Session manager
pub struct SessionManager {
    db: PgPool,
    redis: Arc<redis::Client>,
    max_sessions_per_user: u32,
    session_ttl_hours: i64,
}

impl SessionManager {
    pub fn new(
        db: PgPool,
        redis: Arc<redis::Client>,
        max_sessions_per_user: u32,
        session_ttl_hours: i64,
    ) -> Self {
        Self {
            db,
            redis,
            max_sessions_per_user,
            session_ttl_hours,
        }
    }

    /// Create a new session
    pub async fn create_session(
        &self,
        user_id: UserId,
        tenant_id: &str,
        device_fingerprint: &str,
        ip_address: &str,
        user_agent: Option<&str>,
    ) -> Result<Uuid> {
        let session_id = Uuid::new_v4();
        let now = Utc::now();
        let expires_at = now + Duration::hours(self.session_ttl_hours);

        // Check session limit
        let active_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sessions WHERE user_id = $1 AND is_active = true",
        )
        .bind(user_id.0)
        .fetch_one(&self.db)
        .await?;

        if active_count >= self.max_sessions_per_user as i64 {
            // Revoke oldest session
            sqlx::query(
                "UPDATE sessions SET is_active = false
                 WHERE user_id = $1 AND is_active = true
                 ORDER BY created_at ASC
                 LIMIT 1",
            )
            .bind(user_id.0)
            .execute(&self.db)
            .await?;
        }

        // Insert session into database
        sqlx::query(
            r#"INSERT INTO sessions
               (id, user_id, tenant_id, device_fingerprint, ip_address, user_agent,
                created_at, expires_at, last_active, is_active, mfa_verified)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, false)"#,
        )
        .bind(session_id)
        .bind(user_id.0)
        .bind(tenant_id)
        .bind(device_fingerprint)
        .bind(ip_address)
        .bind(user_agent)
        .bind(now)
        .bind(expires_at)
        .bind(now)
        .execute(&self.db)
        .await?;

        // Cache session in Redis
        let cache_key = format!("session:{}", session_id);
        let session_data = serde_json::json!({
            "user_id": user_id.0,
            "tenant_id": tenant_id,
            "device_fingerprint": device_fingerprint,
            "expires_at": expires_at.to_rfc3339(),
        });

        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        redis::cmd("SET")
            .arg(&cache_key)
            .arg(session_data.to_string())
            .arg("EX")
            .arg(self.session_ttl_hours * 3600)
            .query_async::<_, ()>(&mut conn)
            .await?;

        Ok(session_id)
    }

    /// Validate a session
    pub async fn validate_session(&self, session_id: Uuid) -> Result<Option<SessionInfo>> {
        // Check Redis cache first
        let cache_key = format!("session:{}", session_id);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        let cached: Option<String> = redis::cmd("GET")
            .arg(&cache_key)
            .query_async(&mut conn)
            .await?;

        if let Some(data) = cached {
            let session_info: SessionInfo = serde_json::from_str(&data)?;
            if Utc::now() < session_info.expires_at {
                return Ok(Some(session_info));
            }
        }

        // Fall back to database. user_id is UUID in the schema, not i64.
        let row: Option<(Uuid, Uuid, String, String, String, DateTime<Utc>)> = sqlx::query_as(
            r#"SELECT id, user_id, tenant_id, device_fingerprint, ip_address::text, expires_at
               FROM sessions
               WHERE id = $1 AND is_active = true"#,
        )
        .bind(session_id)
        .fetch_optional(&self.db)
        .await?;

        if let Some((id, user_id, tenant_id, device_fingerprint, ip_address, expires_at)) = row {
            if Utc::now() > expires_at {
                return Ok(None);
            }

            let session_info = SessionInfo {
                session_id: id,
                user_id: UserId(user_id),
                tenant_id,
                device_fingerprint,
                ip_address,
                expires_at,
            };

            // Cache in Redis
            let session_data = serde_json::to_string(&session_info)?;
            redis::cmd("SET")
                .arg(&cache_key)
                .arg(&session_data)
                .arg("EX")
                .arg((expires_at - Utc::now()).num_seconds())
                .query_async::<_, ()>(&mut conn)
                .await?;

            Ok(Some(session_info))
        } else {
            Ok(None)
        }
    }

    /// Revoke a session
    pub async fn revoke_session(&self, session_id: Uuid) -> Result<()> {
        // Remove from database
        sqlx::query("UPDATE sessions SET is_active = false WHERE id = $1")
            .bind(session_id)
            .execute(&self.db)
            .await?;

        // Remove from Redis
        let cache_key = format!("session:{}", session_id);
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        redis::cmd("DEL")
            .arg(&cache_key)
            .query_async::<_, ()>(&mut conn)
            .await?;

        Ok(())
    }

    /// List all active sessions for a user
    pub async fn list_user_sessions(&self, user_id: UserId) -> Result<Vec<SessionInfo>> {
        let rows: Vec<(Uuid, String, String, String, DateTime<Utc>)> = sqlx::query_as(
            r#"SELECT id, tenant_id, device_fingerprint, ip_address::text, expires_at
               FROM sessions
               WHERE user_id = $1 AND is_active = true
               ORDER BY last_active DESC"#,
        )
        .bind(user_id.0)
        .fetch_all(&self.db)
        .await?;

        let owner = user_id.clone();
        let sessions = rows
            .into_iter()
            .map(
                |(id, tenant_id, device_fingerprint, ip_address, expires_at)| SessionInfo {
                    session_id: id,
                    user_id: owner.clone(),
                    tenant_id,
                    device_fingerprint,
                    ip_address,
                    expires_at,
                },
            )
            .collect();

        Ok(sessions)
    }
}

/// Session information returned to client
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SessionInfo {
    pub session_id: Uuid,
    pub user_id: UserId,
    pub tenant_id: String,
    pub device_fingerprint: String,
    pub ip_address: String,
    pub expires_at: DateTime<Utc>,
}
