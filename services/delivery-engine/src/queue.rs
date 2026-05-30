//! Persistent delivery queue backed by Postgres.
//!
//! Manages email delivery lifecycle: enqueue → processing → delivered/failed/dead_letter.
//! Supports retry with exponential backoff.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Delivery queue item status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    Pending,
    Processing,
    Delivered,
    Failed,
    DeadLetter,
}

impl std::fmt::Display for DeliveryStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeliveryStatus::Pending => write!(f, "pending"),
            DeliveryStatus::Processing => write!(f, "processing"),
            DeliveryStatus::Delivered => write!(f, "delivered"),
            DeliveryStatus::Failed => write!(f, "failed"),
            DeliveryStatus::DeadLetter => write!(f, "dead_letter"),
        }
    }
}

/// Delivery queue item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliveryQueueItem {
    pub id: Uuid,
    pub message_id: String,
    pub sender: String,
    pub recipient: String,
    pub subject: String,
    pub body: String,
    pub html_body: Option<String>,
    pub status: String,
    pub retry_count: i32,
    pub max_retries: i32,
    pub last_error: Option<String>,
    pub next_retry_at: Option<chrono::DateTime<chrono::Utc>>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

/// Enqueue request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueRequest {
    pub sender: String,
    pub recipient: String,
    pub subject: String,
    pub body: String,
    pub html_body: Option<String>,
    pub priority: Option<String>,
}

/// Enqueue a new email for delivery.
pub async fn enqueue(db: &PgPool, request: &EnqueueRequest, max_retries: u32) -> Result<Uuid> {
    let id = Uuid::new_v4();
    let message_id = format!("<{}@velismail.online>", Uuid::new_v4());

    sqlx::query(
        r#"INSERT INTO delivery_queue
           (id, message_id, sender, recipient, subject, body, html_body, status, max_retries, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)"#,
    )
    .bind(id)
    .bind(&message_id)
    .bind(&request.sender)
    .bind(&request.recipient)
    .bind(&request.subject)
    .bind(&request.body)
    .bind(request.html_body.as_deref())
    .bind(max_retries as i32)
    .bind(request.priority.as_deref().unwrap_or("normal"))
    .execute(db)
    .await?;

    Ok(id)
}

/// Get the status of a delivery queue item.
pub async fn get_status(db: &PgPool, id: Uuid) -> Result<Option<DeliveryQueueItem>> {
    let row = sqlx::query(
        "SELECT id, message_id, sender, recipient, subject, body, html_body, status, retry_count, max_retries, last_error, next_retry_at, created_at
         FROM delivery_queue WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(db)
    .await?;

    Ok(row.map(|r| DeliveryQueueItem {
        id: r.try_get("id").unwrap_or_default(),
        message_id: r.try_get("message_id").unwrap_or_default(),
        sender: r.try_get("sender").unwrap_or_default(),
        recipient: r.try_get("recipient").unwrap_or_default(),
        subject: r.try_get("subject").unwrap_or_default(),
        body: r.try_get("body").unwrap_or_default(),
        html_body: r.try_get("html_body").ok().flatten(),
        status: r.try_get("status").unwrap_or_else(|_| "unknown".to_string()),
        retry_count: r.try_get("retry_count").unwrap_or(0),
        max_retries: r.try_get("max_retries").unwrap_or(5),
        last_error: r.try_get("last_error").ok().flatten(),
        next_retry_at: r.try_get("next_retry_at").ok().flatten(),
        created_at: r.try_get("created_at").unwrap_or_else(|_| chrono::Utc::now()),
    }))
}

/// Mark a queue item as processing.
pub async fn mark_processing(db: &PgPool, id: Uuid) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE delivery_queue SET status = 'processing', updated_at = NOW()
         WHERE id = $1 AND status IN ('pending', 'failed')",
    )
    .bind(id)
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Mark a queue item as delivered.
pub async fn mark_delivered(db: &PgPool, id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE delivery_queue SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
         WHERE id = $1",
    )
    .bind(id)
    .execute(db)
    .await?;

    Ok(())
}

/// Mark a queue item as failed and schedule retry with exponential backoff.
pub async fn mark_failed(
    db: &PgPool,
    id: Uuid,
    error: &str,
    backoff_seconds: u64,
) -> Result<()> {
    let row = sqlx::query("SELECT retry_count, max_retries FROM delivery_queue WHERE id = $1")
        .bind(id)
        .fetch_optional(db)
        .await?;

    let Some(row) = row else {
        return Ok(());
    };

    let retry_count: i32 = row.try_get("retry_count").unwrap_or(0);
    let max_retries: i32 = row.try_get("max_retries").unwrap_or(5);
    let new_retry_count = retry_count + 1;

    if new_retry_count >= max_retries {
        // Move to dead letter queue
        sqlx::query(
            "UPDATE delivery_queue SET status = 'dead_letter', retry_count = $2, last_error = $3, updated_at = NOW()
             WHERE id = $1",
        )
        .bind(id)
        .bind(new_retry_count)
        .bind(error)
        .execute(db)
        .await?;
    } else {
        // Schedule retry with exponential backoff
        let delay = backoff_seconds * 2u64.pow(new_retry_count as u32);
        let next_retry =
            chrono::Utc::now() + chrono::Duration::seconds(delay as i64);

        sqlx::query(
            "UPDATE delivery_queue SET status = 'failed', retry_count = $2, last_error = $3, next_retry_at = $4, updated_at = NOW()
             WHERE id = $1",
        )
        .bind(id)
        .bind(new_retry_count)
        .bind(error)
        .bind(next_retry)
        .execute(db)
        .await?;
    }

    Ok(())
}

/// Retry a failed delivery by resetting to pending.
pub async fn retry(db: &PgPool, id: Uuid) -> Result<bool> {
    let result = sqlx::query(
        "UPDATE delivery_queue SET status = 'pending', next_retry_at = NULL, updated_at = NOW()
         WHERE id = $1 AND status IN ('failed', 'dead_letter')",
    )
    .bind(id)
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}

/// Fetch pending items ready for delivery.
pub async fn fetch_pending(db: &PgPool, limit: i64) -> Result<Vec<DeliveryQueueItem>> {
    let rows = sqlx::query(
        "SELECT id, message_id, sender, recipient, subject, body, html_body, status, retry_count, max_retries, last_error, next_retry_at, created_at
         FROM delivery_queue
         WHERE status = 'pending'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY
           CASE WHEN priority = 'critical' THEN 0 WHEN priority = 'high' THEN 1 WHEN priority = 'normal' THEN 2 ELSE 3 END,
           created_at ASC
         LIMIT $1",
    )
    .bind(limit)
    .fetch_all(db)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| DeliveryQueueItem {
            id: r.try_get("id").unwrap_or_default(),
            message_id: r.try_get("message_id").unwrap_or_default(),
            sender: r.try_get("sender").unwrap_or_default(),
            recipient: r.try_get("recipient").unwrap_or_default(),
            subject: r.try_get("subject").unwrap_or_default(),
            body: r.try_get("body").unwrap_or_default(),
            html_body: r.try_get("html_body").ok().flatten(),
            status: r.try_get("status").unwrap_or_else(|_| "pending".to_string()),
            retry_count: r.try_get("retry_count").unwrap_or(0),
            max_retries: r.try_get("max_retries").unwrap_or(5),
            last_error: r.try_get("last_error").ok().flatten(),
            next_retry_at: r.try_get("next_retry_at").ok().flatten(),
            created_at: r.try_get("created_at").unwrap_or_else(|_| chrono::Utc::now()),
        })
        .collect())
}
