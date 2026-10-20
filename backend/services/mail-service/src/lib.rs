mod config;
mod handlers;
mod middleware;
mod models;
mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::MailConfig::from_env()?;
    let state = state::MailState::new(config.clone()).await?;

    // Run platform email migrations
    velismail_database::migrations::run_migrations(&state.db).await?;

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/ready", axum::routing::get(handlers::health_check))
        .route("/emails", axum::routing::post(handlers::send_email))
        .route(
            "/emails/{id}",
            axum::routing::get(handlers::get_email)
                .patch(handlers::update_email)
                .delete(handlers::delete_email),
        )
        .route(
            "/emails/{id}/move",
            axum::routing::post(handlers::move_email),
        )
        .route("/threads/{id}", axum::routing::get(handlers::get_thread))
        .route("/folders", axum::routing::get(handlers::list_folders))
        .route("/search", axum::routing::post(handlers::search_emails))
        .route(
            "/inbound",
            axum::routing::post(handlers::save_business_email),
        )
        .route(
            "/business-emails",
            axum::routing::get(handlers::get_business_emails)
                .post(handlers::save_business_email)
                .delete(handlers::delete_business_email),
        )
        .route(
            "/business-emails/query",
            axum::routing::post(handlers::query_business_emails),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::auth_layer,
        ))
        .layer(axum::middleware::from_fn(
            velismail_common::middleware::request_id_middleware,
        ))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            axum::http::StatusCode::GATEWAY_TIMEOUT,
            std::time::Duration::from_secs(60),
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            26 * 1024 * 1024,
        ))
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(middleware::cors_layer())
        .layer(axum::middleware::from_fn(
            velismail_common::middleware::security_headers,
        ))
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        service = "mail-service",
        version = env!("CARGO_PKG_VERSION"),
        address = %addr,
        "Mail Service started"
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
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down mail-service..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down mail-service..."); }
    }
}
