import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { auth, businessAudit, businessGroups, businessMailboxes, businessQueue, businessTeam, businessTemplates, connections, domains, isBusinessSetupReady, mail, platformAdmin, type BusinessAuditEntry, type BusinessGroup, type BusinessMailbox, type BusinessTeamMember, type BusinessTemplate, type ConnectionUsage, type CustomDomain, type Email, type PlatformAdminUserRecord, type DomainCheck, type TeamAccessInvite } from '../api/client';
import Sidebar from '../components/dashboard/Sidebar';
import { type BizTab } from '../components/dashboard/constants';
import EmailInbox from '../components/dashboard/EmailInbox';
import { copyToClipboard, loadRazorpayCheckout, buildReplyQuote } from '../components/dashboard/utils';
import type { DashboardState, DomainRecord, DomainHealth, MailQueueItem } from '../components/dashboard/types';
import DomainsPanel from '../components/dashboard/panels/DomainsPanel';
import MailboxesPanel from '../components/dashboard/panels/MailboxesPanel';
import GroupsPanel from '../components/dashboard/panels/GroupsPanel';
import TeamPanel from '../components/dashboard/panels/TeamPanel';
import QueuePanel from '../components/dashboard/panels/QueuePanel';
import AnalyticsPanel from '../components/dashboard/panels/AnalyticsPanel';
import AuditPanel from '../components/dashboard/panels/AuditPanel';
import AdminPanel from '../components/dashboard/panels/AdminPanel';
import TemplatesPanel from '../components/dashboard/panels/TemplatesPanel';
import SettingsPanel from '../components/dashboard/panels/SettingsPanel';
import BillingPanel from '../components/dashboard/panels/BillingPanel';
import Modals from '../components/dashboard/Modals';
import { useNavigation, useSessionActions } from '../store/sessionStore';
import { useEmails } from '../hooks/useMail';
import './BusinessDashboard.css';
import './Pricing.css';

function toDomainRecord(domain: CustomDomain): DomainRecord {
  const statusFor = (key: string) => domain.checks?.find((c: DomainCheck) => c.key === key)?.status || 'pending';
  const now = new Date().toISOString();
  return {
    id: domain.id, domain: domain.domain, status: domain.status || 'active', reputation: 100,
    mailCount: 0, addedAt: domain.addedAt || now,
    health: [
      { key: 'mx', label: 'MX Record', status: statusFor('mx') as DomainHealth['status'], detail: statusFor('mx') === 'verified' ? 'Mail exchange configured' : 'Not configured', lastCheck: domain.lastCheckedAt || '' },
      { key: 'spf', label: 'SPF Record', status: statusFor('spf') as DomainHealth['status'], detail: statusFor('spf') === 'verified' ? 'Sender policy published' : 'Not published', lastCheck: domain.lastCheckedAt || '' },
      { key: 'dkim', label: 'DKIM Signature', status: statusFor('dkim') as DomainHealth['status'], detail: statusFor('dkim') === 'verified' ? 'DKIM key active' : 'Not configured', lastCheck: domain.lastCheckedAt || '' },
      { key: 'dmarc', label: 'DMARC Policy', status: statusFor('dmarc') as DomainHealth['status'], detail: statusFor('dmarc') === 'verified' ? 'DMARC policy published' : 'Not published', lastCheck: domain.lastCheckedAt || '' },
    ],
    checks: domain.checks?.map((c: DomainCheck) => ({ key: c.key, status: c.status, label: c.label, detail: c.expected })) || [],
    mxVerified: statusFor('mx') === 'verified', spfVerified: statusFor('spf') === 'verified',
    dkimVerified: statusFor('dkim') === 'verified', dmarcVerified: statusFor('dmarc') === 'verified',
  };
}

