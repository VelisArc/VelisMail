//! External API Adapter Component
//!
//! Main adapter interface for connecting to and using external API providers.
//! Implements the ExternalApiAdapter trait from the design document.

use crate::{
    credentials::{ApiCredentials, EncryptedCredentials},
    error::{ExternalApiError, ExternalApiResult},
    health::{HealthStatus, ProviderConnection},
    provider::ProviderType,
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use rand::Rng;
use std::time::Duration;
use tracing::{error, info, warn};

/// Email message structure for sending/receiving
#[derive(Debug, Clone)]
pub struct EmailMessage {
    /// Message ID
    pub id: String,
    /// From address
    pub from: String,
    /// To addresses
    pub to: Vec<String>,
    /// CC addresses
    pub cc: Vec<String>,
    /// BCC addresses
    pub bcc: Vec<String>,
    /// Subject
    pub subject: String,
    /// Plain text body
    pub body_plain: String,
    /// HTML body (optional)
    pub body_html: Option<String>,
    /// Attachments
    pub attachments: Vec<Attachment>,
    /// Headers
    pub headers: Vec<(String, String)>,
}

/// Email attachment
#[derive(Debug, Clone)]
pub struct Attachment {
    /// Filename
    pub filename: String,
    /// Content type
    pub content_type: String,
    /// Content (base64 encoded)
    pub content: Vec<u8>,
    /// Whether it's an inline attachment
    pub inline: bool,
}

/// Result of sending an email
#[derive(Debug, Clone)]
pub struct SendResult {
    /// Whether the send was successful
    pub success: bool,
    /// Provider message ID
    pub provider_message_id: Option<String>,
    /// Error message if failed
    pub error: Option<String>,
    /// Timestamp of send attempt
    pub timestamp: DateTime<Utc>,
    /// Number of retry attempts made
    pub retry_attempts: u32,
}

/// Retry policy for email sending
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Base delay in seconds for exponential backoff
    pub base_delay_seconds: u64,
    /// Maximum delay in seconds
    pub max_delay_seconds: u64,
    /// Whether to add jitter to backoff delays
    pub jitter_enabled: bool,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_retries: 3,
            base_delay_seconds: 2,
            max_delay_seconds: 60,
            jitter_enabled: true,
        }
    }
}

impl RetryPolicy {
    /// Calculate delay for a specific retry attempt
    pub fn calculate_delay(&self, attempt: u32) -> Duration {
        if attempt == 0 {
            return Duration::from_secs(0);
        }

        // Exponential backoff: base_delay * 2^(attempt-1)
        let exponent = attempt - 1;
        let mut delay = self
            .base_delay_seconds
            .saturating_mul(2_u64.saturating_pow(exponent));

        // Cap at maximum delay
        delay = delay.min(self.max_delay_seconds);

        // Add jitter if enabled (up to 10% random variation)
        if self.jitter_enabled {
            let jitter_factor = 0.1; // 10% jitter
            let jitter = rand::thread_rng().gen_range(-jitter_factor..jitter_factor);
            delay = (delay as f64 * (1.0 + jitter)) as u64;
        }

        Duration::from_secs(delay)
    }
}

/// Circuit breaker for provider health monitoring
#[derive(Debug, Clone)]
pub struct CircuitBreaker {
    /// Current state of the circuit breaker
    state: CircuitState,
    /// Number of failures before opening the circuit
    failure_threshold: u32,
    /// Timeout before attempting to close the circuit again
    reset_timeout: Duration,
    /// Time when circuit was last opened
    last_opened: Option<DateTime<Utc>>,
    /// Current failure count
    failure_count: u32,
    /// Success count since last failure
    success_count: u32,
}

/// Queued email for retry when provider is unavailable
#[derive(Debug, Clone)]
struct QueuedEmail {
    /// Unique ID for this queued email
    id: String,
    /// The email to send
    email: EmailMessage,
    /// Provider type to use
    provider_type: ProviderType,
    /// Reason for queuing
    reason: String,
    /// When the email was queued
    #[allow(dead_code)]
    queued_at: DateTime<Utc>,
    /// Number of retry attempts so far
    retry_count: u32,
    /// Maximum number of retry attempts
    max_retries: u32,
    /// When to attempt the next retry
    next_retry_at: DateTime<Utc>,
}

