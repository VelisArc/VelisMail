-- Migration 009: tenant isolation for shared storage and platform mail.
--
-- Rows created before this migration keep a NULL tenant_id and are treated as
-- legacy platform rows. New rows are always written with the authenticated
-- tenant.

ALTER TABLE storage_objects ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE platform_emails ADD COLUMN IF NOT EXISTS tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_storage_objects_tenant
    ON storage_objects(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_emails_tenant
    ON platform_emails(tenant_id, created_at DESC);
