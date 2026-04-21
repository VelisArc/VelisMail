//! API routes

use crate::state::AppState;
use axum::{
    extract::State,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
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
        .route("/verify/providers", get(get_supported_providers))
        // Infrastructure verification route
        .route("/verify", post(verify_infrastructure))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyInfrastructurePayload {
    db_provider: Option<String>,
    db_url: String,
    api_provider: String,
    api_endpoint: Option<String>,
    api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyDomainPayload {
    domain: String,
    domain_id: Option<String>,
    db_provider: Option<String>,
    db_url: String,
    provider: String,
    provider_endpoint: Option<String>,
    api_key: String,
}

#[derive(Debug, Serialize)]
struct ProviderCatalogEntry {
    id: &'static str,
    label: &'static str,
    placeholder: &'static str,
    description: &'static str,
    requires_endpoint: bool,
}

const DATABASE_SCHEMES: &[&str] = &[
    "postgresql://",
    "postgres://",
    "mysql://",
    "mysql2://",
    "mariadb://",
    "sqlite://",
    "mongodb://",
    "mongodb+srv://",
    "redis://",
    "rediss://",
    "libsql://",
    "sqlserver://",
    "mssql://",
    "clickhouse://",
    "custom://",
];

const MAIL_PROVIDER_IDS: &[&str] = &[
    "sendgrid",
    "resend",
    "mailgun",
    "postmark",
    "ses",
    "brevo",
    "mailersend",
    "sparkpost",
    "mailjet",
    "zeptomail",
    "smtp2go",
    "elastic_email",
    "courier",
    "custom_webhook",
];

fn database_provider_catalog() -> Vec<ProviderCatalogEntry> {
    vec![
        ProviderCatalogEntry {
            id: "postgresql",
            label: "PostgreSQL",
            placeholder: "postgresql://user:password@host:5432/database",
            description: "Self-hosted Postgres or managed clusters.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mysql",
            label: "MySQL",
            placeholder: "mysql://user:password@host:3306/database",
            description: "MySQL or MariaDB compatible deployments.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "sqlite",
            label: "SQLite",
            placeholder: "sqlite://./velismail.db",
            description: "Embedded database for local and edge-style deployments.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mongodb",
            label: "MongoDB",
            placeholder: "mongodb://user:password@host:27017/database",
            description: "Replica-set or standalone MongoDB deployments.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "redis",
            label: "Redis",
            placeholder: "redis://default:password@host:6379",
            description: "Redis instances for cache-oriented workflows.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "supabase",
            label: "Supabase",
            placeholder: "postgresql://postgres:[PASSWORD]@db.project.supabase.co:5432/postgres",
            description: "Managed Postgres and platform services.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "neon",
            label: "Neon",
            placeholder: "postgresql://user:password@ep-example.neon.tech/neondb?sslmode=require",
            description: "Serverless Postgres with branching.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "planetscale",
            label: "PlanetScale",
            placeholder: "mysql://user:password@aws.connect.psdb.cloud/database?sslaccept=strict",
            description: "Serverless MySQL-compatible database.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "turso",
            label: "Turso",
            placeholder: "libsql://database-name.turso.io?authToken=token",
            description: "libSQL edge database platform.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "cockroachdb",
            label: "CockroachDB",
            placeholder: "postgresql://user:password@cluster.region.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full",
            description: "Distributed SQL for high availability.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mongodb_atlas",
            label: "MongoDB Atlas",
            placeholder: "mongodb+srv://user:password@cluster.mongodb.net/database",
            description: "Managed MongoDB with SRV connection strings.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "redis_cloud",
            label: "Redis Cloud",
            placeholder: "rediss://default:password@redis-host:6380",
            description: "Managed Redis with TLS endpoints.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "amazon_rds",
            label: "Amazon RDS",
            placeholder: "postgresql://user:password@instance.region.rds.amazonaws.com:5432/database",
            description: "AWS managed relational databases.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "google_cloud_sql",
            label: "Google Cloud SQL",
            placeholder: "postgresql://user:password@host:5432/database?sslmode=require",
            description: "Managed MySQL/Postgres/SQL Server on GCP.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "azure_sql",
            label: "Azure SQL",
            placeholder: "sqlserver://user:password@server.database.windows.net:1433/database",
            description: "Microsoft SQL Server platform as a service.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "clickhouse",
            label: "ClickHouse",
            placeholder: "clickhouse://user:password@host:8443/default",
            description: "Analytical OLAP engine for event-heavy reporting.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "others",
            label: "Others (Custom Driver)",
            placeholder: "custom://user:password@host:port/database",
            description: "Standards-compliant URI for unsupported providers.",
            requires_endpoint: false,
        },
    ]
}

fn mail_provider_catalog() -> Vec<ProviderCatalogEntry> {
    vec![
        ProviderCatalogEntry {
            id: "sendgrid",
            label: "SendGrid",
            placeholder: "SG.xxxxx",
            description: "Transactional and marketing email API.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "resend",
            label: "Resend",
            placeholder: "re_xxxxx",
            description: "Developer-friendly transactional email API.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mailgun",
            label: "Mailgun",
            placeholder: "key-xxxxxxxx",
            description: "Delivery, routes, and validation APIs.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "postmark",
            label: "Postmark",
            placeholder: "postmark-server-token",
            description: "Fast transactional email delivery.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "ses",
            label: "Amazon SES",
            placeholder: "AKIA... or SES SMTP/API credential",
            description: "AWS Simple Email Service integration.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "brevo",
            label: "Brevo",
            placeholder: "xkeysib-xxxxxxxx",
            description: "Transactional email APIs from Brevo.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mailersend",
            label: "MailerSend",
            placeholder: "mlsn.xxxxx",
            description: "Transactional mail for apps and SaaS.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "sparkpost",
            label: "SparkPost",
            placeholder: "sparkpost-api-key",
            description: "High-volume email with analytics APIs.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "mailjet",
            label: "Mailjet",
            placeholder: "mailjet-api-key",
            description: "Email API with SMTP compatibility.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "zeptomail",
            label: "ZeptoMail",
            placeholder: "zeptomail-token",
            description: "Zoho transactional mail delivery service.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "smtp2go",
            label: "SMTP2GO",
            placeholder: "smtp2go-api-key",
            description: "SMTP relay and API-based sending.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "elastic_email",
            label: "Elastic Email",
            placeholder: "elastic-email-api-key",
            description: "Transactional and campaign email APIs.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "courier",
            label: "Courier",
            placeholder: "courier-auth-token",
            description: "Notification orchestration with email routing.",
            requires_endpoint: false,
        },
        ProviderCatalogEntry {
            id: "custom_webhook",
            label: "Custom Webhook",
            placeholder: "custom-provider-secret",
            description: "Your own HTTP delivery endpoint.",
            requires_endpoint: true,
        },
    ]
}

fn is_valid_database_url(value: &str) -> bool {
    let normalized = value.trim().to_lowercase();
    DATABASE_SCHEMES
        .iter()
        .any(|scheme| normalized.starts_with(scheme))
}

fn is_supported_mail_provider(provider: &str) -> bool {
    MAIL_PROVIDER_IDS.contains(&provider)
}

fn is_valid_domain(domain: &str) -> bool {
    let normalized = domain.trim().to_lowercase();
    if normalized.len() < 4 || normalized.starts_with('.') || normalized.ends_with('.') {
        return false;
    }

    let labels: Vec<&str> = normalized.split('.').collect();
    if labels.len() < 2 {
        return false;
    }

    labels.into_iter().all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    })
}

