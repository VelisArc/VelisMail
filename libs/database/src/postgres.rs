//! PostgreSQL connection pool with tenant isolation

use anyhow::Result;
use futures::future::BoxFuture;
use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

/// Database configuration
#[derive(Clone, Debug)]
pub struct DbConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub max_connections: u32,
    pub min_connections: u32,
}

impl DbConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            host: std::env::var("DB_HOST").unwrap_or_else(|_| "localhost".to_string()),
            port: std::env::var("DB_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5432),
            database: std::env::var("DB_NAME").unwrap_or_else(|_| "velismail".to_string()),
            username: std::env::var("DB_USER").unwrap_or_else(|_| "postgres".to_string()),
            password: std::env::var("DB_PASSWORD").unwrap_or_else(|_| "postgres".to_string()),
            max_connections: std::env::var("DB_MAX_CONNECTIONS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(20),
            min_connections: std::env::var("DB_MIN_CONNECTIONS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(5),
        })
    }

    pub fn connection_string(&self) -> String {
        format!(
            "postgres://{}:{}@{}:{}/{}",
            self.username, self.password, self.host, self.port, self.database
        )
    }
}

/// Create a PostgreSQL connection pool
pub async fn create_pool(config: &DbConfig) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .min_connections(config.min_connections)
        .connect(&config.connection_string())
        .await?;

    info!("Database pool created: {}", config.connection_string());
    Ok(pool)
}

/// Set tenant context for Row-Level Security
pub async fn set_tenant_context(pool: &PgPool, tenant_id: &str) -> Result<()> {
    sqlx::query("SET LOCAL velismail.tenant_id = $1")
        .bind(tenant_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Execute a query with tenant isolation
pub async fn with_tenant_context<'a, F, T>(pool: &PgPool, tenant_id: &str, f: F) -> Result<T>
where
    F: FnOnce(&PgPool) -> BoxFuture<'a, Result<T>>,
{
    let mut tx = pool.begin().await?;

    sqlx::query("SET LOCAL velismail.tenant_id = $1")
        .bind(tenant_id)
        .execute(&mut *tx)
        .await?;

    let result = f(pool).await?;

    tx.commit().await?;
    Ok(result)
}

/// Health check
pub async fn check_health(pool: &PgPool) -> Result<()> {
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(())
}
