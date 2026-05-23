pub mod account_lock;
pub mod config;
pub mod handlers;
pub mod jwt;
pub mod middleware;
pub mod state;

const MIGRATIONS: &[(&str, &str)] = &[
    ("001", include_str!("../migrations/001_initial_schema.sql")),
    ("002", include_str!("../migrations/002_initial_auth.sql")),
    ("003", include_str!("../migrations/003_password_auth.sql")),
    ("004", include_str!("../migrations/004_recovery_email_and_password_reset.sql")),
    ("005", include_str!("../migrations/005_user_settings.sql")),
];

async fn run_migrations(db: &sqlx::PgPool) -> anyhow::Result<()> {
    for (version, sql) in MIGRATIONS {
        for statement in sql.split(';') {
            let trimmed = statement.trim();
            if !trimmed.is_empty() && !trimmed.starts_with("--") {
                sqlx::query(trimmed).execute(db).await?;
            }
        }
        tracing::info!("Auth migration {version} applied");
    }
    Ok(())
}

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::AuthConfig::from_env()?;
    let state = state::AuthState::new(config.clone()).await?;

    run_migrations(&state.db).await?;

    let protected_routes = axum::Router::new()
        .route("/me", axum::routing::get(handlers::get_current_user))
        .route("/account", axum::routing::patch(handlers::update_account))
        .route("/sessions", axum::routing::get(handlers::list_sessions))
        .route("/sessions/revoke-others", axum::routing::post(handlers::revoke_other_sessions))
        .route("/sessions/:id", axum::routing::delete(handlers::revoke_session))
        .route("/device/register", axum::routing::post(handlers::register_device))
        .route("/device/trust", axum::routing::post(handlers::trust_device))
        .route("/logout", axum::routing::post(handlers::logout))
        .route_layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::require_auth,
        ));

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/register", axum::routing::post(handlers::register))
        .route("/login", axum::routing::post(handlers::login_password))
        .route("/login/password", axum::routing::post(handlers::login_password))
        .route("/send-otp", axum::routing::post(handlers::send_otp))
        .route("/otp/send", axum::routing::post(handlers::send_otp))
        .route("/password-reset/request", axum::routing::post(handlers::send_otp))
        .route("/verify-otp", axum::routing::post(handlers::verify_otp))
        .route("/otp/verify", axum::routing::post(handlers::verify_otp))
        .route("/reset-password", axum::routing::post(handlers::reset_password))
        .route("/change-password", axum::routing::post(handlers::change_password))
        .route("/token/refresh", axum::routing::post(handlers::refresh_token))
        .merge(protected_routes)
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::rate_limit,
        ))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("Auth Service listening on {}", addr);
    axum::serve(listener, app).await?;

    Ok(())
}
