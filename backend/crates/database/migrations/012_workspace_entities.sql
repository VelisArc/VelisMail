-- Migration 012: Durable workspace entities
--
-- The business dashboard used to keep team members, templates, contacts,
-- contact groups, signatures and the mailbox index in the browser (IndexedDB /
-- localStorage). That created two sources of truth: the Company Admin console
-- read PostgreSQL while the dashboard read the browser store, so the same
-- workspace showed different people, different mailboxes and different audit
-- trails depending on the screen.
--
-- This migration gives every one of those entities a tenant-scoped,
-- PostgreSQL-backed home. All reads and writes are filtered by `tenant_id`,
-- which is derived from the verified session, never from the request body.

-- ---------------------------------------------------------------------------
-- Mailboxes: the gateway already owns this table, add the tenant scope.
-- ---------------------------------------------------------------------------

ALTER TABLE business_mailboxes
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;

UPDATE business_mailboxes bm
SET tenant_id = cd.tenant_id
FROM custom_domains cd
WHERE cd.domain_name = bm.domain
  AND bm.tenant_id IS NULL;

UPDATE business_mailboxes bm
SET tenant_id = t.id
FROM tenants t
WHERE bm.tenant_id IS NULL
  AND LOWER(SPLIT_PART(t.organization_email, '@', 2)) = LOWER(bm.domain);

CREATE INDEX IF NOT EXISTS idx_business_mailboxes_tenant
    ON business_mailboxes(tenant_id);

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(160) NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_templates_tenant
    ON business_templates(tenant_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_templates_tenant_name
    ON business_templates(tenant_id, name);

-- ---------------------------------------------------------------------------
-- Contacts and contact groups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_contact_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_contact_groups_tenant_name
    ON business_contact_groups(tenant_id, name);

CREATE TABLE IF NOT EXISTS business_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(40),
    company VARCHAR(160),
    group_name VARCHAR(120) NOT NULL DEFAULT 'General',
    notes TEXT NOT NULL DEFAULT '',
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_contacts_tenant_email
    ON business_contacts(tenant_id, email);

CREATE INDEX IF NOT EXISTS idx_business_contacts_tenant_group
    ON business_contacts(tenant_id, group_name);

-- ---------------------------------------------------------------------------
-- Signatures
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_signatures_tenant_name
    ON business_signatures(tenant_id, name);

-- ---------------------------------------------------------------------------
-- Mail groups
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS business_mail_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    name VARCHAR(160) NOT NULL,
    address VARCHAR(255) NOT NULL,
    members TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_business_mail_groups_tenant_address
    ON business_mail_groups(tenant_id, address);

CREATE INDEX IF NOT EXISTS idx_business_mail_groups_tenant_domain
    ON business_mail_groups(tenant_id, domain);

-- ---------------------------------------------------------------------------
-- Team invitations issued from the dashboard are stored with the tenant so
-- the Company Admin console and the dashboard share one invite list.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspace_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    invited_by VARCHAR(255) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_workspace_invitation_status
        CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_invitations_pending
    ON workspace_invitations(tenant_id, email)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_tenant
    ON workspace_invitations(tenant_id, created_at DESC);
