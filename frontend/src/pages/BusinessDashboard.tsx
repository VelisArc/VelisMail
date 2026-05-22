import { useState, useEffect, useCallback } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { auth, businessAudit, businessGroups, businessMailboxes, businessQueue, businessTeam, businessTemplates, connections, domains, isBusinessSetupReady, mail, normalizeProviderDnsRecords, platformAdmin, providerEndpointForRequest, type BusinessAuditEntry, type BusinessGroup, type BusinessMailbox, type BusinessTeamMember, type BusinessTemplate, type ConnectionUsage, type CustomDomain, type Email, type PlatformAdminUserRecord } from '../api/client';
import Sidebar, { type BizTab } from '../components/dashboard/Sidebar';
import EmailInbox from '../components/dashboard/EmailInbox';
import { copyToClipboard, loadRazorpayCheckout, buildReplyQuote } from '../components/dashboard/utils';
import type { DomainRecord, DomainHealth, MailQueueItem } from '../components/dashboard/types';
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
import { useNavigation } from '../store/sessionStore';
import { useEmails } from '../hooks/useMail';
import './BusinessDashboard.css';
import './Pricing.css';

function toDomainRecord(domain: CustomDomain): DomainRecord {
  const statusFor = (key: string) => domain.checks?.find(c => c.key === key)?.status || 'pending';
  return {
    id: domain.id, domain: domain.domain, status: domain.status || 'active', reputation: domain.reputation || 100,
    mailCount: domain.mailCount || 0, addedAt: domain.addedAt || new Date().toISOString(),
    health: [
      { key: 'mx', label: 'MX Record', status: statusFor('mx') as DomainHealth['status'], detail: statusFor('mx') === 'verified' ? 'Mail exchange configured' : 'Not configured', lastCheck: domain.lastCheck || '' },
      { key: 'spf', label: 'SPF Record', status: statusFor('spf') as DomainHealth['status'], detail: statusFor('spf') === 'verified' ? 'Sender policy published' : 'Not published', lastCheck: domain.lastCheck || '' },
      { key: 'dkim', label: 'DKIM Signature', status: statusFor('dkim') as DomainHealth['status'], detail: statusFor('dkim') === 'verified' ? 'DKIM key active' : 'Not configured', lastCheck: domain.lastCheck || '' },
      { key: 'dmarc', label: 'DMARC Policy', status: statusFor('dmarc') as DomainHealth['status'], detail: statusFor('dmarc') === 'verified' ? 'DMARC policy published' : 'Not published', lastCheck: domain.lastCheck || '' },
    ],
    checks: domain.checks || [],
    mxVerified: statusFor('mx') === 'verified', spfVerified: statusFor('spf') === 'verified',
    dkimVerified: statusFor('dkim') === 'verified', dmarcVerified: statusFor('dmarc') === 'verified',
  };
}