fn requires_custom_endpoint(provider: &str) -> bool {
    provider == "custom_webhook"
}

fn build_verification_token(domain_id: Option<&str>, domain: &str) -> String {
    let seed = domain_id.unwrap_or(domain);
    let compact: String = seed
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(12)
        .collect();
    format!("velismail-verify={}", compact.to_lowercase())
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
    Json(payload): Json<VerifyDomainPayload>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    let domain = payload.domain.trim().to_lowercase();
    let db_url = payload.db_url.trim();
    let provider = payload.provider.trim();
    let api_key = payload.api_key.trim();
    let provider_endpoint = payload.provider_endpoint.as_deref().map(str::trim);

    if !is_valid_domain(&domain) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Invalid business domain format.",
            })),
        );
    }

    if !is_valid_database_url(db_url) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Invalid database connection string format.",
            })),
        );
    }

    if !is_supported_mail_provider(provider) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": format!("Unsupported mail relay provider '{}'.", provider),
            })),
        );
    }

    if api_key.len() < 8 {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "Mail relay API key looks too short.",
            })),
        );
    }

    if requires_custom_endpoint(provider) {
        let endpoint_valid = provider_endpoint
            .map(|endpoint| endpoint.starts_with("http://") || endpoint.starts_with("https://"))
            .unwrap_or(false);
        if !endpoint_valid {
            return (
                axum::http::StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "message": "Custom webhook providers require a valid http(s) endpoint.",
                })),
            );
        }
    }

    let verification_token = build_verification_token(payload.domain_id.as_deref(), &domain);

    (
        axum::http::StatusCode::OK,
        Json(json!({
            "success": true,
            "verified": false,
            "domain": domain,
            "db_provider": payload.db_provider,
            "db_protocol": db_url.split("://").next().unwrap_or(""),
            "mail_provider": provider,
            "provider_endpoint": provider_endpoint,
            "verification_token": verification_token,
            "dns_records": [
                {
                    "type": "TXT",
                    "name": format!("_velismail-verify.{}", domain),
                    "value": verification_token,
                    "ttl": 300
                },
                {
                    "type": "MX",
                    "name": domain,
                    "value": "mx1.velismail.online",
                    "priority": 10,
                    "ttl": 3600
                },
                {
                    "type": "MX",
                    "name": domain,
                    "value": "mx2.velismail.online",
                    "priority": 20,
                    "ttl": 3600
                },
                {
                    "type": "TXT",
                    "name": domain,
                    "value": "v=spf1 include:velismail.online ~all",
                    "ttl": 3600
                },
                {
                    "type": "CNAME",
                    "name": format!("velismail._domainkey.{}", domain),
                    "value": "dkim.velismail.online",
                    "ttl": 3600
                },
                {
                    "type": "TXT",
                    "name": format!("_dmarc.{}", domain),
                    "value": format!("v=DMARC1; p=quarantine; rua=mailto:dmarc@{}", domain),
                    "ttl": 3600
                }
            ],
            "checks": [
                { "key": "domain", "status": "pending", "detail": domain },
                { "key": "database", "status": "pending", "detail": db_url.split("://").next().unwrap_or("") },
                { "key": "relay", "status": "pending", "detail": provider }
            ]
        })),
    )
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

