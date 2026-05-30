//! Mail service route handlers

use crate::models::{
    CreateEmailRequest, EmailMoveRequest, EmailSearchRequest, EmailUpdateRequest, FolderStats,
};
use crate::state::MailState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use lettre::{
    message::{header::ContentType, Mailbox, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::collections::HashMap;
use std::sync::Mutex;
use uuid::Uuid;

// ────────────────────────────────────────────────────────────
// Business email pool (tenant-specific dynamic DB connections)
// ────────────────────────────────────────────────────────────

struct CachedPool {
    pool: PgPool,
    last_used: std::time::Instant,
}

static BUSINESS_POOLS: std::sync::LazyLock<Mutex<HashMap<String, CachedPool>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn normalize_business_db_url(db_url: &str) -> String {
    let trimmed = db_url.trim();
    if trimmed.contains("neon.tech") && !trimmed.to_ascii_lowercase().contains("sslmode=") {
        let separator = if trimmed.contains('?') { '&' } else { '?' };
        return format!("{trimmed}{separator}sslmode=require");
    }
    trimmed.to_string()
}

async fn get_business_pool(db_url: &str) -> Result<PgPool, String> {
    let normalized_url = normalize_business_db_url(db_url);

    // 1. Try to find and check existing pool
    if let Ok(mut pools) = BUSINESS_POOLS.lock() {
        if let Some(cached) = pools.get_mut(&normalized_url) {
            // Check health before reuse
            if sqlx::query("SELECT 1").execute(&cached.pool).await.is_ok() {
                cached.last_used = std::time::Instant::now();
                return Ok(cached.pool.clone());
            } else {
                pools.remove(&normalized_url);
            }
        }
    }

    // 2. Create new pool
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&normalized_url)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Cache the pool and evict oldest if needed (max 50 pools)
    if let Ok(mut pools) = BUSINESS_POOLS.lock() {
        if pools.len() >= 50 {
            let oldest_key = pools
                .iter()
                .min_by_key(|(_, v)| v.last_used)
                .map(|(k, _)| k.clone());
            if let Some(key) = oldest_key {
                if let Some(removed) = pools.remove(&key) {
                    tokio::spawn(async move {
                        removed.pool.close().await;
                    });
                }
            }
        }
        pools.insert(
            normalized_url,
            CachedPool {
                pool: pool.clone(),
                last_used: std::time::Instant::now(),
            },
        );
    }

    Ok(pool)
}

async fn ensure_business_emails_table(pool: &PgPool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS business_emails (
            id VARCHAR(255) PRIMARY KEY,
            sender VARCHAR(255),
            sender_name VARCHAR(255),
            recipients TEXT,
            subject TEXT,
            body TEXT,
            html_body TEXT,
            folder VARCHAR(50),
            created_at VARCHAR(100),
            is_read BOOLEAN,
            is_starred BOOLEAN,
            has_attachment BOOLEAN DEFAULT FALSE,
            in_reply_to VARCHAR(512),
            thread_id VARCHAR(255),
            message_id VARCHAR(512)
        );",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    // Safe ADD COLUMN IF NOT EXISTS for schema evolution
    for col in &[
        "has_attachment BOOLEAN DEFAULT FALSE",
        "html_body TEXT",
        "in_reply_to VARCHAR(512)",
        "thread_id VARCHAR(255)",
        "message_id VARCHAR(512)",
    ] {
        let _col_name = col.split_whitespace().next().unwrap_or("");
        let stmt =
            format!("ALTER TABLE business_emails ADD COLUMN IF NOT EXISTS {col};");
        let _ = sqlx::query(&stmt).execute(pool).await;
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmail {
    pub id: String,
    pub from: String,
    pub from_name: String,
    pub to: Vec<String>,
    pub subject: String,
    pub body: String,
    #[serde(default)]
    pub html_body: Option<String>,
    pub folder: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
    #[serde(default)]
    pub has_attachment: bool,
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBusinessEmailRequest {
    pub db_url: Option<String>,
    pub email: BusinessEmail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmailsQuery {
    pub db_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessEmailsRequest {
    pub db_url: String,
}

fn business_db_url_from_parts(
    headers: &HeaderMap,
    query_url: Option<&str>,
    body_url: Option<&str>,
) -> Option<String> {
    body_url
        .or(query_url)
        .or_else(|| {
            headers
                .get("x-business-db-url")
                .and_then(|h| h.to_str().ok())
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn read_business_emails(db_url: &str) -> Result<Json<Value>, velismail_common::AppError> {
    let pool = get_business_pool(db_url)
        .await
        .map_err(|e| velismail_common::AppError::Database(sqlx::Error::Configuration(e.to_string().into())))?;

    ensure_business_emails_table(&pool)
        .await
        .map_err(|_| velismail_common::AppError::Internal)?;

    let rows = sqlx::query(
        "SELECT id, sender, sender_name, recipients, subject, body, folder, created_at, is_read, is_starred, has_attachment, html_body, in_reply_to, thread_id, message_id FROM business_emails ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    .map_err(velismail_common::AppError::Database)?;

    let emails: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let recipients: String = row.try_get("recipients").unwrap_or_else(|_| "[]".to_string());
            let to: Vec<String> = serde_json::from_str(&recipients).unwrap_or_default();
            json!({
                "id": row.try_get::<String, _>("id").unwrap_or_default(),
                "from": row.try_get::<String, _>("sender").unwrap_or_default(),
                "fromName": row.try_get::<String, _>("sender_name").unwrap_or_default(),
                "to": to,
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "htmlBody": row.try_get::<Option<String>, _>("html_body").unwrap_or_default(),
                "folder": row.try_get::<String, _>("folder").unwrap_or_default(),
                "date": row.try_get::<String, _>("created_at").unwrap_or_default(),
                "read": row.try_get::<bool, _>("is_read").unwrap_or_default(),
                "starred": row.try_get::<bool, _>("is_starred").unwrap_or_default(),
                "hasAttachment": row.try_get::<bool, _>("has_attachment").unwrap_or_default(),
                "inReplyTo": row.try_get::<Option<String>, _>("in_reply_to").unwrap_or_default(),
                "threadId": row.try_get::<Option<String>, _>("thread_id").unwrap_or_default(),
                "messageId": row.try_get::<Option<String>, _>("message_id").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({"success": true, "emails": emails})))
}

// ────────────────────────────────────────────────────────────
// Health check
// ────────────────────────────────────────────────────────────

/// Deep health check — verifies DB connectivity.
pub async fn health_check(
    State(state): State<MailState>,
) -> Json<serde_json::Value> {
    let db_healthy = sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .is_ok();

    let health = velismail_common::HealthResponse::new(
        "mail-service",
        env!("CARGO_PKG_VERSION"),
        db_healthy,
        None,
        None,
    );
    Json(serde_json::to_value(health).unwrap_or_else(|_| {
        json!({"status": "UNHEALTHY", "service": "mail-service"})
    }))
}

// ────────────────────────────────────────────────────────────
// Business email endpoints
// ────────────────────────────────────────────────────────────

pub async fn get_business_emails(
    State(_state): State<MailState>,
    Query(query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
) -> Result<Json<Value>, velismail_common::AppError> {
    let db_url = match business_db_url_from_parts(&headers, query.db_url.as_deref(), None) {
        Some(url) => url,
        None => {
            return Err(velismail_common::AppError::BadRequest("Missing business database URL".to_string()));
        }
    };

    read_business_emails(&db_url).await
}

pub async fn query_business_emails(
    State(_state): State<MailState>,
    Json(payload): Json<BusinessEmailsRequest>,
) -> Result<Json<Value>, velismail_common::AppError> {
    let db_url = payload.db_url.trim();
    if db_url.is_empty() {
        return Err(velismail_common::AppError::BadRequest("Missing business database URL".to_string()));
    }

    read_business_emails(db_url).await
}

pub async fn save_business_email(
    State(_state): State<MailState>,
    Query(query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
    Json(payload): Json<SaveBusinessEmailRequest>,
) -> Result<Json<Value>, velismail_common::AppError> {
    let db_url = match business_db_url_from_parts(
        &headers,
        query.db_url.as_deref(),
        payload.db_url.as_deref(),
    ) {
        Some(url) => url,
        None => {
            return Err(velismail_common::AppError::BadRequest("Missing business database URL".to_string()));
        }
    };

    let pool = get_business_pool(&db_url)
        .await
        .map_err(|e| velismail_common::AppError::Database(sqlx::Error::Configuration(e.to_string().into())))?;

    ensure_business_emails_table(&pool)
        .await
        .map_err(|_| velismail_common::AppError::Internal)?;

    let email = payload.email;
    let recipients = serde_json::to_string(&email.to).unwrap_or_else(|_| "[]".to_string());

    sqlx::query(
        "INSERT INTO business_emails (id, sender, sender_name, recipients, subject, body, html_body, folder, created_at, is_read, is_starred, has_attachment, in_reply_to, thread_id, message_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (id) DO UPDATE SET
            sender = $2,
            sender_name = $3,
            recipients = $4,
            subject = $5,
            body = $6,
            html_body = $7,
            folder = $8,
            created_at = $9,
            is_read = $10,
            is_starred = $11,
            has_attachment = $12,
            in_reply_to = $13,
            thread_id = $14,
            message_id = $15",
    )
    .bind(&email.id)
    .bind(&email.from)
    .bind(&email.from_name)
    .bind(&recipients)
    .bind(&email.subject)
    .bind(&email.body)
    .bind(&email.html_body)
    .bind(&email.folder)
    .bind(&email.date)
    .bind(email.read)
    .bind(email.starred)
    .bind(email.has_attachment)
    .bind(&email.in_reply_to)
    .bind(&email.thread_id)
    .bind(&email.message_id)
    .execute(&pool)
    .await
    .map_err(velismail_common::AppError::Database)?;

    Ok(Json(json!({"success": true})))
}

// ────────────────────────────────────────────────────────────
// Send email — complete implementation with HTML + threading
// ────────────────────────────────────────────────────────────

/// Send an email with full RFC 5322 support (plain text, HTML, CC/BCC, threading).
pub async fn send_email(
    State(state): State<MailState>,
    Json(request): Json<CreateEmailRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    // Validate request
    if request.to.is_empty() {
        return Err(velismail_common::AppError::BadRequest(
            "At least one recipient is required".to_string(),
        ));
    }

    let from_email = request
        .from
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| state.config.smtp_username.clone());
    let from_name = request
        .from_name
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "VelisMail".to_string());

    let from_mailbox = Mailbox::new(
        Some(from_name.clone()),
        from_email.parse().map_err(|_| {
            velismail_common::AppError::BadRequest("Invalid sender email".to_string())
        })?,
    );

    let message_id = format!("<{}@velismail.online>", Uuid::new_v4());
    let thread_id = if request.in_reply_to.is_some() {
        // Thread continuation: extract thread_id from references or generate from in_reply_to
        request
            .references
            .as_ref()
            .and_then(|refs| refs.first().cloned())
            .or_else(|| request.in_reply_to.clone())
            .unwrap_or_else(|| Uuid::new_v4().to_string())
    } else {
        // New thread
        Uuid::new_v4().to_string()
    };

    let mut builder = Message::builder()
        .from(from_mailbox)
        .subject(request.subject.trim())
        .message_id(Some(message_id.clone()));

    for email in &request.to {
        builder = builder.to(email.parse().map_err(|_| {
            velismail_common::AppError::BadRequest(format!("Invalid recipient: {}", email))
        })?);
    }

    if let Some(cc) = &request.cc {
        for email in cc {
            builder = builder.cc(email.parse().map_err(|_| {
                velismail_common::AppError::BadRequest(format!("Invalid CC: {}", email))
            })?);
        }
    }

    if let Some(bcc) = &request.bcc {
        for email in bcc {
            builder = builder.bcc(email.parse().map_err(|_| {
                velismail_common::AppError::BadRequest(format!("Invalid BCC: {}", email))
            })?);
        }
    }

    if let Some(reply_to) = &request.reply_to {
        builder = builder.reply_to(reply_to.parse().map_err(|_| {
            velismail_common::AppError::BadRequest("Invalid Reply-To".to_string())
        })?);
    }

    if let Some(in_reply_to) = &request.in_reply_to {
        builder = builder.in_reply_to(in_reply_to.clone());
    }

    if let Some(references) = &request.references {
        for reference in references {
            builder = builder.references(reference.clone());
        }
    }

    // Build message body — supports plain, HTML, or multipart
    let message = if let Some(html_body) = &request.html_body {
        // Multipart: text + HTML
        builder
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(request.body.clone()),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html_body.clone()),
                    ),
            )
            .map_err(|e| {
                tracing::error!("Failed to build multipart message: {}", e);
                velismail_common::AppError::Internal
            })?
    } else {
        // Plain text only
        builder
            .header(ContentType::TEXT_PLAIN)
            .body(request.body.clone())
            .map_err(|e| {
                tracing::error!("Failed to build message: {}", e);
                velismail_common::AppError::Internal
            })?
    };

    let transport_builder = match state.config.smtp_port {
        465 => SmtpTransport::relay(&state.config.smtp_host).map_err(|err| {
            tracing::error!(
                "smtp relay builder failed for host {}:{}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                err
            );
            velismail_common::AppError::MailDelivery(err.to_string())
        })?,
        587 => SmtpTransport::starttls_relay(&state.config.smtp_host).map_err(|err| {
            tracing::error!(
                "smtp starttls builder failed for host {}:{}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                err
            );
            velismail_common::AppError::MailDelivery(err.to_string())
        })?,
        _ => SmtpTransport::builder_dangerous(&state.config.smtp_host)
            .port(state.config.smtp_port),
    };

    let transport = transport_builder
        .credentials(Credentials::new(
            state.config.smtp_username.clone(),
            state.config.smtp_password.clone(),
        ))
        .build();

    transport.send(&message).map_err(|err| {
        tracing::error!("smtp send failed: {}", err);
        velismail_common::AppError::MailDelivery(err.to_string())
    })?;

    // Store sent email in platform database
    let email_id = Uuid::new_v4();
    let recipients_json =
        serde_json::to_string(&request.to).unwrap_or_else(|_| "[]".to_string());
    let cc_json = request
        .cc
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    let bcc_json = request
        .bcc
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());

    let _ = sqlx::query(
        r#"INSERT INTO platform_emails
           (id, message_id, thread_id, sender, sender_name, recipients, cc, bcc, subject, body, html_body, folder, in_reply_to, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'sent', $12, 'sent')"#,
    )
    .bind(email_id)
    .bind(&message_id)
    .bind(&thread_id)
    .bind(&from_email)
    .bind(&from_name)
    .bind(&recipients_json)
    .bind(cc_json.as_deref())
    .bind(bcc_json.as_deref())
    .bind(request.subject.trim())
    .bind(&request.body)
    .bind(request.html_body.as_deref())
    .bind(request.in_reply_to.as_deref())
    .execute(&state.db)
    .await
    .map_err(|e| {
        tracing::warn!("Failed to store sent email in platform DB: {}", e);
    });

    Ok(Json(json!({
        "success": true,
        "message_id": message_id,
        "email_id": email_id.to_string(),
        "thread_id": thread_id,
        "status": "sent",
        "delivered_via": state.config.smtp_host,
        "undo_send_window": state.config.undo_send_window_seconds,
        "max_attachment_size_mb": state.config.max_attachment_size_mb
    })))
}

// ────────────────────────────────────────────────────────────
// Platform email CRUD endpoints
// ────────────────────────────────────────────────────────────

/// Get a single email by ID.
pub async fn get_email(
    State(state): State<MailState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let row = sqlx::query(
        "SELECT id, message_id, thread_id, sender, sender_name, recipients, cc, bcc, subject, body, html_body, folder, is_read, is_starred, has_attachment, in_reply_to, status, created_at
         FROM platform_emails WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| velismail_common::AppError::NotFound("Email not found".to_string()))?;

    let recipients: String = row.try_get("recipients").unwrap_or_else(|_| "[]".to_string());
    let to: Vec<String> = serde_json::from_str(&recipients).unwrap_or_default();
    let cc: Option<String> = row.try_get("cc").ok().flatten();
    let cc_list: Vec<String> = cc
        .as_deref()
        .and_then(|v| serde_json::from_str(v).ok())
        .unwrap_or_default();

    Ok(Json(json!({
        "success": true,
        "email": {
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "messageId": row.try_get::<String, _>("message_id").unwrap_or_default(),
            "threadId": row.try_get::<Option<String>, _>("thread_id").unwrap_or_default(),
            "from": row.try_get::<String, _>("sender").unwrap_or_default(),
            "fromName": row.try_get::<Option<String>, _>("sender_name").unwrap_or_default(),
            "to": to,
            "cc": cc_list,
            "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
            "body": row.try_get::<String, _>("body").unwrap_or_default(),
            "htmlBody": row.try_get::<Option<String>, _>("html_body").unwrap_or_default(),
            "folder": row.try_get::<String, _>("folder").unwrap_or_default(),
            "isRead": row.try_get::<bool, _>("is_read").unwrap_or_default(),
            "isStarred": row.try_get::<bool, _>("is_starred").unwrap_or_default(),
            "hasAttachment": row.try_get::<bool, _>("has_attachment").unwrap_or_default(),
            "inReplyTo": row.try_get::<Option<String>, _>("in_reply_to").unwrap_or_default(),
            "status": row.try_get::<String, _>("status").unwrap_or_default(),
            "createdAt": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|d| d.to_rfc3339())
                .unwrap_or_default(),
        }
    })))
}

/// Update email (read status, starred, folder).
pub async fn update_email(
    State(state): State<MailState>,
    Path(id): Path<Uuid>,
    Json(request): Json<EmailUpdateRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let mut updates = Vec::new();
    let mut bind_idx = 1usize;
    let mut values: Vec<String> = Vec::new();

    if let Some(is_read) = request.is_read {
        bind_idx += 1;
        updates.push(format!("is_read = ${bind_idx}"));
        values.push(is_read.to_string());
    }
    if let Some(is_starred) = request.is_starred {
        bind_idx += 1;
        updates.push(format!("is_starred = ${bind_idx}"));
        values.push(is_starred.to_string());
    }
    if let Some(folder) = &request.folder {
        bind_idx += 1;
        updates.push(format!("folder = ${bind_idx}"));
        values.push(folder.clone());
    }

    if updates.is_empty() {
        return Err(velismail_common::AppError::BadRequest(
            "No fields to update".to_string(),
        ));
    }

    let sql = format!(
        "UPDATE platform_emails SET {}, updated_at = NOW() WHERE id = $1",
        updates.join(", ")
    );

    let mut query = sqlx::query(&sql).bind(id);
    // Rebind the dynamic parameters
    for val in &values {
        query = query.bind(val);
    }

    let result = query.execute(&state.db).await?;

    if result.rows_affected() == 0 {
        return Err(velismail_common::AppError::NotFound(
            "Email not found".to_string(),
        ));
    }

    Ok(Json(json!({
        "success": true,
        "message": "Email updated"
    })))
}

/// Soft-delete an email (move to trash).
pub async fn delete_email(
    State(state): State<MailState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let result = sqlx::query(
        "UPDATE platform_emails SET folder = 'trash', updated_at = NOW() WHERE id = $1 AND folder != 'trash'",
    )
    .bind(id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        // If already in trash, permanently delete
        sqlx::query("DELETE FROM platform_emails WHERE id = $1 AND folder = 'trash'")
            .bind(id)
            .execute(&state.db)
            .await?;
    }

    Ok(Json(json!({
        "success": true,
        "message": "Email deleted"
    })))
}

/// Move an email between folders.
pub async fn move_email(
    State(state): State<MailState>,
    Path(id): Path<Uuid>,
    Json(request): Json<EmailMoveRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let result = sqlx::query(
        "UPDATE platform_emails SET folder = $2, updated_at = NOW() WHERE id = $1",
    )
    .bind(id)
    .bind(&request.target_folder)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(velismail_common::AppError::NotFound(
            "Email not found".to_string(),
        ));
    }

    Ok(Json(json!({
        "success": true,
        "message": format!("Email moved to {}", request.target_folder)
    })))
}

/// Get email thread/conversation.
pub async fn get_thread(
    State(state): State<MailState>,
    Path(thread_id): Path<String>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let rows = sqlx::query(
        "SELECT id, message_id, sender, sender_name, recipients, subject, body, html_body, folder, is_read, is_starred, in_reply_to, status, created_at
         FROM platform_emails
         WHERE thread_id = $1
         ORDER BY created_at ASC",
    )
    .bind(&thread_id)
    .fetch_all(&state.db)
    .await?;

    if rows.is_empty() {
        return Err(velismail_common::AppError::NotFound(
            "Thread not found".to_string(),
        ));
    }

    let messages: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let recipients: String = row.try_get("recipients").unwrap_or_else(|_| "[]".to_string());
            let to: Vec<String> = serde_json::from_str(&recipients).unwrap_or_default();
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "messageId": row.try_get::<String, _>("message_id").unwrap_or_default(),
                "from": row.try_get::<String, _>("sender").unwrap_or_default(),
                "fromName": row.try_get::<Option<String>, _>("sender_name").unwrap_or_default(),
                "to": to,
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "body": row.try_get::<String, _>("body").unwrap_or_default(),
                "htmlBody": row.try_get::<Option<String>, _>("html_body").unwrap_or_default(),
                "folder": row.try_get::<String, _>("folder").unwrap_or_default(),
                "isRead": row.try_get::<bool, _>("is_read").unwrap_or_default(),
                "isStarred": row.try_get::<bool, _>("is_starred").unwrap_or_default(),
                "inReplyTo": row.try_get::<Option<String>, _>("in_reply_to").unwrap_or_default(),
                "status": row.try_get::<String, _>("status").unwrap_or_default(),
                "createdAt": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "thread": {
            "threadId": thread_id,
            "messageCount": messages.len(),
            "messages": messages,
        }
    })))
}