/// Result of processing queued emails
#[derive(Debug, Clone)]
pub struct ProcessQueueResult {
    /// Number of emails successfully processed
    pub processed: usize,
    /// Number of emails that failed again
    pub failed: usize,
    /// Number of emails that were retried
    pub retried: usize,
    /// Number of emails remaining in queue
    pub remaining_in_queue: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CircuitState {
    /// Circuit is closed - requests flow normally
    Closed,
    /// Circuit is open - requests fail fast
    Open,
    /// Circuit is half-open - testing if service recovered
    HalfOpen,
}

impl CircuitBreaker {
    /// Create a new circuit breaker with default settings
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            state: CircuitState::Closed,
            failure_threshold: 5,
            reset_timeout: Duration::from_secs(60), // 1 minute
            last_opened: None,
            failure_count: 0,
            success_count: 0,
        }
    }

    /// Check if request should be allowed
    pub fn allow_request(&mut self) -> bool {
        match self.state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                // Check if reset timeout has passed
                if let Some(last_opened) = self.last_opened {
                    let now = Utc::now();
                    let elapsed = now - last_opened;
                    if elapsed >= chrono::Duration::from_std(self.reset_timeout).unwrap() {
                        // Transition to half-open
                        self.state = CircuitState::HalfOpen;
                        self.success_count = 0;
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            }
            CircuitState::HalfOpen => {
                // Allow limited number of requests to test if service recovered
                self.success_count < 3
            }
        }
    }

    /// Record a successful request
    pub fn record_success(&mut self) -> Option<(CircuitState, CircuitState)> {
        let old_state = self.state.clone();

        match self.state {
            CircuitState::Closed => {
                self.success_count += 1;
                self.failure_count = 0;
            }
            CircuitState::HalfOpen => {
                self.success_count += 1;
                if self.success_count >= 3 {
                    // Service recovered, close the circuit
                    self.state = CircuitState::Closed;
                    self.failure_count = 0;
                    self.last_opened = None;
                }
            }
            CircuitState::Open => {
                // Shouldn't happen - success shouldn't be recorded when circuit is open
            }
        }

        if old_state != self.state {
            Some((old_state, self.state.clone()))
        } else {
            None
        }
    }

    /// Record a failed request
    pub fn record_failure(&mut self) -> Option<(CircuitState, CircuitState)> {
        let old_state = self.state.clone();

        match self.state {
            CircuitState::Closed | CircuitState::HalfOpen => {
                self.failure_count += 1;
                self.success_count = 0;

                if self.failure_count >= self.failure_threshold {
                    // Open the circuit
                    self.state = CircuitState::Open;
                    self.last_opened = Some(Utc::now());
                }
            }
            CircuitState::Open => {
                // Already open, keep it open
                self.last_opened = Some(Utc::now());
            }
        }

        if old_state != self.state {
            Some((old_state, self.state.clone()))
        } else {
            None
        }
    }

    /// Get current state
    pub fn state(&self) -> &CircuitState {
        &self.state
    }
}

/// External API Adapter trait
///
/// Main interface for external API provider operations as defined in the design document.
#[async_trait]
pub trait ExternalApiAdapter {
    /// Connect to an external API provider with credentials
    ///
    /// Validates credentials and establishes a connection to the provider.
    /// Returns a ProviderConnection that can be used for subsequent operations.
    async fn connect_provider(
        &self,
        credentials: ApiCredentials,
    ) -> ExternalApiResult<ProviderConnection>;

    /// Send an email through the configured provider
    ///
    /// Routes the email through the configured external API provider.
    /// Implements retry logic with exponential backoff on failure.
    async fn send_email(
        &self,
        provider: &ProviderConnection,
        email: EmailMessage,
    ) -> ExternalApiResult<SendResult>;

    /// Receive emails from the configured provider
    ///
    /// Fetches emails from the provider since the specified timestamp.
    /// Only works for providers that support receiving emails.
    async fn receive_emails(
        &self,
        provider: &ProviderConnection,
        since: DateTime<Utc>,
    ) -> ExternalApiResult<Vec<EmailMessage>>;

    /// Check health of a provider connection
    ///
    /// Performs health check and returns detailed status.
    /// Used for monitoring and failover decisions.
    async fn check_health(&self, provider: &ProviderConnection) -> ExternalApiResult<HealthStatus>;

    /// Failover from primary to secondary provider
    ///
    /// Switches from a failing primary provider to a secondary provider.
    /// Returns the new active provider connection.
    async fn failover(
        &self,
        primary: ProviderConnection,
        secondary: ProviderConnection,
    ) -> ExternalApiResult<ProviderConnection>;
}

/// Default implementation of ExternalApiAdapter
pub struct DefaultExternalApiAdapter {
    /// Encryption key for credential storage
    #[allow(dead_code)]
    encryption_key: Vec<u8>,
    /// Key ID for encryption
    #[allow(dead_code)]
    key_id: String,
    /// Retry policy for email sending
    retry_policy: RetryPolicy,
    /// Circuit breaker for provider health monitoring
    circuit_breaker: std::sync::Arc<tokio::sync::Mutex<CircuitBreaker>>,
}

impl DefaultExternalApiAdapter {
    /// Create a new adapter with encryption key
    pub fn new(encryption_key: Vec<u8>, key_id: String) -> Self {
        Self {
            encryption_key,
            key_id,
            retry_policy: RetryPolicy::default(),
            circuit_breaker: std::sync::Arc::new(tokio::sync::Mutex::new(CircuitBreaker::new())),
        }
    }

    /// Create a new adapter with custom retry policy
    pub fn with_retry_policy(
        encryption_key: Vec<u8>,
        key_id: String,
        retry_policy: RetryPolicy,
    ) -> Self {
        Self {
            encryption_key,
            key_id,
            retry_policy,
            circuit_breaker: std::sync::Arc::new(tokio::sync::Mutex::new(CircuitBreaker::new())),
        }
    }

    /// Encrypt credentials for storage
    #[allow(dead_code)]
    fn encrypt_credentials(
        &self,
        credentials: &ApiCredentials,
    ) -> ExternalApiResult<EncryptedCredentials> {
        EncryptedCredentials::encrypt(credentials, &self.key_id, &self.encryption_key)
            .map_err(|e| ExternalApiError::EncryptionError(e.to_string()))
    }

