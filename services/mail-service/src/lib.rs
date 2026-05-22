mod config;
mod handlers;
mod middleware;
mod models;
mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::MailConfig::from_env()?;
    let state = state::MailState::new(config.clone()).await?;

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/emails", axum::routing::post(handlers::send_email))
        .route("/inbound", axum::routing::post(handlers::save_business_email))
        .route(
            "/business-emails",
            axum::routing::get(handlers::get_business_emails).post(handlers::save_business_email),
        )
        .route("/business-emails/query", axum::routing::post(handlers::query_business_emails))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Mail Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