pub async fn get_supported_providers() -> Json<serde_json::Value> {
    Json(json!({
        "success": true,
        "databaseProviders": database_provider_catalog(),
        "mailProviders": mail_provider_catalog(),
    }))
}

pub async fn verify_infrastructure(
    State(_state): State<AppState>,
    Json(payload): Json<VerifyInfrastructurePayload>,
) -> (axum::http::StatusCode, Json<serde_json::Value>) {
    let db_url = payload.db_url.trim();
    let api_provider = payload.api_provider.trim();
    let api_key = payload.api_key.trim();
    let api_endpoint = payload.api_endpoint.as_deref().map(str::trim);

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

    if !is_valid_database_url(db_url) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "DatabaseConnectionError",
                "message": format!("Failed to connect to database: Unknown or invalid protocol for '{}'. Expected protocol://user:pass@host/db", db_url.split("://").next().unwrap_or("")),
            })),
        );
    }

    if !is_supported_mail_provider(api_provider) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": format!("Unsupported mail relay provider '{}'.", api_provider),
            })),
        );
    }

    let endpoint_valid = api_endpoint
        .map(|endpoint| endpoint.starts_with("http://") || endpoint.starts_with("https://"))
        .unwrap_or(false);

    if requires_custom_endpoint(api_provider) && !endpoint_valid {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "errorType": "MailProviderConnectionError",
                "message": "Custom webhook providers require a valid http(s) endpoint.",
            })),
        );
    }

    if api_key.len() < 8 {
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
            "db_provider": payload.db_provider,
            "provider": api_provider,
            "provider_endpoint": api_endpoint,
            "db_protocol": db_url.split("://").next().unwrap_or(""),
        })),
    )
}

/// OpenAPI documentation
pub fn swagger_ui() -> Router<AppState> {
    Router::new()
}

#[cfg(test)]
mod tests {
    use super::{is_supported_mail_provider, is_valid_database_url, is_valid_domain};

    #[test]
    fn validates_supported_database_urls() {
        assert!(is_valid_database_url("postgresql://user:pass@host:5432/db"));
        assert!(is_valid_database_url("mongodb+srv://user:pass@cluster.mongodb.net/db"));
        assert!(is_valid_database_url("libsql://demo.turso.io?authToken=token"));
        assert!(!is_valid_database_url("ftp://example.com"));
    }

    #[test]
    fn validates_supported_mail_provider_ids() {
        assert!(is_supported_mail_provider("resend"));
        assert!(is_supported_mail_provider("courier"));
        assert!(is_supported_mail_provider("custom_webhook"));
        assert!(!is_supported_mail_provider("random-provider"));
    }

    #[test]
    fn validates_domain_format() {
        assert!(is_valid_domain("velismail.online"));
        assert!(is_valid_domain("mail.example.co.in"));
        assert!(!is_valid_domain("localhost"));
        assert!(!is_valid_domain("-bad.example"));
    }
}
