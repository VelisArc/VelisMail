//! VelisMail API Gateway
//!
//! Central entry point for all API requests.
//! Routes to internal microservices with authentication and rate limiting.

use axum::{http::HeaderValue, routing::get, Router};
use tokio::net::TcpListener;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod middleware;
mod routes;
mod state;

use config::GatewayConfig;
use state::AppState;

/// Build a restrictive CORS layer from the configured FRONTEND_URL.
/// Accepts comma-separated origins. Falls back to permissive ONLY when
/// FRONTEND_URL is empty (local development).
fn build_cors_layer(frontend_url: &str) -> CorsLayer {
    use axum::http::Method;

    let methods = vec![
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::PATCH,
        Method::OPTIONS,
    ];

    if frontend_url.is_empty() {
        tracing::warn!("FRONTEND_URL not set — CORS is permissive (development mode only)");
        return CorsLayer::permissive();
    }

    let origins: Vec<HeaderValue> = frontend_url
        .split(',')
        .filter_map(|origin| origin.trim().parse::<HeaderValue>().ok())
        .collect();

    if origins.is_empty() {
        tracing::warn!("No valid CORS origins parsed from FRONTEND_URL — falling back to permissive");
        return CorsLayer::permissive();
    }

    info!("CORS restricted to origins: {}", frontend_url);

    let allowed_headers = vec![
        axum::http::header::AUTHORIZATION,
        axum::http::header::ACCEPT,
        axum::http::header::CONTENT_TYPE,
    ];

    CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods(methods)
        .allow_headers(allowed_headers)
        .allow_credentials(true)
        .max_age(std::time::Duration::from_secs(3600))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_api_gateway=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail API Gateway...");

    // Load configuration
    let config = GatewayConfig::from_env()?;

    // Initialize application state
    let state = AppState::new(config.clone()).await?;

    // Build CORS layer from config
    let cors = build_cors_layer(&config.frontend_url);

    // Build router with rate limiting, tracing, and restricted CORS.
    // Authentication is delegated to each downstream service which validates
    // the JWT independently. The gateway adds rate limiting and security headers.
    let app = Router::new()
        .route("/", get(routes::root))
        .route("/health", get(routes::health_check))
        .nest("/api/v1", routes::api_v1_routes(&state))
        .nest("/v1", routes::api_v1_routes(&state))
        .merge(routes::swagger_ui())
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit,
        ))
        .layer(axum::middleware::from_fn(middleware::security_headers))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("API Gateway listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
