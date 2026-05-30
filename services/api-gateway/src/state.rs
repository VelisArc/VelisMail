//! Application state

use crate::config::GatewayConfig;
use anyhow::Result;
use reqwest::Client;
use serde_json::Value;
use sqlx::PgPool;
use std::time::Duration;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::RwLock;
use tokio::sync::Semaphore;

#[derive(Clone)]
pub struct AppState {
    pub config: GatewayConfig,
    pub http_client: Client,
    pub rate_limiter: Arc<Semaphore>,
    /// Persistent DB pool (when DATABASE_URL is set), else falls back to in-memory.
    pub db: Option<PgPool>,
    /// Fallback in-memory store when no DB is configured.
    pub team_invites: Arc<RwLock<HashMap<String, Value>>>,
    pub inbound_routes: Arc<RwLock<HashMap<String, Value>>>,
}

impl AppState {
    pub async fn new(config: GatewayConfig) -> Result<Self> {
        let http_client = Client::builder()
            .timeout(Duration::from_secs(30))
            .pool_max_idle_per_host(10)
            .build()?;

        let rate_limit_capacity = config.rate_limit_per_minute as usize;
        let rate_limiter = Arc::new(Semaphore::new(rate_limit_capacity));

        // Refill permits every minute up to capacity
        {
            let rl = rate_limiter.clone();
            let cap = rate_limit_capacity;
            tokio::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let available = rl.available_permits();
                    if available < cap {
                        rl.add_permits(cap - available);
                    }
                }
            });
        }

        // Connect to gateway DB if configured
        let db = if let Some(url) = &config.db_url {
            match PgPool::connect(url).await {
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
            tracing::info!("No DATABASE_URL set — using in-memory storage for team invites / inbound routes");
            None
        };

        Ok(Self {
            config,
            http_client,
            rate_limiter,
            db,
            team_invites: Arc::new(RwLock::new(HashMap::new())),
            inbound_routes: Arc::new(RwLock::new(HashMap::new())),
        })
    }
}