export default function BusinessDashboard() {
  const navigate = useNavigate();
  const [user] = useState(auth.getSession());
  const { navigation, updateNavigation } = useNavigation();

  const [activeBizTab, setActiveBizTab] = useState<BizTab>(() => (navigation?.bizTab as BizTab) || 'mail');
  const [activeFolder, setActiveFolder] = useState(navigation?.folder || 'inbox');
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
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('velismail_theme') || 'dark');

  const activeDomainName = activeDomain || domainsList[0]?.domain || '';

  useEffect(() => {
    if (user && domainsList.length > 0 && !activeDomain) setActiveDomain(domainsList[0].id);
  }, [user, domainsList, activeDomain]);

  useEffect(() => {
    if (activeDomainName) {
      setDomainMailboxes(businessMailboxes.getByDomain(activeDomainName));
      setDomainGroups(businessGroups.getByDomain(activeDomainName));
    }
  }, [activeDomainName]);

  useEffect(() => {
    setThemeMode(localStorage.getItem('velismail_theme') || 'dark');
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    localStorage.setItem('velismail_theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    updateNavigation({ bizTab: activeBizTab, folder: activeFolder });
  }, [activeBizTab, activeFolder, updateNavigation]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const toggleTheme = () => setThemeMode(t => t === 'dark' ? 'light' : 'dark');

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
  const refreshQueue = useCallback(() => setMailQueue(businessQueue.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshAudit = useCallback(() => setAuditLog(businessAudit.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshTemplates = useCallback(() => setTemplates(businessTemplates.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshMailboxes = useCallback(() => setDomainMailboxes(businessMailboxes.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshGroups = useCallback(() => setDomainGroups(businessGroups.getByDomain(activeDomainName)), [activeDomainName]);
  const refreshConnectionUsage = useCallback(() => setConnectionUsage(connections.getUsage()), []);

  useEffect(() => { refreshTeam(); refreshQueue(); refreshAudit(); refreshTemplates(); refreshConnectionUsage(); }, [activeDomainName, refreshTeam, refreshQueue, refreshAudit, refreshTemplates, refreshConnectionUsage]);

  const handleSendEmail = async () => {
    if (!composeTo || !composeSubject) { showToast('Recipient and subject required', 'error'); return; }
    setSending(true);
    try { await mail.send(activeDomainName, { to: composeTo, subject: composeSubject, body: composeBody, from: selectedFromAddress || undefined }); showToast('Email sent'); setComposeOpen(false); }
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
    setVerifyingDomainId(domainId);
    const dom = domainsList.find(d => d.id === domainId);
    if (!dom) return;
    const providerRecords = normalizeProviderDnsRecords(providerEndpointForRequest(activeDomainName));
    setDomainVerifyProviderRecords(providerRecords);
    const checks = await domains.verify(domainId);
    const steps: DomainHealth[] = [
      { key: 'mx', label: 'MX Record', status: checks.mxVerified ? 'verified' : 'failed', detail: checks.mxVerified ? 'Mail exchange configured' : 'No MX record found', lastCheck: new Date().toISOString() },
      { key: 'spf', label: 'SPF Record', status: checks.spfVerified ? 'verified' : 'failed', detail: checks.spfVerified ? 'Sender policy published' : 'SPF record missing', lastCheck: new Date().toISOString() },
      { key: 'dkim', label: 'DKIM Signature', status: checks.dkimVerified ? 'verified' : 'failed', detail: checks.dkimVerified ? 'DKIM key active' : 'DKIM not configured', lastCheck: new Date().toISOString() },
      { key: 'dmarc', label: 'DMARC Policy', status: checks.dmarcVerified ? 'verified' : 'pending', detail: checks.dmarcVerified ? 'DMARC policy published' : 'DMARC not required', lastCheck: new Date().toISOString() },
    ];
    setDomainVerifySteps(steps);
    setDomainVerifyOpen(true);
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
      if (action === 'archive') { await Promise.all(ids.map(id => mail.archive(activeDomainName, id))); showToast('Archived'); }
      else if (action === 'trash') { await Promise.all(ids.map(id => mail.trash(activeDomainName, id))); showToast('Trashed'); }
      else if (action === 'star') { await Promise.all(ids.map(id => mail.toggleStar(activeDomainName, id))); showToast('Starred'); }
      else if (action === 'read') { await Promise.all(ids.map(id => mail.markRead(activeDomainName, id))); showToast('Marked read'); }
      else if (action === 'unread') { await Promise.all(ids.map(id => mail.markUnread(activeDomainName, id))); showToast('Marked unread'); }
      refetch(); setSelectedEmails(new Set());
    } catch { showToast('Action failed', 'error'); }
  };

  useEffect(() => { refetch(); }, [activeFolder, activeDomainName, refetch]);

  if (!user) return <Navigate to="/login" replace />;
  if (!isBusinessSetupReady(user)) return <Navigate to="/business-setup" replace />;

  return (
    <div className="biz-dashboard">
      <Sidebar
        activeBizTab={activeBizTab} setActiveBizTab={setActiveBizTab}
        activeFolder={activeFolder} setActiveFolder={setActiveFolder}
        onCompose={() => openComposeWith()} onAddDomain={() => setShowAddDomain(true)}
        user={user} themeMode={themeMode} toggleTheme={toggleTheme}
        onLogout={() => setShowLogoutConfirm(true)} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        hasRoleAccess={hasRoleAccess} canAccessPlatformAdmin={canAccessPlatformAdmin}
        onShowDomain={() => { setActiveBizTab('domains'); setSidebarOpen(false); }}
      />

      <main className="dash-main">
        {activeBizTab === 'mail' && (
          <EmailInbox
            emails={emails} folders={[]} state={{
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
              themeMode, setThemeMode, toggleTheme, activeDomainName,
              hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
              refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
              handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
            }}
            onSelectEmail={(e) => setSelectedEmail(e)}
            onRefresh={() => refetch()}
            onToggleStar={(id) => { mail.toggleStar(activeDomainName, id); refetch(); }}
            onToggleRead={(id) => { mail.toggleRead(activeDomainName, id); refetch(); }}
    onArchive={() => handleBulkAction('archive')}
    onTrash={() => handleBulkAction('trash')}
    onMarkSpam={(_ids) => { _ids.forEach(id => mail.markSpam(activeDomainName, id)); refetch(); }}
    onMarkSafe={(_ids) => { _ids.forEach(id => mail.markSafe(activeDomainName, id)); refetch(); }}
            onReply={handleReply} onForward={handleForward}
          />
        )}

        {activeBizTab === 'domains' && <DomainsPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} handleAddDomain={handleAddDomain} handleVerifyDomain={handleVerifyDomain} />}

        {activeBizTab === 'mailboxes' && <MailboxesPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'groups' && <GroupsPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'team' && <TeamPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'queue' && <QueuePanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'analytics' && <AnalyticsPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'audit' && <AuditPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'admin' && canAccessPlatformAdmin && <AdminPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'templates' && <TemplatesPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'settings' && <SettingsPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} />}

        {activeBizTab === 'billing' && <BillingPanel state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }} handleBuyPlan={handleBuyPlan} />}
      </main>

      <Modals
        state={{
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
          themeMode, setThemeMode, toggleTheme, activeDomainName,
          hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
          refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage,
          handleLogout, handleSendEmail, openComposeWith, copyToClipboard,
        }}
        handleVerifyDomain={handleVerifyDomain}
        confirmRoleChangeStep={confirmRoleChangeStep}
      />
    </div>
  );
}
