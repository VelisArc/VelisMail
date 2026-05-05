//! VelisMail Mail Service
//!
//! Core mail engine handling SMTP/IMAP, email storage,
//! threading, and real-time sync.

use axum::{
    routing::{delete, get, post, put},
    Router,
};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod attachments;
mod config;
mod handlers;
mod http_delivery;
mod middleware;
mod models;
mod rules;
mod smtp;
mod state;
mod threading;
mod workflows;

use config::MailConfig;
use state::MailState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_mail=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail Mail Service...");

    // Load configuration
    let config = MailConfig::from_env()?;

    // Initialize application state
    let state = MailState::new(config.clone()).await?;

    // Build router
    let app = Router::new()
        .route("/health", get(handlers::health_check))
        // Email CRUD
        .route("/emails", get(handlers::list_emails))
        .route("/emails", post(handlers::send_email))
        .route("/emails/:id", get(handlers::get_email))
        .route("/emails/:id", delete(handlers::delete_email))
        // Folders
        .route("/folders", get(handlers::list_folders))
        .route("/folders", post(handlers::create_folder))
        .route("/folders/:id", delete(handlers::delete_folder))
        // Labels
        .route("/labels", get(handlers::list_labels))
        .route("/labels", post(handlers::create_label))
        // Drafts
        .route("/drafts", get(handlers::list_drafts))
        .route("/drafts", post(handlers::create_draft))
        .route("/drafts/:id", put(handlers::update_draft))
        // Batch operations
        .route("/batch/move", post(handlers::batch_move))
        .route("/batch/delete", post(handlers::batch_delete))
        .route("/batch/label", post(handlers::batch_label))
        // Threading
        .route("/threads", get(handlers::list_threads))
        .route("/threads/:id", get(handlers::get_thread))
        // Undo send
        .route("/undo-send/:id", post(handlers::undo_send))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    // Start server
    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("Mail Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