/// List available folders with unread counts.
pub async fn list_folders(
    State(state): State<MailState>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let rows = sqlx::query(
        "SELECT folder, COUNT(*) as total, COUNT(*) FILTER (WHERE is_read = false) as unread
         FROM platform_emails
         GROUP BY folder
         ORDER BY folder",
    )
    .fetch_all(&state.db)
    .await?;

    let folders: Vec<FolderStats> = rows
        .into_iter()
        .map(|row| FolderStats {
            name: row.try_get("folder").unwrap_or_else(|_| "inbox".to_string()),
            total: row.try_get("total").unwrap_or(0),
            unread: row.try_get("unread").unwrap_or(0),
        })
        .collect();

    // Ensure standard folders always appear
    let standard_folders = ["inbox", "sent", "drafts", "trash", "spam", "archive"];
    let mut result: Vec<FolderStats> = Vec::new();
    for name in standard_folders {
        if let Some(f) = folders.iter().find(|f| f.name == name) {
            result.push(f.clone());
        } else {
            result.push(FolderStats {
                name: name.to_string(),
                total: 0,
                unread: 0,
            });
        }
    }
    // Append any custom folders
    for f in &folders {
        if !standard_folders.contains(&f.name.as_str()) {
            result.push(f.clone());
        }
    }

    Ok(Json(json!({
        "success": true,
        "folders": result
    })))
}

