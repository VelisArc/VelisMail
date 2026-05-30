//! Storage handlers

use crate::state::StorageState;
use axum::{
    extract::{Multipart, Path, Query, State},
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

/// Deep health check — verifies DB and S3 connectivity.
pub async fn health_check(
    State(state): State<StorageState>,
) -> Json<serde_json::Value> {
    let db_healthy = sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .is_ok();

    // S3 health: try listing with max-keys=0
    let s3_healthy = state.s3.is_healthy().await;

    let health = velismail_common::HealthResponse::new(
        "storage-service",
        env!("CARGO_PKG_VERSION"),
        db_healthy,
        None,
        Some(s3_healthy),
    );
    Json(serde_json::to_value(health).unwrap_or_else(|_| {
        json!({"status": "UNHEALTHY", "service": "storage-service"})
    }))
}

/// Upload a file (base64 JSON body)
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
    let encrypted = state.encryption.encrypt(&plaintext).map_err(|err| {
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

/// Upload via multipart form (no base64 encoding needed).
pub async fn upload_multipart(
    State(state): State<StorageState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let max_bytes = state.config.max_file_size_mb as usize * 1024 * 1024;
    let mut results = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        velismail_common::AppError::BadRequest(format!("Multipart parse error: {}", e))
    })? {
        let file_name = field
            .file_name()
            .map(|n| sanitize_filename(n))
            .unwrap_or_else(|| "upload.bin".to_string());
        let content_type = field
            .content_type()
            .map(|ct| ct.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        let data = field.bytes().await.map_err(|e| {
            velismail_common::AppError::BadRequest(format!("Failed to read field: {}", e))
        })?;

        if data.is_empty() || data.len() > max_bytes {
            return Err(velismail_common::AppError::BadRequest(format!(
                "File '{}' exceeds size limit of {} MB",
                file_name, state.config.max_file_size_mb
            )));
        }

        let attachment_id = Uuid::new_v4();
        let storage_key = format!("attachments/{}/{}", attachment_id, file_name);

        let encrypted = state
            .encryption
            .encrypt(&data)
            .map_err(|_| velismail_common::AppError::Internal)?;

        state
            .s3
            .upload_object(&storage_key, encrypted, &content_type)
            .await
            .map_err(|e| {
                tracing::error!("s3 multipart upload failed for {}: {}", storage_key, e);
                velismail_common::AppError::Internal
            })?;

        sqlx::query(
            "INSERT INTO storage_objects (id, storage_key, filename, content_type, size_bytes, encrypted)
             VALUES ($1, $2, $3, $4, $5, true)",
        )
        .bind(attachment_id)
        .bind(&storage_key)
        .bind(&file_name)
        .bind(&content_type)
        .bind(data.len() as i64)
        .execute(&state.db)
        .await
        .map_err(|e| {
            tracing::error!("storage metadata insert failed: {}", e);
            velismail_common::AppError::Internal
        })?;

        results.push(json!({
            "attachment_id": attachment_id,
            "storage_key": storage_key,
            "filename": file_name,
            "content_type": content_type,
            "size_bytes": data.len(),
        }));
    }

    Ok(Json(json!({
        "success": true,
        "files": results
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
    let decrypted = state.encryption.decrypt(&data).map_err(|err| {
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

/// Get storage quota — reads from config instead of hardcoded value.
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
    let total_bytes = state.config.default_quota_bytes;
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

/// List user's files with pagination.
#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

pub async fn list_files(
    State(state): State<StorageState>,
    Query(query): Query<ListQuery>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let page = query.page.unwrap_or(1).max(1);
    let per_page = query.per_page.unwrap_or(20).min(100);
    let offset = ((page - 1) * per_page) as i64;

    let rows = sqlx::query(
        "SELECT id, storage_key, filename, content_type, size_bytes, encrypted, created_at
         FROM storage_objects
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2",
    )
    .bind(per_page as i64)
    .bind(offset)
    .fetch_all(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("list files query failed: {}", err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM storage_objects")
        .fetch_one(&state.db)
        .await
        .unwrap_or(0);

    let files: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
                "storageKey": row.try_get::<String, _>("storage_key").unwrap_or_default(),
                "filename": row.try_get::<String, _>("filename").unwrap_or_default(),
                "contentType": row.try_get::<String, _>("content_type").unwrap_or_default(),
                "sizeBytes": row.try_get::<i64, _>("size_bytes").unwrap_or(0),
                "encrypted": row.try_get::<bool, _>("encrypted").unwrap_or(false),
                "createdAt": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({
        "success": true,
        "files": files,
        "pagination": {
            "page": page,
            "perPage": per_page,
            "total": total,
        }
    })))
}

/// Get file metadata without downloading content.
pub async fn get_metadata(
    State(state): State<StorageState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let row = sqlx::query(
        "SELECT id, storage_key, filename, content_type, size_bytes, encrypted, created_at
         FROM storage_objects WHERE storage_key = $1",
    )
    .bind(&key)
    .fetch_optional(&state.db)
    .await
    .map_err(|err| {
        tracing::error!("metadata query failed for {}: {}", key, err);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(json!({
        "success": true,
        "metadata": {
            "id": row.try_get::<Uuid, _>("id").unwrap_or_default(),
            "storageKey": row.try_get::<String, _>("storage_key").unwrap_or_default(),
            "filename": row.try_get::<String, _>("filename").unwrap_or_default(),
            "contentType": row.try_get::<String, _>("content_type").unwrap_or_default(),
            "sizeBytes": row.try_get::<i64, _>("size_bytes").unwrap_or(0),
            "encrypted": row.try_get::<bool, _>("encrypted").unwrap_or(false),
            "createdAt": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")
                .map(|d| d.to_rfc3339())
                .unwrap_or_default(),
        }
    })))
}
