//! VelisMail Auth Service
//!
//! Handles authentication, passkey verification, JWT tokens,
//! and session management with zero-trust architecture.

use axum::{
    routing::{get, post, delete},
    Router,
};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod handlers;
mod jwt;
mod passkey;
mod session;
mod routes;
mod config;
mod state;
mod middleware;
mod account_lock;

use config::AuthConfig;
use state::AuthState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_auth=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail Auth Service...");

    // Load configuration
    let config = AuthConfig::from_env()?;

    // Initialize application state
    let state = AuthState::new(config.clone()).await?;

    // Build router
    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/register", post(handlers::register))
        .route("/login/passkey", post(handlers::login_passkey))
        .route("/login/zkp", post(handlers::login_zkp))
        .route("/token/refresh", post(handlers::refresh_token))
        .route("/logout", post(handlers::logout))
        .route("/me", get(handlers::get_current_user))
        .route("/sessions", get(handlers::list_sessions))
        .route("/sessions/:id", delete(handlers::revoke_session))
        .route("/device/register", post(handlers::register_device))
        .route("/device/trust", post(handlers::trust_device))
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("Auth Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
