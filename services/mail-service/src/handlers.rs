//! Mail service route handlers

use crate::models::{BatchLabelRequest, BatchMoveRequest, CreateEmailRequest};
use crate::state::MailState;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool, Row};
use std::{collections::HashMap, sync::Mutex};
use uuid::Uuid;

static BUSINESS_POOLS: std::sync::LazyLock<Mutex<HashMap<String, PgPool>>> =
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

    if let Ok(pools) = BUSINESS_POOLS.lock() {
        if let Some(pool) = pools.get(&normalized_url) {
            return Ok(pool.clone());
        }
    }

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&normalized_url)
        .await
        .map_err(|e| e.to_string())?;

    let mut pools = BUSINESS_POOLS
        .lock()
        .map_err(|_| "Business pool cache lock poisoned".to_string())?;
    pools.insert(normalized_url, pool.clone());
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
            folder VARCHAR(50),
            created_at VARCHAR(100),
            is_read BOOLEAN,
            is_starred BOOLEAN
        );",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
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
    pub folder: String,
    pub date: String,
    pub read: bool,
    pub starred: bool,
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
        .or_else(|| headers.get("x-business-db-url").and_then(|h| h.to_str().ok()))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn read_business_emails(db_url: &str) -> (StatusCode, Json<Value>) {
    let pool = match get_business_pool(db_url).await {
        Ok(pool) => pool,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_emails_table(&pool).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let rows = match sqlx::query(
        "SELECT id, sender, sender_name, recipients, subject, body, folder, created_at, is_read, is_starred FROM business_emails ORDER BY created_at DESC",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": format!("Query Error: {}", e)})),
            )
        }
    };

    let emails: Vec<Value> = rows
        .into_iter()
        .map(|row| {
            let recipients: String = row.try_get(3).unwrap_or_else(|_| "[]".to_string());
            let to: Vec<String> = serde_json::from_str(&recipients).unwrap_or_default();
            json!({
                "id": row.try_get::<String, _>(0).unwrap_or_default(),
                "from": row.try_get::<String, _>(1).unwrap_or_default(),
                "fromName": row.try_get::<String, _>(2).unwrap_or_default(),
                "to": to,
                "subject": row.try_get::<String, _>(4).unwrap_or_default(),
                "body": row.try_get::<String, _>(5).unwrap_or_default(),
                "folder": row.try_get::<String, _>(6).unwrap_or_default(),
                "date": row.try_get::<String, _>(7).unwrap_or_default(),
                "read": row.try_get::<bool, _>(8).unwrap_or_default(),
                "starred": row.try_get::<bool, _>(9).unwrap_or_default()
            })
        })
        .collect();

    (StatusCode::OK, Json(json!({"success": true, "emails": emails})))
}

/// Health check
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "mail-service"
    }))
}

/// List emails in a folder
pub async fn list_emails(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Would query database with pagination and filters
    Ok(Json(json!({
        "success": true,
        "emails": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    })))
}

pub async fn get_business_emails(
    State(_state): State<MailState>,
    Query(query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    let db_url = match business_db_url_from_parts(&headers, query.db_url.as_deref(), None) {
        Some(url) => url,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": "Missing business database URL"})),
            )
        }
    };

    read_business_emails(&db_url).await
}

pub async fn query_business_emails(
    State(_state): State<MailState>,
    Json(payload): Json<BusinessEmailsRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = payload.db_url.trim();
    if db_url.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"success": false, "error": "Missing business database URL"})),
        );
    }

    read_business_emails(db_url).await
}

pub async fn save_business_email(
    State(_state): State<MailState>,
    Query(query): Query<BusinessEmailsQuery>,
    headers: HeaderMap,
    Json(payload): Json<SaveBusinessEmailRequest>,
) -> (StatusCode, Json<Value>) {
    let db_url = match business_db_url_from_parts(
        &headers,
        query.db_url.as_deref(),
        payload.db_url.as_deref(),
    ) {
        Some(url) => url,
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"success": false, "error": "Missing business database URL"})),
            )
        }
    };

    let pool = match get_business_pool(&db_url).await {
        Ok(pool) => pool,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"success": false, "error": format!("DB Error: {}", e)})),
            )
        }
    };

    if let Err(e) = ensure_business_emails_table(&pool).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Schema Error: {}", e)})),
        );
    }

    let email = payload.email;
    let recipients = serde_json::to_string(&email.to).unwrap_or_else(|_| "[]".to_string());

    match sqlx::query(
        "INSERT INTO business_emails (id, sender, sender_name, recipients, subject, body, folder, created_at, is_read, is_starred)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET folder = $7, is_read = $9, is_starred = $10",
    )
    .bind(&email.id)
    .bind(&email.from)
    .bind(&email.from_name)
    .bind(&recipients)
    .bind(&email.subject)
    .bind(&email.body)
    .bind(&email.folder)
    .bind(&email.date)
    .bind(email.read)
    .bind(email.starred)
    .execute(&pool)
    .await
    {
        Ok(_) => (StatusCode::OK, Json(json!({"success": true}))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"success": false, "error": format!("Insert Error: {}", e)})),
        ),
    }
}

