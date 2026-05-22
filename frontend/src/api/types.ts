export type User = {
  id: string;
  tenantId?: string;
  email: string;
  displayName: string;
  plan: string;
  status?: 'active' | 'suspended' | 'deactivated';
  suspendedAt?: string;
  suspensionReason?: string;
  planStartedAt?: string;
  paidPlanPurchasedAt?: string;
  paidPlanExpiresAt?: string;
  subscriptionStatus?: 'active' | 'expired' | 'canceled' | 'past_due';
  billingCycle?: 'monthly' | 'annual';
  lastPlanChangeAt?: string;
  accountType: 'business';
  customDomain?: string;
  mailProvider?: string;
  mailProviderEndpoint?: string;
  apiKey?: string;
  isSetupComplete: boolean;
  customDbUrl?: string;
  createdAt: string;
  recoveryEmail?: string;
  recoveryEmailVerified?: boolean;
  pendingRecoveryEmail?: string;
  businessMailboxAddress?: string;
  profileImageUrl?: string;
  role?: 'admin' | 'member' | 'viewer';
  isPlatformAdmin?: boolean;
  isBusinessSetupComplete?: boolean;
  businessDomain?: string;
  businessDbUrl?: string;
  businessApiKey?: string;
  businessMailProvider?: string;
  businessMailProviderEndpoint?: string;
  businessMailWebhookSecret?: string;
  businessDomainVerified?: boolean;
  teamAccessRole?: 'admin' | 'member' | 'viewer';
  teamAccessInviteId?: string;
  teamAccessOwnerEmail?: string;
  dkimStatus?: 'pending' | 'verified' | 'failed';
  spfStatus?: 'pending' | 'verified' | 'failed';
  dmarcStatus?: 'pending' | 'verified' | 'failed';
  businessProfile?: {
    domain?: string;
    dbUrl?: string;
    apiKey?: string;
    mailProvider?: string;
    mailProviderEndpoint?: string;
    mailWebhookSecret?: string;
    verified?: boolean;
    dkimStatus?: 'pending' | 'verified' | 'failed';
    spfStatus?: 'pending' | 'verified' | 'failed';
    dmarcStatus?: 'pending' | 'verified' | 'failed';
  };
};

export type Contact = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  group: string;
  notes?: string;
  favorite: boolean;
  createdAt: string;
};

export type Signature = {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
};

export type DomainCheckStatus = 'pending' | 'verified' | 'failed';

export type DnsRecord = {
  type: 'TXT' | 'MX' | 'CNAME';
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
};

export type ProviderDnsRecordInput = {
  recordType?: string;
  record_type?: string;
  type?: string;
  name?: string;
  host?: string;
  value?: string;
  content?: string;
  data?: string;
  ttl?: number | null;
  priority?: number | null;
};

export type DomainCheck = {
  key: 'txt' | 'mx' | 'spf' | 'dkim' | 'dmarc';
  label: string;
  status: DomainCheckStatus;
  expected: string;
  actual?: string;
};

export type CustomDomain = {
  id: string;
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  verificationToken: string;
  dnsRecords: DnsRecord[];
  checks: DomainCheck[];
  addedAt: string;
  lastCheckedAt?: string;
  verifiedAt?: string;
};

export type BusinessMailbox = {
  id: string;
  domain: string;
  address: string;
  displayName: string;
  kind: 'primary' | 'mailbox' | 'alias' | 'shared';
  aliases: string[];
  active: boolean;
  source: 'system' | 'custom';
  createdAt: string;
  lastUsedAt?: string;
};

export type BusinessGroup = {
  id: string;
  domain: string;
  name: string;
  address: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
};

export type BusinessTeamMember = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  status?: 'pending' | 'active' | 'expired' | 'revoked';
  inviteToken?: string;
  inviteExpiresAt?: string | null;
  apiKey?: string;
  addedAt: string;
  lastActive: string;
};

export type TeamAccessInvite = {
  id: string;
  token: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string | null;
  acceptedAt?: string;
  issuerEmail: string;
  workspace: Pick<User,
    'tenantId' |
    'displayName' |
    'businessDomain' |
    'businessDbUrl' |
    'businessApiKey' |
    'businessMailProvider' |
    'businessMailProviderEndpoint' |
    'businessMailWebhookSecret' |
    'businessMailboxAddress' |
    'businessDomainVerified' |
    'businessProfile' |
    'isBusinessSetupComplete'
  >;
};

export type BusinessTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  lastUsed?: string;
  usageCount: number;
};

export type BusinessMailQueueItem = {
  id: string;
  domain: string;
  fromAddress: string;
  to: string;
  recipients: string[];
  subject: string;
  body: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'deferred';
  queuedAt: string;
  updatedAt: string;
  retryCount: number;
  error?: string;
  scheduledAt?: string;
};

export type BusinessAuditEntry = {
  id: string;
  action: string;
  actor: string;
  target: string;
  timestamp: string;
  severity: 'info' | 'warn' | 'critical';
};

export type ActiveSession = {
  id: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
  lastActive: string;
  mfaVerified: boolean;
  current: boolean;
};

export type ConnectionUsage = {
  id: string;
  type: 'database' | 'mail-provider';
  fingerprint: string;
  label: string;
  maskedValue: string;
  provider?: string;
  ownerAccountId: string;
  ownerDisplayName: string;
  ownerEmail: string;
  accountType: 'personal' | 'business';
  domain?: string;
  mailbox?: string;
  createdAt: string;
};

export type PlatformAdminUserRecord = {
  user: User;
  status: 'active' | 'suspended' | 'deactivated';
  domain: string;
  plan: string;
  billingCycle: 'monthly' | 'annual';
  paidPlanPurchasedAt?: string;
  paidPlanExpiresAt?: string;
  planStartedAt?: string;
  lastPlanChangeAt?: string;
  createdAt: string;
  lastActiveAt?: string;
  emailCount: number;
  domainCount: number;
  mailboxCount: number;
  queueCount: number;
  templateCount: number;
  teamMemberCount: number;
  auditCount: number;
  storageEstimateBytes: number;
  risk: 'low' | 'medium' | 'high';
};

export type Email = {
  id: string;
  from: string;
  fromName: string;
  to: string[];
  subject: string;
  body: string;
  date: string;
  folder: string;
  unread: boolean;
  starred: boolean;
  labels: string[];
  hasAttachment: boolean;
  scheduledAt?: string;
};

export type OtpSendResponse = {
  success: boolean;
  challengeToken: string;
  expiresIn: number;
  maskedEmail: string;
  provider: string;
  messageId?: string | null;
};

export type OtpVerifyResponse = {
  success: boolean;
  verificationToken: string;
  expiresIn: number;
};

export type ApiJsonDetailedResult<T = unknown> = {
  ok: boolean;
  status: number;
  baseUrl: string;
  data: T | null;
  rawText: string;
};
