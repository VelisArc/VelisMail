-- Migration 011: Complete administration ecosystem
--
-- Adds the durable control-plane used by the VelisMail Super Admin console
-- and the per-company Company Admin console. Everything here is operational
-- data: platform staff, company membership, investigations, API keys,
-- invoices, announcements, feature flags, security events and audit trails.

-- ---------------------------------------------------------------------------
-- Platform staff & role based access control
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_roles (
    key VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions JSONB NOT NULL DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_roles (key, name, description, permissions) VALUES
    ('owner', 'Owner', 'Unrestricted control of the VelisMail platform.', '["*"]'),
    ('superadmin', 'Super Admin', 'Full platform operations, excluding owner transfer.', '["companies.read","companies.write","users.read","users.write","billing.read","billing.write","investigations.read","investigations.write","audit.read","team.read","team.write","config.read","config.write","system.read"]'),
    ('admin', 'Administrator', 'Day-to-day platform administration.', '["companies.read","companies.write","users.read","users.write","billing.read","investigations.read","investigations.write","audit.read","team.read","config.read","system.read"]'),
    ('analyst', 'Analyst', 'Read analytics and manage investigations.', '["companies.read","users.read","investigations.read","investigations.write","audit.read","system.read"]'),
    ('support', 'Support Agent', 'Customer support and investigation triage.', '["companies.read","users.read","investigations.read","investigations.write","audit.read"]'),
    ('viewer', 'Read Only', 'Read-only access to the control plane.', '["companies.read","users.read","billing.read","investigations.read","audit.read","team.read","config.read","system.read"]')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_admins (
    email VARCHAR(255) PRIMARY KEY,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(50) NOT NULL DEFAULT 'admin' REFERENCES platform_roles(key),
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    permissions JSONB NOT NULL DEFAULT '[]',
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_platform_admin_status CHECK (status IN ('active', 'suspended'))
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_role ON platform_admins(role);
CREATE INDEX IF NOT EXISTS idx_platform_admins_status ON platform_admins(status);

-- Company roles and permission matrix (shared by every tenant).
CREATE TABLE IF NOT EXISTS company_roles (
    key VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permissions JSONB NOT NULL DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO company_roles (key, name, description, permissions) VALUES
    ('owner', 'Owner', 'Billing owner and final authority for the workspace.', '["mail.read","mail.send","mail.manage","templates.read","templates.write","contacts.read","contacts.write","domains.read","domains.write","mailboxes.read","mailboxes.write","groups.read","groups.write","team.read","team.write","analytics.read","audit.read","billing.read","billing.write","settings.read","settings.write","apikeys.read","apikeys.write","security.read"]'),
    ('admin', 'Admin', 'Full workspace administration.', '["mail.read","mail.send","mail.manage","templates.read","templates.write","contacts.read","contacts.write","domains.read","domains.write","mailboxes.read","mailboxes.write","groups.read","groups.write","team.read","team.write","analytics.read","audit.read","billing.read","billing.write","settings.read","settings.write","apikeys.read","apikeys.write","security.read"]'),
    ('member', 'Member', 'Daily mail, templates, contacts and analytics.', '["mail.read","mail.send","templates.read","templates.write","contacts.read","contacts.write","mailboxes.read","groups.read","analytics.read"]'),
    ('viewer', 'Viewer', 'Read-only access to mail and reports.', '["mail.read","templates.read","contacts.read","domains.read","mailboxes.read","groups.read","analytics.read","audit.read"]')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Company profiles, normalized membership and invitations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_profiles (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    slug VARCHAR(120) UNIQUE,
    legal_name VARCHAR(255),
    industry VARCHAR(120),
    country VARCHAR(120),
    timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Kolkata',
    logo_url TEXT,
    billing_email VARCHAR(255),
    technical_email VARCHAR(255),
    seat_limit INTEGER NOT NULL DEFAULT 10,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID,
    email VARCHAR(255) NOT NULL,
    display_name VARCHAR(255) NOT NULL DEFAULT '',
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    invited_by VARCHAR(255),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email),
    CONSTRAINT chk_company_member_status CHECK (status IN ('active', 'invited', 'suspended', 'removed'))
);

CREATE INDEX IF NOT EXISTS idx_company_members_tenant ON company_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_company_members_email ON company_members(email);

CREATE TABLE IF NOT EXISTS company_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    token_hash VARCHAR(128) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    invited_by VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_company_invitation_status CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_company_invitations_tenant ON company_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_company_invitations_email ON company_invitations(email);

-- ---------------------------------------------------------------------------
-- Durable auditing, investigations and support
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_email VARCHAR(255) NOT NULL,
    actor_role VARCHAR(50) NOT NULL DEFAULT 'admin',
    action VARCHAR(120) NOT NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'general',
    resource_type VARCHAR(80) NOT NULL DEFAULT '',
    resource_id VARCHAR(255),
    tenant_id UUID,
    ip_address INET,
    user_agent TEXT,
    details JSONB NOT NULL DEFAULT '{}',
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_tenant ON platform_audit_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_actor ON platform_audit_logs(actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_audit_category ON platform_audit_logs(category, created_at DESC);

CREATE TABLE IF NOT EXISTS investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    case_number VARCHAR(40) NOT NULL UNIQUE,
    title TEXT NOT NULL,
    investigation_type VARCHAR(60) NOT NULL DEFAULT 'abuse',
    severity VARCHAR(20) NOT NULL DEFAULT 'medium',
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    priority VARCHAR(10) NOT NULL DEFAULT 'P3',
    tenant_id UUID,
    tenant_name VARCHAR(255),
    reporter_email VARCHAR(255),
    assignee_email VARCHAR(255),
    summary TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    evidence JSONB NOT NULL DEFAULT '[]',
    tags TEXT[] NOT NULL DEFAULT '{}',
    sla_due_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL DEFAULT 'system',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_investigation_severity CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    CONSTRAINT chk_investigation_status CHECK (status IN ('open', 'investigating', 'contained', 'resolved', 'closed')),
    CONSTRAINT chk_investigation_priority CHECK (priority IN ('P1', 'P2', 'P3', 'P4'))
);

CREATE INDEX IF NOT EXISTS idx_investigations_status ON investigations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_tenant ON investigations(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investigations_assignee ON investigations(assignee_email, status);
CREATE INDEX IF NOT EXISTS idx_investigations_severity ON investigations(severity, created_at DESC);

CREATE TABLE IF NOT EXISTS investigation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    actor_email VARCHAR(255) NOT NULL,
    kind VARCHAR(40) NOT NULL DEFAULT 'note',
    message TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investigation_events_case ON investigation_events(investigation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    subject TEXT NOT NULL,
    category VARCHAR(60) NOT NULL DEFAULT 'general',
    priority VARCHAR(10) NOT NULL DEFAULT 'P3',
    status VARCHAR(30) NOT NULL DEFAULT 'open',
    requester_email VARCHAR(255) NOT NULL,
    assignee_email VARCHAR(255),
    last_message TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT chk_support_status CHECK (status IN ('open', 'pending', 'resolved', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant ON support_tickets(tenant_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- API keys, invoices, security events and announcements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS company_api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    key_prefix VARCHAR(24) NOT NULL,
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL,
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_api_keys_tenant ON company_api_keys(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS company_invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    invoice_number VARCHAR(60) NOT NULL UNIQUE,
    plan VARCHAR(50) NOT NULL,
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    amount_paise BIGINT NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'INR',
    status VARCHAR(30) NOT NULL DEFAULT 'paid',
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    gateway VARCHAR(60) NOT NULL DEFAULT 'manual',
    payment_ref VARCHAR(255),
    line_items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_invoice_status CHECK (status IN ('draft', 'open', 'paid', 'void', 'refunded'))
);

CREATE INDEX IF NOT EXISTS idx_company_invoices_tenant ON company_invoices(tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_invoices_status ON company_invoices(status, issued_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_invoices_payment
    ON company_invoices(gateway, payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    user_id UUID,
    event_type VARCHAR(80) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    ip_address INET,
    user_agent TEXT,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_events_tenant ON security_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity, created_at DESC);

CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    audience VARCHAR(30) NOT NULL DEFAULT 'all',
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    published_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_announcement_status CHECK (status IN ('draft', 'published', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status, published_at DESC);

CREATE TABLE IF NOT EXISTS feature_flags (
    key VARCHAR(120) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    rollout_percent INTEGER NOT NULL DEFAULT 100,
    audience JSONB NOT NULL DEFAULT '{}',
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO feature_flags (key, name, description, enabled) VALUES
    ('company.api_keys', 'Company API Keys', 'Allow companies to create scoped API keys.', TRUE),
    ('company.investigations', 'Company Security Cases', 'Show company-facing security case summaries.', TRUE),
    ('platform.investigations', 'Platform Investigations', 'Enable the investigation management module.', TRUE),
    ('platform.billing_console', 'Billing Console', 'Enable revenue and invoice management.', TRUE),
    ('platform.announcements', 'Platform Announcements', 'Enable platform-wide announcements.', TRUE),
    ('platform.feature_flags', 'Feature Flag Console', 'Enable runtime feature flag management.', TRUE)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_settings (
    key VARCHAR(120) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platform_settings (key, value) VALUES
    ('platform.identity', '{"name":"VelisMail","legalName":"VelisMail Technologies","supportEmail":"support@velismail.online","website":"https://velismail.online"}'),
    ('billing.defaults', '{"currency":"INR","defaultPlan":"Free","gracePeriodDays":7,"taxPercent":18}'),
    ('security.policy', '{"sessionTimeoutMinutes":30,"mfaRequired":false,"passwordMinLength":12,"maxFailedLogins":5,"ipAllowlistEnabled":false}'),
    ('operations.limits', '{"free":5,"starter":25,"business":200,"enterprise":1000}')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Daily usage rollups (real aggregates, written by the gateway)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_usage_daily (
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    emails_sent INTEGER NOT NULL DEFAULT 0,
    emails_received INTEGER NOT NULL DEFAULT 0,
    api_requests INTEGER NOT NULL DEFAULT 0,
    storage_bytes BIGINT NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    queue_depth INTEGER NOT NULL DEFAULT 0,
    bounces INTEGER NOT NULL DEFAULT 0,
    spam_blocked INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms INTEGER NOT NULL DEFAULT 0,
    error_rate NUMERIC(6, 3) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, day)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_day ON tenant_usage_daily(day DESC);

-- Gateway-wide daily traffic counters. Written by the gateway middleware so the
-- control plane can show real request volume, error rate and latency history.
CREATE TABLE IF NOT EXISTS platform_traffic_daily (
    day DATE PRIMARY KEY,
    requests BIGINT NOT NULL DEFAULT 0,
    errors BIGINT NOT NULL DEFAULT 0,
    rate_limited BIGINT NOT NULL DEFAULT 0,
    overloads BIGINT NOT NULL DEFAULT 0,
    total_latency_us BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_traffic_day ON platform_traffic_daily(day DESC);

-- ---------------------------------------------------------------------------
-- Backfill: every existing user domain becomes a real tenant with membership
-- and a profile. This removes the old "unaffiliated account" state so company
-- administration is backed by real ownership.
-- ---------------------------------------------------------------------------

WITH unassigned AS (
    SELECT
        LOWER(SPLIT_PART(u.email, '@', 2)) AS domain,
        MIN(u.email) AS owner_email,
        COUNT(*) AS user_count
    FROM users u
    WHERE u.email LIKE '%@%'
      AND (u.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = u.tenant_id))
    GROUP BY 1
    HAVING COUNT(*) > 0
), inserted AS (
    INSERT INTO tenants (organization_name, organization_email, plan_tier, status, settings, limits)
    SELECT
        domain,
        owner_email,
        'free',
        'active',
        jsonb_build_object('domain', domain, 'backfilled', TRUE),
        '{}'::jsonb
    FROM unassigned
    ON CONFLICT (organization_email) DO NOTHING
    RETURNING id, organization_email
)
INSERT INTO tenant_profiles (tenant_id, slug, legal_name, billing_email, technical_email, seat_limit)
SELECT
    t.id,
    LOWER(REGEXP_REPLACE(SPLIT_PART(t.organization_email, '@', 2), '[^a-z0-9]+', '-', 'g')),
    t.organization_name,
    t.organization_email,
    t.organization_email,
    10
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM tenant_profiles p WHERE p.tenant_id = t.id)
ON CONFLICT (tenant_id) DO NOTHING;

UPDATE users u
SET tenant_id = t.id
FROM tenants t
WHERE (u.tenant_id IS NULL OR NOT EXISTS (SELECT 1 FROM tenants x WHERE x.id = u.tenant_id))
  AND LOWER(SPLIT_PART(u.email, '@', 2)) = LOWER(SPLIT_PART(t.organization_email, '@', 2))
  AND u.email LIKE '%@%';

INSERT INTO company_members (tenant_id, user_id, email, display_name, role, status, joined_at, last_active_at)
SELECT
    u.tenant_id,
    u.id,
    u.email,
    u.display_name,
    CASE
        WHEN u.settings->>'role' IN ('owner', 'admin', 'member', 'viewer') THEN u.settings->>'role'
        ELSE 'member'
    END,
    CASE WHEN u.status = 'active' THEN 'active' ELSE 'suspended' END,
    u.created_at,
    u.last_login
FROM users u
WHERE u.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, email) DO NOTHING;

-- Every existing workspace needs at least one durable owner. Promote the
-- earliest active administrator (or earliest member) when the legacy data did
-- not distinguish an owner.
UPDATE company_members cm
SET role = 'owner', updated_at = NOW()
WHERE cm.id IN (
    SELECT DISTINCT ON (candidate.tenant_id) candidate.id
    FROM company_members candidate
    WHERE candidate.status = 'active'
      AND NOT EXISTS (
          SELECT 1 FROM company_members owner
          WHERE owner.tenant_id = candidate.tenant_id
            AND owner.role = 'owner'
            AND owner.status = 'active'
      )
    ORDER BY candidate.tenant_id,
             CASE candidate.role WHEN 'admin' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
             candidate.joined_at ASC,
             candidate.created_at ASC
);

UPDATE tenant_users tu
SET role = 'owner', updated_at = NOW()
FROM company_members cm
WHERE cm.tenant_id = tu.tenant_id
  AND cm.user_id = tu.user_id
  AND cm.role = 'owner';

-- The legacy UI reads users.settings.role, so keep it aligned with the
-- normalized membership role. Owners are represented as "admin" in settings
-- because that is the highest role the existing client understands.
UPDATE users u
SET settings = jsonb_set(COALESCE(u.settings, '{}'::jsonb), '{role}', '"admin"'::jsonb),
    updated_at = NOW()
FROM company_members cm
WHERE cm.user_id = u.id
  AND cm.tenant_id = u.tenant_id
  AND cm.status = 'active'
  AND cm.role IN ('owner', 'admin')
  AND COALESCE(u.settings->>'role', '') NOT IN ('admin', 'owner');

INSERT INTO tenant_users (tenant_id, user_id, role)
SELECT u.tenant_id, u.id,
       CASE
           WHEN u.settings->>'role' IN ('owner', 'admin', 'member', 'viewer') THEN u.settings->>'role'
           ELSE 'member'
       END
FROM users u
WHERE u.tenant_id IS NOT NULL
ON CONFLICT (tenant_id, user_id) DO NOTHING;

-- Accelerate company-scoped analytics.
CREATE INDEX IF NOT EXISTS idx_users_tenant_created ON users(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_queue_created ON delivery_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_queue_message ON delivery_queue(message_id);
