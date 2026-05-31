pub mod config;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod service;
pub mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::TenantConfig::from_env()?;
    let state = state::TenantState::new(config.clone()).await?;

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/tenants", axum::routing::post(handlers::create_tenant))
        .route("/tenants/:id", axum::routing::get(handlers::get_tenant))
        .route("/tenants/:id", axum::routing::put(handlers::update_tenant))
        .route(
            "/tenants/:id/users",
            axum::routing::get(handlers::list_users),
        )
        .route(
            "/tenants/:id/domains",
            axum::routing::get(handlers::list_domains),
        )
        .route(
            "/tenants/:id/domains",
            axum::routing::post(handlers::add_domain),
        )
        .route(
            "/tenants/:id/settings",
            axum::routing::get(handlers::get_settings),
        )
        .route(
            "/tenants/:id/settings",
            axum::routing::put(handlers::update_settings),
        )
        .route(
            "/tenants/:id/billing",
            axum::routing::get(handlers::get_billing),
        )
        .route(
            "/tenants/:id/audit-logs",
            axum::routing::get(handlers::get_audit_logs),
        )
        .route(
            "/tenants/:id/stats",
            axum::routing::get(handlers::get_stats),
        )
        .route(
            "/tenants/:id/limits",
            axum::routing::get(handlers::check_limits),
        )
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        service = "tenant-service",
        version = env!("CARGO_PKG_VERSION"),
        address = %addr,
        "Tenant Service started"
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down tenant-service..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down tenant-service..."); }
    }
}
