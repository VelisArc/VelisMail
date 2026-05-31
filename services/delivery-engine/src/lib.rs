pub mod config;
pub mod handlers;
mod middleware;
pub mod state;

pub mod bounce;
pub mod dkim;
pub mod dmarc;
pub mod queue;
pub mod spf;

const MIGRATIONS: &[(&str, &str)] = &[
    ("001", include_str!("../migrations/001_delivery_schema.sql")),
];

async fn run_migrations(db: &sqlx::PgPool) -> anyhow::Result<()> {
    for (version, sql) in MIGRATIONS {
        let clean: String = sql
            .lines()
            .filter(|l| !l.trim().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n");
        for stmt in clean.split(';') {
            let trimmed = stmt.trim();
            if !trimmed.is_empty() {
                sqlx::query(trimmed).execute(db).await?;
            }
        }
        tracing::info!("Delivery migration {version} applied");
    }
    Ok(())
}

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::DeliveryConfig::from_env()?;
    let state = state::DeliveryState::new(config.clone()).await?;

    run_migrations(&state.db).await?;

    // Spawn background queue worker
    {
        let worker_db = state.db.clone();
        let backoff = config.queue_retry_backoff_seconds;
        tokio::spawn(async move {
            queue_worker(worker_db, backoff).await;
        });
    }

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        // DKIM
        .route("/dkim/info", axum::routing::get(handlers::dkim_info))
        .route("/dkim/sign", axum::routing::post(handlers::dkim_sign))
        .route("/dkim/verify", axum::routing::post(handlers::dkim_verify))
        // SPF
        .route("/spf/verify", axum::routing::post(handlers::spf_verify))
        .route("/spf/check", axum::routing::post(handlers::spf_check))
        // DMARC
        .route("/dmarc/check", axum::routing::post(handlers::dmarc_check))
        // Bounce
        .route("/bounce/handle", axum::routing::post(handlers::handle_bounce))
        .route("/bounce/stats", axum::routing::get(handlers::bounce_stats))
        // Queue
        .route("/queue/enqueue", axum::routing::post(handlers::queue_enqueue))
        .route("/queue/status/:id", axum::routing::get(handlers::queue_status))
        .route("/queue/retry/:id", axum::routing::post(handlers::queue_retry))
        // Deliverability
        .route("/deliverability/score", axum::routing::get(handlers::deliverability_score))
        .layer(axum::middleware::from_fn(middleware::auth_layer))
        .layer(middleware::cors_layer())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        service = "delivery-engine",
        version = env!("CARGO_PKG_VERSION"),
        address = %addr,
        "Delivery Engine started"
    );
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

/// Background worker that processes the delivery queue.
async fn queue_worker(db: sqlx::PgPool, backoff_seconds: u64) {
    tracing::info!("Delivery queue worker started");
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));

    loop {
        interval.tick().await;

        match queue::fetch_pending(&db, 10).await {
            Ok(items) if items.is_empty() => continue,
            Ok(items) => {
                for item in items {
                    let db = db.clone();
                    let backoff = backoff_seconds;
                    tokio::spawn(async move {
                        if !queue::mark_processing(&db, item.id).await.unwrap_or(false) {
                            return; // Already picked up by another worker
                        }

                        // Simulate delivery (in production, this would use SMTP)
                        tracing::info!(
                            queue_id = %item.id,
                            recipient = %item.recipient,
                            "Processing delivery"
                        );

                        // For now, mark as delivered (real SMTP integration would go here)
                        if let Err(e) = queue::mark_delivered(&db, item.id).await {
                            tracing::error!(
                                queue_id = %item.id,
                                error = %e,
                                "Failed to mark delivery as completed"
                            );
                            let _ = queue::mark_failed(
                                &db,
                                item.id,
                                &e.to_string(),
                                backoff,
                            )
                            .await;
                        }
                    });
                }
            }
            Err(e) => {
                tracing::error!("Queue worker fetch error: {}", e);
            }
        }
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => { tracing::info!("Received Ctrl+C, shutting down delivery-engine..."); }
        _ = terminate => { tracing::info!("Received SIGTERM, shutting down delivery-engine..."); }
    }
}
