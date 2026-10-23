mod admin;
mod api_keys;
mod business_mailboxes;
mod company_api;
mod company_businesses;
mod config;
mod domain_dns;
mod middleware;
mod platform_api_keys;
mod routes;
mod state;
mod traffic;

use std::net::SocketAddr;
use std::time::Duration;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::GatewayConfig::from_env()?;
    let state = state::AppState::new(config.clone()).await?;

    // Run gateway migrations if DB is connected
    if let Some(db) = &state.db {
        velismail_database::migrations::run_migrations(db).await?;
    }

    // Flush in-memory traffic counters to PostgreSQL every 30 seconds. This
    // keeps the control-plane analytics durable without a write per request.
    if let Some(db) = state.db.clone() {
        let traffic = state.traffic.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(Duration::from_secs(30));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                if let Err(err) = traffic.flush(&db).await {
                    tracing::warn!("traffic rollup flush failed: {}", err);
                }
            }
        });
    }

    let cors = build_cors_layer(&config.frontend_url);

    let api_routes = routes::api_v1_routes(&state).layer(axum::middleware::from_fn_with_state(
        state.clone(),
        middleware::require_auth,
    ));

    let app = axum::Router::new()
        .route("/", axum::routing::get(routes::root))
        .route("/health", axum::routing::get(routes::health_check))
        .route("/health/live", axum::routing::get(routes::health_check))
        .route("/health/ready", axum::routing::get(routes::readiness))
        .route("/ready", axum::routing::get(routes::readiness))
        .route("/config/public", axum::routing::get(routes::public_config))
        .route("/metrics", axum::routing::get(routes::metrics))
        .nest("/api/v1", api_routes.clone())
        .nest("/v1", api_routes)
        .fallback(routes::not_found)
        // Inner layers first: rate limiting/metrics wrap the handlers.
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::traffic,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::concurrency_limit,
        ))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            axum::http::StatusCode::GATEWAY_TIMEOUT,
            Duration::from_secs(config.request_timeout_seconds),
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            config.max_body_bytes,
        ))
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(tower_http::catch_panic::CatchPanicLayer::new())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(cors)
        .layer(axum::middleware::from_fn(middleware::security_headers))
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        service = "api-gateway",
        version = env!("CARGO_PKG_VERSION"),
        address = %addr,
        rate_limit_per_minute = config.rate_limit_per_minute,
        auth_rate_limit_per_minute = config.auth_rate_limit_per_minute,
        max_body_bytes = config.max_body_bytes,
        max_concurrent_requests = config.max_concurrent_requests,
        "API Gateway started"
    );
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

fn build_cors_layer(frontend_url: &str) -> tower_http::cors::CorsLayer {
    use axum::http::HeaderValue;
    use tower_http::cors::{AllowOrigin, CorsLayer};

    let methods = vec![
        axum::http::Method::GET,
        axum::http::Method::POST,
        axum::http::Method::PUT,
        axum::http::Method::DELETE,
        axum::http::Method::PATCH,
        axum::http::Method::OPTIONS,
    ];

    let allowed_headers = vec![
        axum::http::header::AUTHORIZATION,
        axum::http::header::ACCEPT,
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderName::from_static("x-request-id"),
    ];

    let expose_headers = vec![
        axum::http::HeaderName::from_static("x-request-id"),
        axum::http::HeaderName::from_static("x-ratelimit-limit"),
        axum::http::HeaderName::from_static("x-ratelimit-remaining"),
        axum::http::HeaderName::from_static("x-ratelimit-policy"),
        axum::http::header::RETRY_AFTER,
    ];

    let origins: Vec<HeaderValue> = frontend_url
        .split(',')
        .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
        .collect();

    let origins = if origins.is_empty() {
        tracing::warn!(
            "FRONTEND_URL not set or invalid — restricting CORS to production domains plus localhost"
        );
        vec![
            HeaderValue::from_static("https://velismail.online"),
            HeaderValue::from_static("https://www.velismail.online"),
            HeaderValue::from_static("http://localhost:5173"),
            HeaderValue::from_static("http://127.0.0.1:5173"),
        ]
    } else {
        tracing::info!("CORS restricted to configured origins: {}", frontend_url);
        origins
    };

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(methods)
        .allow_headers(allowed_headers)
        .expose_headers(expose_headers)
        .allow_credentials(true)
        .max_age(std::time::Duration::from_secs(3600))
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
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down api-gateway..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down api-gateway..."); }
    }
}