    /// Send email via Gmail API
    async fn send_via_gmail(
        &self,
        connection: &ProviderConnection,
        email: EmailMessage,
    ) -> ExternalApiResult<SendResult> {
        use reqwest::Client;

        info!("Sending email via Gmail API: {}", email.subject);

        // Extract Gmail connection details
        let crate::health::ConnectionDetails::Gmail {
            access_token,
            user_id,
        } = &connection.connection_details
        else {
            return Err(ExternalApiError::ConnectionError(
                "Invalid connection details for Gmail API".to_string(),
            ));
        };

        // Build Gmail API request
        let client = Client::new();
        let url = format!(
            "https://gmail.googleapis.com/gmail/v1/users/{}/messages/send",
            user_id
        );

        // Convert email to Gmail API format
        let raw_message = self.build_gmail_raw_message(&email)?;

        let request_body = serde_json::json!({
            "raw": raw_message,
        });

        match client
            .post(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    let response_json: serde_json::Value = response
                        .json()
                        .await
                        .map_err(|e| ExternalApiError::InvalidResponse(e.to_string()))?;

                    let message_id = response_json["id"]
                        .as_str()
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("gmail_{}", uuid::Uuid::new_v4()));

                    info!(
                        "Email sent successfully via Gmail API, message ID: {}",
                        message_id
                    );

                    Ok(SendResult {
                        success: true,
                        provider_message_id: Some(message_id),
                        error: None,
                        timestamp: Utc::now(),
                        retry_attempts: 0,
                    })
                } else if response.status() == 429 {
                    // Rate limited
                    warn!("Gmail API rate limit exceeded");
                    Err(ExternalApiError::RateLimitExceeded(
                        "Gmail API rate limit exceeded".to_string(),
                    ))
                } else if response.status() == 401 || response.status() == 403 {
                    // Authentication error
                    warn!("Gmail API authentication error: {}", response.status());
                    Err(ExternalApiError::AuthenticationError(format!(
                        "Gmail API authentication error: {}",
                        response.status()
                    )))
                } else {
                    let error_text = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Unknown error".to_string());
                    warn!("Gmail API error: {}", error_text);
                    Err(ExternalApiError::ProviderUnavailable(format!(
                        "Gmail API error: {}",
                        error_text
                    )))
                }
            }
            Err(e) => {
                error!("Gmail API network error: {}", e);
                Err(ExternalApiError::NetworkError(e.to_string()))
            }
        }
    }

    /// Build raw message for Gmail API
    fn build_gmail_raw_message(&self, email: &EmailMessage) -> ExternalApiResult<String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        // Build MIME message
        let mut message = String::new();

        // Headers
        message.push_str(&format!("From: {}\r\n", email.from));
        message.push_str(&format!("To: {}\r\n", email.to.join(", ")));
        if !email.cc.is_empty() {
            message.push_str(&format!("Cc: {}\r\n", email.cc.join(", ")));
        }
        message.push_str(&format!("Subject: {}\r\n", email.subject));
        message.push_str("MIME-Version: 1.0\r\n");

        // Determine content type
        if email.body_html.is_some() {
            // Multipart message
            let boundary = format!("boundary_{}", uuid::Uuid::new_v4());
            message.push_str(&format!(
                "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
                boundary
            ));

            // Plain text part
            message.push_str(&format!("--{}\r\n", boundary));
            message.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
            message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
            message.push_str(&email.body_plain);
            message.push_str("\r\n\r\n");

            // HTML part
            if let Some(html) = &email.body_html {
                message.push_str(&format!("--{}\r\n", boundary));
                message.push_str("Content-Type: text/html; charset=UTF-8\r\n");
                message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
                message.push_str(html);
                message.push_str("\r\n\r\n");
            }

            // Attachments
            for attachment in &email.attachments {
                message.push_str(&format!("--{}\r\n", boundary));
                message.push_str(&format!("Content-Type: {}\r\n", attachment.content_type));
                message.push_str("Content-Transfer-Encoding: base64\r\n");
                message.push_str(&format!(
                    "Content-Disposition: {}; filename=\"{}\"\r\n\r\n",
                    if attachment.inline {
                        "inline"
                    } else {
                        "attachment"
                    },
                    attachment.filename
                ));

                let encoded = STANDARD.encode(&attachment.content);
                // Split into lines of 76 characters (RFC 2045)
                for chunk in encoded.as_bytes().chunks(76) {
                    message.push_str(&String::from_utf8_lossy(chunk));
                    message.push_str("\r\n");
                }
                message.push_str("\r\n");
            }

            message.push_str(&format!("--{}--\r\n", boundary));
        } else {
            // Simple plain text message
            message.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
            message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
            message.push_str(&email.body_plain);
        }

        // Base64 encode the entire message
        Ok(STANDARD.encode(message))
    }

    /// Send email via SendGrid
    async fn send_via_sendgrid(
        &self,
        connection: &ProviderConnection,
        email: EmailMessage,
    ) -> ExternalApiResult<SendResult> {
        use reqwest::Client;

        info!("Sending email via SendGrid: {}", email.subject);

        // Extract SendGrid connection details
        let crate::health::ConnectionDetails::SendGrid { api_key } = &connection.connection_details
        else {
            return Err(ExternalApiError::ConnectionError(
                "Invalid connection details for SendGrid".to_string(),
            ));
        };

        // Build SendGrid API request
        let client = Client::new();
        let url = "https://api.sendgrid.com/v3/mail/send";

        // Convert email to SendGrid API format
        let request_body = self.build_sendgrid_request_body(&email)?;

        match client
            .post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    // SendGrid returns message ID in X-Message-Id header
                    let message_id = response
                        .headers()
                        .get("X-Message-Id")
                        .and_then(|h| h.to_str().ok())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| format!("sendgrid_{}", uuid::Uuid::new_v4()));

                    info!(
                        "Email sent successfully via SendGrid, message ID: {}",
                        message_id
                    );

                    Ok(SendResult {
                        success: true,
                        provider_message_id: Some(message_id),
                        error: None,
                        timestamp: Utc::now(),
                        retry_attempts: 0,
                    })
                } else if response.status() == 429 {
                    // Rate limited
                    warn!("SendGrid rate limit exceeded");
                    Err(ExternalApiError::RateLimitExceeded(
                        "SendGrid rate limit exceeded".to_string(),
                    ))
                } else if response.status() == 401 || response.status() == 403 {
                    // Authentication error
                    warn!("SendGrid authentication error: {}", response.status());
                    Err(ExternalApiError::AuthenticationError(format!(
                        "SendGrid authentication error: {}",
                        response.status()
                    )))
                } else {
                    let error_text = response
                        .text()
                        .await
                        .unwrap_or_else(|_| "Unknown error".to_string());
                    warn!("SendGrid error: {}", error_text);
                    Err(ExternalApiError::ProviderUnavailable(format!(
                        "SendGrid error: {}",
                        error_text
                    )))
                }
            }
            Err(e) => {
                error!("SendGrid network error: {}", e);
                Err(ExternalApiError::NetworkError(e.to_string()))
            }
        }
    }

    /// Build SendGrid API request body
    fn build_sendgrid_request_body(
        &self,
        email: &EmailMessage,
    ) -> ExternalApiResult<serde_json::Value> {
        let mut personalizations = vec![serde_json::json!({
            "to": email.to.iter().map(|addr| serde_json::json!({
                "email": addr
            })).collect::<Vec<_>>(),
        })];

        if !email.cc.is_empty() {
            personalizations[0]["cc"] = serde_json::json!(email
                .cc
                .iter()
                .map(|addr| serde_json::json!({
                    "email": addr
                }))
                .collect::<Vec<_>>());
        }

        if !email.bcc.is_empty() {
            personalizations[0]["bcc"] = serde_json::json!(email
                .bcc
                .iter()
                .map(|addr| serde_json::json!({
                    "email": addr
                }))
                .collect::<Vec<_>>());
        }

        let mut content = vec![serde_json::json!({
            "type": "text/plain",
            "value": email.body_plain
        })];

        if let Some(html) = &email.body_html {
            content.push(serde_json::json!({
                "type": "text/html",
                "value": html
            }));
        }

        let mut request_body = serde_json::json!({
            "personalizations": personalizations,
            "from": {
                "email": email.from
            },
            "subject": email.subject,
            "content": content,
        });

        // Add attachments if any
        if !email.attachments.is_empty() {
            let attachments: Vec<serde_json::Value> = email
                .attachments
                .iter()
                .map(|attachment| {
                    use base64::{engine::general_purpose::STANDARD, Engine as _};

                    serde_json::json!({
                        "content": STANDARD.encode(&attachment.content),
                        "type": attachment.content_type,
                        "filename": attachment.filename,
                        "disposition": if attachment.inline { "inline" } else { "attachment" }
                    })
                })
                .collect();

            request_body["attachments"] = serde_json::json!(attachments);
        }

        Ok(request_body)
    }

    /// Send email via Amazon SES
    async fn send_via_ses(
        &self,
        connection: &ProviderConnection,
        email: EmailMessage,
    ) -> ExternalApiResult<SendResult> {
        use chrono::Utc;
        #[allow(unused_imports)]
        use hmac::Mac;
        use reqwest::Client;
        use sha2::Digest;

        info!("Sending email via Amazon SES: {}", email.subject);

        // Extract SES connection details
        let crate::health::ConnectionDetails::AmazonSes {
            access_key_id,
            secret_access_key,
            region,
        } = &connection.connection_details
        else {
            return Err(ExternalApiError::ConnectionError(
                "Invalid connection details for Amazon SES".to_string(),
            ));
        };

        // Build SES API request
        let client = Client::new();
        let service = "ses";
        let host = format!("email.{}.amazonaws.com", region);
        let url = format!("https://{}", host);

        // Build SES API request body
        let request_body = self.build_ses_request_body(&email)?;

        // Create AWS SigV4 signature
        let now = Utc::now();
        let date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date_short = now.format("%Y%m%d").to_string();

        // For simplicity, we'll use a simplified approach
        // In production, you would use AWS SDK or proper SigV4 implementation
        let request_body_str = serde_json::to_string(&request_body).unwrap_or_default();
        let canonical_request = format!(
            "POST\n/\n\nhost:{}\nx-amz-date:{}\n\nhost;x-amz-date\n{}",
            host,
            date,
            hex::encode(sha2::Sha256::digest(request_body_str.as_bytes()))
        );

        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
            date,
            date_short,
            region,
            service,
            hex::encode(sha2::Sha256::digest(canonical_request.as_bytes()))
        );

        // Calculate signature
        let k_date = Self::hmac_sha256(
            format!("AWS4{}", secret_access_key).as_bytes(),
            date_short.as_bytes(),
        );
        let k_region = Self::hmac_sha256(&k_date, region.as_bytes());
        let k_service = Self::hmac_sha256(&k_region, service.as_bytes());
        let k_signing = Self::hmac_sha256(&k_service, b"aws4_request");
        let signature = hex::encode(Self::hmac_sha256(&k_signing, string_to_sign.as_bytes()));

        match client
            .post(&url)
            .header("Host", host)
            .header("X-Amz-Date", date)
            .header("Authorization", format!("AWS4-HMAC-SHA256 Credential={}/{}/{}/{}/aws4_request, SignedHeaders=host;x-amz-date, Signature={}",
                access_key_id, date_short, region, service, signature))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(request_body)
            .timeout(Duration::from_secs(30))
            .send()
            .await
        {
            Ok(response) => {
                if response.status().is_success() {
                    let response_text = response.text().await.unwrap_or_default();

                    // Parse SES response to extract message ID
                    let message_id = Self::extract_ses_message_id(&response_text)
                        .unwrap_or_else(|| format!("ses_{}", uuid::Uuid::new_v4()));

                    info!("Email sent successfully via Amazon SES, message ID: {}", message_id);

                    Ok(SendResult {
                        success: true,
                        provider_message_id: Some(message_id),
                        error: None,
                        timestamp: Utc::now(),
                        retry_attempts: 0,
                    })
                } else if response.status() == 429 {
                    // Rate limited
                    warn!("Amazon SES rate limit exceeded");
                    Err(ExternalApiError::RateLimitExceeded(
                        "Amazon SES rate limit exceeded".to_string()
                    ))
                } else if response.status() == 403 {
                    // Authentication error
                    warn!("Amazon SES authentication error: {}", response.status());
                    Err(ExternalApiError::AuthenticationError(
                        format!("Amazon SES authentication error: {}", response.status())
                    ))
                } else {
                    let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
                    warn!("Amazon SES error: {}", error_text);
                    Err(ExternalApiError::ProviderUnavailable(
                        format!("Amazon SES error: {}", error_text)
                    ))
                }
            }
            Err(e) => {
                error!("Amazon SES network error: {}", e);
                Err(ExternalApiError::NetworkError(e.to_string()))
            }
        }
    }

    /// Build SES API request body
    fn build_ses_request_body(&self, email: &EmailMessage) -> ExternalApiResult<String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};

        let mut params = vec![("Action", "SendRawEmail"), ("Version", "2010-12-01")];

        // Build MIME message similar to Gmail
        let mut message = String::new();

        // Headers
        message.push_str(&format!("From: {}\r\n", email.from));
        message.push_str(&format!("To: {}\r\n", email.to.join(", ")));
        if !email.cc.is_empty() {
            message.push_str(&format!("Cc: {}\r\n", email.cc.join(", ")));
        }
        message.push_str(&format!("Subject: {}\r\n", email.subject));
        message.push_str("MIME-Version: 1.0\r\n");

        // Determine content type
        if email.body_html.is_some() || !email.attachments.is_empty() {
            // Multipart message
            let boundary = format!("boundary_{}", uuid::Uuid::new_v4());
            message.push_str(&format!(
                "Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
                boundary
            ));

            // First part: alternative for text/html
            if email.body_html.is_some() {
                let alt_boundary = format!("alt_{}", uuid::Uuid::new_v4());
                message.push_str(&format!("--{}\r\n", boundary));
                message.push_str(&format!(
                    "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
                    alt_boundary
                ));

                // Plain text part
                message.push_str(&format!("--{}\r\n", alt_boundary));
                message.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
                message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
                message.push_str(&email.body_plain);
                message.push_str("\r\n\r\n");

                // HTML part
                if let Some(html) = &email.body_html {
                    message.push_str(&format!("--{}\r\n", alt_boundary));
                    message.push_str("Content-Type: text/html; charset=UTF-8\r\n");
                    message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
                    message.push_str(html);
                    message.push_str("\r\n\r\n");
                }

                message.push_str(&format!("--{}--\r\n\r\n", alt_boundary));
            } else {
                // Just plain text
                message.push_str(&format!("--{}\r\n", boundary));
                message.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
                message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
                message.push_str(&email.body_plain);
                message.push_str("\r\n\r\n");
            }

            // Attachments
            for attachment in &email.attachments {
                message.push_str(&format!("--{}\r\n", boundary));
                message.push_str(&format!("Content-Type: {}\r\n", attachment.content_type));
                message.push_str("Content-Transfer-Encoding: base64\r\n");
                message.push_str(&format!(
                    "Content-Disposition: {}; filename=\"{}\"\r\n\r\n",
                    if attachment.inline {
                        "inline"
                    } else {
                        "attachment"
                    },
                    attachment.filename
                ));

                let encoded = STANDARD.encode(&attachment.content);
                // Split into lines of 76 characters
                for chunk in encoded.as_bytes().chunks(76) {
                    message.push_str(&String::from_utf8_lossy(chunk));
                    message.push_str("\r\n");
                }
                message.push_str("\r\n");
            }

            message.push_str(&format!("--{}--\r\n", boundary));
        } else {
            // Simple plain text message
            message.push_str("Content-Type: text/plain; charset=UTF-8\r\n");
            message.push_str("Content-Transfer-Encoding: 7bit\r\n\r\n");
            message.push_str(&email.body_plain);
        }

        // Base64 encode the entire message
        let raw_message = STANDARD.encode(message);
        params.push(("RawMessage.Data", &raw_message));

        // Build URL-encoded parameters
        let body = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");

        Ok(body)
    }

    /// Helper function for HMAC-SHA256
    fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
        use hmac::{Hmac, Mac};
        use sha2::Sha256;

        type HmacSha256 = Hmac<Sha256>;

        let mut mac =
            HmacSha256::new_from_slice(key).expect("HMAC-SHA256 should accept any key length");
        mac.update(data);
        mac.finalize().into_bytes().to_vec()
    }

    /// Extract message ID from SES response
    fn extract_ses_message_id(response_text: &str) -> Option<String> {
        // SES returns XML response, extract MessageId element
        if let Some(start) = response_text.find("<MessageId>") {
            let end = response_text.find("</MessageId>").unwrap_or(start + 20);
            let message_id = &response_text[start + 11..end];
            Some(message_id.to_string())
        } else {
            None
        }
    }
}

