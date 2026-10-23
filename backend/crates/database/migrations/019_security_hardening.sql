-- Security hardening for authenticator replay protection.
--
-- A TOTP code stays valid for up to three 30-second steps. Persisting the
-- last accepted step lets the auth service reject a second use of the same
-- code (for example a code observed during a phishing attempt).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_used_step BIGINT;

-- Speed up the account-lock lookups used by every login and MFA check.
CREATE INDEX IF NOT EXISTS idx_failed_login_attempts_email_time
    ON failed_login_attempts (email, attempted_at DESC);

-- Refresh-token revocation is looked up per device when a session is closed.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_device
    ON refresh_tokens (user_id, device_fingerprint) WHERE revoked = FALSE;

-- Every team invite created before tenant authorization was enforced is
-- suspect: the creator could choose any workspace and role. Revoke all
-- outstanding keys so an administrator has to issue a fresh, server-scoped one.
UPDATE team_invites
SET revoked = TRUE,
    data = data || '{"status":"revoked"}'::jsonb
WHERE revoked = FALSE;
