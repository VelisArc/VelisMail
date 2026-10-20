pub mod config;
pub mod handlers;
mod middleware;
pub mod state;

pub mod bounce;
pub mod dkim;
pub mod dmarc;
pub mod queue;
pub mod spf;

pub async fn run_service() -> anyhow::Result<()> {
    let config = config::DeliveryConfig::from_env()?;
    let state = state::DeliveryState::new(config.clone()).await?;

    velismail_database::migrations::run_migrations(&state.db).await?;

    // Spawn the background delivery worker.
    {
        let worker_db = state.db.clone();
        let email_client = state.email_client.clone();
        let backoff = config.queue_retry_backoff_seconds;
        let concurrency = config.queue_concurrency;
        let poll_seconds = config.queue_poll_seconds;
        let from_name = config.platform_from_name.clone();
        tokio::spawn(async move {
            queue_worker(
                worker_db,
                email_client,
                backoff,
                concurrency,
                poll_seconds,
                from_name,
            )
            .await;
        });
    }

    let app = axum::Router::new()
        .route("/health", axum::routing::get(handlers::health_check))
        .route("/ready", axum::routing::get(handlers::health_check))
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
        .route(
            "/bounce/handle",
            axum::routing::post(handlers::handle_bounce),
        )
        .route("/bounce/stats", axum::routing::get(handlers::bounce_stats))
        // Queue
        .route(
            "/queue/enqueue",
            axum::routing::post(handlers::queue_enqueue),
        )
        .route(
            "/queue/status/{id}",
            axum::routing::get(handlers::queue_status),
        )
        .route(
            "/queue/retry/{id}",
            axum::routing::post(handlers::queue_retry),
        )
        // Deliverability
        .route(
            "/deliverability/score",
            axum::routing::get(handlers::deliverability_score),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            middleware::auth_layer,
        ))
        .layer(axum::middleware::from_fn(
            velismail_common::middleware::request_id_middleware,
        ))
        .layer(tower_http::timeout::TimeoutLayer::with_status_code(
            axum::http::StatusCode::GATEWAY_TIMEOUT,
            std::time::Duration::from_secs(60),
        ))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            2 * 1024 * 1024,
        ))
        .layer(tower_http::compression::CompressionLayer::new())
        .layer(middleware::cors_layer())
        .layer(axum::middleware::from_fn(
            velismail_common::middleware::security_headers,
        ))
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
///
/// Items are claimed atomically with `FOR UPDATE SKIP LOCKED`, so multiple
/// worker tasks (and multiple service instances) never send the same message
/// twice. Delivery failures schedule an exponential-backoff retry and
/// eventually move the item to the dead-letter queue.
async fn queue_worker(
    db: sqlx::PgPool,
    email_client: Option<std::sync::Arc<velismail_email::ResendClient>>,
    backoff_seconds: u64,
    concurrency: usize,
    poll_seconds: u64,
    from_name: String,
) {
    tracing::info!(
        concurrency,
        poll_seconds,
        resend_configured = email_client.is_some(),
        "Delivery queue worker started"
    );

    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(poll_seconds));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    if let Err(error) = queue::requeue_stale(&db, 15).await {
        tracing::warn!(error = %error, "Could not requeue stale deliveries at startup");
    }

    loop {
        interval.tick().await;

        // Recover rows whose worker died mid-send before claiming new work.
        if let Err(error) = queue::requeue_stale(&db, 15).await {
            tracing::warn!(error = %error, "Could not requeue stale deliveries");
        }

        let items = match queue::claim_pending(&db, concurrency.max(1) as i64).await {
            Ok(items) => items,
            Err(error) => {
                tracing::error!(error = %error, "Queue worker claim failed");
                continue;
            }
        };

        for item in items {
            let permit = match semaphore.clone().acquire_owned().await {
                Ok(permit) => permit,
                Err(_) => return,
            };

            let db = db.clone();
            let client = email_client.clone();
            let from_name = from_name.clone();
            tokio::spawn(async move {
                let _permit = permit;
                tracing::info!(
                    queue_id = %item.id,
                    recipient = %item.recipient,
                    "Processing delivery"
                );

                let Some(client) = client else {
                    let error =
                        "Outbound email provider is not configured (PLATFORM_RESEND_API_KEY)";
                    tracing::error!(queue_id = %item.id, "{error}");
                    if let Err(mark_error) =
                        queue::mark_failed(&db, item.id, error, backoff_seconds).await
                    {
                        tracing::error!(queue_id = %item.id, error = %mark_error, "Failed to record delivery failure");
                    }
                    return;
                };

                let mut headers = std::collections::BTreeMap::new();
                headers.insert("Message-ID".to_string(), item.message_id.clone());
                let message = velismail_email::EmailMessage {
                    from: item.sender.clone(),
                    from_name: Some(from_name),
                    to: vec![item.recipient.clone()],
                    subject: item.subject.clone(),
                    text: item.body.clone(),
                    html: item.html_body.clone(),
                    headers,
                    ..Default::default()
                };

                match client.send(&message).await {
                    Ok(_) => {
                        if let Err(error) = queue::mark_delivered(&db, item.id).await {
                            tracing::error!(
                                queue_id = %item.id,
                                error = %error,
                                "Failed to mark delivery as completed"
                            );
                        }
                    }
                    Err(error) => {
                        tracing::warn!(
                            queue_id = %item.id,
                            recipient = %item.recipient,
                            error = %error,
                            "Outbound delivery failed; scheduling retry"
                        );
                        if let Err(mark_error) =
                            queue::mark_failed(&db, item.id, &error.to_string(), backoff_seconds)
                                .await
                        {
                            tracing::error!(
                                queue_id = %item.id,
                                error = %mark_error,
                                "Failed to record delivery failure"
                            );
                        }
                    }
                }
            });
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