#[async_trait]
impl ExternalApiAdapter for DefaultExternalApiAdapter {
    async fn connect_provider(
        &self,
        credentials: ApiCredentials,
    ) -> ExternalApiResult<ProviderConnection> {
        // Validate credentials first
        credentials.validate()?;

        // Create connection based on provider type
        let provider_type = credentials.provider_type();
        let connection_details = match credentials {
            ApiCredentials::Gmail {
                client_id: _,
                client_secret: _,
                refresh_token: _,
            } => {
                // In real implementation, we'd exchange refresh token for access token
                crate::health::ConnectionDetails::Gmail {
                    access_token: "placeholder_access_token".to_string(),
                    user_id: "me".to_string(),
                }
            }
            ApiCredentials::SendGrid { api_key } => {
                crate::health::ConnectionDetails::SendGrid { api_key }
            }
            ApiCredentials::AmazonSes {
                access_key_id,
                secret_access_key,
                region,
            } => crate::health::ConnectionDetails::AmazonSes {
                access_key_id,
                secret_access_key,
                region,
            },
        };

        Ok(ProviderConnection::new(provider_type, connection_details))
    }

    async fn send_email(
        &self,
        provider: &ProviderConnection,
        email: EmailMessage,
    ) -> ExternalApiResult<SendResult> {
        // Check circuit breaker first
        let mut circuit_breaker = self.circuit_breaker.lock().await;
        if !circuit_breaker.allow_request() {
            return Err(ExternalApiError::ProviderUnavailable(
                "Circuit breaker is open, provider temporarily unavailable".to_string(),
            ));
        }

        // Try with retry logic
        let mut last_error = None;

        for attempt in 0..=self.retry_policy.max_retries {
            if attempt > 0 {
                // Calculate delay for this retry attempt
                let delay = self.retry_policy.calculate_delay(attempt);
                info!(
                    "Retrying email send attempt {} after {:?} delay",
                    attempt, delay
                );
                tokio::time::sleep(delay).await;
            }

            // Route through appropriate provider based on type
            let result = match provider.provider_type {
                ProviderType::GmailApi => self.send_via_gmail(provider, email.clone()).await,
                ProviderType::SendGrid => self.send_via_sendgrid(provider, email.clone()).await,
                ProviderType::AmazonSes => self.send_via_ses(provider, email.clone()).await,
                ProviderType::Other(_) => Err(ExternalApiError::UnsupportedProvider(
                    "Custom provider type not implemented".to_string(),
                )),
            };

            match result {
                Ok(mut send_result) => {
                    // Success - update circuit breaker and return result
                    if let Some((old_state, new_state)) = circuit_breaker.record_success() {
                        // Record circuit breaker state change
                        self.record_metrics(MetricEvent::CircuitBreakerStateChanged {
                            provider_type: provider.provider_type.clone(),
                            from_state: old_state,
                            to_state: new_state,
                        })
                        .await;
                    }
                    send_result.retry_attempts = attempt;
                    return Ok(send_result);
                }
                Err(err) => {
                    last_error = Some(err);

                    // Check if error is retryable
                    if let Some(ref error) = last_error {
                        if !error.is_retryable() {
                            // Non-retryable error - fail fast
                            circuit_breaker.record_failure();
                            break;
                        }
                    }

                    // Record failure in circuit breaker
                    if let Some((old_state, new_state)) = circuit_breaker.record_failure() {
                        // Record circuit breaker state change
                        self.record_metrics(MetricEvent::CircuitBreakerStateChanged {
                            provider_type: provider.provider_type.clone(),
                            from_state: old_state,
                            to_state: new_state,
                        })
                        .await;
                    }

                    // If this was the last attempt, break
                    if attempt == self.retry_policy.max_retries {
                        break;
                    }
                }
            }
        }

        // All attempts failed
        Err(last_error.unwrap_or_else(|| {
            ExternalApiError::ProviderUnavailable("All retry attempts failed".to_string())
        }))
    }

