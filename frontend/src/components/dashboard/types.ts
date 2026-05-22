import type { LucideIcon } from 'lucide-react';
import type {
  BusinessAuditEntry,
  BusinessGroup,
  BusinessMailbox,
  BusinessTeamMember,
  BusinessTemplate,
  ConnectionUsage,
  Email,
  PlatformAdminUserRecord,
  User,
} from '../../api/client';

export type BizTab = 'mail' | 'domains' | 'mailboxes' | 'groups' | 'team' | 'queue' | 'analytics' | 'audit' | 'templates' | 'settings' | 'billing' | 'admin';

export type BizFolder = { id: string; label: string; icon: LucideIcon; badge?: string };

export interface DashboardState {
  activeBizTab: BizTab;
  setActiveBizTab: (tab: BizTab) => void;
  activeFolder: string;
  setActiveFolder: (f: string) => void;
  selectedEmail: Email | null;
  setSelectedEmail: (e: Email | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  composeOpen: boolean;
  setComposeOpen: (o: boolean) => void;
  composeTo: string;
  setComposeTo: (t: string) => void;
  composeSubject: string;
  setComposeSubject: (s: string) => void;
  composeBody: string;
  setComposeBody: (b: string) => void;
  sending: boolean;
  setSending: (s: boolean) => void;
  selectedFromAddress: string;
  setSelectedFromAddress: (a: string) => void;
  annual: boolean;
  setAnnual: (a: boolean) => void;
  loadingPayment: string | null;
  setLoadingPayment: (p: string | null) => void;
  toast: { msg: string; type: 'success' | 'error' } | null;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  showLogoutConfirm: boolean;
  setShowLogoutConfirm: (s: boolean) => void;
  confirmRevokeId: string | null;
  setConfirmRevokeId: (id: string | null) => void;
  pendingRoleChange: { id: string; role: string; step: number } | null;
  setPendingRoleChange: (r: { id: string; role: string; step: number } | null) => void;
  confirmAction: { title: string; message: string; onConfirm: () => void } | null;
  setConfirmAction: (a: { title: string; message: string; onConfirm: () => void } | null) => void;
  domainsList: DomainRecord[];
  setDomainsList: (d: DomainRecord[]) => void;
  activeDomain: string;
  setActiveDomain: (d: string) => void;
  domainMailboxes: BusinessMailbox[];
  setDomainMailboxes: (m: BusinessMailbox[]) => void;
  domainGroups: BusinessGroup[];
  setDomainGroups: (g: BusinessGroup[]) => void;
  teamMembers: BusinessTeamMember[];
  setTeamMembers: (t: BusinessTeamMember[]) => void;
  mailQueue: MailQueueItem[];
  setMailQueue: (q: MailQueueItem[]) => void;
  auditLog: BusinessAuditEntry[];
  setAuditLog: (a: BusinessAuditEntry[]) => void;
  templates: BusinessTemplate[];
  setTemplates: (t: BusinessTemplate[]) => void;
  connectionUsage: ConnectionUsage[];
  setConnectionUsage: (c: ConnectionUsage[]) => void;
  adminUsers: PlatformAdminUserRecord[];
  setAdminUsers: (u: PlatformAdminUserRecord[]) => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (s: 'asc' | 'desc') => void;
  viewMode: 'list' | 'grid';
  setViewMode: (v: 'list' | 'grid') => void;
  selectedEmails: Set<string>;
  setSelectedEmails: (s: Set<string>) => void;
  mailStatusFilter: string;
  setMailStatusFilter: (f: string) => void;
  notificationEnabled: boolean;
  setNotificationEnabled: (n: boolean) => void;
  soundEnabled: boolean;
  setSoundEnabled: (s: boolean) => void;
  showQueueFilters: boolean;
  setShowQueueFilters: (s: boolean) => void;
  queueStatusFilter: string;
  setQueueStatusFilter: (f: string) => void;
  templateSearch: string;
  setTemplateSearch: (s: string) => void;
  showAddDomain: boolean;
  setShowAddDomain: (s: boolean) => void;
  newDomainInput: string;
  setNewDomainInput: (s: string) => void;
  teamFilter: string;
  setTeamFilter: (f: string) => void;
  auditFilter: string;
  setAuditFilter: (f: string) => void;
  adminSearch: string;
  setAdminSearch: (s: string) => void;
  adminPlanFilter: string;
  setAdminPlanFilter: (f: string) => void;
  adminStatusFilter: string;
  setAdminStatusFilter: (f: string) => void;
  adminRiskFilter: string;
  setAdminRiskFilter: (f: string) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (o: boolean) => void;
  user: User;
  themeMode: string;
  setThemeMode: (t: string) => void;
  toggleTheme: () => void;
  activeDomainName: string;
  hasRoleAccess: (tab: BizTab) => boolean;
  canAccessPlatformAdmin: boolean;
  refreshDomains: () => void;
  refreshTeam: () => void;
  refreshQueue: () => void;
  refreshAudit: () => void;
  refreshTemplates: () => void;
  refreshMailboxes: () => void;
  refreshGroups: () => void;
  refreshConnectionUsage: () => void;
  handleLogout: () => void;
  handleSendEmail: () => void;
  openComposeWith: (to?: string, subject?: string, body?: string) => void;
  copyToClipboard: (text: string) => void;
}

export interface DomainRecord {
  id: string;
  domain: string;
  status: string;
  reputation: number;
  mailCount: number;
  addedAt: string;
  health: DomainHealth[];
  providerDnsRecords?: Record<string, string>[];
  mxVerified?: boolean;
  spfVerified?: boolean;
  dkimVerified?: boolean;
  dmarcVerified?: boolean;
  checks: { key: string; status: string; label: string; detail: string }[];
}

export interface DomainHealth {
  key: string;
  label: string;
  status: 'verified' | 'pending' | 'failed' | 'checking';
  detail: string;
  lastCheck: string;
}

export interface MailQueueItem {
  id: string;
  to: string;
  subject: string;
  status: string;
  queuedAt: string;
  scheduledAt?: string;
  retries: number;
  error?: string;
  from?: string;
}
