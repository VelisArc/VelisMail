//! VelisMail Tenant Service
//!
//! Multi-tenant management with custom domains, billing, and admin panel.

use axum::{
    routing::{get, post, put},
    Router,
};
use tokio::net::TcpListener;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use velismail_tenant_service::{config::TenantConfig, handlers, middleware, state::TenantState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "velismail_tenant=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().json())
        .init();

    info!("Starting VelisMail Tenant Service...");

    let config = TenantConfig::from_env()?;
    let state = TenantState::new(config.clone()).await?;

    let app = Router::new()
        .route("/health", get(handlers::health_check))
        .route("/tenants", post(handlers::create_tenant))
        .route("/tenants/:id", get(handlers::get_tenant))
        .route("/tenants/:id", put(handlers::update_tenant))
        .route("/tenants/:id/users", get(handlers::list_users))
        .route("/tenants/:id/domains", get(handlers::list_domains))
        .route("/tenants/:id/domains", post(handlers::add_domain))
        .route(
            "/tenants/:id/domains/:domain/verify",
            post(handlers::verify_domain),
        )
        .route("/tenants/:id/settings", get(handlers::get_settings))
        .route("/tenants/:id/settings", put(handlers::update_settings))
        .route("/tenants/:id/billing", get(handlers::get_billing))
        .route("/tenants/:id/audit-logs", get(handlers::get_audit_logs))
        .route("/tenants/:id/stats", get(handlers::get_stats))
        .route("/tenants/:id/limits", get(handlers::check_limits))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = TcpListener::bind(&addr).await?;

    info!("Tenant Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
