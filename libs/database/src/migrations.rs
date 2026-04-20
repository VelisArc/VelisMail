//! Database migrations

use anyhow::Result;
use sqlx::PgPool;
use tracing::info;

/// Run all migrations
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Running database migrations...");

    sqlx::migrate!("./migrations").run(pool).await?;

    info!("Database migrations completed");
    Ok(())
}

/// Migration SQL files will be placed in ./migrations directory
///
/// Migration 001: initial_schema
/// Migration 002: add_tenant_rls
/// Migration 003: add_email_tables
/// Migration 004: add_auth_tables
/// Migration 005: add_audit_log
/// etc.

#[cfg(test)]
mod tests {
    #[test]
    fn test_migrations_module() {
        // Module compiles
    }
}