    async fn receive_emails(
        &self,
        provider: &ProviderConnection,
        _since: DateTime<Utc>,
    ) -> ExternalApiResult<Vec<EmailMessage>> {
        // Only providers that support receiving emails can be used
        if !provider.provider_type.supports_receiving() {
            return Err(ExternalApiError::UnsupportedOperation(
                "Provider does not support receiving emails".to_string(),
            ));
        }

        // Placeholder implementation
        // In real implementation, would fetch emails from provider API
        Ok(vec![])
    }

    async fn check_health(&self, provider: &ProviderConnection) -> ExternalApiResult<HealthStatus> {
        Ok(provider.check_health().await)
    }

    async fn failover(
        &self,
        primary: ProviderConnection,
        secondary: ProviderConnection,
    ) -> ExternalApiResult<ProviderConnection> {
        // Enhanced failover that can work with multiple providers
        // For now, we maintain backward compatibility with primary/secondary
        // In a real implementation, this would take a list of providers

        // Check health of both providers
        let primary_health = primary.check_health().await;
        let secondary_health = secondary.check_health().await;

        // If primary is healthy, keep using it
        if primary_health.is_available() {
            info!("Primary provider is healthy, continuing to use it");
            return Ok(primary);
        }

        // If secondary is healthy, failover to it
        if secondary_health.is_available() {
            info!("Primary provider unavailable, failing over to secondary");
            return Ok(secondary);
        }

        // Both providers are unhealthy
        warn!("Both primary and secondary providers are unavailable");
        Err(ExternalApiError::ProviderUnavailable(
            "Both primary and secondary providers are unavailable".to_string(),
        ))
    }

