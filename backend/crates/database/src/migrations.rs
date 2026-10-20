//! Database migrations.
//!
//! VelisMail runs every backend service against one PostgreSQL database, so
//! schema ownership lives here in the shared `velismail-database` crate.
//! Migrations are versioned and tracked by SQLx in the `_sqlx_migrations`
//! table, which makes them safe to run on every service boot and safe to run
//! concurrently from multiple services.

use anyhow::Result;
use sqlx::PgPool;
use tracing::info;

/// Static migrator compiled from `backend/crates/database/migrations`.
///
/// The directory is embedded at compile time, so migrations never depend on
/// files being present at runtime.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Apply all pending migrations to the given database.
///
/// Safe to call concurrently and repeatedly: SQLx takes an advisory lock and
/// skips migrations that are already recorded as applied.
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Applying database migrations...");

    MIGRATOR.run(pool).await?;

    info!("Database migrations completed");
    Ok(())
}
