mod config;
mod handlers;
mod middleware;
mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::DeliveryConfig::from_env()?;
    let state = state::DeliveryState::new(config.clone()).await?;

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/dkim/info", axum::routing::get(handlers::dkim_info))
        .route("/spf/verify", axum::routing::post(handlers::spf_verify))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Delivery Engine listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