    // Additional helper methods (failover_multiple, queueing, metrics, etc.)
    // have been moved to an inherent impl block below to avoid defining
    // non-trait methods inside the `impl ExternalApiAdapter for DefaultExternalApiAdapter` block.
}

impl DefaultExternalApiAdapter {
    /// Enhanced failover with multiple providers
    ///
    /// Takes a list of providers sorted by priority and returns the first healthy one.
    pub async fn failover_multiple(
        &self,
        providers: Vec<ProviderConnection>,
    ) -> ExternalApiResult<ProviderConnection> {
        if providers.is_empty() {
            return Err(ExternalApiError::ProviderUnavailable(
                "No providers available for failover".to_string(),
            ));
        }

        info!("Attempting failover across {} providers", providers.len());

        for (i, provider) in providers.iter().enumerate() {
            let health = provider.check_health().await;

            if health.is_available() {
                info!("Provider {} is healthy, selecting it for failover", i);
                return Ok(provider.clone());
            } else {
                warn!("Provider {} is unavailable: {:?}", i, health.error);
            }
        }

        warn!("All {} providers are unavailable", providers.len());
        Err(ExternalApiError::ProviderUnavailable(format!(
            "All {} providers are unavailable",
            providers.len()
        )))
    }

    /// Queue email for later delivery when provider is unavailable
    ///
    /// This is a simplified implementation. In production, this would use
    /// a proper message queue like NATS, RabbitMQ, or Redis.
    pub async fn queue_email_for_retry(
        &self,
        email: EmailMessage,
        provider_type: ProviderType,
        reason: String,
    ) -> ExternalApiResult<String> {
        use std::collections::VecDeque;
        use tokio::sync::Mutex;

        static QUEUE: Mutex<VecDeque<QueuedEmail>> = Mutex::const_new(VecDeque::new());

        let queued_email = QueuedEmail {
            id: uuid::Uuid::new_v4().to_string(),
            email,
            provider_type,
            reason,
            queued_at: Utc::now(),
            retry_count: 0,
            max_retries: 5,
            next_retry_at: Utc::now() + chrono::Duration::minutes(5),
        };

        let mut queue = QUEUE.lock().await;
        queue.push_back(queued_email.clone());

        info!(
            "Queued email {} for retry later: {}",
            queued_email.id, queued_email.reason
        );

        Ok(queued_email.id)
    }

