-- Migration 001: Delivery engine schema

-- Delivery queue with priority and retry support
CREATE TABLE IF NOT EXISTS delivery_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id VARCHAR(512) NOT NULL,
    sender VARCHAR(255) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    html_body TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_queue_status ON delivery_queue(status);
CREATE INDEX IF NOT EXISTS idx_delivery_queue_next_retry ON delivery_queue(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_delivery_queue_priority ON delivery_queue(priority, created_at);

-- Bounce events
CREATE TABLE IF NOT EXISTS bounce_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient VARCHAR(255) NOT NULL,
    sender_domain VARCHAR(255) NOT NULL,
    bounce_type VARCHAR(20) NOT NULL,
    diagnostic_code TEXT,
    message_id VARCHAR(512),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bounce_events_recipient ON bounce_events(recipient);
CREATE INDEX IF NOT EXISTS idx_bounce_events_domain ON bounce_events(sender_domain);
CREATE INDEX IF NOT EXISTS idx_bounce_events_created ON bounce_events(created_at DESC);

-- Suppression list for emails that should not receive mail
CREATE TABLE IF NOT EXISTS suppression_list (
    email VARCHAR(255) PRIMARY KEY,
    reason VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppression_list_email ON suppression_list(email);
