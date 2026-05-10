-- Migration 001: Mail schema

-- Email messages
CREATE TABLE IF NOT EXISTS email_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    thread_id UUID NOT NULL,
    from_address VARCHAR(512) NOT NULL,
    to_addresses TEXT[] NOT NULL,
    cc_addresses TEXT[] NOT NULL DEFAULT '{}',
    bcc_addresses TEXT[] NOT NULL DEFAULT '{}',
    subject TEXT NOT NULL,
    body_plain TEXT,
    body_html TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    folder VARCHAR(100) NOT NULL DEFAULT 'inbox',
    is_starred BOOLEAN NOT NULL DEFAULT false,
    is_read BOOLEAN NOT NULL DEFAULT false,
    has_attachments BOOLEAN NOT NULL DEFAULT false,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    sent_at TIMESTAMP WITH TIME ZONE,
    received_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    message_id_header VARCHAR(512),
    in_reply_to VARCHAR(512),
    references_header TEXT
);

-- Attachments
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

-- Folders
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

-- Labels
CREATE TABLE IF NOT EXISTS labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#000000',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Email-label mapping
CREATE TABLE IF NOT EXISTS email_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    UNIQUE(message_id, label_id)
);

-- Undo send queue
CREATE TABLE IF NOT EXISTS undo_send_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_email_messages_user_id ON email_messages(user_id);
CREATE INDEX idx_email_messages_thread_id ON email_messages(thread_id);
CREATE INDEX idx_email_messages_tenant_id ON email_messages(tenant_id);
CREATE INDEX idx_email_messages_folder ON email_messages(user_id, folder);
CREATE INDEX idx_email_messages_status ON email_messages(status);
CREATE INDEX idx_email_messages_received_at ON email_messages(received_at DESC);
CREATE INDEX idx_attachments_message_id ON attachments(message_id);
CREATE INDEX idx_labels_user_id ON labels(user_id);
CREATE INDEX idx_email_labels_message_id ON email_labels(message_id);
CREATE INDEX idx_email_labels_label_id ON email_labels(label_id);
CREATE INDEX idx_undo_send_queue_user_id ON undo_send_queue(user_id);
CREATE INDEX idx_undo_send_queue_expires_at ON undo_send_queue(expires_at);

-- Full-text search index
CREATE INDEX idx_email_messages_search ON email_messages
    USING GIN(to_tsvector('english', subject || ' ' || COALESCE(body_plain, '')));

-- Row-Level Security
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mailbox_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE undo_send_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY email_messages_tenant_isolation ON email_messages
    USING (tenant_id::text = current_setting('velismail.tenant_id', true));

CREATE POLICY attachments_tenant_isolation ON attachments
    USING (
        EXISTS (
            SELECT 1
            FROM email_messages
            WHERE email_messages.id = attachments.message_id
              AND email_messages.tenant_id::text = current_setting('velismail.tenant_id', true)
        )
    );

CREATE POLICY folders_tenant_isolation ON mailbox_folders
    USING (user_id::text = current_setting('velismail.user_id', true));

CREATE POLICY labels_tenant_isolation ON labels
    USING (user_id::text = current_setting('velismail.user_id', true));

CREATE POLICY email_labels_tenant_isolation ON email_labels
    USING (
        EXISTS (
            SELECT 1
            FROM email_messages
            WHERE email_messages.id = email_labels.message_id
              AND email_messages.tenant_id::text = current_setting('velismail.tenant_id', true)
        )
    );

CREATE POLICY undo_send_queue_tenant_isolation ON undo_send_queue
    USING (user_id::text = current_setting('velismail.user_id', true));