    /// Process queued emails
    ///
    /// This would be called periodically by a background worker.
    pub async fn process_queued_emails(
        &self,
        providers: Vec<ProviderConnection>,
    ) -> ExternalApiResult<ProcessQueueResult> {
        use std::collections::VecDeque;
        use tokio::sync::Mutex;

        static QUEUE: Mutex<VecDeque<QueuedEmail>> = Mutex::const_new(VecDeque::new());

        let mut queue = QUEUE.lock().await;
        let now = Utc::now();
        let mut processed = 0;
        let mut failed = 0;
        let mut retried = 0;

        // Process emails that are ready for retry
        let mut i = 0;
        while i < queue.len() {
            let queued_email = &mut queue[i];

            if queued_email.next_retry_at <= now
                && queued_email.retry_count < queued_email.max_retries
            {
                // Try to send this email
                info!(
                    "Processing queued email {} (attempt {}/{})",
                    queued_email.id,
                    queued_email.retry_count + 1,
                    queued_email.max_retries
                );

                // Find appropriate provider
                let provider = providers
                    .iter()
                    .find(|p| p.provider_type == queued_email.provider_type)
                    .cloned();

                if let Some(provider) = provider {
                    match self.send_email(&provider, queued_email.email.clone()).await {
                        Ok(_) => {
                            // Success - remove from queue
                            info!("Successfully sent queued email {}", queued_email.id);
                            queue.remove(i);
                            processed += 1;
                            continue; // Don't increment i since we removed this item
                        }
                        Err(e) => {
                            // Failed again - update retry info
                            warn!("Failed to send queued email {}: {}", queued_email.id, e);
                            queued_email.retry_count += 1;
                            let backoff_minutes = 5_i64 * (2_i64).pow(queued_email.retry_count);
                            queued_email.next_retry_at =
                                now + chrono::Duration::minutes(backoff_minutes);
                            failed += 1;
                        }
                    }
                } else {
                    // No provider available for this type
                    warn!("No provider available for queued email {}", queued_email.id);
                    queued_email.retry_count += 1;
                    let backoff_minutes = 5_i64 * (2_i64).pow(queued_email.retry_count);
                    queued_email.next_retry_at = now + chrono::Duration::minutes(backoff_minutes);
                    failed += 1;
                }

                retried += 1;
            }

            i += 1;
        }

        info!(
            "Processed queue: {} processed, {} retried, {} still failed",
            processed, retried, failed
        );

        // Update metrics
        self.record_metrics(MetricEvent::QueueProcessed {
            processed,
            failed,
            retried,
            remaining: queue.len(),
        })
        .await;

        Ok(ProcessQueueResult {
            processed,
            failed,
            retried,
            remaining_in_queue: queue.len(),
        })
    }

