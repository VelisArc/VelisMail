//! Redis cache layer for sessions and fast mailbox loading

use anyhow::Result;
use redis::Client;
use std::sync::Arc;
use tracing::info;

/// Redis configuration
#[derive(Clone, Debug)]
pub struct RedisConfig {
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub db: u8,
    pub max_connections: u32,
}

impl RedisConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            host: std::env::var("REDIS_HOST").unwrap_or_else(|_| "localhost".to_string()),
            port: std::env::var("REDIS_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(6379),
            password: std::env::var("REDIS_PASSWORD").ok(),
            db: std::env::var("REDIS_DB")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(0),
            max_connections: std::env::var("REDIS_MAX_CONNECTIONS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(20),
        })
    }

    pub fn connection_string(&self) -> String {
        match &self.password {
            Some(password) => {
                format!(
                    "redis://:{}@{}:{}/{}",
                    password, self.host, self.port, self.db
                )
            }
            None => format!("redis://{}:{}/{}", self.host, self.port, self.db),
        }
    }
}

/// Create Redis connection pool
pub async fn create_redis_pool(config: &RedisConfig) -> Result<Arc<Client>> {
    let client = Client::open(config.connection_string())?;

    // Test connection
    let mut conn = client.get_multiplexed_async_connection().await?;
    redis::cmd("PING").query_async::<_, ()>(&mut conn).await?;

    info!(
        "Redis connection established: {}",
        config.connection_string()
    );
    Ok(Arc::new(client))
}

/// Cache operations
pub struct CacheManager {
    redis: Arc<Client>,
}

impl CacheManager {
    pub fn new(redis: Arc<Client>) -> Self {
        Self { redis }
    }

    /// Get a value from cache
    pub async fn get(&mut self, key: &str) -> Result<Option<String>> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        let value: Option<String> = redis::cmd("GET").arg(key).query_async(&mut conn).await?;
        Ok(value)
    }

    /// Set a value in cache with TTL
    pub async fn set(&mut self, key: &str, value: &str, ttl_seconds: u64) -> Result<()> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        redis::pipe()
            .atomic()
            .cmd("SET")
            .arg(key)
            .arg(value)
            .cmd("EXPIRE")
            .arg(key)
            .arg(ttl_seconds)
            .query_async::<_, ()>(&mut conn)
            .await?;
        Ok(())
    }

    /// Delete a value from cache
    pub async fn delete(&mut self, key: &str) -> Result<bool> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        let deleted: bool = redis::cmd("DEL").arg(key).query_async(&mut conn).await?;
        Ok(deleted)
    }

    /// Check if key exists
    pub async fn exists(&mut self, key: &str) -> Result<bool> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        let exists: bool = redis::cmd("EXISTS").arg(key).query_async(&mut conn).await?;
        Ok(exists)
    }

    /// Increment a counter
    pub async fn incr(&mut self, key: &str) -> Result<i64> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        let value: i64 = redis::cmd("INCR").arg(key).query_async(&mut conn).await?;
        Ok(value)
    }

    /// Set with rate limiting (TTL-based)
    pub async fn set_rate_limit(
        &mut self,
        key: &str,
        value: &str,
        ttl_seconds: u64,
    ) -> Result<bool> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;

        // Use SET NX (only if not exists) for rate limiting
        let set: Option<String> = redis::cmd("SET")
            .arg(key)
            .arg(value)
            .arg("NX")
            .arg("EX")
            .arg(ttl_seconds)
            .query_async(&mut conn)
            .await?;

        Ok(set.is_some())
    }
}

/// Cache key helpers
pub mod keys {
    pub fn session(session_id: &str) -> String {
        format!("session:{}", session_id)
    }

    pub fn user_sessions(user_id: &str) -> String {
        format!("user:sessions:{}", user_id)
    }

    pub fn mailbox(user_id: &str, folder: &str) -> String {
        format!("mailbox:{}:{}", user_id, folder)
    }

    pub fn rate_limit(action: &str, identifier: &str) -> String {
        format!("ratelimit:{}:{}", action, identifier)
    }

    pub fn tenant_config(tenant_id: &str) -> String {
        format!("tenant:config:{}", tenant_id)
    }

    pub fn email_thread(thread_id: &str) -> String {
        format!("email:thread:{}", thread_id)
    }
}

