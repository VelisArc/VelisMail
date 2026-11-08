-- VelisMail D1 schema (SQLite dialect, ported from the PostgreSQL migrations).
-- Every table is created idempotently so the file can be re-run safely.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounts and tenants
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'owner',
  plan TEXT NOT NULL DEFAULT 'Free',
  status TEXT NOT NULL DEFAULT 'active',
  tenant_id TEXT,
  recovery_email TEXT,
  recovery_email_verified INTEGER NOT NULL DEFAULT 0,
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  phone_country_code TEXT,
  phone_number TEXT,
  phone_e164 TEXT,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  profile_image_url TEXT,
  email_logo_url TEXT,
  append_email_logo INTEGER NOT NULL DEFAULT 0,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  firebase_uid TEXT,
  last_login_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  plan TEXT NOT NULL DEFAULT 'Free',
  status TEXT NOT NULL DEFAULT 'active',
  owner_user_id TEXT,
  seat_limit INTEGER NOT NULL DEFAULT 5,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_members (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'active',
  invited_by TEXT,
  joined_at TEXT,
  last_active_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON tenant_members(user_id);

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  device_id TEXT,
  ip TEXT,
  user_agent TEXT,
  mfa_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_active TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL,
  challenge_token TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_otp_challenge ON otp_challenges(challenge_token);

CREATE TABLE IF NOT EXISTS otp_daily (
  identifier TEXT NOT NULL COLLATE NOCASE,
  day TEXT NOT NULL,
  purpose TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identifier, day, purpose)
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL COLLATE NOCASE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_verify_token ON verification_tokens(token_hash);

CREATE TABLE IF NOT EXISTS team_invites (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  scope TEXT NOT NULL DEFAULT 'workspace',
  tenant_id TEXT,
  workspace TEXT NOT NULL DEFAULT '{}',
  issuer_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  accepted_at TEXT
);

-- ---------------------------------------------------------------------------
-- Workspace: domains, mailboxes, groups
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'pending',
  verification_token TEXT NOT NULL,
  dns_records TEXT NOT NULL DEFAULT '[]',
  checks TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  primary_domain INTEGER NOT NULL DEFAULT 0,
  added_at TEXT NOT NULL,
  last_checked_at TEXT,
  verified_at TEXT,
  UNIQUE (tenant_id, domain)
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  address TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'mailbox',
  aliases TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'custom',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (tenant_id, address)
);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(tenant_id, domain);

CREATE TABLE IF NOT EXISTS mail_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL COLLATE NOCASE,
  members TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Mail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  folder TEXT NOT NULL DEFAULT 'inbox',
  direction TEXT NOT NULL DEFAULT 'inbound',
  from_addr TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  to_addrs TEXT NOT NULL DEFAULT '[]',
  cc_addrs TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  html_body TEXT,
  email_date TEXT NOT NULL,
  unread INTEGER NOT NULL DEFAULT 1,
  starred INTEGER NOT NULL DEFAULT 0,
  labels TEXT NOT NULL DEFAULT '[]',
  has_attachment INTEGER NOT NULL DEFAULT 0,
  message_id TEXT,
  thread_id TEXT,
  in_reply_to TEXT,
  scheduled_at TEXT,
  client_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_client ON emails(tenant_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_tenant_folder ON emails(tenant_id, folder, email_date);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);

CREATE TABLE IF NOT EXISTS mail_queue (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  from_address TEXT NOT NULL,
  recipients TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  queued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_queue_tenant ON mail_queue(tenant_id, status);

CREATE TABLE IF NOT EXISTS delivery_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  email_id TEXT,
  provider TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbound_webhooks (
  tenant_id TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  provider TEXT NOT NULL DEFAULT 'resend',
  secret TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, domain)
);

-- ---------------------------------------------------------------------------
-- Workspace extras
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT,
  company TEXT,
  group_name TEXT NOT NULL DEFAULT 'General',
  notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signatures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  actor TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT 'member',
  action TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'workspace',
  resource_type TEXT NOT NULL DEFAULT 'workspace',
  resource_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_entries(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL DEFAULT '',
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Billing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT,
  user_id TEXT,
  email TEXT,
  plan TEXT NOT NULL,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  amount_paise INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'created',
  gateway TEXT NOT NULL DEFAULT 'razorpay',
  order_id TEXT,
  payment_ref TEXT,
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- Platform control plane
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform_audit (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'platform',
  resource_type TEXT NOT NULL DEFAULT '',
  resource_id TEXT,
  tenant_id TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'info',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_audit_date ON platform_audit(created_at);

CREATE TABLE IF NOT EXISTS investigations (
  id TEXT PRIMARY KEY,
  case_number TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'security',
  severity TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'P3',
  tenant_id TEXT,
  tenant_name TEXT,
  reporter_email TEXT,
  assignee_email TEXT,
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  evidence TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  sla_due_at TEXT,
  resolved_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS investigation_events (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'note',
  message TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0,
  rollout_percent INTEGER NOT NULL DEFAULT 0,
  audience TEXT NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'info',
  audience TEXT NOT NULL DEFAULT 'all',
  status TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open',
  requester TEXT NOT NULL DEFAULT '',
  assignee TEXT,
  last_message TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 1,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  case_number TEXT NOT NULL,
  user_id TEXT,
  email TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  escalated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT 'null',
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  tenant_id TEXT NOT NULL,
  day TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  received INTEGER NOT NULL DEFAULT 0,
  api_requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  queue_depth INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  spam_blocked INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);

-- ---------------------------------------------------------------------------
-- Seed platform settings
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO platform_settings (key, value, updated_at)
VALUES ('platform', '{"signupEnabled":true,"maintenanceMode":false,"supportEmail":"support@velismail.online"}', datetime('now'));

INSERT OR IGNORE INTO feature_flags (key, name, description, enabled, rollout_percent, audience, updated_at)
VALUES
  ('custom_domains', 'Custom domains', 'Allow workspaces to connect their own sending domain.', 1, 100, '{}', datetime('now')),
  ('bulk_sending', 'Bulk sending', 'Enable high-volume queue sending.', 1, 100, '{}', datetime('now'));
