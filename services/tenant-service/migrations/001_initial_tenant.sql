-- Initial tenant schema with Row-Level Security (RLS)
-- Migration: 001_initial_tenant

-- Enable Row-Level Security
ALTER DATABASE velismail_tenant SET row_security = on;

-- Create tenant table
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_name VARCHAR(255) NOT NULL,
    organization_email VARCHAR(255) NOT NULL UNIQUE,
    plan_tier VARCHAR(50) NOT NULL DEFAULT 'starter',
    status VARCHAR(50) NOT NULL DEFAULT 'pending_verification',
    settings JSONB NOT NULL DEFAULT '{}',
    limits JSONB NOT NULL DEFAULT '{}',
    billing_info JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- Create tenant users table
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

-- Create custom domains table
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

-- Create resource usage table
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

-- Create audit logs table
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

-- Create indexes for performance
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_tenants_organization_email ON tenants(organization_email);
CREATE INDEX idx_tenant_users_tenant_id ON tenant_users(tenant_id);
CREATE INDEX idx_tenant_users_user_id ON tenant_users(user_id);
CREATE INDEX idx_custom_domains_tenant_id ON custom_domains(tenant_id);
CREATE INDEX idx_custom_domains_verification_status ON custom_domains(verification_status);
CREATE INDEX idx_resource_usage_tenant_id ON resource_usage(tenant_id);
CREATE INDEX idx_resource_usage_period ON resource_usage(period_start, period_end);
CREATE INDEX idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tenant_users_updated_at BEFORE UPDATE ON tenant_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create tenant context function for RLS
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id UUID)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('velismail.tenant_id', tenant_id::text, false);
END;
$$ LANGUAGE plpgsql;

-- Create function to get current tenant ID
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
DECLARE
    tenant_id_text TEXT;
BEGIN
    tenant_id_text := current_setting('velismail.tenant_id', true);
    IF tenant_id_text IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN tenant_id_text::UUID;
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS on all tables
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tenants table
-- Only system admins can see all tenants
CREATE POLICY tenants_admin_all ON tenants
    FOR ALL
    USING (current_setting('velismail.is_admin', true) = 'true');

-- Create RLS policies for tenant_users table
-- Users can only see their own tenant associations
CREATE POLICY tenant_users_tenant_access ON tenant_users
    FOR ALL
    USING (tenant_id = current_tenant_id());

-- Create RLS policies for custom_domains table
-- Users can only see domains for their tenant
CREATE POLICY custom_domains_tenant_access ON custom_domains
    FOR ALL
    USING (tenant_id = current_tenant_id());

-- Create RLS policies for resource_usage table
-- Users can only see usage for their tenant
CREATE POLICY resource_usage_tenant_access ON resource_usage
    FOR ALL
    USING (tenant_id = current_tenant_id());

-- Create RLS policies for audit_logs table
-- Users can only see audit logs for their tenant
CREATE POLICY audit_logs_tenant_access ON audit_logs
    FOR ALL
    USING (tenant_id = current_tenant_id());

-- Create admin role for system administration
CREATE ROLE velismail_admin;
GRANT ALL ON ALL TABLES IN SCHEMA public TO velismail_admin;
GRANT USAGE ON SCHEMA public TO velismail_admin;

-- Create tenant role for regular tenant access
CREATE ROLE velismail_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_users TO velismail_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON custom_domains TO velismail_tenant;
GRANT SELECT ON resource_usage TO velismail_tenant;
GRANT SELECT ON audit_logs TO velismail_tenant;

-- Create function to check if user is admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN current_setting('velismail.is_admin', true) = 'true';
END;
$$ LANGUAGE plpgsql;