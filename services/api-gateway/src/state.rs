//! Application state

use axum::extract::FromRef;
use reqwest::Client;
use anyhow::Result;
use crate::config::GatewayConfig;
use std::sync::Arc;
use tokio::sync::Semaphore;
use std::time::Duration;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub config: GatewayConfig,
    pub http_client: Client,
    pub rate_limiter: Arc<Semaphore>,
    pub rate_limit_capacity: usize,
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

        Ok(Self {
            config,
            http_client,
            rate_limiter,
            rate_limit_capacity,
        })
    }
}
