-- Indexes for the hot authorization and inbox queries. They are additive and
-- idempotent so a rolling deploy can apply them without a table rewrite.

CREATE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_company_members_tenant_status
    ON company_members (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_custom_domains_tenant_status
    ON custom_domains (tenant_id, verification_status);

CREATE INDEX IF NOT EXISTS idx_feedback_user_email
    ON feedback (LOWER(user_email));

-- Members read only their own feedback history, which filters by tenant and
-- user id rather than by the stored email.
CREATE INDEX IF NOT EXISTS idx_feedback_tenant_user
    ON feedback (tenant_id, user_id);
