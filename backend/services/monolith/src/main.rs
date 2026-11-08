use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    tracing::info!("Starting VelisMail Monolith...");

    velismail_common::init_crypto_provider();

    // Apply every migration once, up front, before the per-service boot
    // races begin. On serverless Postgres (Neon) several services calling
    // run_migrations() at the same time raced on composite-type catalog rows
    // and crashed the boot loop.
    let db_url = std::env::var("DATABASE_URL")
        .expect("missing required environment variable DATABASE_URL");
    let pool = sqlx::PgPool::connect(&db_url).await?;
    velismail_database::migrations::run_migrations(&pool).await?;
    drop(pool);
    std::env::set_var("VELISMAIL_MIGRATIONS_DONE", "1");

    tokio::try_join!(
        velismail_api_gateway::run_service(),
        velismail_auth_service::run_service(),
        velismail_mail_service::run_service(),
        velismail_storage_service::run_service(),
        velismail_tenant_service::run_service(),
        velismail_delivery_engine::run_service(),
    )?;

    Ok(())
}