    /// Record metrics for monitoring
    async fn record_metrics(&self, event: MetricEvent) {
        // In production, this would send metrics to a monitoring system
        // For now, we just log them
        match event {
            MetricEvent::EmailSent {
                provider_type,
                success,
                retry_attempts,
                duration_ms,
            } => {
                if success {
                    info!(
                        "Metrics: Email sent via {:?} (attempts: {}, duration: {}ms)",
                        provider_type, retry_attempts, duration_ms
                    );
                } else {
                    warn!(
                        "Metrics: Email failed via {:?} (attempts: {}, duration: {}ms)",
                        provider_type, retry_attempts, duration_ms
                    );
                }
            }
            MetricEvent::ProviderHealthChanged {
                provider_type,
                from_status,
                to_status,
            } => {
                info!(
                    "Metrics: Provider {:?} health changed: {:?} -> {:?}",
                    provider_type, from_status, to_status
                );
            }
            MetricEvent::CircuitBreakerStateChanged {
                provider_type,
                from_state,
                to_state,
            } => {
                info!(
                    "Metrics: Circuit breaker for {:?} changed: {:?} -> {:?}",
                    provider_type, from_state, to_state
                );
            }
            MetricEvent::QueueProcessed {
                processed,
                failed,
                retried,
                remaining,
            } => {
                info!(
                    "Metrics: Queue processed: {} success, {} failed, {} retried, {} remaining",
                    processed, failed, retried, remaining
                );
            }
            MetricEvent::RetryAttempt {
                provider_type,
                attempt,
                delay_seconds,
            } => {
                info!(
                    "Metrics: Retry attempt {} for {:?} after {}s delay",
                    attempt, provider_type, delay_seconds
                );
            }
        }
    }

    /// Send email with metrics tracking
    pub async fn send_email_with_metrics(
        &self,
        provider: &ProviderConnection,
        email: EmailMessage,
    ) -> ExternalApiResult<SendResult> {
        let start_time = std::time::Instant::now();

        let result = self.send_email(provider, email).await;

        let duration_ms = start_time.elapsed().as_millis() as u64;

        match &result {
            Ok(send_result) => {
                self.record_metrics(MetricEvent::EmailSent {
                    provider_type: provider.provider_type.clone(),
                    success: send_result.success,
                    retry_attempts: send_result.retry_attempts,
                    duration_ms,
                })
                .await;
            }
            Err(_) => {
                self.record_metrics(MetricEvent::EmailSent {
                    provider_type: provider.provider_type.clone(),
                    success: false,
                    retry_attempts: 0,
                    duration_ms,
                })
                .await;
            }
        }

        result
    }
}

/// Metrics events for monitoring
#[derive(Debug, Clone)]
enum MetricEvent {
    /// Email send attempt
    EmailSent {
        provider_type: crate::provider::ProviderType,
        success: bool,
        retry_attempts: u32,
        duration_ms: u64,
    },
    /// Provider health status change
    #[allow(dead_code)]
    ProviderHealthChanged {
        provider_type: crate::provider::ProviderType,
        from_status: crate::provider::ProviderStatus,
        to_status: crate::provider::ProviderStatus,
    },
    /// Circuit breaker state change
    CircuitBreakerStateChanged {
        provider_type: crate::provider::ProviderType,
        from_state: CircuitState,
        to_state: CircuitState,
    },
    /// Queue processing results
    QueueProcessed {
        processed: usize,
        failed: usize,
        retried: usize,
        remaining: usize,
    },
    /// Retry attempt
    #[allow(dead_code)]
    RetryAttempt {
        provider_type: crate::provider::ProviderType,
        attempt: u32,
        delay_seconds: u64,
    },
}
