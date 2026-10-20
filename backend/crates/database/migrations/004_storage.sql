-- Migration 004: Storage service schema
--
-- Metadata for encrypted attachment objects. The encrypted bytes themselves
-- live on the VM filesystem under STORAGE_ROOT.

CREATE TABLE IF NOT EXISTS storage_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_key VARCHAR(512) NOT NULL UNIQUE,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,
    encrypted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_key ON storage_objects(storage_key);
CREATE INDEX IF NOT EXISTS idx_storage_objects_created ON storage_objects(created_at DESC);
