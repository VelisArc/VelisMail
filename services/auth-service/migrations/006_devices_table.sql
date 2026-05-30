-- Migration 006: Recreate devices table to support fingerprint

DROP TABLE IF EXISTS devices CASCADE;

CREATE TABLE devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name VARCHAR(255) NOT NULL,
    platform VARCHAR(100) NOT NULL,
    browser VARCHAR(100) NOT NULL,
    os VARCHAR(100) NOT NULL,
    fingerprint VARCHAR(255) NOT NULL,
    is_trusted BOOLEAN NOT NULL DEFAULT false,
    has_tpm BOOLEAN NOT NULL DEFAULT false,
    has_secure_enclave BOOLEAN NOT NULL DEFAULT false,
    registered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices(fingerprint);

-- Enable Row-Level Security
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;

-- Add RLS policy for tenant isolation
DROP POLICY IF EXISTS devices_tenant_isolation ON devices;
CREATE POLICY devices_tenant_isolation ON devices
    USING (user_id IN (SELECT id FROM users WHERE tenant_id::text = current_setting('velismail.tenant_id', true)));
