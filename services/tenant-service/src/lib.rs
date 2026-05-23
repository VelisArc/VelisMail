pub mod config;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod service;
pub mod state;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::TenantConfig::from_env()?;
    let state = state::TenantState::new(config.clone()).await?;

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/tenants", axum::routing::post(handlers::create_tenant))
        .route("/tenants/:id", axum::routing::get(handlers::get_tenant))
        .route("/tenants/:id", axum::routing::put(handlers::update_tenant))
        .route(
            "/tenants/:id/users",
            axum::routing::get(handlers::list_users),
        )
        .route(
            "/tenants/:id/domains",
            axum::routing::get(handlers::list_domains),
        )
        .route(
            "/tenants/:id/domains",
            axum::routing::post(handlers::add_domain),
        )
        .route(
            "/tenants/:id/settings",
            axum::routing::get(handlers::get_settings),
        )
        .route(
            "/tenants/:id/settings",
            axum::routing::put(handlers::update_settings),
        )
        .route(
            "/tenants/:id/billing",
            axum::routing::get(handlers::get_billing),
        )
        .route(
            "/tenants/:id/audit-logs",
            axum::routing::get(handlers::get_audit_logs),
        )
        .route(
            "/tenants/:id/stats",
            axum::routing::get(handlers::get_stats),
        )
        .route(
            "/tenants/:id/limits",
            axum::routing::get(handlers::check_limits),
        )
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Tenant Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
