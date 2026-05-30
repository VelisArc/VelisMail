-- Migration 007: Create otp_rate_limits table

CREATE TABLE IF NOT EXISTS otp_rate_limits (
    email VARCHAR(255) NOT NULL,
    purpose VARCHAR(100) NOT NULL,
    day DATE NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (email, purpose, day)
);

CREATE INDEX IF NOT EXISTS idx_otp_rate_limits_email_day ON otp_rate_limits(email, day);
