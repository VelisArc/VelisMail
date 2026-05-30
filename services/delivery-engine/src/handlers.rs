//! Delivery engine route handlers — complete delivery ecosystem.

use crate::bounce::{self, BounceEventRequest};
use crate::dkim::DkimSigner;
use crate::dmarc;
use crate::queue::{self, EnqueueRequest};
use crate::spf;
use crate::state::DeliveryState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

// ────────────────────────────────────────────────────────────
// Health check
// ────────────────────────────────────────────────────────────

pub async fn health_check(
    State(state): State<DeliveryState>,
) -> Json<serde_json::Value> {
    let db_healthy = sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .is_ok();

    let redis_healthy = if let Some(redis) = &state.redis {
        redis
            .get_multiplexed_async_connection()
            .await
            .and_then(|mut conn| {
                // Use a simple future wrapper
                Ok(conn)
            })
            .is_ok()
    } else {
        false
    };

    let health = velismail_common::HealthResponse::new(
        "delivery-engine",
        env!("CARGO_PKG_VERSION"),
        db_healthy,
        Some(redis_healthy),
        None,
    );
    Json(serde_json::to_value(health).unwrap_or_else(|_| {
        json!({"status": "UNHEALTHY", "service": "delivery-engine"})
    }))
}

// ────────────────────────────────────────────────────────────
// DKIM endpoints
// ────────────────────────────────────────────────────────────

