use crate::state::DeliveryState;
use axum::{extract::State, http::StatusCode, Json};
use serde_json::json;

pub async fn health_check() -> Json<serde_json::Value> {
    Json(json!({
        "status": "healthy",
        "service": "delivery-engine",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

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

pub async fn spf_verify(
    State(state): State<DeliveryState>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    Ok(Json(
        json!({"success": true, "spfConfigured": state.config.spf_record.as_deref().is_some_and(|s| !s.trim().is_empty()), "record": state.config.spf_record}),
    ))
}