/// Send an email
pub async fn send_email(
    State(state): State<MailState>,
    Json(request): Json<CreateEmailRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Validate request
    if request.to.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
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
        Some(from_name),
        from_email.parse().map_err(|_| StatusCode::BAD_REQUEST)?,
    );
    let mut builder = Message::builder().from(from_mailbox).subject(request.subject.trim());

    for email in &request.to {
        builder = builder.to(email.parse().map_err(|_| StatusCode::BAD_REQUEST)?);
    }

    if let Some(cc) = &request.cc {
        for email in cc {
            builder = builder.cc(email.parse().map_err(|_| StatusCode::BAD_REQUEST)?);
        }
    }

    if let Some(bcc) = &request.bcc {
        for email in bcc {
            builder = builder.bcc(email.parse().map_err(|_| StatusCode::BAD_REQUEST)?);
        }
    }

    let message = builder
        .header(ContentType::TEXT_PLAIN)
        .body(request.body.clone())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let transport_builder = match state.config.smtp_port {
        465 => SmtpTransport::relay(&state.config.smtp_host).map_err(|err| {
            tracing::error!(
                "smtp relay builder failed for host {}:{}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                err
            );
            StatusCode::BAD_GATEWAY
        })?,
        587 => SmtpTransport::starttls_relay(&state.config.smtp_host).map_err(|err| {
            tracing::error!(
                "smtp starttls builder failed for host {}:{}: {}",
                state.config.smtp_host,
                state.config.smtp_port,
                err
            );
            StatusCode::BAD_GATEWAY
        })?,
        _ => SmtpTransport::builder_dangerous(&state.config.smtp_host).port(state.config.smtp_port),
    };

    let transport = transport_builder
        .credentials(Credentials::new(
            state.config.smtp_username.clone(),
            state.config.smtp_password.clone(),
        ))
        .build();

    transport.send(&message).map_err(|err| {
        tracing::error!("smtp send failed: {}", err);
        StatusCode::BAD_GATEWAY
    })?;

    // Create message
    let message_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4(); // Generate or find in real db

    // Store in database
    // sqlx::query!("INSERT INTO emails ...").execute(&state.db).await

    // Publish to NATS for async processing
    let _ = state
        .nats
        .publish("mail.outgoing", message_id.to_string().into())
        .await;

    // Schedule undo-send timer
    // In production, store in pending state for undo_send_window_seconds

    Ok(Json(json!({
        "success": true,
        "message_id": message_id.to_string(),
        "thread_id": thread_id.to_string(),
        "status": "sent",
        "delivered_via": state.config.smtp_host,
        "undo_send_window": state.config.undo_send_window_seconds
    })))
}

/// Get a single email
pub async fn get_email(
    State(_state): State<MailState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Would fetch from database with attachments
    Ok(Json(json!({
        "success": true,
        "email": {
            "id": id.to_string(),
            "from": "sender@example.com",
            "to": ["recipient@example.com"],
            "subject": "Test Email",
            "body": "Email body",
            "status": "delivered"
        }
    })))
}

/// Delete an email (move to trash)
pub async fn delete_email(
    State(_state): State<MailState>,
    Path(_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Would update status to trash
    Ok(Json(json!({
        "success": true,
        "message": "Email moved to trash"
    })))
}

/// List folders
pub async fn list_folders(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "folders": [
            {"id": "inbox", "name": "Inbox", "type": "inbox", "unread_count": 0},
            {"id": "sent", "name": "Sent", "type": "sent", "unread_count": 0},
            {"id": "drafts", "name": "Drafts", "type": "draft", "unread_count": 0},
            {"id": "trash", "name": "Trash", "type": "trash", "unread_count": 0},
            {"id": "spam", "name": "Spam", "type": "spam", "unread_count": 0},
            {"id": "archive", "name": "Archive", "type": "archive", "unread_count": 0}
        ]
    })))
}

/// Create a custom folder
pub async fn create_folder(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "folder_id": Uuid::new_v4().to_string()
    })))
}

/// Delete a folder
pub async fn delete_folder(
    State(_state): State<MailState>,
    Path(_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Folder deleted"
    })))
}

/// List labels
pub async fn list_labels(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "labels": []
    })))
}

/// Create a label
pub async fn create_label(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "label_id": Uuid::new_v4().to_string()
    })))
}

/// List drafts
pub async fn list_drafts(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "drafts": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    })))
}

/// Create a draft
pub async fn create_draft(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "draft_id": Uuid::new_v4().to_string()
    })))
}

/// Update a draft
pub async fn update_draft(
    State(_state): State<MailState>,
    Path(_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "message": "Draft updated"
    })))
}

/// Batch move emails
pub async fn batch_move(
    State(_state): State<MailState>,
    Json(_request): Json<BatchMoveRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "moved_count": 0
    })))
}

/// Batch delete emails
pub async fn batch_delete(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "deleted_count": 0
    })))
}

/// Batch label emails
pub async fn batch_label(
    State(_state): State<MailState>,
    Json(_request): Json<BatchLabelRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "labeled_count": 0
    })))
}

/// List email threads
pub async fn list_threads(
    State(_state): State<MailState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "threads": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    })))
}

/// Get a single thread
pub async fn get_thread(
    State(_state): State<MailState>,
    Path(_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "thread": {
            "id": Uuid::new_v4().to_string(),
            "subject": "Thread Subject",
            "messages": []
        }
    })))
}

/// Undo send (within window)
pub async fn undo_send(
    State(_state): State<MailState>,
    Path(_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Would check if within undo window and cancel send
    Ok(Json(json!({
        "success": true,
        "message": "Email send cancelled"
    })))
}
