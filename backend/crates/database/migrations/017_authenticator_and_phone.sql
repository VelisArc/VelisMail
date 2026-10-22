-- Migration 017: TOTP Authenticator and Phone Number
--
-- Adds TOTP authenticator support and optional phone number for account recovery.

-- TOTP Authenticator columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_confirmed_at TIMESTAMPTZ;

-- Phone number columns for future recovery
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_country_code VARCHAR(8);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Add mfa_verified to refresh_tokens for secure token rotation
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS mfa_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for TOTP enabled users
CREATE INDEX IF NOT EXISTS idx_users_totp_enabled ON users(totp_enabled);