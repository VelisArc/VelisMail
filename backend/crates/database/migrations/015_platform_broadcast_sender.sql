-- Migration 015: Record the sender of a platform broadcast
--
-- A broadcast can be sent from the platform default address or from one of
-- the active custom mailboxes. The control plane shows the sender in the
-- history so an operator can tell exactly which address reached the users.

ALTER TABLE platform_broadcasts
    ADD COLUMN IF NOT EXISTS from_address VARCHAR(255);

COMMENT ON COLUMN platform_broadcasts.from_address IS
    'The From address used for the broadcast. NULL for legacy rows.';
