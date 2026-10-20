//! Lightweight, lock-free daily traffic rollups.
//!
//! The request middleware only touches atomics; a background task flushes the
//! deltas into `platform_traffic_daily` every 30 seconds. This keeps the
//! control-plane analytics durable without adding a database round-trip to
//! every proxied request.

use sqlx::PgPool;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;

#[derive(Default)]
pub struct DailyTraffic {
    requests: AtomicI64,
    errors: AtomicI64,
    rate_limited: AtomicI64,
    overloads: AtomicI64,
    total_latency_us: AtomicI64,
}

impl DailyTraffic {
    pub fn record(&self, status: u16, duration: Duration) {
        self.requests.fetch_add(1, Ordering::Relaxed);
        if status >= 500 {
            self.errors.fetch_add(1, Ordering::Relaxed);
        }
        self.total_latency_us.fetch_add(
            duration.as_micros().min(i64::MAX as u128) as i64,
            Ordering::Relaxed,
        );
    }

    pub fn record_rate_limited(&self) {
        self.rate_limited.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_overload(&self) {
        self.overloads.fetch_add(1, Ordering::Relaxed);
    }

    /// Atomically drain the counters and upsert them into the current day's row.
    pub async fn flush(&self, db: &PgPool) -> Result<(), sqlx::Error> {
        let requests = self.requests.swap(0, Ordering::Relaxed);
        let errors = self.errors.swap(0, Ordering::Relaxed);
        let rate_limited = self.rate_limited.swap(0, Ordering::Relaxed);
        let overloads = self.overloads.swap(0, Ordering::Relaxed);
        let total_latency_us = self.total_latency_us.swap(0, Ordering::Relaxed);

        if requests == 0 && rate_limited == 0 && overloads == 0 {
            return Ok(());
        }

        sqlx::query(
            "INSERT INTO platform_traffic_daily
             (day, requests, errors, rate_limited, overloads, total_latency_us, updated_at)
             VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, NOW())
             ON CONFLICT (day) DO UPDATE SET
                requests = platform_traffic_daily.requests + EXCLUDED.requests,
                errors = platform_traffic_daily.errors + EXCLUDED.errors,
                rate_limited = platform_traffic_daily.rate_limited + EXCLUDED.rate_limited,
                overloads = platform_traffic_daily.overloads + EXCLUDED.overloads,
                total_latency_us = platform_traffic_daily.total_latency_us + EXCLUDED.total_latency_us,
                updated_at = NOW()",
        )
        .bind(requests)
        .bind(errors)
        .bind(rate_limited)
        .bind(overloads)
        .bind(total_latency_us)
        .execute(db)
        .await?;

        Ok(())
    }
}
