-- Migration 014: Platform broadcasts
--
-- The control plane can send a message to every account on the platform
-- (release notes, feature announcements, scheduled maintenance, incidents).
-- Every broadcast is recorded so the operator can see what was sent, to
-- whom and how many deliveries succeeded.

CREATE TABLE IF NOT EXISTS platform_broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'notification',
    audience VARCHAR(30) NOT NULL DEFAULT 'all',
    recipient_count INTEGER NOT NULL DEFAULT 0,
    delivered_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'sent',
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_broadcasts_created_at
    ON platform_broadcasts (created_at DESC);

COMMENT ON TABLE platform_broadcasts IS
    'Broadcasts sent from the control plane. Only the configured platform owner may send them.';
COMMENT ON COLUMN platform_broadcasts.category IS
    'One of: event, feature, notification, alert, maintenance.';
