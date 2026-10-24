-- Team invitations live in a JSONB blob, so the console queries by the
-- scope and status inside the document. These indexes keep those lookups and
-- the expiry sweep cheap as the invitation history grows.
CREATE INDEX IF NOT EXISTS idx_team_invites_scope_status
    ON team_invites ((data->>'scope'), (data->>'status'))
    WHERE revoked = FALSE;

CREATE INDEX IF NOT EXISTS idx_team_invites_pending_email
    ON team_invites (LOWER(data->>'email'))
    WHERE revoked = FALSE AND data->>'status' = 'pending';

CREATE INDEX IF NOT EXISTS idx_team_invites_expires
    ON team_invites (expires_at)
    WHERE revoked = FALSE;