pub async fn dkim_info(
    State(state): State<DeliveryState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(json!({
        "success": true,
        "selector": state.config.dkim_selector,
        "dnsHostPattern": format!("{}._domainkey.<your-domain>", state.config.dkim_selector),
        "envKey": "DKIM_PRIVATE_KEY",
        "publicKeyStorage": "Do not store dkim-public.pem in this repo or .env. Publish its public key in DNS as a TXT record.",
        "privateKeyLoaded": state.config.dkim_private_key.as_deref().is_some_and(|s| !s.trim().is_empty()),
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkimSignRequest {
    pub domain: String,
    pub headers: String,
    pub body: String,
    pub headers_to_sign: Option<Vec<String>>,
}

pub async fn dkim_sign(
    State(state): State<DeliveryState>,
    Json(request): Json<DkimSignRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let private_key = state
        .config
        .dkim_private_key
        .as_deref()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            velismail_common::AppError::BadRequest("DKIM private key not configured".to_string())
        })?;

    let signer = DkimSigner::new(&state.config.dkim_selector, &request.domain, private_key)
        .map_err(|e| velismail_common::AppError::Internal)?;

    let default_headers = vec![
        "from".to_string(),
        "to".to_string(),
        "subject".to_string(),
        "date".to_string(),
        "message-id".to_string(),
    ];
    let headers_to_sign = request.headers_to_sign.as_ref().unwrap_or(&default_headers);
    let header_refs: Vec<&str> = headers_to_sign.iter().map(|s| s.as_str()).collect();

    let signature = signer
        .sign(&header_refs, &request.headers, &request.body)
        .map_err(|e| {
            tracing::error!("DKIM signing failed: {}", e);
            velismail_common::AppError::Internal
        })?;

    Ok(Json(json!({
        "success": true,
        "signature": signature,
        "selector": state.config.dkim_selector,
        "domain": request.domain,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DkimVerifyRequest {
    pub dkim_header: String,
    pub headers: String,
    pub body: String,
    pub public_key_base64: String,
}

pub async fn dkim_verify(
    Json(request): Json<DkimVerifyRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let public_key = base64::engine::general_purpose::STANDARD
        .decode(&request.public_key_base64)
        .map_err(|_| {
            velismail_common::AppError::BadRequest("Invalid base64 public key".to_string())
        })?;

    let valid = crate::dkim::verify_dkim_signature(
        &request.dkim_header,
        &request.headers,
        &request.body,
        &public_key,
    )
    .map_err(|e| {
        tracing::error!("DKIM verification error: {}", e);
        velismail_common::AppError::Internal
    })?;

    Ok(Json(json!({
        "success": true,
        "valid": valid,
    })))
}

// ────────────────────────────────────────────────────────────
// SPF endpoints
// ────────────────────────────────────────────────────────────

pub async fn spf_verify(
    State(state): State<DeliveryState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(
        json!({"success": true, "spfConfigured": state.config.spf_record.as_deref().is_some_and(|s| !s.trim().is_empty()), "record": state.config.spf_record}),
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpfCheckRequest {
    pub spf_record: String,
    pub sender_ip: String,
}

pub async fn spf_check(
    Json(request): Json<SpfCheckRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let result = spf::check_ip_against_spf(&request.spf_record, &request.sender_ip);

    Ok(Json(json!({
        "success": true,
        "result": result.to_string(),
        "senderIp": request.sender_ip,
    })))
}

// ────────────────────────────────────────────────────────────
// DMARC endpoints
// ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmarcCheckRequest {
    pub dmarc_record: String,
    pub from_domain: String,
    pub spf_domain: Option<String>,
    pub dkim_domain: Option<String>,
    pub spf_result: String,
    pub dkim_pass: bool,
}

pub async fn dmarc_check(
    Json(request): Json<DmarcCheckRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let spf_result = match request.spf_result.to_lowercase().as_str() {
        "pass" => spf::SpfResult::Pass,
        "fail" => spf::SpfResult::Fail,
        "softfail" => spf::SpfResult::SoftFail,
        "neutral" => spf::SpfResult::Neutral,
        "none" => spf::SpfResult::None,
        "temperror" => spf::SpfResult::TempError,
        "permerror" => spf::SpfResult::PermError,
        _ => spf::SpfResult::None,
    };

    let result = dmarc::evaluate_dmarc(
        &request.dmarc_record,
        &request.from_domain,
        request.spf_domain.as_deref(),
        request.dkim_domain.as_deref(),
        &spf_result,
        request.dkim_pass,
    );

    Ok(Json(json!({
        "success": true,
        "dmarc": result,
    })))
}

// ────────────────────────────────────────────────────────────
// Bounce endpoints
// ────────────────────────────────────────────────────────────

pub async fn handle_bounce(
    State(state): State<DeliveryState>,
    Json(request): Json<BounceEventRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let bounce_type = bounce::handle_bounce(&state.db, &request)
        .await
        .map_err(|e| {
            tracing::error!("Bounce handling failed: {}", e);
            velismail_common::AppError::Internal
        })?;

    Ok(Json(json!({
        "success": true,
        "bounceType": bounce_type.to_string(),
        "recipient": request.recipient,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BounceStatsQuery {
    pub domain: Option<String>,
}

pub async fn bounce_stats(
    State(state): State<DeliveryState>,
    axum::extract::Query(query): axum::extract::Query<BounceStatsQuery>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let domain = query.domain.as_deref().unwrap_or("*");

    let stats = bounce::get_bounce_stats(&state.db, domain)
        .await
        .map_err(|e| {
            tracing::error!("Bounce stats query failed: {}", e);
            velismail_common::AppError::Internal
        })?;

    Ok(Json(json!({
        "success": true,
        "stats": stats,
    })))
}

// ────────────────────────────────────────────────────────────
// Queue endpoints
// ────────────────────────────────────────────────────────────

pub async fn queue_enqueue(
    State(state): State<DeliveryState>,
    Json(request): Json<EnqueueRequest>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    // Check suppression list
    if bounce::is_suppressed(&state.db, &request.recipient)
        .await
        .unwrap_or(false)
    {
        return Err(velismail_common::AppError::BadRequest(format!(
            "Recipient {} is on the suppression list",
            request.recipient
        )));
    }

    let id = queue::enqueue(&state.db, &request, state.config.queue_retry_max)
        .await
        .map_err(|e| {
            tracing::error!("Queue enqueue failed: {}", e);
            velismail_common::AppError::Internal
        })?;

    Ok(Json(json!({
        "success": true,
        "queueId": id.to_string(),
        "status": "pending",
    })))
}

pub async fn queue_status(
    State(state): State<DeliveryState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let item = queue::get_status(&state.db, id)
        .await
        .map_err(|e| {
            tracing::error!("Queue status query failed: {}", e);
            velismail_common::AppError::Internal
        })?
        .ok_or_else(|| {
            velismail_common::AppError::NotFound("Queue item not found".to_string())
        })?;

    Ok(Json(json!({
        "success": true,
        "item": item,
    })))
}

pub async fn queue_retry(
    State(state): State<DeliveryState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let retried = queue::retry(&state.db, id).await.map_err(|e| {
        tracing::error!("Queue retry failed: {}", e);
        velismail_common::AppError::Internal
    })?;

    if !retried {
        return Err(velismail_common::AppError::NotFound(
            "Queue item not found or not in retryable state".to_string(),
        ));
    }

    Ok(Json(json!({
        "success": true,
        "message": "Delivery queued for retry",
    })))
}

// ────────────────────────────────────────────────────────────
// Deliverability score
// ────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverabilityQuery {
    pub domain: Option<String>,
}

pub async fn deliverability_score(
    State(state): State<DeliveryState>,
    axum::extract::Query(query): axum::extract::Query<DeliverabilityQuery>,
) -> Result<Json<serde_json::Value>, velismail_common::AppError> {
    let domain = query.domain.as_deref().unwrap_or("*");

    let has_dkim = state.config.dkim_private_key.as_deref().is_some_and(|k| !k.trim().is_empty());
    let has_spf = state.config.spf_record.as_deref().is_some_and(|s| !s.trim().is_empty());
    let has_dmarc = state.config.dmarc_domain.as_deref().is_some_and(|d| !d.trim().is_empty());

    let bounce_stats = bounce::get_bounce_stats(&state.db, domain).await.ok();
    let bounce_rate = bounce_stats
        .as_ref()
        .map(|s| s.bounce_rate_percent)
        .unwrap_or(0.0);

    // Calculate score (0-100)
    let mut score = 100.0f64;
    if !has_dkim { score -= 25.0; }
    if !has_spf { score -= 20.0; }
    if !has_dmarc { score -= 15.0; }
    if bounce_rate > 5.0 { score -= 20.0; }
    else if bounce_rate > 2.0 { score -= 10.0; }
    else if bounce_rate > 1.0 { score -= 5.0; }

    Ok(Json(json!({
        "success": true,
        "domain": domain,
        "score": score.max(0.0).round() as u32,
        "factors": {
            "dkim": has_dkim,
            "spf": has_spf,
            "dmarc": has_dmarc,
            "bounceRate": bounce_rate,
        },
        "recommendations": build_recommendations(has_dkim, has_spf, has_dmarc, bounce_rate),
    })))
}

fn build_recommendations(dkim: bool, spf: bool, dmarc: bool, bounce_rate: f64) -> Vec<String> {
    let mut recs = Vec::new();
    if !dkim {
        recs.push("Configure DKIM signing by setting DKIM_PRIVATE_KEY environment variable".to_string());
    }
    if !spf {
        recs.push("Set up SPF record for your sending domain".to_string());
    }
    if !dmarc {
        recs.push("Configure DMARC policy for your domain".to_string());
    }
    if bounce_rate > 2.0 {
        recs.push(format!("Bounce rate ({:.1}%) is above recommended threshold. Clean your mailing list.", bounce_rate));
    }
    recs
}
