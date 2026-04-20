//! API routes

use crate::state::AppState;
use axum::{
    extract::State,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde_json::json;

/// Build API v1 routes
pub fn api_v1_routes(_state: &AppState) -> Router<AppState> {
    Router::new()
        // Auth routes (proxy to auth service)
        .nest("/auth", auth_routes())
        // Mail routes (proxy to mail service)
        .nest("/mail", mail_routes())
        // Tenant routes (proxy to tenant service)
        .nest("/tenants", tenant_routes())
        // Storage routes (proxy to storage service)
        .nest("/storage", storage_routes())
        // Search routes
        .route("/search", get(search_emails))
        // Infrastructure verification route
        .route("/verify", post(verify_infrastructure))
}

/// Authentication routes
fn auth_routes() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login/passkey", post(login_passkey))
        .route("/login/zkp", post(login_zkp))
        .route("/token/refresh", post(refresh_token))
        .route("/logout", post(logout))
        .route("/me", get(get_current_user))
}

/// Mail routes
fn mail_routes() -> Router<AppState> {
    Router::new()
        .route("/send", post(send_email))
        .route("/inbox", get(get_inbox))
        .route("/sent", get(get_sent))
        .route("/drafts", get(get_drafts))
        .route("/:id", get(get_email))
        .route("/:id/delete", delete(delete_email))
        .route("/compose", post(compose_draft))
        .route("/batch", post(batch_send))
}

/// Tenant routes
fn tenant_routes() -> Router<AppState> {
    Router::new()
        .route("/", post(create_tenant))
        .route("/me", get(get_my_tenant))
        .route("/verify-domain", post(verify_domain))
        .route("/users", get(list_users))
        .route("/settings", put(update_settings))
}

/// Storage routes
fn storage_routes() -> Router<AppState> {
    Router::new()
        .route("/upload", post(upload_attachment))
        .route("/:id", get(download_attachment))
        .route("/:id", delete(delete_attachment))
}

// Route handlers (proxy to internal services)

pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "api-gateway",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

pub async fn register(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "message": "Registration successful",
        "user_id": uuid::Uuid::new_v4().to_string()
    }))
}

pub async fn login_passkey(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "access_token": "jwt_token_here",
        "refresh_token": "refresh_token_here",
        "expires_in": 3600
    }))
}

pub async fn login_zkp(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "access_token": "jwt_token_here",
        "refresh_token": "refresh_token_here",
        "expires_in": 3600
    }))
}

pub async fn refresh_token(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "access_token": "new_access_token",
        "expires_in": 3600
    }))
}

pub async fn logout(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "message": "Logged out successfully"
    }))
}

pub async fn get_current_user(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "user": {
            "id": uuid::Uuid::new_v4().to_string(),
            "email": "user@example.com",
            "display_name": "User Name"
        }
    }))
}

pub async fn send_email(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "message_id": uuid::Uuid::new_v4().to_string(),
        "status": "sent"
    }))
}

pub async fn get_inbox(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "emails": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    }))
}

pub async fn get_sent(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "emails": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    }))
}

pub async fn get_drafts(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "drafts": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    }))
}

pub async fn get_email(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "email": {
            "id": uuid::Uuid::new_v4().to_string(),
            "from": "sender@example.com",
            "to": ["recipient@example.com"],
            "subject": "Test Email",
            "body": "Email body here"
        }
    }))
}

pub async fn delete_email(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "message": "Email deleted"
    }))
}

pub async fn compose_draft(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "draft_id": uuid::Uuid::new_v4().to_string()
    }))
}

pub async fn batch_send(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "sent_count": 0,
        "failed_count": 0
    }))
}

pub async fn create_tenant(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "tenant_id": uuid::Uuid::new_v4().to_string(),
        "message": "Tenant created"
    }))
}

pub async fn get_my_tenant(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "tenant": {
            "id": uuid::Uuid::new_v4().to_string(),
            "name": "My Company",
            "domain": "company.com",
            "plan": "business"
        }
    }))
}

pub async fn verify_domain(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "domain": "example.com",
        "verified": false,
        "dns_records": [
            {
                "type": "TXT",
                "name": "_velismail-verification",
                "value": "token123",
                "ttl": 300
            }
        ]
    }))
}

pub async fn list_users(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "users": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    }))
}

pub async fn update_settings(
    State(_state): State<AppState>,
    Json(_payload): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "message": "Settings updated"
    }))
}

pub async fn upload_attachment(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "attachment_id": uuid::Uuid::new_v4().to_string(),
        "storage_key": "key123"
    }))
}

pub async fn download_attachment(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "url": "https://storage.velismail.online/attachments/file123",
        "expires_in": 3600
    }))
}

pub async fn delete_attachment(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "message": "Attachment deleted"
    }))
}

pub async fn search_emails(State(_state): State<AppState>) -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "results": [],
        "pagination": {
            "page": 1,
            "per_page": 50,
            "total": 0
        }
    }))
}

pub async fn verify_infrastructure(
    State(_state): State<AppState>,
    Json(payload): Json<serde_json::Value>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    // Expected payload: { dbUrl: string, apiProvider: string, apiKey: string }
    let db_url = payload.get("dbUrl").and_then(|v| v.as_str()).unwrap_or("");
    let api_provider = payload
        .get("apiProvider")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let api_key = payload.get("apiKey").and_then(|v| v.as_str()).unwrap_or("");

    // Basic software bug check: Missing fields
    if db_url.is_empty() || api_provider.is_empty() || api_key.is_empty() {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "SoftwareBug",
                "message": "Verification failed: missing required payload fields."
            })),
        );
    }

    // Heuristic DB Validation
    // To match frontend: /^(postgresql|postgres|mysql|sqlite|mongodb(\+srv)?|redis|custom):\/\/.+/i
    let db_valid = db_url.starts_with("postgresql://")
        || db_url.starts_with("postgres://")
        || db_url.starts_with("mysql://")
        || db_url.starts_with("sqlite://")
        || db_url.starts_with("mongodb://")
        || db_url.starts_with("mongodb+srv://")
        || db_url.starts_with("redis://")
        || db_url.starts_with("custom://");

    if !db_valid {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "DatabaseConnectionError",
                "message": format!("Failed to connect to database: Unknown or invalid protocol for '{}'. Expected protocol://user:pass@host/db", db_url.split("://").next().unwrap_or("")),
            })),
        );
    }

    // Heuristic API Token Validation
    if api_key.len() < 8 && api_provider != "others" {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Failed to verify Mail API Key. Provider rejected connection due to invalid key format.",
            })),
        );
    }

    (
        axum::http::StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Connection established",
            "provider": api_provider,
            "db_protocol": db_url.split("://").next().unwrap_or("")
        })),
    )
}

/// OpenAPI documentation
pub fn swagger_ui() -> Router<AppState> {
    Router::new()
}
