//! Redis cache layer for sessions and fast mailbox loading

use anyhow::Result;
use redis::Client;
use std::sync::Arc;
use tracing::info;

/// Redis configuration
#[derive(Clone, Debug)]
pub struct RedisConfig {
    /// Full connection URL when provided via `REDIS_URL`.
    pub url: Option<String>,
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub db: u8,
    pub max_connections: u32,
}

impl RedisConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            url: std::env::var("REDIS_URL")
                .ok()
                .filter(|value| !value.trim().is_empty()),
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
        if let Some(url) = &self.url {
            return url.clone();
        }

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
    redis::cmd("PING").query_async::<()>(&mut conn).await?;

    info!(
        "Redis connection established: {}:{} (db {})",
        config.host, config.port, config.db
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
            .query_async::<()>(&mut conn)
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

    /// Get and deserialize a JSON value from cache
    pub async fn get_json<T: serde::de::DeserializeOwned>(
        &mut self,
        key: &str,
    ) -> Result<Option<T>> {
        if let Some(val_str) = self.get(key).await? {
            let val = serde_json::from_str(&val_str)?;
            Ok(Some(val))
        } else {
            Ok(None)
        }
    }

    /// Serialize and set a value in cache with TTL
    pub async fn set_json<T: serde::Serialize>(
        &mut self,
        key: &str,
        value: &T,
        ttl_seconds: u64,
    ) -> Result<()> {
        let val_str = serde_json::to_string(value)?;
        self.set(key, &val_str, ttl_seconds).await
    }

    /// Cache-aside helper. Tries to fetch from cache; on miss, invokes `fallback`,
    /// caches the result, and returns it.
    pub async fn cached<T, F, Fut>(&mut self, key: &str, ttl_seconds: u64, fallback: F) -> Result<T>
    where
        T: serde::Serialize + serde::de::DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        if let Some(cached_val) = self.get_json::<T>(key).await? {
            return Ok(cached_val);
        }
        let fresh_val = fallback().await?;
        self.set_json(key, &fresh_val, ttl_seconds).await?;
        Ok(fresh_val)
    }

    /// Verify connectivity to Redis
    pub async fn check_health(&mut self) -> Result<()> {
        let mut conn = self.redis.get_multiplexed_async_connection().await?;
        redis::cmd("PING").query_async::<()>(&mut conn).await?;
        Ok(())
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
