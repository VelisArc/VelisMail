//! Delivery engine entrypoint.

use tracing_subscriber::prelude::*;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    tracing::info!("Starting VelisMail Delivery Engine...");

    velismail_common::init_crypto_provider();

    velismail_delivery_engine::run_service().await?;

    Ok(())
}
