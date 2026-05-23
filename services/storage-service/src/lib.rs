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
        .route("/download/*key", axum::routing::get(handlers::download))
        .route("/delete/*key", axum::routing::delete(handlers::delete))
        .route("/quota", axum::routing::get(handlers::get_quota))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Storage Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
