-- Migration 007: API gateway persistence
--
-- Team invites and inbound email routing rules previously lived in memory.

CREATE TABLE IF NOT EXISTS team_invites (
    code VARCHAR(255) PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS inbound_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    route_key VARCHAR(255) NOT NULL UNIQUE,
    data JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_invites_created ON team_invites(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_routes_key ON inbound_routes(route_key);
