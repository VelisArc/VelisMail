-- Migration 003: recovery email support for OTP-based account recovery

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS recovery_email_verified BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_recovery_email ON users(recovery_email);
