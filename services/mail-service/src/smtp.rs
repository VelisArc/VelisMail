#![allow(dead_code)]
//! SMTP client for sending emails

use anyhow::Result;
use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};

/// SMTP client wrapper
pub struct SmtpClient {
    transport: SmtpTransport,
    from_email: String,
}

impl SmtpClient {
    pub fn new(host: &str, port: u16, username: &str, password: &str) -> Result<Self> {
        let creds = Credentials::new(username.to_string(), password.to_string());

        let transport_builder = match port {
            465 => SmtpTransport::relay(host)?,
            587 => SmtpTransport::starttls_relay(host)?,
            _ => SmtpTransport::builder_dangerous(host).port(port),
        };

        let transport = transport_builder.credentials(creds).build();

        Ok(Self {
            transport,
            from_email: username.to_string(),
        })
    }

    /// Send an email
    pub async fn send(
        &self,
        to: Vec<String>,
        subject: String,
        body: String,
        html_body: Option<String>,
        from: Option<String>,
    ) -> Result<()> {
        let from_addr = from.unwrap_or_else(|| self.from_email.clone());
        let from_mailbox = Mailbox::new(None, from_addr.parse()?);

        let mut builder = Message::builder()
            .from(from_mailbox)
            .to(to.first().unwrap().parse()?)
            .subject(&subject);

        // Add multiple recipients (simplified for sync transport)
        for addr in to.iter().skip(1) {
            if let Ok(mailbox) = addr.parse::<Mailbox>() {
                builder = builder.cc(mailbox);
            }
        }

        // Build message with plain text body
        let email = if let Some(_html) = html_body {
            // In production, build multipart message with both plain and HTML
            builder.header(ContentType::TEXT_PLAIN).body(body)?
        } else {
            builder.header(ContentType::TEXT_PLAIN).body(body)?
        };

        // Send email (note: lettre 0.11 uses sync transport)
        self.transport.send(&email)?;

        Ok(())
    }
}

/// Email to send via SMTP
pub struct OutgoingEmail {
    pub from: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body_plain: String,
    pub body_html: Option<String>,
    pub attachments: Vec<Vec<u8>>,
    pub headers: Vec<(String, String)>,
}
