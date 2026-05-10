// HTTP provider delivery client used by provider-backed sending flows.
#![allow(dead_code)]
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tracing::{error, info};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MailProvider {
    VelisMail,
    SendGrid,
    Resend,
    CustomSmtp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyConfig {
    pub provider: MailProvider,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchPayload {
    pub to: String,
    pub from: String,
    pub subject: String,
    pub body: String, // Encrypted or plaintext based on logic
    pub is_html: bool,
}

pub struct HttpDeliveryAdapter {
    client: Client,
}

impl HttpDeliveryAdapter {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Dispatch payload via the configured provider
    pub async fn dispatch(&self, payload: DispatchPayload, config: ApiKeyConfig) -> Result<()> {
        match config.provider {
            MailProvider::VelisMail => {
                // In BYOK setup, picking VelisMail could default to a generic internal cluster router
                // or just error out if the central SMTP was removed.
                Err(anyhow!(
                    "VelisMail central delivery is disabled in BYOK mode."
                ))
            }
            MailProvider::SendGrid => self.send_via_sendgrid(payload, config.api_key).await,
            MailProvider::Resend => self.send_via_resend(payload, config.api_key).await,
            MailProvider::CustomSmtp => {
                // Here we would implement lettre based custom SMTP dispatch
                Err(anyhow!(
                    "Custom SMTP mapping not yet implemented in HTTP Adapter"
                ))
            }
        }
    }

    async fn send_via_resend(&self, payload: DispatchPayload, api_key: String) -> Result<()> {
        info!("Dispatching to {} via Resend", payload.to);

        let req_body = serde_json::json!({
            "from": payload.from,
            "to": [payload.to],
            "subject": payload.subject,
            "html": if payload.is_html { payload.body.clone() } else { "".to_string() },
            "text": if !payload.is_html { payload.body } else { "".to_string() }
        });

        let res = self
            .client
            .post("https://api.resend.com/emails")
            .bearer_auth(api_key)
            .json(&req_body)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let txt = res.text().await.unwrap_or_default();
            error!("Resend API error: {} - {}", status, txt);
            return Err(anyhow!("Failed to send via Resend API"));
        }

        Ok(())
    }

    async fn send_via_sendgrid(&self, payload: DispatchPayload, api_key: String) -> Result<()> {
        info!("Dispatching to {} via SendGrid", payload.to);

        // SendGrid payload mapping
        let req_body = serde_json::json!({
            "personalizations": [{
                "to": [{"email": payload.to}]
            }],
            "from": {"email": payload.from},
            "subject": payload.subject,
            "content": [{
                "type": if payload.is_html { "text/html" } else { "text/plain" },
                "value": payload.body
            }]
        });

        let res = self
            .client
            .post("https://api.sendgrid.com/v3/mail/send")
            .bearer_auth(api_key)
            .json(&req_body)
            .send()
            .await?;

        if !res.status().is_success() {
            let status = res.status();
            let txt = res.text().await.unwrap_or_default();
            error!("SendGrid API error: {} - {}", status, txt);
            return Err(anyhow!("Failed to send via SendGrid API"));
        }

        Ok(())
    }
}
