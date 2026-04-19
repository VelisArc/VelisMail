//! VelisMail API Gateway
//!
//! Central entry point for all API requests.
//! Routes to internal microservices with authentication and rate limiting.

use axum::{
    routing::get,
    Router,
};
use tokio::net::TcpListener;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod middleware;
mod routes;
mod state;

use config::GatewayConfig;
use state::AppState;

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

    // Build router
    let app = Router::new()
        // Health check
        .route("/health", get(routes::health_check))
        // API v1 routes
        .nest("/api/v1", routes::api_v1_routes(&state))
        // OpenAPI documentation
        .merge(routes::swagger_ui())
        // Middleware
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::authentication,
        ))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit,
        ))
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("API Gateway listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
