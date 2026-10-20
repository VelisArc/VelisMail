-- Migration 003: Mail service schema
--
-- Platform mailbox tables plus the business mailbox tables used by the
-- gateway and mail service.

CREATE TABLE IF NOT EXISTS platform_emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(512) NOT NULL,
    thread_id VARCHAR(255),
    sender VARCHAR(255) NOT NULL,
    sender_name VARCHAR(255),
    recipients TEXT NOT NULL DEFAULT '[]',
    cc TEXT,
    bcc TEXT,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    html_body TEXT,
    folder VARCHAR(50) NOT NULL DEFAULT 'sent',
    is_read BOOLEAN NOT NULL DEFAULT true,
    is_starred BOOLEAN NOT NULL DEFAULT false,
    has_attachment BOOLEAN NOT NULL DEFAULT false,
    in_reply_to VARCHAR(512),
    status VARCHAR(50) NOT NULL DEFAULT 'sent',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_emails (
    id VARCHAR(255) PRIMARY KEY,
    sender VARCHAR(255),
    sender_name VARCHAR(255),
    recipients TEXT,
    subject TEXT,
    body TEXT,
    html_body TEXT,
    folder VARCHAR(50),
    created_at VARCHAR(100),
    is_read BOOLEAN,
    is_starred BOOLEAN,
    has_attachment BOOLEAN DEFAULT FALSE,
    in_reply_to VARCHAR(512),
    thread_id VARCHAR(255),
    message_id VARCHAR(512)
);

CREATE TABLE IF NOT EXISTS business_mailboxes (
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
);

CREATE INDEX IF NOT EXISTS idx_platform_emails_folder ON platform_emails(folder);
CREATE INDEX IF NOT EXISTS idx_platform_emails_thread_id ON platform_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_platform_emails_message_id ON platform_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_platform_emails_sender ON platform_emails(sender);
CREATE INDEX IF NOT EXISTS idx_platform_emails_created_at ON platform_emails(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_emails_folder_created ON business_emails(folder, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_business_emails_message_id ON business_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_business_emails_thread_id ON business_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_business_mailboxes_domain ON business_mailboxes(domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_mailboxes_domain_address ON business_mailboxes(domain, address);
