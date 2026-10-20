//! API response wrappers

use crate::Pagination;
use serde::{Deserialize, Serialize};

/// Standard API response
#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub pagination: Option<Pagination>,
    pub meta: Option<serde_json::Value>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            pagination: None,
            meta: None,
        }
    }

    pub fn with_pagination(data: T, pagination: Pagination) -> Self {
        Self {
            success: true,
            data: Some(data),
            pagination: Some(pagination),
            meta: None,
        }
    }

    pub fn with_meta(data: T, meta: serde_json::Value) -> Self {
        Self {
            success: true,
            data: Some(data),
            pagination: None,
            meta: Some(meta),
        }
    }
}

/// Empty success response
#[derive(Debug, Serialize, Deserialize)]
pub struct EmptyResponse {
    pub success: bool,
    pub message: String,
}

impl EmptyResponse {
    pub fn success(message: &str) -> Self {
        Self {
            success: true,
            message: message.to_string(),
        }
    }
}

/// Bulk operation response
#[derive(Debug, Serialize, Deserialize)]
pub struct BulkOperationResponse {
    pub success_count: u32,
    pub failed_count: u32,
    pub errors: Vec<BulkError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkError {
    pub index: u32,
    pub error: String,
}
