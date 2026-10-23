//! Application state

use crate::config::GatewayConfig;
use anyhow::Result;
use reqwest::Client;
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::{Duration, Instant};
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use velismail_common::traffic::{Metrics, RateLimiter};

#[derive(Clone)]
pub struct AppState {
    pub config: GatewayConfig,
    pub http_client: Client,
    /// Per-client rate limiter for general API traffic.
    pub rate_limiter: Arc<RateLimiter>,
    /// Stricter per-client limiter for authentication endpoints.
    pub auth_rate_limiter: Arc<RateLimiter>,
    pub metrics: Arc<Metrics>,
    /// Bounds in-flight requests so a traffic spike cannot exhaust memory.
    pub request_slots: Arc<tokio::sync::Semaphore>,
    pub started_at: Instant,
    /// Daily traffic rollup counters flushed by a background task.
    pub traffic: Arc<crate::traffic::DailyTraffic>,
    /// Persistent DB pool (when DATABASE_URL is set), else falls back to in-memory.
    pub db: Option<PgPool>,
    pub inbound_routes: Arc<RwLock<HashMap<String, Value>>>,
}

impl AppState {
    pub async fn new(config: GatewayConfig) -> Result<Self> {
        let http_client = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(
                config.request_timeout_seconds.max(10) + 5,
            ))
            .pool_max_idle_per_host(32)
            .pool_idle_timeout(Duration::from_secs(90))
            .tcp_keepalive(Duration::from_secs(30))
            .user_agent(concat!("VelisMail-Gateway/", env!("CARGO_PKG_VERSION")))
            .build()?;

        let rate_limiter = Arc::new(RateLimiter::per_minute(config.rate_limit_per_minute as u32));
        let auth_rate_limiter = Arc::new(RateLimiter::per_minute(
            config.auth_rate_limit_per_minute as u32,
        ));

        // Connect to gateway DB if configured. A bounded, health-checked pool
        // prevents an unavailable database from exhausting the process.
        let db = if let Some(url) = &config.db_url {
            match PgPoolOptions::new()
                .max_connections(10)
                .min_connections(1)
                .acquire_timeout(Duration::from_secs(5))
                .idle_timeout(Duration::from_secs(300))
                .max_lifetime(Duration::from_secs(1800))
                .connect(url)
                .await
            {
                Ok(pool) => {
                    tracing::info!("Gateway DB connected for persistence");
                    Some(pool)
                }
                Err(e) => {
                    tracing::warn!(
                        "Gateway DB connection failed, falling back to in-memory: {}",
                        e
                    );
                    None
                }
            }
        } else {
            tracing::info!(
                "No DATABASE_URL set — using in-memory storage for team invites / inbound routes"
            );
            None
        };

        let request_slots = Arc::new(tokio::sync::Semaphore::new(config.max_concurrent_requests));

        Ok(Self {
            config,
            http_client,
            rate_limiter,
            auth_rate_limiter,
            metrics: Arc::new(Metrics::default()),
            request_slots,
            started_at: Instant::now(),
            traffic: Arc::new(crate::traffic::DailyTraffic::default()),
            db,
            inbound_routes: Arc::new(RwLock::new(HashMap::new())),
        })
    }
}
