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
