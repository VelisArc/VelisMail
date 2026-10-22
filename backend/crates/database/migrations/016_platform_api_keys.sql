-- Migration 016: Platform API keys
--
-- A workspace key runs one company. A platform key runs the control plane:
-- it can read every company, every user, every support ticket and every
-- investigation, change a plan, turn a feature flag and send a broadcast.
-- That is what an assistant needs to monitor the whole ecosystem, upgrade
-- accounts and fix what is broken without a browser session.
--
-- The key is bound to the platform, not to a tenant, and carries the scopes
-- the operator granted. Only the secret is hashed; the prefix is stored so
-- the console can recognise the key without revealing it.

CREATE TABLE IF NOT EXISTS platform_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    key_prefix VARCHAR(24) NOT NULL,
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_api_keys_created_at
    ON platform_api_keys (created_at DESC);

COMMENT ON TABLE platform_api_keys IS
    'Bearer credentials for the control plane. A key runs the platform API with exactly the scopes it was created with.';
