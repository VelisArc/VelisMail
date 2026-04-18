//! Mail service route handlers

use crate::models::{BatchLabelRequest, BatchMoveRequest, CreateEmailRequest};
use crate::state::MailState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;
use velismail_common::{FolderType, MessageStatus};

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

/// Send an email
pub async fn send_email(
    State(state): State<MailState>,
    Json(request): Json<CreateEmailRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Validate request
    if request.to.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

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
    Path(id): Path<Uuid>,
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
