//! VelisMail Auth Service
//!
//! Handles authentication (password + JWT), session management, and
//! (stubbed) passkey / ZKP flows.

use axum::{
    routing::{delete, get, post},
    Router,
};
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod account_lock;
mod config;
mod handlers;
mod jwt;
mod middleware;
mod passkey;
mod session;
mod state;

use config::AuthConfig;
use state::AuthState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_auth=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail Auth Service...");

    let config = AuthConfig::from_env()?;
    let state = AuthState::new(config.clone()).await?;

    let protected_routes = Router::new()
        .route("/me", get(handlers::get_current_user))
        .route("/account", axum::routing::patch(handlers::update_account))
        .route("/sessions", get(handlers::list_sessions))
        .route("/sessions/:id", delete(handlers::revoke_session))
        .route("/device/register", post(handlers::register_device))
        .route("/device/trust", post(handlers::trust_device))
        .route("/logout", post(handlers::logout))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ));

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/register", post(handlers::register))
        // Primary working flow
        .route("/login", post(handlers::login_password))
        // Compatibility aliases used by the existing frontend
        .route("/login/password", post(handlers::login_password))
        .route("/login/passkey", post(handlers::login_passkey))
        .route("/login/zkp", post(handlers::login_zkp))
        .route("/send-otp", post(handlers::send_otp))
        // Compatibility aliases for deployed clients and cached gateways.
        .route("/otp/send", post(handlers::send_otp))
        .route("/password-reset/request", post(handlers::send_otp))
        .route("/verify-otp", post(handlers::verify_otp))
        .route("/otp/verify", post(handlers::verify_otp))
        .route("/reset-password", post(handlers::reset_password))
        .route("/change-password", post(handlers::change_password))
        .route("/token/refresh", post(handlers::refresh_token))
        .merge(protected_routes)
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;
    info!("Auth Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
