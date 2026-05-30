-- Migration 001: Platform emails and threading tables

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

CREATE INDEX IF NOT EXISTS idx_platform_emails_folder ON platform_emails(folder);
CREATE INDEX IF NOT EXISTS idx_platform_emails_thread_id ON platform_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_platform_emails_message_id ON platform_emails(message_id);
CREATE INDEX IF NOT EXISTS idx_platform_emails_sender ON platform_emails(sender);
CREATE INDEX IF NOT EXISTS idx_platform_emails_created_at ON platform_emails(created_at DESC);
