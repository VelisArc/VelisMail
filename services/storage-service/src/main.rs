//! VelisMail Storage Service
//!
//! S3-compatible object storage with AES-256 encryption
//! for email bodies and attachments.

use axum::{
    routing::{delete, get, post},
    Router,
};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod config;
mod encryption;
mod handlers;
mod middleware;
mod s3_client;
mod state;

use config::StorageConfig;
use state::StorageState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_storage=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail Storage Service...");

    let config = StorageConfig::from_env()?;
    let state = StorageState::new(config.clone()).await?;

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/upload", post(handlers::upload).layer(middleware::body_limit_layer()))
        .route("/download/*key", get(handlers::download))
        .route("/delete/*key", delete(handlers::delete))
        .route("/presigned/*key", get(handlers::presigned_url))
        .route("/quota", get(handlers::get_quota))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("Storage Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
