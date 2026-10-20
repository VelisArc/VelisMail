-- Migration 005: Tenant service schema
--
-- Multi-tenant organisation, membership, custom domain and usage tracking.
-- Row-Level Security policies isolate tenants using the session variable
-- `velismail.tenant_id`, which the tenant service sets via set_tenant_context().

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_name VARCHAR(255) NOT NULL,
    organization_email VARCHAR(255) NOT NULL UNIQUE,
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'free',
    status VARCHAR(50) NOT NULL DEFAULT 'pending_verification',
    settings JSONB NOT NULL DEFAULT '{}',
    limits JSONB NOT NULL DEFAULT '{}',
    billing_info JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tenant_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    permissions JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS custom_domains (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain_name VARCHAR(255) NOT NULL,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'pending',
    verification_method VARCHAR(50),
    dns_records JSONB NOT NULL DEFAULT '[]',
    mx_records JSONB NOT NULL DEFAULT '[]',
    spf_record TEXT,
    dkim_record TEXT,
    dmarc_record TEXT,
    ssl_certificate JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    UNIQUE(domain_name)
);

CREATE TABLE IF NOT EXISTS resource_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    emails_sent INTEGER NOT NULL DEFAULT 0,
    emails_received INTEGER NOT NULL DEFAULT 0,
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    api_requests INTEGER NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, period_start)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id UUID,
    details JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_organization_email ON tenants(organization_email);
CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_id ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user_id ON tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_tenant_id ON custom_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_domains_verification_status ON custom_domains(verification_status);
CREATE INDEX IF NOT EXISTS idx_resource_usage_tenant_id ON resource_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_resource_usage_period ON resource_usage(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Helper functions
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('velismail.tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
DECLARE
    tenant_id_text TEXT;
BEGIN
    tenant_id_text := current_setting('velismail.tenant_id', true);
    IF tenant_id_text IS NULL OR tenant_id_text = '' THEN
        RETURN NULL;
    END IF;
    RETURN tenant_id_text::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN current_setting('velismail.is_admin', true) = 'true';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tenants_updated_at ON tenants;
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tenant_users_updated_at ON tenant_users;
CREATE TRIGGER update_tenant_users_updated_at BEFORE UPDATE ON tenant_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row-Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_admin_all ON tenants;
CREATE POLICY tenants_admin_all ON tenants
    FOR ALL
    USING (current_setting('velismail.is_admin', true) = 'true');

DROP POLICY IF EXISTS tenant_users_tenant_access ON tenant_users;
CREATE POLICY tenant_users_tenant_access ON tenant_users
    FOR ALL
    USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS custom_domains_tenant_access ON custom_domains;
CREATE POLICY custom_domains_tenant_access ON custom_domains
    FOR ALL
    USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS resource_usage_tenant_access ON resource_usage;
CREATE POLICY resource_usage_tenant_access ON resource_usage
    FOR ALL
    USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS audit_logs_tenant_access ON audit_logs;
CREATE POLICY audit_logs_tenant_access ON audit_logs
    FOR ALL
    USING (tenant_id = current_tenant_id());
