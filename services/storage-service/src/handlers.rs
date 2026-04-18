//! Storage handlers

use crate::state::StorageState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde_json::json;
use uuid::Uuid;

/// Health check
pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "storage-service"
    }))
}

/// Upload a file
pub async fn upload(
    State(state): State<StorageState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // In production: extract multipart form, encrypt, upload to S3
    let attachment_id = Uuid::new_v4();
    let storage_key = format!("attachments/{}", attachment_id);

    Ok(Json(json!({
        "success": true,
        "attachment_id": attachment_id.to_string(),
        "storage_key": storage_key,
        "encrypted": true
    })))
}

/// Download a file
pub async fn download(
    State(state): State<StorageState>,
    Path(key): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Download from S3 and decrypt
    let _data = state
        .s3
        .download_object(&key)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(json!({
        "success": true,
        "url": format!("/storage/download/{}", key)
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
    let url = state
        .s3
        .presigned_url(&key, 3600)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(json!({
        "success": true,
        "url": url,
        "expires_in": 3600
    })))
}

/// Get storage quota
pub async fn get_quota(
    State(_state): State<StorageState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "quota": {
            "used_bytes": 0,
            "total_bytes": 5368709120_i64, // 5GB for free plan
            "used_percent": 0
        }
    })))
}
