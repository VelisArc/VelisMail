//! Bounce handling: classification, suppression lists, and rate tracking.
//!
//! Hard bounces trigger immediate suppression; soft bounces are tracked
//! and suppressed after threshold violations.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

/// Bounce type classification.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BounceType {
    Hard,
    Soft,
}

impl std::fmt::Display for BounceType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BounceType::Hard => write!(f, "hard"),
            BounceType::Soft => write!(f, "soft"),
        }
    }
}

/// Bounce event request.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BounceEventRequest {
    pub recipient: String,
    pub sender_domain: String,
    pub bounce_type: String,
    pub diagnostic_code: Option<String>,
    pub message_id: Option<String>,
}

/// Bounce statistics per domain.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BounceStats {
    pub domain: String,
    pub total_bounces: i64,
    pub hard_bounces: i64,
    pub soft_bounces: i64,
    pub bounce_rate_percent: f64,
    pub total_sent: i64,
}

/// Classify a bounce as hard or soft based on diagnostic code.
pub fn classify_bounce(diagnostic_code: Option<&str>, bounce_type_hint: &str) -> BounceType {
    // Check explicit hint
    if bounce_type_hint.to_lowercase().contains("hard") {
        return BounceType::Hard;
    }

    // Check diagnostic codes per RFC 3463 / SMTP enhanced status codes
    if let Some(code) = diagnostic_code {
        let code = code.trim();
        // 5.x.x codes are permanent failures → hard bounce
        if code.starts_with("5.1.")
            || code.starts_with("550")
            || code.starts_with("551")
            || code.starts_with("552")
            || code.starts_with("553")
            || code.starts_with("554")
        {
            return BounceType::Hard;
        }
        // 4.x.x codes are temporary → soft bounce
        if code.starts_with("4.")
            || code.starts_with("421")
            || code.starts_with("450")
            || code.starts_with("451")
            || code.starts_with("452")
        {
            return BounceType::Soft;
        }
        // Common hard bounce indicators
        if code.contains("user unknown")
            || code.contains("mailbox not found")
            || code.contains("no such user")
            || code.contains("does not exist")
        {
            return BounceType::Hard;
        }
    }

    // Default to soft if we can't determine
    BounceType::Soft
}

/// Record a bounce event and manage suppression.
pub async fn handle_bounce(db: &PgPool, event: &BounceEventRequest) -> Result<BounceType> {
    let bounce_type = classify_bounce(event.diagnostic_code.as_deref(), &event.bounce_type);
    let id = Uuid::new_v4();

    // Insert bounce event
    sqlx::query(
        r#"INSERT INTO bounce_events
           (id, recipient, sender_domain, bounce_type, diagnostic_code, message_id)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(id)
    .bind(&event.recipient)
    .bind(&event.sender_domain)
    .bind(bounce_type.to_string())
    .bind(event.diagnostic_code.as_deref())
    .bind(event.message_id.as_deref())
    .execute(db)
    .await?;

    // For hard bounces, immediately add to suppression list
    if bounce_type == BounceType::Hard {
        add_to_suppression_list(db, &event.recipient, "hard_bounce").await?;
    } else {
        // For soft bounces, suppress after 3 within 24 hours
        let recent_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM bounce_events
             WHERE recipient = $1 AND bounce_type = 'soft'
             AND created_at > NOW() - INTERVAL '24 hours'",
        )
        .bind(&event.recipient)
        .fetch_one(db)
        .await
        .unwrap_or(0);

        if recent_count >= 3 {
            add_to_suppression_list(db, &event.recipient, "repeated_soft_bounce").await?;
        }
    }

    Ok(bounce_type)
}

/// Add an email address to the suppression list.
async fn add_to_suppression_list(db: &PgPool, email: &str, reason: &str) -> Result<()> {
    sqlx::query(
        "INSERT INTO suppression_list (email, reason)
         VALUES ($1, $2)
         ON CONFLICT (email) DO UPDATE SET reason = $2, updated_at = NOW()",
    )
    .bind(email)
    .bind(reason)
    .execute(db)
    .await?;

    tracing::info!(email = email, reason = reason, "Added to suppression list");

    Ok(())
}

/// Check if an email is suppressed.
pub async fn is_suppressed(db: &PgPool, email: &str) -> Result<bool> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM suppression_list WHERE email = $1")
        .bind(email)
        .fetch_one(db)
        .await
        .unwrap_or(0);

    Ok(count > 0)
}

/// Get bounce statistics for a domain.
pub async fn get_bounce_stats(db: &PgPool, domain: &str) -> Result<BounceStats> {
    let row = sqlx::query(
        "SELECT
            COUNT(*) as total_bounces,
            COUNT(*) FILTER (WHERE bounce_type = 'hard') as hard_bounces,
            COUNT(*) FILTER (WHERE bounce_type = 'soft') as soft_bounces
         FROM bounce_events
         WHERE sender_domain = $1
         AND created_at > NOW() - INTERVAL '30 days'",
    )
    .bind(domain)
    .fetch_one(db)
    .await?;

    let total_bounces: i64 = row.try_get("total_bounces").unwrap_or(0);
    let hard_bounces: i64 = row.try_get("hard_bounces").unwrap_or(0);
    let soft_bounces: i64 = row.try_get("soft_bounces").unwrap_or(0);

    // Estimate total sent (from delivery queue)
    let total_sent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM delivery_queue
         WHERE sender LIKE '%' || $1
         AND created_at > NOW() - INTERVAL '30 days'",
    )
    .bind(domain)
    .fetch_one(db)
    .await
    .unwrap_or(1); // Avoid division by zero

    let bounce_rate = if total_sent > 0 {
        (total_bounces as f64 / total_sent as f64) * 100.0
    } else {
        0.0
    };

    Ok(BounceStats {
        domain: domain.to_string(),
        total_bounces,
        hard_bounces,
        soft_bounces,
        bounce_rate_percent: (bounce_rate * 100.0).round() / 100.0,
        total_sent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_hard_bounce() {
        assert_eq!(
            classify_bounce(Some("550 User not found"), "bounce"),
            BounceType::Hard
        );
        assert_eq!(
            classify_bounce(Some("5.1.1 mailbox not found"), "bounce"),
            BounceType::Hard
        );
    }

    #[test]
    fn test_classify_soft_bounce() {
        assert_eq!(
            classify_bounce(Some("450 Mailbox busy"), "bounce"),
            BounceType::Soft
        );
        assert_eq!(
            classify_bounce(Some("4.2.2 Mailbox full"), "bounce"),
            BounceType::Soft
        );
    }

    #[test]
    fn test_classify_from_hint() {
        assert_eq!(classify_bounce(None, "hard"), BounceType::Hard);
    }
}
