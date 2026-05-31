mod config;
mod encryption;
mod handlers;
mod middleware;
mod s3_client;
mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::StorageConfig::from_env()?;
    let state = state::StorageState::new(config.clone()).await?;

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route(
            "/upload",
            axum::routing::post(handlers::upload).layer(middleware::body_limit_layer()),
        )
        .route(
            "/upload/multipart",
            axum::routing::post(handlers::upload_multipart).layer(middleware::body_limit_layer()),
        )
        .route("/download/*key", axum::routing::get(handlers::download))
        .route("/delete/*key", axum::routing::delete(handlers::delete))
        .route("/quota", axum::routing::get(handlers::get_quota))
        .route("/list", axum::routing::get(handlers::list_files))
        .route("/metadata/*key", axum::routing::get(handlers::get_metadata))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        service = "storage-service",
        version = env!("CARGO_PKG_VERSION"),
        address = %addr,
        "Storage Service started"
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
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down storage-service..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down storage-service..."); }
    }
}
