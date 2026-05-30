-- Migration 002: Mail service v4.0 schema enhancements
-- Adds from_name, reply_to, improves undo_send_queue, adds search columns

-- Add missing columns to email_messages
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS from_name VARCHAR(512);
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS reply_to VARCHAR(512);
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal';
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS encryption VARCHAR(20) NOT NULL DEFAULT 'none';
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Add cancelled_at to undo_send_queue for cancellation support
ALTER TABLE undo_send_queue ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE undo_send_queue ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMP WITH TIME ZONE;

-- Partial index for faster undo-send lookups (only pending items)
CREATE INDEX IF NOT EXISTS idx_undo_send_pending
    ON undo_send_queue(message_id, expires_at)
    WHERE cancelled_at IS NULL AND dispatched_at IS NULL;

-- Soft-delete index for messages
CREATE INDEX IF NOT EXISTS idx_email_messages_deleted
    ON email_messages(deleted_at)
    WHERE deleted_at IS NOT NULL;

-- Composite index for folder + received_at pagination
CREATE INDEX IF NOT EXISTS idx_email_messages_folder_date
    ON email_messages(user_id, folder, received_at DESC)
    WHERE deleted_at IS NULL;

-- Composite index for starred messages
CREATE INDEX IF NOT EXISTS idx_email_messages_starred
    ON email_messages(user_id, is_starred)
    WHERE is_starred = true AND deleted_at IS NULL;

-- Thread-level latest message timestamp
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_latest
    ON email_messages(thread_id, created_at DESC);
