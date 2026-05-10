-- Migration 002: Add password-based authentication support
-- Passkey/WebAuthn is still supported, but password auth is now the primary
-- working flow until a full WebAuthn client integration ships.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT,
    ADD COLUMN IF NOT EXISTS display_name_updated_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_password_present ON users((password_hash IS NOT NULL));
