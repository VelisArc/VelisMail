mod config;
mod middleware;
mod routes;
mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::GatewayConfig::from_env()?;
    let state = state::AppState::new(config.clone()).await?;
    let cors = build_cors_layer(&config.frontend_url);

    let app = axum::Router::new()
        .route("/", axum::routing::get(routes::root))
        .route("/health", axum::routing::get(routes::health_check))
        .nest("/api/v1", routes::api_v1_routes(&state))
        .nest("/v1", routes::api_v1_routes(&state))
        .merge(routes::swagger_ui())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit,
        ))
        .layer(axum::middleware::from_fn(middleware::security_headers))
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("API Gateway listening on {}", addr);
    axum::serve(listener, app).await?;

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

    if frontend_url.is_empty() {
        tracing::warn!("FRONTEND_URL not set — CORS is permissive (development mode only)");
        return CorsLayer::new()
            .allow_origin(AllowOrigin::list(vec![
                HeaderValue::from_static("https://velismail.online"),
                HeaderValue::from_static("http://localhost:5173"),
                HeaderValue::from_static("http://127.0.0.1:5173"),
            ]))
            .allow_methods(methods)
            .allow_headers(vec![
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
                axum::http::header::CONTENT_TYPE,
                axum::http::HeaderName::from_static("x-business-db-url"),
            ])
            .allow_credentials(true)
            .max_age(std::time::Duration::from_secs(3600));
    }

    let origins: Vec<HeaderValue> = frontend_url
        .split(',')
        .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
        .collect();

    if origins.is_empty() {
        tracing::warn!("No valid CORS origins parsed from FRONTEND_URL — falling back to permissive");
        return CorsLayer::new()
            .allow_origin(AllowOrigin::exact(HeaderValue::from_static("https://velismail.online")))
            .allow_methods(methods)
            .allow_headers(vec![
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
                axum::http::header::CONTENT_TYPE,
                axum::http::HeaderName::from_static("x-business-db-url"),
            ])
            .allow_credentials(true)
            .max_age(std::time::Duration::from_secs(3600));
    }

    tracing::info!("CORS restricted to origins: {}", frontend_url);

    let allowed_headers = vec![
        axum::http::header::AUTHORIZATION,
        axum::http::header::ACCEPT,
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderName::from_static("x-business-db-url"),
    ];

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(methods)
        .allow_headers(allowed_headers)
        .allow_credentials(true)
        .max_age(std::time::Duration::from_secs(3600))
}
