import { useState, useEffect, useCallback, useMemo } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Building2, Crown, Globe, Plus } from 'lucide-react';
import { auth, connections, domains, fetchAPI, fetchAuthenticatedProfile, isBusinessSetupReady, mail, saveDB, signatures, contacts, STORAGE_KEYS, type BusinessAuditEntry, type BusinessGroup, type BusinessMailbox, type BusinessTeamMember, type BusinessTemplate, type ConnectionUsage, type CustomDomain, type Email, type PlatformAdminUserRecord, type DomainCheck, type TeamAccessInvite, type Signature, type Contact, type ActiveSession } from '../api/client';
import { platformAdminApi } from '../api/admin';
import Sidebar from '../components/dashboard/Sidebar';
import { PLANS, ROLE_ALLOWED_TABS, type BizTab } from '../components/dashboard/constants';
import EmailInbox from '../components/dashboard/EmailInbox';
import ErrorBoundary from '../components/ErrorBoundary';
import { copyToClipboard, loadRazorpayCheckout, buildReplyQuote } from '../components/dashboard/utils';
import type { DashboardState, DomainRecord, DomainHealth, MailQueueItem } from '../components/dashboard/types';
import DomainsPanel from '../components/dashboard/panels/DomainsPanel';
import MailboxesPanel from '../components/dashboard/panels/MailboxesPanel';
import GroupsPanel from '../components/dashboard/panels/GroupsPanel';
import TeamPanel from '../components/dashboard/panels/TeamPanel';
import QueuePanel from '../components/dashboard/panels/QueuePanel';
import AnalyticsPanel from '../components/dashboard/panels/AnalyticsPanel';
import AuditPanel from '../components/dashboard/panels/AuditPanel';
import CompanyAdminPanel from '../components/dashboard/panels/CompanyAdminPanel';
import SetupRequired from '../components/dashboard/SetupRequired';
import PlatformAdminPanel, { type PlatformSection } from '../components/dashboard/panels/PlatformAdminPanel';
import { platformOwnerUids, platformOwnerEmails } from '../lib/firebase';
import { toAuditEntry, toQueueItem, toTeamMember, toTemplate, workspaceApi } from '../api/company';
import { companyAdminApi } from '../api/admin';
import TemplatesPanel from '../components/dashboard/panels/TemplatesPanel';
import SettingsPanel from '../components/dashboard/panels/SettingsPanel';
import BillingPanel from '../components/dashboard/panels/BillingPanel';
import Modals from '../components/dashboard/Modals';
import { useNavigation, useSessionActions } from '../store/sessionStore';
import { useQueryClient } from '@tanstack/react-query';
import { useEmails } from '../hooks/useMail';
import './BusinessDashboard.css';
import './Pricing.css';
import ContactsPage from './Contacts';
import DeliverabilityPanel from '../components/dashboard/panels/DeliverabilityPanel';


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
  const location = useLocation();
  const [user, setUser] = useState(auth.getSession());
  const navigation = useNavigation();
  const { updateNavigation } = useSessionActions();
  const queryClient = useQueryClient();

  const [activeBizTab, setActiveBizTab] = useState<BizTab>(() => (navigation?.activeTab as BizTab) || 'mail');
  const [activeFolder, setActiveFolder] = useState(navigation?.activeFolder || 'inbox');
  const [viewMode, setViewMode] = useState<'workspace' | 'control-plane'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'admin' ? 'control-plane' : 'workspace',
  );
  const [platformSection, setPlatformSection] = useState<PlatformSection>('overview');
  const [isPlatformOwner, setIsPlatformOwner] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeReplyQuote, setComposeReplyQuote] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFromAddress, setSelectedFromAddress] = useState('');
  const [activeMailboxAddress, setActiveMailboxAddress] = useState('');
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
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [mailStatusFilter, setMailStatusFilter] = useState('all');
  const [notificationEnabled, setNotificationEnabled] = useState(() => {
    const saved = localStorage.getItem('velismail_notification_enabled');
    return saved !== null ? saved === 'true' : true;
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = localStorage.getItem('velismail_sound_enabled');
    return saved !== null ? saved === 'true' : true;
  });

  const handleToggleNotification = (val: boolean) => {
    setNotificationEnabled(val);
    localStorage.setItem('velismail_notification_enabled', String(val));
  };
  const handleToggleSound = (val: boolean) => {
    setSoundEnabled(val);
    localStorage.setItem('velismail_sound_enabled', String(val));
  };
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
  const [adminPage, setAdminPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer' | 'user'>('user');
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

  const [signaturesList, setSignaturesList] = useState<Signature[]>(() => signatures.getAll());
  const [contactsList, setContactsList] = useState<Contact[]>(() => contacts.getAll());
  const [contactsSearch, setContactsSearch] = useState('');
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [signatureEditorOpen, setSignatureEditorOpen] = useState(false);
  const [signatureEditorName, setSignatureEditorName] = useState('');
  const [signatureEditorContent, setSignatureEditorContent] = useState('');
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null);
  const [contactEditorOpen, setContactEditorOpen] = useState(false);
  const [contactEditorName, setContactEditorName] = useState('');
  const [contactEditorEmail, setContactEditorEmail] = useState('');
  const [contactEditorPhone, setContactEditorPhone] = useState('');
  const [contactEditorCompany, setContactEditorCompany] = useState('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  useEffect(() => {
    updateNavigation({ activeTab: activeBizTab, activeFolder });
  }, [activeBizTab, activeFolder, updateNavigation]);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleLogout = useCallback(() => { auth.logout(); navigate('/login'); }, [navigate]);
  const openComposeWith = (to = '', subject = '', body = '', replyQuote = '') => {
    setComposeTo(to); setComposeSubject(subject); setComposeBody(body); setComposeReplyQuote(replyQuote); setComposeOpen(true);
  };

  // Platform staff are the accounts configured as owners (Firebase UID or
  // email) plus the accounts that were explicitly invited into the control
  // plane. The gateway stays authoritative; this only decides what to render.
  const canAccessPlatformAdmin = Boolean(
    user?.isPlatformAdmin
    || (user?.firebaseUid && platformOwnerUids().includes(user.firebaseUid))
    || (user?.email && platformOwnerEmails().includes(user.email.toLowerCase())),
  );
  const hasRoleAccess = useCallback(
    (tab: BizTab) => {
      const effectiveRole = user?.role || 'user';
      return (ROLE_ALLOWED_TABS[effectiveRole] || ROLE_ALLOWED_TABS.user).includes(tab);
    },
    [user?.role],
  );

  useEffect(() => {
    if (!hasRoleAccess(activeBizTab)) {
      setActiveBizTab('mail');
    }
  }, [activeBizTab, hasRoleAccess]);

  // The control plane renders its own access notice when the account is not
  // platform staff, so the requested view is never silently discarded.

  // Keep the platform identity in sync with the backend. The gateway stays
  // authoritative, this only keeps the control-plane switch accurate after a
  // Google sign-in or a role change.
  useEffect(() => {
    let cancelled = false;
    void fetchAuthenticatedProfile().then((profile) => {
      if (cancelled || !profile) return;
      const firebaseUid = profile.firebaseUid;
      const isPlatformAdmin = profile.isPlatformAdmin;
      if (!firebaseUid && !isPlatformAdmin) return;
      setUser((current) => {
        if (!current) return current;
        const next = {
          ...current,
          firebaseUid: firebaseUid || current.firebaseUid,
          isPlatformAdmin: Boolean(isPlatformAdmin ?? current.isPlatformAdmin),
        };
        saveDB(STORAGE_KEYS.session, next);
        return next;
      });
    });
    return () => { cancelled = true; };
  }, []);

  // The configured platform owner is the only account that may broadcast to
  // every user, so the console asks the gateway who it is dealing with.
  useEffect(() => {
    if (!canAccessPlatformAdmin) {
      setIsPlatformOwner(false);
      return;
    }
    let cancelled = false;
    void platformAdminApi.me()
      .then((result) => { if (!cancelled) setIsPlatformOwner(Boolean(result.owner)); })
      .catch(() => { if (!cancelled) setIsPlatformOwner(false); });
    return () => { cancelled = true; };
  }, [canAccessPlatformAdmin]);

  const switchView = useCallback((next: 'workspace' | 'control-plane') => {
    setViewMode(next);
    if (next === 'control-plane') {
      setPlatformSection('overview');
    }
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); openComposeWith(); }
    };
    window.addEventListener('keydown', handler);

    const routerState = location.state as { composeTo?: string } | null;
    if (routerState && typeof routerState.composeTo === 'string') {
      openComposeWith(routerState.composeTo);
      window.history.replaceState({}, document.title);
    }

    return () => window.removeEventListener('keydown', handler);
  }, [location.state]);

  const { data: emails = [], isLoading: emailsLoading, refetch } = useEmails(activeDomainName, activeFolder);

  const refreshDomains = useCallback(async () => {
    try {
      const result = await workspaceApi.domains();
      setDomainsList(
        result.domains.map((domain) => ({
          id: domain.id,
          domain: domain.domain,
          status: domain.status === 'verified' ? 'active' : domain.status === 'failed' ? 'error' : 'pending',
          reputation: 100,
          mailCount: domain.mailboxes || 0,
          addedAt: domain.createdAt || new Date().toISOString(),
          health: [
            { key: 'mx', label: 'MX Record', status: domain.mxRecords?.length ? 'verified' : 'pending', detail: domain.mxRecords?.length ? 'Mail exchange configured' : 'Not configured', lastCheck: domain.verifiedAt || '' },
            { key: 'spf', label: 'SPF Record', status: domain.spfRecord ? 'verified' : 'pending', detail: domain.spfRecord ? 'Sender policy published' : 'Not published', lastCheck: domain.verifiedAt || '' },
            { key: 'dkim', label: 'DKIM Signature', status: domain.dkimRecord ? 'verified' : 'pending', detail: domain.dkimRecord ? 'DKIM key active' : 'Not configured', lastCheck: domain.verifiedAt || '' },
            { key: 'dmarc', label: 'DMARC Policy', status: domain.dmarcRecord ? 'verified' : 'pending', detail: domain.dmarcRecord ? 'DMARC policy published' : 'Not published', lastCheck: domain.verifiedAt || '' },
          ],
          checks: [],
          mxVerified: Boolean(domain.mxRecords?.length),
          dkimVerified: Boolean(domain.dkimRecord),
          dmarcVerified: Boolean(domain.dmarcRecord),
        })),
      );
    } catch (error) {
      console.error('refresh domains failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to load domains.', 'error');
    }
  }, [showToast]);
  const refreshTeam = useCallback(async () => {
    try {
      const result = await workspaceApi.team();
      setTeamMembers(result.members.map(toTeamMember));
    } catch (error) {
      console.error('refresh team failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to load the team.', 'error');
    }
  }, [showToast]);
  const refreshQueue = useCallback(async () => {
    try {
      const result = await workspaceApi.queue({ limit: 200 });
      setMailQueue(result.items.map(toQueueItem));
    } catch (error) {
      console.error('refresh queue failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to load the mail queue.', 'error');
    }
  }, [showToast]);
  const refreshAudit = useCallback(async () => {
    try {
      const result = await workspaceApi.audit({ limit: 300 });
      setAuditLog(result.entries.map(toAuditEntry));
    } catch (error) {
      console.error('refresh audit failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to load the audit trail.', 'error');
    }
  }, [showToast]);
  const refreshTemplates = useCallback(async () => {
    try {
      const result = await workspaceApi.templates();
      setTemplates(result.templates.map(toTemplate));
    } catch (error) {
      console.error('refresh templates failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to load templates.', 'error');
    }
  }, [showToast]);
  const refreshMailboxes = useCallback(async () => {
    try {
      const result = await workspaceApi.mailboxes();
      setDomainMailboxes(result.mailboxes);
    } catch (error) {
      console.error('refresh mailboxes failed', error);
      setDomainMailboxes([]);
      showToast(error instanceof Error ? error.message : 'Unable to refresh mailboxes.', 'error');
    }
  }, [showToast]);
  const refreshGroups = useCallback(async () => {
    try {
      const result = await workspaceApi.groups(activeDomainName);
      setDomainGroups(result.groups.map((group) => ({
        id: group.id,
        domain: group.domain,
        name: group.name,
        address: group.address,
        members: group.members || [],
        createdAt: group.createdAt || '',
        updatedAt: group.updatedAt || '',
      })));
    } catch (error) {
      console.error('refresh groups failed', error);
      setDomainGroups([]);
    }
  }, [activeDomainName]);
  const refreshConnectionUsage = useCallback(() => setConnectionUsage(connections.getUsage()), []);
  const refreshAdminUsers = useCallback(async () => {
    // Platform users live in the separate /admin control plane. The business
    // dashboard no longer mirrors a local admin user list.
    setAdminUsers([]);
  }, []);

  const refreshSignatures = useCallback(async () => {
    try {
      const result = await workspaceApi.signatures();
      setSignaturesList(result.signatures);
    } catch (error) {
      console.error('refresh signatures failed', error);
      setSignaturesList([]);
    }
  }, []);
  const refreshContacts = useCallback(async () => {
    try {
      const result = await workspaceApi.contacts();
      setContactsList(result.contacts);
    } catch (error) {
      console.error('refresh contacts failed', error);
      setContactsList([]);
    }
  }, []);
  const refreshSessions = useCallback(async () => { try { const res = await auth.listSessions(); if (res.success) setActiveSessions(res.sessions); } catch (e) { console.error('refresh sessions failed', e); } }, []);

  useEffect(() => {
    void refreshDomains();
    refreshTeam();
    refreshQueue();
    refreshAudit();
    refreshTemplates();
    refreshConnectionUsage();
    void refreshMailboxes();
    refreshGroups();
  }, [activeDomainName, refreshDomains, refreshTeam, refreshQueue, refreshAudit, refreshTemplates, refreshConnectionUsage, refreshMailboxes, refreshGroups]);

  useEffect(() => {
    if (domainMailboxes.length === 0) {
      setSelectedFromAddress('');
      setActiveMailboxAddress('');
      return;
    }
    if (!domainMailboxes.some((mailbox) => mailbox.address === selectedFromAddress)) {
      setSelectedFromAddress(domainMailboxes.find((mailbox) => mailbox.active)?.address || domainMailboxes[0].address);
    }
    if (activeMailboxAddress && !domainMailboxes.some((mailbox) => mailbox.address === activeMailboxAddress || mailbox.aliases.includes(activeMailboxAddress))) {
      setActiveMailboxAddress('');
    }
  }, [activeMailboxAddress, domainMailboxes, selectedFromAddress]);

  const handleSendEmail = useCallback(async (to?: string, subject?: string, body?: string) => {
    const finalTo = to !== undefined ? to : composeTo;
    const finalSubject = subject !== undefined ? subject : composeSubject;
    const finalBody = body !== undefined ? body : composeBody;
    if (!finalTo || !finalSubject) { showToast('Recipient and subject required', 'error'); return; }
    setSending(true);
    try {
      await mail.sendBusiness(activeDomainName, finalTo.split(',').map(s => s.trim()).filter(Boolean), finalSubject, finalBody, selectedFromAddress || undefined);
      queryClient.invalidateQueries({ queryKey: ['emails', activeDomainName] });
      showToast('Email sent'); setComposeOpen(false);
    }
    catch (e) { console.error('send failed', e); showToast(e instanceof Error ? e.message : 'Failed to send', 'error'); }
    finally { setSending(false); }
  }, [activeDomainName, composeTo, composeSubject, composeBody, selectedFromAddress, queryClient, showToast]);

  const handleBuyPlan = async (planId: string) => {
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) { showToast('Plan not found', 'error'); return; }
    if (planId === 'free') {
      const updated = auth.updateSettings({ 
        plan: 'Free', 
        billingCycle: annual ? 'annual' : 'monthly',
        paidPlanPurchasedAt: undefined,
        paidPlanExpiresAt: undefined,
        subscriptionStatus: undefined
      });
      if (updated.user) {
        setUser(updated.user);
        if (typeof window !== 'undefined') window.location.reload();
      }
      showToast('Free plan activated');
      return;
    }
    setLoadingPayment(planId);
    try {
      const Razorpay = await loadRazorpayCheckout();
      if (!Razorpay) { showToast('Payment SDK failed to load', 'error'); setLoadingPayment(null); return; }
      const billingCycle = annual ? 'annual' : 'monthly';
      const amountRupees = annual ? plan.priceAnnual : plan.priceMonthly;
      const order = await fetchAPI('/payments/create-order', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountRupees * 100,
          currency: 'INR',
          plan: plan.id,
          billing: billingCycle,
          email: user?.email,
        }),
      });
      if (!order.success && order.message) {
        showToast(order.message, 'error');
        setLoadingPayment(null);
        return;
      }
      const razorpayKey = order.razorpay_key_id || import.meta.env.VITE_RAZORPAY_KEY_ID;
      const orderId = order.order_id || order.id;
      if (!razorpayKey || !orderId) {
        showToast('Payment gateway is not ready. Check Razorpay server keys.', 'error');
        setLoadingPayment(null);
        return;
      }
      const rzp = new Razorpay({
        key: razorpayKey,
        amount: order.amount || amountRupees * 100,
        currency: order.currency || 'INR',
        order_id: orderId,
        name: 'VelisMail', description: `${plan.name} - ${annual ? 'Annual' : 'Monthly'}`,
        handler: async (response: Record<string, string>) => {
          try {
            const verifyResult = await fetchAPI('/payments/verify', {
              method: 'POST',
              body: JSON.stringify({
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            if (verifyResult.success) {
              // The backend API has processed the secure upgrade logic (timers, db update)
              // and recorded the invoice in the platform revenue ledger.
              showToast(`${plan.name} plan activated`);
              setTimeout(() => { if (typeof window !== 'undefined') window.location.reload(); }, 500);
            } else {
              showToast(verifyResult.message || 'Payment verification failed', 'error');
            }
          } catch (error) {
            console.error('payment verification error', error);
            showToast('Payment verification failed', 'error');
          } finally {
            setLoadingPayment(null);
          }
        },
        modal: { ondismiss: () => setLoadingPayment(null) },
      });
      rzp.on('payment.failed', () => { showToast('Payment failed', 'error'); setLoadingPayment(null); });
      rzp.open();
    } catch (e) {
      console.error('payment error', e);
      showToast(e instanceof Error ? e.message : 'Payment error', 'error');
      setLoadingPayment(null);
    }
  };


  const handleReply = (email: Email) => {
    const replyQuote = buildReplyQuote(email);
    const replySubject = email.subject?.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    
    // Determine the reply recipient (TO address)
    const myAddresses = new Set((domainMailboxes || []).map(m => m.address.toLowerCase()));
    if (user?.email) myAddresses.add(user.email.toLowerCase());
    
    const isFromMe = myAddresses.has(email.from.toLowerCase());
    const replyToAddress = isFromMe ? (Array.isArray(email.to) ? email.to.join(', ') : email.to) : email.from;
    
    // Open compose with empty body, quote stored separately for ••• toggle
    openComposeWith(replyToAddress, replySubject, '', replyQuote);
  };

  const handleForward = (email: Email) => {
    const fwdBody = `\n\n---------- Forwarded message ----------\nFrom: ${email.fromName || email.from}\nDate: ${new Date(email.date).toLocaleString()}\nSubject: ${email.subject || ''}\n\n${email.body}`;
    openComposeWith('', `Fwd: ${email.subject || ''}`, fwdBody);
  };

  const handleVerifyDomain = async (domainId: string) => {
    const dom = domainsList.find(d => d.id === domainId);
    if (!dom) return;
    setVerifyingDomainId(domainId);
    setDomainVerifySteps([
      { key: 'mx', label: 'MX Record', status: 'checking', detail: 'Checking MX record...', lastCheck: new Date().toISOString() },
      { key: 'spf', label: 'SPF Record', status: 'checking', detail: 'Checking SPF record...', lastCheck: new Date().toISOString() },
      { key: 'dkim', label: 'DKIM Signature', status: 'checking', detail: 'Checking DKIM key...', lastCheck: new Date().toISOString() },
      { key: 'dmarc', label: 'DMARC Policy', status: 'checking', detail: 'Checking DMARC policy...', lastCheck: new Date().toISOString() },
    ]);
    setDomainVerifyOpen(true);
    setDomainVerifyProviderRecords([]);

    try {
      const updated = await domains.verify(domainId);
      if (updated) {
        const steps: DomainHealth[] = [
          { key: 'mx', label: 'MX Record', status: (updated.checks.find((c: DomainCheck) => c.key === 'mx')?.status || 'pending') as DomainHealth['status'], detail: 'MX record check', lastCheck: new Date().toISOString() },
          { key: 'spf', label: 'SPF Record', status: (updated.checks.find((c: DomainCheck) => c.key === 'spf')?.status || 'pending') as DomainHealth['status'], detail: 'SPF record check', lastCheck: new Date().toISOString() },
          { key: 'dkim', label: 'DKIM Signature', status: (updated.checks.find((c: DomainCheck) => c.key === 'dkim')?.status || 'pending') as DomainHealth['status'], detail: 'DKIM key check', lastCheck: new Date().toISOString() },
          { key: 'dmarc', label: 'DMARC Policy', status: (updated.checks.find((c: DomainCheck) => c.key === 'dmarc')?.status || 'pending') as DomainHealth['status'], detail: 'DMARC policy check', lastCheck: new Date().toISOString() },
        ];
        setDomainVerifySteps(steps);
        if (Array.isArray(updated.dnsRecords)) {
          setDomainVerifyProviderRecords(updated.dnsRecords as unknown as Record<string, string>[]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      refreshDomains();
      setVerifyingDomainId('');
    }
  };

  const handleAddDomain = async () => {
    if (!newDomainInput.trim()) return;
    try { await domains.register(newDomainInput.trim()); setNewDomainInput(''); setShowAddDomain(false); refreshDomains(); }
    catch (e) { console.error('add domain failed', e); showToast('Failed to add domain', 'error'); }
  };

  const confirmRoleChangeStep = async () => {
    if (!pendingRoleChange) return;
    if (pendingRoleChange.step === 1) { setPendingRoleChange({ ...pendingRoleChange, step: 2 }); return; }
    try {
      // The role lives in PostgreSQL. Resolve the member by email and update
      // the real record instead of a browser copy.
      const result = await workspaceApi.team();
      const member = result.members.find((entry) => entry.email === pendingRoleChange.id);
      if (!member) {
        showToast('That member is no longer part of this workspace.', 'error');
        setPendingRoleChange(null);
        return;
      }
      await companyAdminApi.updateMember(member.id, {
        role: pendingRoleChange.role as 'admin' | 'member' | 'viewer',
      });
      await refreshTeam();
      showToast('Role updated');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to update the role.', 'error');
    } finally {
      setPendingRoleChange(null);
    }
  };

  const handleBulkAction = async (action: string, ids?: string[]) => {
    const targetIds = ids || [...selectedEmails];
    if (!targetIds.length) return;
    try {
      if (action === 'archive') { await Promise.all(targetIds.map(id => mail.archive(id))); showToast('Archived'); }
      else if (action === 'trash') { await Promise.all(targetIds.map(id => mail.trash(activeDomainName, id))); showToast('Trashed'); }
      else if (action === 'star') { await Promise.all(targetIds.map(id => mail.toggleStar(id))); showToast('Starred'); }
      else if (action === 'read') { await Promise.all(targetIds.map(id => mail.markRead(id))); showToast('Marked read'); }
      else if (action === 'unread') { await Promise.all(targetIds.map(id => mail.markUnread(id))); showToast('Marked unread'); }
      refetch(); if (!ids) setSelectedEmails(new Set());
    } catch (e) { console.error('bulk action failed', e); showToast('Action failed', 'error'); }
  };

  const dashboardState = useMemo((): DashboardState => ({
    activeBizTab, setActiveBizTab, activeFolder, setActiveFolder,
    searchQuery, setSearchQuery,
    composeOpen, setComposeOpen, composeTo, setComposeTo, composeSubject, setComposeSubject,
    composeBody, setComposeBody, composeReplyQuote, setComposeReplyQuote, sending, setSending,
    selectedFromAddress, setSelectedFromAddress, activeMailboxAddress, setActiveMailboxAddress,
    annual, setAnnual, loadingPayment, setLoadingPayment, toast, showToast,
    showLogoutConfirm, setShowLogoutConfirm, confirmRevokeId, setConfirmRevokeId,
    pendingRoleChange, setPendingRoleChange, confirmAction, setConfirmAction,
    domainsList, setDomainsList, activeDomain, setActiveDomain,
    domainMailboxes, setDomainMailboxes, domainGroups, setDomainGroups,
    teamMembers, setTeamMembers, mailQueue, setMailQueue, auditLog, setAuditLog,
    templates, setTemplates, connectionUsage, setConnectionUsage, adminUsers, setAdminUsers,
    sortOrder, setSortOrder, selectedEmails, setSelectedEmails,
    mailStatusFilter, setMailStatusFilter, notificationEnabled, setNotificationEnabled: handleToggleNotification,
    soundEnabled, setSoundEnabled: handleToggleSound, showQueueFilters, setShowQueueFilters,
    queueStatusFilter, setQueueStatusFilter, templateSearch, setTemplateSearch,
    showAddDomain, setShowAddDomain, newDomainInput, setNewDomainInput,
    teamFilter, setTeamFilter, auditFilter, setAuditFilter, adminSearch, setAdminSearch,
    adminPlanFilter, setAdminPlanFilter, adminStatusFilter, setAdminStatusFilter,
    adminRiskFilter, setAdminRiskFilter, adminPage, setAdminPage, sidebarOpen, setSidebarOpen, user,
    activeDomainName,
    hasRoleAccess, canAccessPlatformAdmin, refreshDomains, refreshTeam, refreshQueue,
    refreshAudit, refreshTemplates, refreshMailboxes, refreshGroups, refreshConnectionUsage, refreshAdminUsers,
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

    signatures: signaturesList, setSignatures: setSignaturesList,
    refreshSignatures,
    contacts: contactsList, setContacts: setContactsList,
    refreshContacts,
    contactsSearch, setContactsSearch,
    activeSessions, setActiveSessions,
    refreshSessions,
    signatureEditorOpen, setSignatureEditorOpen,
    signatureEditorName, setSignatureEditorName,
    signatureEditorContent, setSignatureEditorContent,
    editingSignatureId, setEditingSignatureId,
    contactEditorOpen, setContactEditorOpen,
    contactEditorName, setContactEditorName,
    contactEditorEmail, setContactEditorEmail,
    contactEditorPhone, setContactEditorPhone,
    contactEditorCompany, setContactEditorCompany,
    editingContactId, setEditingContactId,
  }), [activeBizTab, activeFolder, searchQuery, composeOpen, composeTo, composeSubject, composeBody, composeReplyQuote, sending, selectedFromAddress, activeMailboxAddress, annual, loadingPayment, toast, showLogoutConfirm, confirmRevokeId, pendingRoleChange, confirmAction, domainsList, activeDomain, domainMailboxes, domainGroups, teamMembers, mailQueue, auditLog, templates, connectionUsage, adminUsers, sortOrder, selectedEmails, mailStatusFilter, notificationEnabled, soundEnabled, showQueueFilters, queueStatusFilter, templateSearch, showAddDomain, newDomainInput, teamFilter, auditFilter, adminSearch, adminPlanFilter, adminStatusFilter, adminRiskFilter, adminPage, sidebarOpen, user, inviteOpen, inviteName, inviteEmail, inviteRole, inviteExpiresHours, issuedInvite, templateEditorOpen, templateName, templateSubject, templateBody, previewTemplate, selectedAdminUser, adminStatusConfirm, domainDetails, mailboxDetails, groupDetails, mailboxLocalPart, mailboxDisplayName, mailboxKind, groupName, groupLocalPart, groupMembers, verifyingDomainId, domainVerifyOpen, domainVerifySteps, domainVerifyProviderRecords, copiedField, signaturesList, contactsList, contactsSearch, activeSessions, signatureEditorOpen, signatureEditorName, signatureEditorContent, editingSignatureId, contactEditorOpen, contactEditorName, contactEditorEmail, contactEditorPhone, contactEditorCompany, editingContactId, showToast, activeDomainName, canAccessPlatformAdmin, handleLogout, handleSendEmail, hasRoleAccess, refreshAdminUsers, refreshAudit, refreshConnectionUsage, refreshContacts, refreshGroups, refreshMailboxes, refreshQueue, refreshSessions, refreshSignatures, refreshTeam, refreshTemplates]);

  if (!user) return <Navigate to="/login" replace />;
  // The product needs a database, a mail API key, a verified domain and a mail
  // provider. Until the workspace is configured the dashboard explains what is
  // missing instead of showing screens that cannot work.
  if (!isBusinessSetupReady(user)) return <SetupRequired user={user} />;

  return (
    <div className="biz-dash">
      <Sidebar
        activeBizTab={activeBizTab} setActiveBizTab={setActiveBizTab}
        activeFolder={activeFolder} setActiveFolder={setActiveFolder}
        user={user}        onLogout={() => setShowLogoutConfirm(true)} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        hasRoleAccess={hasRoleAccess} isPlatformOwner={isPlatformOwner}
        viewMode={viewMode}
        platformSection={platformSection} onPlatformSectionChange={setPlatformSection}
        onProfileClick={() => navigate('/settings')}
      />

      <main className="dash-main">
        <header className="dash-topbar">
          <div className="dash-topbar-left">
            {canAccessPlatformAdmin && (
              <button
                type="button"
                className="dash-view-toggle"
                onClick={() => switchView(viewMode === 'workspace' ? 'control-plane' : 'workspace')}
                title={viewMode === 'workspace' ? 'Open the platform control plane' : 'Back to your workspace'}
              >
                {viewMode === 'workspace'
                  ? (<><Crown size={15} /> Control Plane</>)
                  : (<><Building2 size={15} /> Workspace</>)}
              </button>
            )}
          </div>

          <div className="dash-topbar-right">
            {viewMode === 'workspace' && domainsList.length > 0 && (
              <label className="dash-domain-picker">
                <Globe size={14} />
                <span className="dash-domain-picker-label">Active domain</span>
                <select
                  className="input input-sm"
                  value={activeDomainName}
                  onChange={(event) => {
                    const domName = event.target.value;
                    setActiveDomain(domName);
                    const matched = domainsList.find((domain) => domain.domain === domName);
                    if (matched) domains.setPrimary(matched.id);
                    showToast(`Switched active domain to ${domName}`);
                  }}
                  aria-label="Active domain"
                >
                  {domainsList.map((domain) => (
                    <option key={domain.id} value={domain.domain}>
                      {domain.domain} ({domain.status})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {viewMode === 'workspace' && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openComposeWith()}>
                <Plus size={15} /> New Message
              </button>
            )}
          </div>
        </header>

        {viewMode === 'control-plane' && (
          <ErrorBoundary>
            <PlatformAdminPanel
              section={platformSection}
              onSectionChange={setPlatformSection}
              state={dashboardState}
            />
          </ErrorBoundary>
        )}

        {viewMode === 'workspace' && activeBizTab === 'mail' && (
          <ErrorBoundary>
            <EmailInbox
            emails={emails} isLoading={emailsLoading} state={dashboardState}
            onRefresh={() => refetch()}
            onToggleStar={async (id) => { await mail.toggleStar(id); refetch(); }}
            onArchive={(ids) => handleBulkAction('archive', ids)}
            onTrash={(ids) => handleBulkAction('trash', ids)}
            onReply={handleReply} onForward={handleForward}
            onToggleRead={async (id, currentlyUnread) => { if (currentlyUnread) { await mail.markRead(id); } else { await mail.markUnread(id); } refetch(); }}
            onMarkSpam={async (id) => { await mail.markSpam(activeDomainName, id); refetch(); }}
            onTogglePriority={async (id) => { await mail.togglePriority(id); refetch(); }}
          />
          </ErrorBoundary>
        )}

        {viewMode === 'workspace' && activeBizTab === 'domains' && <ErrorBoundary><DomainsPanel state={dashboardState} handleAddDomain={handleAddDomain} handleVerifyDomain={handleVerifyDomain} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'mailboxes' && <ErrorBoundary><MailboxesPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'groups' && <ErrorBoundary><GroupsPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'team' && <ErrorBoundary><TeamPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'queue' && <ErrorBoundary><QueuePanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'analytics' && <ErrorBoundary><AnalyticsPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'audit' && <ErrorBoundary><AuditPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'company-admin' && <ErrorBoundary><CompanyAdminPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'templates' && <ErrorBoundary><TemplatesPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'settings' && <ErrorBoundary><SettingsPanel state={dashboardState} /></ErrorBoundary>}

        {viewMode === 'workspace' && activeBizTab === 'billing' && <ErrorBoundary><BillingPanel state={dashboardState} handleBuyPlan={handleBuyPlan} /></ErrorBoundary>}
        {viewMode === 'workspace' && activeBizTab === 'contacts' && <ErrorBoundary><ContactsPage /></ErrorBoundary>}
        {viewMode === 'workspace' && activeBizTab === 'deliverability' && <ErrorBoundary><DeliverabilityPanel state={dashboardState} /></ErrorBoundary>}

      </main>

      <Modals
        state={dashboardState}
        handleVerifyDomain={handleVerifyDomain}
        confirmRoleChangeStep={confirmRoleChangeStep}
      />
    </div>
  );
}
