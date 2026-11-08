//! Database migrations.
//!
//! VelisMail runs every backend service against one PostgreSQL database, so
//! schema ownership lives here in the shared `velismail-database` crate.
//! Migrations are versioned and tracked by SQLx in the `_sqlx_migrations`
//! table, which makes them safe to run on every service boot and safe to run
//! concurrently from multiple services.

use anyhow::{Context, Result};
use sqlx::PgPool;
use tracing::info;

/// Static migrator compiled from `backend/crates/database/migrations`.
///
/// The directory is embedded at compile time, so migrations never depend on
/// files being present at runtime.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

/// Session-level advisory lock shared by every service in the monolith.
///
/// SQLx already locks individual migration files, but it releases that lock
/// between files. On PostgreSQL with several processes/services starting
/// together, the same migration can be entered by two runners at once and one
/// fails with a catalog-level duplicate (pg_extension/pg_type unique indexes).
/// Holding this lock across the whole run serialises the runners so the
/// first one applies everything and the rest see a finished schema and skip.
const MIGRATION_LOCK_ID: i64 = 876352459;

/// Apply all pending migrations to the given database.
///
/// Safe to call concurrently and repeatedly: a global advisory lock makes the
/// whole run sequential; SQLx skips migrations already recorded.
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    info!("Applying database migrations...");

    let mut conn = pool.acquire().await.context("failed to acquire a database connection for migrations")?;

    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(MIGRATION_LOCK_ID)
        .execute(&mut *conn)
        .await
        .context("failed to acquire the database migration lock")?;

    let outcome = MIGRATOR.run(&mut *conn).await;

    // Always release the lock, even if a migration failed, so the next
    // service can retry with the latest schema state.
    let unlock_result = sqlx::query("SELECT pg_advisory_unlock($1)")
        .bind(MIGRATION_LOCK_ID)
        .execute(&mut *conn)
        .await;

    if let Err(error) = unlock_result {
        tracing::warn!(error = %error, "failed to release the database migration lock");
    }

    outcome?;

    info!("Database migrations completed");
    Ok(())
}