/// Full-text email search.
pub async fn search_emails(
    State(state): State<MailState>,
    Json(request): Json<EmailSearchRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    if request.query.trim().is_empty() {
        return Err(velismail_common::AppError::BadRequest(
            "Search query is required".to_string(),
        ));
    }

    let page = request.page.unwrap_or(1).max(1);
    let per_page = request.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;
    let search_pattern = format!("%{}%", request.query.trim());

    let rows = sqlx::query(
        "SELECT id, message_id, thread_id, sender, sender_name, recipients, subject, body, folder, is_read, is_starred, has_attachment, created_at
         FROM platform_emails
         WHERE (subject ILIKE $1 OR body ILIKE $1 OR sender ILIKE $1 OR recipients ILIKE $1)
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3",
    )
    .bind(&search_pattern)
    .bind(per_page as i64)
    .bind(offset)
    .fetch_all(&state.db)
    .await?;

    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM platform_emails WHERE (subject ILIKE $1 OR body ILIKE $1 OR sender ILIKE $1 OR recipients ILIKE $1)",
    )
    .bind(&search_pattern)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    let emails: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let recipients: String = row.try_get("recipients").unwrap_or_else(|_| "[]".to_string());
            let to: Vec<String> = serde_json::from_str(&recipients).unwrap_or_default();
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "from": row.try_get::<String, _>("sender").unwrap_or_default(),
                "to": to,
                "subject": row.try_get::<String, _>("subject").unwrap_or_default(),
                "folder": row.try_get::<String, _>("folder").unwrap_or_default(),
                "isRead": row.try_get::<bool, _>("is_read").unwrap_or_default(),
                "isStarred": row.try_get::<bool, _>("is_starred").unwrap_or_default(),
                "hasAttachment": row.try_get::<bool, _>("has_attachment").unwrap_or_default(),
                "createdAt": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "emails": emails,
        "pagination": {
            "page": page,
            "perPage": per_page,
            "total": total,
        }
    })))
}
