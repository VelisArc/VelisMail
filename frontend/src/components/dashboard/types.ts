import type {
  BusinessAuditEntry,
  BusinessGroup,
  BusinessMailbox,
  BusinessTeamMember,
  BusinessTemplate,
  ConnectionUsage,
  PlatformAdminUserRecord,
  User,
  Signature,
  Contact,
  ActiveSession,
} from '../../api/client';
import type { WorkspaceInvitation } from '../../api/company';
import type { BizTab } from './constants';

export interface DashboardState {
  activeBizTab: BizTab;
  setActiveBizTab: (tab: BizTab) => void;
  activeFolder: string;
  setActiveFolder: (f: string) => void;
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
  composeReplyQuote: string;
  setComposeReplyQuote: (q: string) => void;
  sending: boolean;
  setSending: (s: boolean) => void;
  selectedFromAddress: string;
  setSelectedFromAddress: (a: string) => void;
  activeMailboxAddress: string;
  setActiveMailboxAddress: (a: string) => void;
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
  adminPage: number;
  setAdminPage: (p: number) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (o: boolean) => void;
  user: User | null;
  activeDomainName: string;
  hasRoleAccess: (tab: BizTab) => boolean;
  canAccessPlatformAdmin: boolean;
  refreshDomains: () => void;
  refreshTeam: () => void;
  refreshQueue: () => void;
  refreshAudit: () => void;
  refreshTemplates: () => void;
  refreshMailboxes: () => void | Promise<void>;
  refreshGroups: () => void;
  removeTeamMember: (email: string) => Promise<void>;
  refreshConnectionUsage: () => void;
  refreshAdminUsers: () => void | Promise<void>;
  handleLogout: () => void;
  handleSendEmail: (to?: string, subject?: string, body?: string, attachments?: File[], scheduledAt?: string) => void;
  openComposeWith: (to?: string, subject?: string, body?: string) => void;
  copyToClipboard: (text: string) => Promise<boolean>;
  inviteOpen: boolean;
  setInviteOpen: (o: boolean) => void;
  inviteName: string;
  setInviteName: (n: string) => void;
  inviteEmail: string;
  setInviteEmail: (e: string) => void;
  inviteRole: 'admin' | 'member' | 'viewer';
  setInviteRole: (r: 'admin' | 'member' | 'viewer') => void;
  inviteSending: boolean;
  setInviteSending: (s: boolean) => void;
  inviteExpiresHours: number;
  setInviteExpiresHours: (h: number) => void;
  issuedInvite: WorkspaceInvitation | null;
  setIssuedInvite: (i: WorkspaceInvitation | null) => void;
  templateEditorOpen: boolean;
  setTemplateEditorOpen: (o: boolean) => void;
  templateName: string;
  setTemplateName: (n: string) => void;
  templateSubject: string;
  setTemplateSubject: (s: string) => void;
  templateBody: string;
  setTemplateBody: (b: string) => void;
  templateSaving: boolean;
  setTemplateSaving: (s: boolean) => void;
  previewTemplate: BusinessTemplate | null;
  setPreviewTemplate: (t: BusinessTemplate | null) => void;
  selectedAdminUser: PlatformAdminUserRecord | null;
  setSelectedAdminUser: (u: PlatformAdminUserRecord | null) => void;
  adminStatusConfirm: { record: PlatformAdminUserRecord; status: string; step: number } | null;
  setAdminStatusConfirm: (c: { record: PlatformAdminUserRecord; status: string; step: number } | null) => void;
  domainDetails: DomainRecord | null;
  setDomainDetails: (d: DomainRecord | null) => void;
  mailboxDetails: BusinessMailbox | null;
  setMailboxDetails: (m: BusinessMailbox | null) => void;
  groupDetails: BusinessGroup | null;
  setGroupDetails: (g: BusinessGroup | null) => void;
  domainVerifyOpen: boolean;
  setDomainVerifyOpen: (o: boolean) => void;
  domainVerifySteps: DomainHealth[];
  setDomainVerifySteps: (s: DomainHealth[]) => void;
  domainVerifyProviderRecords: Record<string, string>[];
  setDomainVerifyProviderRecords: (r: Record<string, string>[]) => void;
  verifyingDomainId: string;
  setVerifyingDomainId: (id: string) => void;
  domainVerifyBusy: boolean;
  setDomainVerifyBusy: (busy: boolean) => void;
  mailboxLocalPart: string;
  setMailboxLocalPart: (p: string) => void;
  mailboxDisplayName: string;
  setMailboxDisplayName: (n: string) => void;
  mailboxKind: BusinessMailbox['kind'];
  setMailboxKind: (k: BusinessMailbox['kind']) => void;
  groupName: string;
  setGroupName: (n: string) => void;
  groupLocalPart: string;
  setGroupLocalPart: (p: string) => void;
  groupMembers: string;
  setGroupMembers: (m: string) => void;
  copiedField: string | null;
  setCopiedField: (f: string | null) => void;

  signatures: Signature[];
  setSignatures: (s: Signature[]) => void;
  refreshSignatures: () => void;
  contacts: Contact[];
  setContacts: (c: Contact[]) => void;
  refreshContacts: () => void;
  contactsSearch: string;
  setContactsSearch: (s: string) => void;
  activeSessions: ActiveSession[];
  setActiveSessions: (s: ActiveSession[]) => void;
  refreshSessions: () => void;
  signatureEditorOpen: boolean;
  setSignatureEditorOpen: (o: boolean) => void;
  signatureEditorName: string;
  setSignatureEditorName: (n: string) => void;
  signatureEditorContent: string;
  setSignatureEditorContent: (c: string) => void;
  editingSignatureId: string | null;
  setEditingSignatureId: (id: string | null) => void;
  contactEditorOpen: boolean;
  setContactEditorOpen: (o: boolean) => void;
  contactEditorName: string;
  setContactEditorName: (n: string) => void;
  contactEditorEmail: string;
  setContactEditorEmail: (e: string) => void;
  contactEditorPhone: string;
  setContactEditorPhone: (p: string) => void;
  contactEditorCompany: string;
  setContactEditorCompany: (c: string) => void;
  editingContactId: string | null;
  setEditingContactId: (id: string | null) => void;
  profilePopupOpen?: boolean;
  setProfilePopupOpen?: (open: boolean) => void;
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
