//! VelisMail Delivery Engine
//!
//! Email deliverability with SPF, DKIM, DMARC,
//! IP warming, reputation tracking, and bounce handling.

use axum::{
    routing::{get, post},
    Router,
};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod handlers;
mod dkim;
mod spf;
mod dmarc;
mod reputation;
mod bounce;
mod config;
mod state;
mod middleware;

use config::DeliveryConfig;
use state::DeliveryState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_delivery=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail Delivery Engine...");

    let config = DeliveryConfig::from_env()?;
    let state = DeliveryState::new(config.clone()).await?;

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        // Outgoing queue
        .route("/queue", post(handlers::queue_email))
        .route("/queue/status/:id", get(handlers::queue_status))
        // DKIM signing
        .route("/dkim/sign", post(handlers::dkim_sign))
        // SPF verification
        .route("/spf/verify", post(handlers::spf_verify))
        // DMARC
        .route("/dmarc/check", post(handlers::dmarc_check))
        // Reputation
        .route("/reputation/:domain", get(handlers::get_reputation))
        // Bounce handling
        .route("/bounce", post(handlers::handle_bounce))
        .route("/bounce/stats", get(handlers::bounce_stats))
        // IP warming
        .route("/ip-warming/status", get(handlers::ip_warming_status))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("Delivery Engine listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
