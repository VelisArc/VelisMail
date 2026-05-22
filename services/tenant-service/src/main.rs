#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_tenant=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    velismail_tenant_service::run_service().await
}