export default function BusinessDashboard() {
  const navigate = useNavigate();
  const [user] = useState(auth.getSession());
  const navigation = useNavigation();
  const { updateNavigation } = useSessionActions();

  const [activeBizTab, setActiveBizTab] = useState<BizTab>(() => (navigation?.activeTab as BizTab) || 'mail');
  const [activeFolder, setActiveFolder] = useState(navigation?.activeFolder || 'inbox');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFromAddress, setSelectedFromAddress] = useState('');
  const [annual, setAnnual] = useState(false);
  const [loadingPayment, setLoadingPayment] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ id: string; role: string; step: number } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  const [domainsList, setDomainsList] = useState<DomainRecord[]>(() => domains.getAll().map(toDomainRecord));
  const [activeDomain, setActiveDomain] = useState('');
  const activeDomainName = activeDomain || domainsList[0]?.domain || '';
  const [domainMailboxes, setDomainMailboxes] = useState<BusinessMailbox[]>([]);
  const [domainGroups, setDomainGroups] = useState<BusinessGroup[]>([]);
  const [teamMembers, setTeamMembers] = useState<BusinessTeamMember[]>([]);
  const [mailQueue, setMailQueue] = useState<MailQueueItem[]>([]);
  const [auditLog, setAuditLog] = useState<BusinessAuditEntry[]>([]);
  const [templates, setTemplates] = useState<BusinessTemplate[]>([]);
  const [connectionUsage, setConnectionUsage] = useState<ConnectionUsage[]>([]);
  const [adminUsers, setAdminUsers] = useState<PlatformAdminUserRecord[]>([]);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [mailStatusFilter, setMailStatusFilter] = useState('all');
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showQueueFilters, setShowQueueFilters] = useState(false);
  const [queueStatusFilter, setQueueStatusFilter] = useState('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [auditFilter, setAuditFilter] = useState('all');
  const [adminSearch, setAdminSearch] = useState('');
  const [adminPlanFilter, setAdminPlanFilter] = useState('all');
  const [adminStatusFilter, setAdminStatusFilter] = useState('all');
  const [adminRiskFilter, setAdminRiskFilter] = useState('all');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteExpiresHours, setInviteExpiresHours] = useState(48);
  const [issuedInvite, setIssuedInvite] = useState<TeamAccessInvite | null>(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<BusinessTemplate | null>(null);
  const [selectedAdminUser, setSelectedAdminUser] = useState<PlatformAdminUserRecord | null>(null);
  const [adminStatusConfirm, setAdminStatusConfirm] = useState<{ record: PlatformAdminUserRecord; status: string; step: number } | null>(null);
  const [domainDetails, setDomainDetails] = useState<DomainRecord | null>(null);
  const [mailboxDetails, setMailboxDetails] = useState<BusinessMailbox | null>(null);
  const [groupDetails, setGroupDetails] = useState<BusinessGroup | null>(null);
  const [mailboxLocalPart, setMailboxLocalPart] = useState('');
  const [mailboxDisplayName, setMailboxDisplayName] = useState('');
  const [mailboxKind, setMailboxKind] = useState<BusinessMailbox['kind']>('primary');
  const [groupName, setGroupName] = useState('');
  const [groupLocalPart, setGroupLocalPart] = useState('');
  const [groupMembers, setGroupMembers] = useState('');
  const [verifyingDomainId, setVerifyingDomainId] = useState('');
  const [domainVerifyOpen, setDomainVerifyOpen] = useState(false);
  const [domainVerifySteps, setDomainVerifySteps] = useState<DomainHealth[]>([]);
  const [domainVerifyProviderRecords, setDomainVerifyProviderRecords] = useState<Record<string, string>[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  useEffect(() => {
    updateNavigation({ activeTab: activeBizTab, activeFolder });
  }, [activeBizTab, activeFolder, updateNavigation]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = () => { auth.logout(); navigate('/login'); };
  const openComposeWith = (to = '', subject = '', body = '') => {
    setComposeTo(to); setComposeSubject(subject); setComposeBody(body); setComposeOpen(true);
  };

  const ROLE_ALLOWED_TABS: Record<string, BizTab[]> = {
    admin: ['mail', 'templates', 'queue', 'domains', 'mailboxes', 'groups', 'team', 'analytics', 'audit', 'settings', 'billing', 'admin'],
    member: ['mail', 'templates', 'queue', 'analytics', 'team'],
    viewer: ['mail', 'analytics', 'team'],
  };
  const hasRoleAccess = (tab: BizTab) => (ROLE_ALLOWED_TABS[user?.role || 'member'] || ROLE_ALLOWED_TABS.member).includes(tab);
  const canAccessPlatformAdmin = user?.role === 'admin' && platformAdmin.isCurrentUserPlatformAdmin();

  const { data: emails = [], refetch } = useEmails(activeDomainName, activeFolder);

  const refreshDomains = () => setDomainsList(domains.getAll().map(toDomainRecord));
  const refreshTeam = useCallback(() => setTeamMembers(businessTeam.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshQueue = useCallback(() => setMailQueue(businessQueue.getByDomain(activeDomainName).map(i => ({ id: i.id, to: i.to, subject: i.subject, status: i.status, queuedAt: i.queuedAt, scheduledAt: i.scheduledAt, retries: i.retryCount, error: i.error, from: i.fromAddress }))), [activeDomainName]);
  const refreshAudit = useCallback(() => setAuditLog(businessAudit.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshTemplates = useCallback(() => setTemplates(businessTemplates.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshMailboxes = useCallback(() => setDomainMailboxes(businessMailboxes.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshGroups = useCallback(() => setDomainGroups(businessGroups.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshConnectionUsage = useCallback(() => setConnectionUsage(connections.getUsage()), []);

  useEffect(() => { refreshTeam(); refreshQueue(); refreshAudit(); refreshTemplates(); refreshConnectionUsage(); }, [activeDomainName, refreshTeam, refreshQueue, refreshAudit, refreshTemplates, refreshConnectionUsage]);

  const handleSendEmail = async () => {
    if (!composeTo || !composeSubject) { showToast('Recipient and subject required', 'error'); return; }
    setSending(true);
    try { await mail.sendBusiness(activeDomainName, composeTo.split(',').map(s => s.trim()).filter(Boolean), composeSubject, composeBody, selectedFromAddress || undefined); showToast('Email sent'); setComposeOpen(false); }
    catch { showToast('Failed to send', 'error'); }
    finally { setSending(false); }
  };

  const handleBuyPlan = async (planId: string) => {
    if (planId === 'free') { showToast('Free plan activated'); return; }
    setLoadingPayment(planId);
    try {
      const Razorpay = await loadRazorpayCheckout();
      if (!Razorpay) { showToast('Payment system unavailable', 'error'); setLoadingPayment(null); return; }
      const PLANS = [
        { id: 'free', name: 'Free', priceMonthly: 0, priceAnnual: 0, desc: '1 domain, 5 mailboxes', features: ['1 Custom Domain', '5 Mailboxes', 'Basic Queue', 'Community Support'] },
        { id: 'starter', name: 'Starter', priceMonthly: 299, priceAnnual: 2999, desc: '3 domains, 25 mailboxes', features: ['3 Custom Domains', '25 Mailboxes', 'Queue Monitoring', 'Email Support', 'Basic Templates'] },
        { id: 'business', name: 'Business', priceMonthly: 999, priceAnnual: 9999, desc: '10 domains, unlimited mailboxes', features: ['10 Custom Domains', 'Unlimited Mailboxes', 'Priority Queue', 'Advanced Templates', 'Team Access', 'Audit Logs', 'Priority Support'] },
        { id: 'enterprise', name: 'Enterprise', priceMonthly: 2499, priceAnnual: 24999, desc: 'Unlimited domains & users', features: ['Unlimited Domains', 'Unlimited Mailboxes', 'Dedicated Queue', 'Custom Templates', 'Bulk Operations', 'SLA Guarantee', 'Phone Support', 'White Label'] },
      ];
      const plan = PLANS.find(p => p.id === planId);
      if (!plan) { showToast('Plan not found', 'error'); setLoadingPayment(null); return; }
      const amount = annual ? plan.priceAnnual : plan.priceMonthly;
      const rzp = new Razorpay({
        key: import.meta.env.VITE_RAZORPAY_KEY_ID || '', amount: amount * 100, currency: 'INR',
        name: 'VelisMail', description: `${plan.name} - ${annual ? 'Annual' : 'Monthly'}`,
        handler: () => { showToast(`${plan.name} plan activated`); setLoadingPayment(null); },
        modal: { ondismiss: () => setLoadingPayment(null) },
      });
      rzp.on('payment.failed', () => { showToast('Payment failed', 'error'); setLoadingPayment(null); });
      rzp.open();
    } catch { showToast('Payment error', 'error'); setLoadingPayment(null); }
  };

  const handleReply = (email: Email) => {
    const replyBody = buildReplyQuote(email);
    const replySubject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    openComposeWith(email.from, replySubject, replyBody);
  };

  const handleForward = (email: Email) => {
    const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${email.fromName || email.from}\nDate: ${new Date(email.date).toLocaleString()}\nSubject: ${email.subject || ''}\n\n${email.body}`;
    openComposeWith('', `Fwd: ${email.subject || ''}`, fwdBody);
  };

  const handleVerifyDomain = async (domainId: string) => {
    const dom = domainsList.find(d => d.id === domainId);
    if (!dom) return;
    setVerifyingDomainId(domainId);
    const updated = domains.verify(domainId);
    if (updated) {
      const steps: DomainHealth[] = [
        { key: 'mx', label: 'MX Record', status: (updated.checks.find((c: DomainCheck) => c.key === 'mx')?.status || 'pending') as DomainHealth['status'], detail: 'MX record check', lastCheck: new Date().toISOString() },
        { key: 'spf', label: 'SPF Record', status: (updated.checks.find((c: DomainCheck) => c.key === 'spf')?.status || 'pending') as DomainHealth['status'], detail: 'SPF record check', lastCheck: new Date().toISOString() },
        { key: 'dkim', label: 'DKIM Signature', status: (updated.checks.find((c: DomainCheck) => c.key === 'dkim')?.status || 'pending') as DomainHealth['status'], detail: 'DKIM key check', lastCheck: new Date().toISOString() },
        { key: 'dmarc', label: 'DMARC Policy', status: (updated.checks.find((c: DomainCheck) => c.key === 'dmarc')?.status || 'pending') as DomainHealth['status'], detail: 'DMARC policy check', lastCheck: new Date().toISOString() },
      ];
      setDomainVerifySteps(steps);
    }
    setDomainVerifyOpen(true);
    setDomainVerifyProviderRecords([]);
    setVerifyingDomainId('');
    refreshDomains();
  };

  const handleAddDomain = async () => {
    if (!newDomainInput.trim()) return;
    try { await domains.register(newDomainInput.trim()); setNewDomainInput(''); setShowAddDomain(false); refreshDomains(); }
    catch { showToast('Failed to add domain', 'error'); }
  };

  const confirmRoleChangeStep = () => {
    if (!pendingRoleChange) return;
    if (pendingRoleChange.step === 1) { setPendingRoleChange({ ...pendingRoleChange, step: 2 }); return; }
    businessTeam.updateRole(pendingRoleChange.id, pendingRoleChange.role as 'admin' | 'member' | 'viewer');
    refreshTeam(); setPendingRoleChange(null); showToast('Role updated');
  };

  const handleBulkAction = async (action: string) => {
    const ids = [...selectedEmails];
    if (!ids.length) return;
    try {
      if (action === 'archive') { await Promise.all(ids.map(id => mail.archive(id))); showToast('Archived'); }
      else if (action === 'trash') { await Promise.all(ids.map(id => mail.trash(activeDomainName, id))); showToast('Trashed'); }
      else if (action === 'star') { await Promise.all(ids.map(id => mail.toggleStar(id))); showToast('Starred'); }
      else if (action === 'read') { await Promise.all(ids.map(id => mail.markRead(id))); showToast('Marked read'); }
      else if (action === 'unread') { await Promise.all(ids.map(id => mail.markUnread(id))); showToast('Marked unread'); }
      refetch(); setSelectedEmails(new Set());
    } catch { showToast('Action failed', 'error'); }
  };

  useEffect(() => { refetch(); }, [activeFolder, activeDomainName, refetch]);

  const dashboardState: DashboardState = {
    activeBizTab, setActiveBizTab, activeFolder, setActiveFolder,
    selectedEmail, setSelectedEmail, searchQuery, setSearchQuery,
    composeOpen, setComposeOpen, composeTo, setComposeTo, composeSubject, setComposeSubject,
    composeBody, setComposeBody, sending, setSending, selectedFromAddress, setSelectedFromAddress,
    annual, setAnnual, loadingPayment, setLoadingPayment, toast, showToast,
    showLogoutConfirm, setShowLogoutConfirm, confirmRevokeId, setConfirmRevokeId,
    pendingRoleChange, setPendingRoleChange, confirmAction, setConfirmAction,
    domainsList, setDomainsList, activeDomain, setActiveDomain,
    domainMailboxes, setDomainMailboxes, domainGroups, setDomainGroups,
    teamMembers, setTeamMembers, mailQueue, setMailQueue, auditLog, setAuditLog,
    templates, setTemplates, connectionUsage, setConnectionUsage, adminUsers, setAdminUsers,
    sortOrder, setSortOrder, viewMode, setViewMode, selectedEmails, setSelectedEmails,
    mailStatusFilter, setMailStatusFilter, notificationEnabled, setNotificationEnabled,
    soundEnabled, setSoundEnabled, showQueueFilters, setShowQueueFilters,
    queueStatusFilter, setQueueStatusFilter, templateSearch, setTemplateSearch,
    showAddDomain, setShowAddDomain, newDomainInput, setNewDomainInput,
    teamFilter, setTeamFilter, auditFilter, setAuditFilter, adminSearch, setAdminSearch,
    adminPlanFilter, setAdminPlanFilter, adminStatusFilter, setAdminStatusFilter,
    adminRiskFilter, setAdminRiskFilter, sidebarOpen, setSidebarOpen, user,
    activeDomainName,
    hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
    refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
    handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
    inviteOpen, setInviteOpen, inviteName, setInviteName, inviteEmail, setInviteEmail,
    inviteRole, setInviteRole, inviteExpiresHours, setInviteExpiresHours,
    issuedInvite, setIssuedInvite,
    templateEditorOpen, setTemplateEditorOpen, templateName, setTemplateName,
    templateSubject, setTemplateSubject, templateBody, setTemplateBody,
    previewTemplate, setPreviewTemplate,
    selectedAdminUser, setSelectedAdminUser,
    adminStatusConfirm, setAdminStatusConfirm,
    domainDetails, setDomainDetails, mailboxDetails, setMailboxDetails,
    groupDetails, setGroupDetails,
    mailboxLocalPart, setMailboxLocalPart, mailboxDisplayName, setMailboxDisplayName,
    mailboxKind, setMailboxKind,
    groupName, setGroupName, groupLocalPart, setGroupLocalPart, groupMembers, setGroupMembers,
    verifyingDomainId, setVerifyingDomainId,
    domainVerifyOpen, setDomainVerifyOpen, domainVerifySteps, setDomainVerifySteps,
    domainVerifyProviderRecords, setDomainVerifyProviderRecords,
    copiedField, setCopiedField,
  };

  if (!user) return <Navigate to="/login" replace />;
  if (!isBusinessSetupReady(user)) return <Navigate to="/business-setup" replace />;

  return (
    <div className="biz-dash">
      <Sidebar
        activeBizTab={activeBizTab} setActiveBizTab={setActiveBizTab}
        activeFolder={activeFolder} setActiveFolder={setActiveFolder}
        onCompose={() => openComposeWith()} user={user}
        onLogout={() => setShowLogoutConfirm(true)} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        hasRoleAccess={hasRoleAccess} canAccessPlatformAdmin={canAccessPlatformAdmin}
        onShowDomain={() => { setActiveBizTab('domains'); setSidebarOpen(false); }}
      />

      <main className="dash-main">
        {activeBizTab === 'mail' && (
          <EmailInbox
            emails={emails} state={dashboardState}
            onSelectEmail={(e) => setSelectedEmail(e)}
            onRefresh={() => refetch()}
            onToggleStar={(id) => { mail.toggleStar(id); refetch(); }}
            onArchive={() => handleBulkAction('archive')}
            onTrash={() => handleBulkAction('trash')}
            onReply={handleReply} onForward={handleForward}
          />
        )}

        {activeBizTab === 'domains' && <DomainsPanel state={dashboardState} handleAddDomain={handleAddDomain} handleVerifyDomain={handleVerifyDomain} />}

        {activeBizTab === 'mailboxes' && <MailboxesPanel state={dashboardState} />}

        {activeBizTab === 'groups' && <GroupsPanel state={dashboardState} />}

        {activeBizTab === 'team' && <TeamPanel state={dashboardState} />}

        {activeBizTab === 'queue' && <QueuePanel state={dashboardState} />}

        {activeBizTab === 'analytics' && <AnalyticsPanel state={dashboardState} />}

        {activeBizTab === 'audit' && <AuditPanel state={dashboardState} />}

        {activeBizTab === 'admin' && canAccessPlatformAdmin && <AdminPanel state={dashboardState} />}

        {activeBizTab === 'templates' && <TemplatesPanel state={dashboardState} />}

        {activeBizTab === 'settings' && <SettingsPanel state={dashboardState} />}

        {activeBizTab === 'billing' && <BillingPanel state={dashboardState} handleBuyPlan={handleBuyPlan} />}
      </main>

      <Modals
        state={dashboardState}
        handleVerifyDomain={handleVerifyDomain}
        confirmRoleChangeStep={confirmRoleChangeStep}
      />
    </div>
  );
}
