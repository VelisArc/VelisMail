-- Migration 008: Legacy mail tables
--
-- The mail service historically created these tables at runtime. They are kept
-- here so a fresh database is fully provisioned before any service starts.

CREATE TABLE IF NOT EXISTS email_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    thread_id UUID NOT NULL,
    from_address VARCHAR(512) NOT NULL,
    from_name VARCHAR(512),
    to_addresses TEXT[] NOT NULL,
    cc_addresses TEXT[] NOT NULL DEFAULT '{}',
    bcc_addresses TEXT[] NOT NULL DEFAULT '{}',
    reply_to VARCHAR(512),
    subject TEXT NOT NULL,
    body_plain TEXT,
    body_html TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    folder VARCHAR(100) NOT NULL DEFAULT 'inbox',
    is_starred BOOLEAN NOT NULL DEFAULT false,
    is_read BOOLEAN NOT NULL DEFAULT false,
    has_attachments BOOLEAN NOT NULL DEFAULT false,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    encryption VARCHAR(20) NOT NULL DEFAULT 'none',
    labels TEXT[] NOT NULL DEFAULT '{}',
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    message_id_header VARCHAR(512),
    in_reply_to VARCHAR(512),
    references_header TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    received_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    filename TEXT NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_key TEXT NOT NULL,
    is_inline BOOLEAN NOT NULL DEFAULT false,
    content_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mailbox_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    folder_type VARCHAR(100) NOT NULL,
    parent_id UUID REFERENCES mailbox_folders(id),
    message_count BIGINT NOT NULL DEFAULT 0,
    unread_count BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#000000',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS email_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    UNIQUE(message_id, label_id)
);

CREATE TABLE IF NOT EXISTS undo_send_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    dispatched_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_user_id ON email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_id ON email_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_tenant_id ON email_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_folder ON email_messages(user_id, folder);
CREATE INDEX IF NOT EXISTS idx_email_messages_status ON email_messages(status);
CREATE INDEX IF NOT EXISTS idx_email_messages_received_at ON email_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_latest ON email_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_deleted ON email_messages(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_folder_date ON email_messages(user_id, folder, received_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_starred ON email_messages(user_id, is_starred) WHERE is_starred = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_labels_user_id ON labels(user_id);
CREATE INDEX IF NOT EXISTS idx_email_labels_message_id ON email_labels(message_id);
CREATE INDEX IF NOT EXISTS idx_email_labels_label_id ON email_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_undo_send_queue_user_id ON undo_send_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_undo_send_queue_expires_at ON undo_send_queue(expires_at);
CREATE INDEX IF NOT EXISTS idx_undo_send_pending ON undo_send_queue(message_id, expires_at) WHERE cancelled_at IS NULL AND dispatched_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_messages_search ON email_messages
    USING GIN(to_tsvector('english', subject || ' ' || COALESCE(body_plain, '')));
