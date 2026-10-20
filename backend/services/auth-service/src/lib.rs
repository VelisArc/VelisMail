pub mod account_lock;
pub mod config;
pub mod handlers;
pub mod jwt;
pub mod middleware;
pub mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::AuthConfig::from_env()?;
    let state = state::AuthState::new(config.clone()).await?;

    velismail_database::migrations::run_migrations(&state.db).await?;

    let protected_routes = axum::Router::new()
        .route("/me", axum::routing::get(handlers::get_current_user))
        .route("/account", axum::routing::patch(handlers::update_account))
        .route("/sessions", axum::routing::get(handlers::list_sessions))
        .route(
            "/sessions/revoke-others",
            axum::routing::post(handlers::revoke_other_sessions),
        )
        .route(
            "/sessions/{id}",
            axum::routing::delete(handlers::revoke_session),
        )
        .route(
            "/device/register",
            axum::routing::post(handlers::register_device),
        )
        .route("/device/trust", axum::routing::post(handlers::trust_device))
        .route("/logout", axum::routing::post(handlers::logout))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ));

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/ready", axum::routing::get(handlers::health_check))
        .route("/register", axum::routing::post(handlers::register))
        .route("/login", axum::routing::post(handlers::login_password))
        .route(
            "/login/password",
            axum::routing::post(handlers::login_password),
        )
        .route("/send-otp", axum::routing::post(handlers::send_otp))
        .route("/otp/send", axum::routing::post(handlers::send_otp))
        .route(
            "/password-reset/request",
            axum::routing::post(handlers::send_otp),
        )
        .route("/verify-otp", axum::routing::post(handlers::verify_otp))
        .route("/otp/verify", axum::routing::post(handlers::verify_otp))
        .route(
            "/reset-password",
            axum::routing::post(handlers::reset_password),
        )
        .route(
            "/change-password",
            axum::routing::post(handlers::change_password),
        )
        .route(
            "/token/refresh",
            axum::routing::post(handlers::refresh_token),
        )
        .route("/feedback", axum::routing::post(handlers::feedback))
        .merge(protected_routes)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit,
        ))
        .layer(axum::middleware::from_fn(middleware::request_id))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            axum::http::StatusCode::GATEWAY_TIMEOUT,
            std::time::Duration::from_secs(30),
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(1024 * 1024))
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
        service = "auth-service",
        version = env!("CARGO_PKG_VERSION"),
        address = %addr,
        "Auth Service started"
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
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
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down auth-service..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down auth-service..."); }
    }
}
