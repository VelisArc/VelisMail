//! The mailbox index of a company.
//!
//! A mailbox is written to two places: the central index that the console
//! reads and the business database that the mail path uses when a message is
//! sent. Both are written together, otherwise a mailbox that the console
//! shows cannot send mail and the customer gets "sender mailbox is not
//! registered in the business database".
//!
//! The timestamp columns of `business_mailboxes` are text, not a database
//! timestamp, so every write stores the same RFC 3339 string the rest of the
//! product uses.

use sqlx::PgPool;

/// The current time in the format the mailbox index stores.
pub fn now_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Create the mailbox table of a business database when it is missing.
pub async fn ensure_table(pool: &PgPool) -> Result<(), String> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS business_mailboxes (
            id VARCHAR(255) NOT NULL,
            domain VARCHAR(255) NOT NULL,
            address VARCHAR(255) NOT NULL,
            display_name VARCHAR(255) NOT NULL,
            kind VARCHAR(50) NOT NULL,
            aliases TEXT NOT NULL DEFAULT '[]',
            active BOOLEAN NOT NULL DEFAULT TRUE,
            source VARCHAR(50) NOT NULL DEFAULT 'custom',
            created_at VARCHAR(100) NOT NULL,
            last_used_at VARCHAR(100),
            PRIMARY KEY (domain, address)
        );",
    )
    .execute(pool)
    .await
    .map_err(|err| err.to_string())?;

    for column in [
        "last_used_at VARCHAR(100)",
        "aliases TEXT NOT NULL DEFAULT '[]'",
        "source VARCHAR(50) NOT NULL DEFAULT 'custom'",
    ] {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER TABLE business_mailboxes ADD COLUMN IF NOT EXISTS {column};"
        )))
        .execute(pool)
        .await
        .map_err(|err| err.to_string())?;
    }

    for index in [
        "CREATE INDEX IF NOT EXISTS idx_business_mailboxes_domain ON business_mailboxes(domain);",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_business_mailboxes_domain_address ON business_mailboxes(domain, address);",
    ] {
        sqlx::query(index)
            .execute(pool)
            .await
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

/// The values of a mailbox.
pub struct MailboxValues<'a> {
    pub id: &'a str,
    pub domain: &'a str,
    pub address: &'a str,
    pub display_name: &'a str,
    pub kind: &'a str,
    pub aliases: &'a str,
    pub active: bool,
    pub source: &'a str,
}

/// Write a mailbox into a business database.
pub async fn upsert(pool: &PgPool, mailbox: &MailboxValues<'_>) -> Result<(), String> {
    ensure_table(pool).await?;
    sqlx::query(
        "INSERT INTO business_mailboxes
            (id, domain, address, display_name, kind, aliases, active, source, created_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
         ON CONFLICT (domain, address) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            kind = EXCLUDED.kind,
            aliases = EXCLUDED.aliases,
            active = EXCLUDED.active,
            source = EXCLUDED.source",
    )
    .bind(mailbox.id)
    .bind(mailbox.domain.trim().to_lowercase())
    .bind(mailbox.address.trim().to_lowercase())
    .bind(mailbox.display_name)
    .bind(mailbox.kind)
    .bind(mailbox.aliases)
    .bind(mailbox.active)
    .bind(mailbox.source)
    .bind(now_string())
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|err| err.to_string())
}
