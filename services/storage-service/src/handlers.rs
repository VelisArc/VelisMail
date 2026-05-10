//! Storage handlers

use crate::state::StorageState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadRequest {
    filename: String,
    content_type: Option<String>,
    content_base64: String,
}

fn sanitize_filename(value: &str) -> String {
    let cleaned: String = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect();

    cleaned
        .trim_matches('.')
        .chars()
        .take(160)
        .collect::<String>()
        .if_empty("attachment.bin")
}

trait EmptyFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

/// Health check
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "storage-service",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// Upload a file
pub async fn upload(
    State(state): State<StorageState>,
    Json(request): Json<UploadRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let filename = sanitize_filename(&request.filename);
    let content_type = request
        .content_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("application/octet-stream")
        .to_string();
    let plaintext = BASE64_STANDARD
        .decode(request.content_base64.trim())
        .map_err(|_| StatusCode::BAD_REQUEST)?;
    let max_bytes = state.config.max_file_size_mb as usize * 1024 * 1024;
    if plaintext.is_empty() || plaintext.len() > max_bytes {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let attachment_id = Uuid::new_v4();
    let storage_key = format!("attachments/{}/{}", attachment_id, filename);
    let encrypted = state
        .encryption
        .encrypt(&plaintext)
        .map_err(|err| {
            tracing::error!("attachment encryption failed: {}", err);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    state
        .s3
        .upload_object(&storage_key, encrypted, &content_type)
        .await
        .map_err(|err| {
            tracing::error!("s3 upload failed for {}: {}", storage_key, err);
            StatusCode::BAD_GATEWAY
        })?;

    sqlx::query(
        "INSERT INTO storage_objects (id, storage_key, filename, content_type, size_bytes, encrypted)
         VALUES ($1, $2, $3, $4, $5, true)",
    )
    .bind(attachment_id)
    .bind(&storage_key)
    .bind(&filename)
    .bind(&content_type)
    .bind(plaintext.len() as i64)
    .execute(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("storage metadata insert failed for {}: {}", storage_key, err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(json!({
        "success": true,
        "attachment_id": attachment_id,
        "storage_key": storage_key,
        "filename": filename,
        "content_type": content_type,
        "size_bytes": plaintext.len(),
        "encrypted": true
    })))
}

/// Download a file
pub async fn download(
    State(state): State<StorageState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let data = state
        .s3
        .download_object(&key)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    let decrypted = state
        .encryption
        .decrypt(&data)
        .map_err(|err| {
            tracing::error!("attachment decrypt failed for {}: {}", key, err);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(json!({
        "success": true,
        "storage_key": key,
        "content_base64": BASE64_STANDARD.encode(decrypted)
    })))
}

/// Delete a file
pub async fn delete(
    State(state): State<StorageState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state
        .s3
        .delete_object(&key)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("DELETE FROM storage_objects WHERE storage_key = $1")
        .bind(&key)
        .execute(&state.db)
        .await
        .ok();

    Ok(Json(json!({
        "success": true,
        "message": "File deleted"
    })))
}

/// Generate presigned URL
pub async fn presigned_url(
    State(state): State<StorageState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let _ = (state, key);
    Err(StatusCode::NOT_IMPLEMENTED)
}

/// Get storage quota
pub async fn get_quota(
    State(state): State<StorageState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let used_bytes = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM storage_objects",
    )
    .fetch_one(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("storage quota query failed: {}", err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .unwrap_or(0);
    let total_bytes = 5_368_709_120_i64;
    let used_percent = if total_bytes > 0 {
        (used_bytes as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    Ok(Json(json!({
        "success": true,
        "quota": {
            "used_bytes": used_bytes,
            "total_bytes": total_bytes,
            "used_percent": used_percent
        }
    })))
}
