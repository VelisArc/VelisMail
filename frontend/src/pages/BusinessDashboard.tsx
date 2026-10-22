import { useState, useEffect, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Building2, Check, ChevronDown, ChevronUp, Crown, Globe, Plus, X } from 'lucide-react';
import { auth, connections, fetchAPI, fetchAuthenticatedProfile, isBusinessSetupReady, mail, saveDB, signatures, contacts, STORAGE_KEYS, type BusinessAuditEntry, type BusinessGroup, type BusinessMailbox, type BusinessTeamMember, type BusinessTemplate, type ConnectionUsage, type Email, type PlatformAdminUserRecord, type TeamAccessInvite, type Signature, type Contact, type ActiveSession, type User } from '../api/client';
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
import useWorkspaceReadiness from '../components/dashboard/useWorkspaceReadiness';
import PlatformAdminPanel, { type PlatformSection } from '../components/dashboard/panels/PlatformAdminPanel';
import { platformOwnerUids, platformOwnerEmails } from '../lib/firebase';
import { toAuditEntry, toQueueItem, toTeamMember, toTemplate, workspaceApi, type WorkspaceBusiness } from '../api/company';
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

export default function BusinessDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(auth.getSession());
  // The live state of the setup. The dashboard only opens when every step of
  // the setup is done.
  const readiness = useWorkspaceReadiness(user);

  // Once every live check passes, the session is updated as well so the rest of
  // the app (settings, contacts, refresh) agrees with the gate. This never
  // clears an existing value and runs only when the state is actually behind.
  useEffect(() => {
    if (!user || !readiness.ready) return;
    const primary = readiness.primaryDomain;
    if (!primary) return;
    const alreadyReady =
      isBusinessSetupReady(user) &&
      user.businessDomain === primary.domain &&
      user.businessDomainVerified === true;
    if (alreadyReady) return;
    const updated = auth.updateSettings({
      isBusinessSetupComplete: true,
      businessDomain: primary.domain,
      businessDomainVerified: true,
      dkimStatus: 'verified',
      spfStatus: 'verified',
      dmarcStatus: 'verified',
      businessProfile: {
        ...user.businessProfile,
        domain: primary.domain,
        verified: true,
        dkimStatus: 'verified',
        spfStatus: 'verified',
        dmarcStatus: 'verified',
      },
    });
    if (updated.user) setUser(updated.user);
  }, [readiness.primaryDomain, readiness.ready, user]);

  // A stale "ready" flag must never open another route while the live state is
  // incomplete. Keep the session in sync in both directions; the credentials
  // and the primary domain are preserved, only the verification flags change.
  useEffect(() => {
    if (!user || !readiness.loaded || readiness.ready || !isBusinessSetupReady(user)) return;
    const updated = auth.updateSettings({
      isBusinessSetupComplete: false,
      businessDomainVerified: false,
      dkimStatus: 'pending',
      spfStatus: 'pending',
      dmarcStatus: 'pending',
      businessProfile: {
        ...user.businessProfile,
        verified: false,
        dkimStatus: 'pending',
        spfStatus: 'pending',
        dmarcStatus: 'pending',
      },
    });
    if (updated.user) setUser(updated.user);
  }, [readiness.loaded, readiness.ready, user]);

  if (!user) return <Navigate to="/login" replace />;
  // The product needs a database, a mail API key, a mail provider with its
  // inbound webhook, a verified domain and every DNS record published and
  // active. Until all of that is done the dashboard stays closed and the setup
  // panel names every missing step. The control plane is not a way around the
  // gate: a workspace that is not ready has no console at all.
  //
  // A member that signed in with a workspace API key works in the workspace
  // the owner configured, so the setup does not belong to them.
  const invitedMember = Boolean(user.teamAccessRole);
  if (!invitedMember && !readiness.ready) {
    return (
      <SetupRequired
        user={user}
        readiness={readiness}
        onUserUpdate={setUser}
        onLogout={() => { auth.logout(); navigate('/login'); }}
      />
    );
  }

  // Everything below only mounts after the live gate has passed. The dashboard
  // effects (mail, team, queue, audit, control plane) never run for a workspace
  // that is still being set up.
  return <WorkspaceDashboard user={user} setUser={setUser} reloadReadiness={readiness.reload} />;
}

interface WorkspaceDashboardProps {
  user: User;
  setUser: Dispatch<SetStateAction<User | null>>;
  reloadReadiness: () => Promise<void>;
}

function WorkspaceDashboard({ user, setUser, reloadReadiness }: WorkspaceDashboardProps) {
  const navigate = useNavigate();
  const location = useLocation();
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
  // Business switcher
  const [businesses, setBusinesses] = useState<WorkspaceBusiness[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState('');
  const [businessMenuOpen, setBusinessMenuOpen] = useState(false);
  const [newBusinessOpen, setNewBusinessOpen] = useState(false);
  const [newBusiness, setNewBusiness] = useState({ name: '', domain: '', plan: 'free' });
  const [creatingBusiness, setCreatingBusiness] = useState(false);
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
  const [domainsList, setDomainsList] = useState<DomainRecord[]>([]);
  const [activeDomain, setActiveDomain] = useState('');
  const activeDomainName = activeDomain || domainsList[0]?.domain || '';
  // A deleted or renamed domain must not stay selected: the mail hooks would
  // keep querying a domain that no longer belongs to the workspace.
  useEffect(() => {
    if (!activeDomain) return;
    if (domainsList.some((entry) => entry.domain === activeDomain)) return;
    setActiveDomain(domainsList[0]?.domain || '');
  }, [activeDomain, domainsList]);
  const [domainMailboxes, setDomainMailboxes] = useState<BusinessMailbox[]>([]);
  const [domainGroups, setDomainGroups] = useState<BusinessGroup[]>([]);  const [teamMembers, setTeamMembers] = useState<BusinessTeamMember[]>([]);
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
  }, [setUser]);

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

  // The control plane is only for platform staff. Without the access the
  // console never switches into it, not even through the URL.
  useEffect(() => {
    if (!canAccessPlatformAdmin && viewMode === 'control-plane') {
      setViewMode('workspace');
    }
  }, [canAccessPlatformAdmin, viewMode]);

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

  // ─── Businesses ───
  // An account can run more than one business. They all live in the same
  // storage, each in its own part, and switching re-scopes the whole console
  // to the complete details of that business.
  const refreshBusinesses = useCallback(async () => {
    try {
      const result = await workspaceApi.businesses();
      setBusinesses(result.businesses);
      setActiveBusinessId(result.activeBusinessId);
    } catch (error) {
      console.error('refresh businesses failed', error);
    }
  }, []);

  useEffect(() => { void refreshBusinesses(); }, [refreshBusinesses]);

  const activeBusiness = useMemo(
    () => businesses.find((business) => business.id === activeBusinessId) || null,
    [businesses, activeBusinessId],
  );

  const handleSwitchBusiness = useCallback(async (businessId: string) => {
    setBusinessMenuOpen(false);
    try {
      const result = await workspaceApi.switchBusiness(businessId);
      setActiveBusinessId(result.business.id);
      const domain = result.business.primaryDomain;
      if (domain) {
        setActiveDomain(domain);
      }
      setActiveBizTab('mail');
      setActiveFolder('inbox');
      await Promise.all([
        refreshDomains(),
        refreshTeam(),
        refreshQueue(),
        refreshAudit(),
        refreshTemplates(),
        refreshMailboxes(),
        refreshGroups(),
        refreshContacts(),
      ]);
      await reloadReadiness();
      showToast(`Switched to ${result.business.name}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to switch business.', 'error');
    }
  }, [
    refreshAudit,
    refreshContacts,
    refreshDomains,
    refreshGroups,
    refreshMailboxes,
    refreshQueue,
    refreshTeam,
    refreshTemplates,
    reloadReadiness,
    showToast,
  ]);

  const handleCreateBusiness = useCallback(async () => {
    const name = newBusiness.name.trim();
    const domain = newBusiness.domain.trim();
    if (name.length < 2) {
      showToast('Enter the name of the business.', 'error');
      return;
    }
    if (!domain.includes('.')) {
      showToast('Enter a valid domain, for example acme.com.', 'error');
      return;
    }
    setCreatingBusiness(true);
    try {
      const result = await workspaceApi.createBusiness({ name, domain, plan: newBusiness.plan });
      setNewBusinessOpen(false);
      setNewBusiness({ name: '', domain: '', plan: 'free' });
      await refreshBusinesses();
      await handleSwitchBusiness(result.business.id);
      showToast(`${name} is ready. Publish the DNS records to start sending.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Unable to create the business.', 'error');
    } finally {
      setCreatingBusiness(false);
    }
  }, [handleSwitchBusiness, newBusiness, refreshBusinesses, showToast]);

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
      { key: 'checking', label: 'Reading the live DNS', status: 'checking', detail: `Checking every record of ${dom.domain}...`, lastCheck: new Date().toISOString() },
    ]);
    setDomainVerifyOpen(true);
    setDomainVerifyProviderRecords([]);

    try {
      const result = await workspaceApi.verifyDomain(domainId);
      const steps: DomainHealth[] = result.records.map((record) => ({
        key: `${record.recordType}-${record.host}`,
        label: `${record.purpose} (${record.recordType})`,
        status: record.status === 'verified'
          ? 'verified'
          : record.status === 'mismatch'
            ? 'failed'
            : 'pending',
        detail: record.detail || record.actual || record.value || 'Waiting for the DNS answer',
        lastCheck: new Date().toISOString(),
      }));
      setDomainVerifySteps(steps);
      setDomainVerifyProviderRecords(
        result.records.map((record) => ({
          type: record.recordType,
          name: record.host,
          value: record.value,
          status: record.status,
          ttl: String(record.ttl),
        })),
      );
      if (result.complete) {
        showToast(`${dom.domain} is verified. Every record is live.`);
      } else {
        const missing = result.records.filter((record) => record.status !== 'verified').length;
        showToast(`${missing} record${missing === 1 ? '' : 's'} still need attention.`, 'error');
      }
      await refreshDomains();
      await reloadReadiness();
    } catch (error) {
      console.error('verify domain failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to verify the domain.', 'error');
    } finally {
      setVerifyingDomainId('');
    }
  };

  const handleAddDomain = async () => {
    const domain = newDomainInput.trim().toLowerCase();
    if (!domain) return;
    try {
      const created = await workspaceApi.createDomain({ domain });
      setNewDomainInput('');
      setShowAddDomain(false);
      await refreshDomains();
      await refreshBusinesses();
      await reloadReadiness();
      if (!user?.businessDomain) {
        const updated = auth.updateSettings({ businessDomain: created.domain });
        if (updated.user) setUser(updated.user);
      }
      showToast(created.existing ? `${created.domain} is already connected.` : `${created.domain} added. Publish its DNS records next.`);
    } catch (error) {
      console.error('add domain failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to add the domain.', 'error');
    }
  };

  const handleDeleteDomain = async (domainId: string) => {
    const dom = domainsList.find(entry => entry.id === domainId);
    if (!dom) return;
    try {
      await workspaceApi.deleteDomain(domainId);
      await refreshDomains();
      await refreshBusinesses();
      await reloadReadiness();
      showToast(`${dom.domain} removed.`);
    } catch (error) {
      console.error('delete domain failed', error);
      showToast(error instanceof Error ? error.message : 'Unable to delete the domain.', 'error');
    }
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
  }), [activeBizTab, activeFolder, searchQuery, composeOpen, composeTo, composeSubject, composeBody, composeReplyQuote, sending, selectedFromAddress, activeMailboxAddress, annual, loadingPayment, toast, showLogoutConfirm, confirmRevokeId, pendingRoleChange, confirmAction, domainsList, activeDomain, domainMailboxes, domainGroups, teamMembers, mailQueue, auditLog, templates, connectionUsage, adminUsers, sortOrder, selectedEmails, mailStatusFilter, notificationEnabled, soundEnabled, showQueueFilters, queueStatusFilter, templateSearch, showAddDomain, newDomainInput, teamFilter, auditFilter, adminSearch, adminPlanFilter, adminStatusFilter, adminRiskFilter, adminPage, sidebarOpen, user, inviteOpen, inviteName, inviteEmail, inviteRole, inviteExpiresHours, issuedInvite, templateEditorOpen, templateName, templateSubject, templateBody, previewTemplate, selectedAdminUser, adminStatusConfirm, domainDetails, mailboxDetails, groupDetails, mailboxLocalPart, mailboxDisplayName, mailboxKind, groupName, groupLocalPart, groupMembers, verifyingDomainId, domainVerifyOpen, domainVerifySteps, domainVerifyProviderRecords, copiedField, signaturesList, contactsList, contactsSearch, activeSessions, signatureEditorOpen, signatureEditorName, signatureEditorContent, editingSignatureId, contactEditorOpen, contactEditorName, contactEditorEmail, contactEditorPhone, contactEditorCompany, editingContactId, showToast, activeDomainName, canAccessPlatformAdmin, handleLogout, handleSendEmail, hasRoleAccess, refreshAdminUsers, refreshAudit, refreshConnectionUsage, refreshContacts, refreshGroups, refreshMailboxes, refreshQueue, refreshSessions, refreshSignatures, refreshTeam, refreshTemplates, refreshDomains]);

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
        onCompose={() => openComposeWith()}
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
            {viewMode === 'workspace' && (
              <>
                {domainsList.length > 0 && (
                  <label className="dash-domain-picker">
                    <Globe size={14} />
                    <span className="dash-domain-picker-label">Active domain</span>
                    <select
                      className="input input-sm"
                      value={activeDomainName}
                      onChange={(event) => {
                        const domName = event.target.value;
                        setActiveDomain(domName);
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

                <div className="dash-business-switcher">
                  <button
                    type="button"
                    className="dash-business-trigger"
                    onClick={() => setBusinessMenuOpen((open) => !open)}
                    aria-haspopup="menu"
                    aria-expanded={businessMenuOpen}
                    aria-label="Switch business"
                  >
                    <Building2 size={15} />
                    <span className="dash-business-trigger-name">
                      {activeBusiness?.name || 'Workspace'}
                    </span>
                    {businessMenuOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {businessMenuOpen && (
                    <>
                      <div className="dash-business-scrim" onClick={() => setBusinessMenuOpen(false)} />
                      <div className="dash-business-menu" role="menu">
                        <span className="dash-business-menu-label">Your businesses</span>
                        {businesses.length === 0 && (
                          <p className="dash-business-empty">No business yet.</p>
                        )}
                        {businesses.map((business) => (
                          <button
                            key={business.id}
                            type="button"
                            role="menuitem"
                            className={`dash-business-item ${business.id === activeBusinessId ? 'active' : ''}`}
                            onClick={() => { void handleSwitchBusiness(business.id); }}
                          >
                            <span className="dash-business-item-main">
                              <strong>{business.name}</strong>
                              <span>{business.primaryDomain || business.email} · {business.plan}</span>
                            </span>
                            {business.id === activeBusinessId
                              ? <Check size={14} />
                              : <span className="dash-business-item-role">{business.role}</span>}
                          </button>
                        ))}
                        <button
                          type="button"
                          role="menuitem"
                          className="dash-business-item dash-business-add"
                          onClick={() => { setBusinessMenuOpen(false); setNewBusinessOpen(true); }}
                        >
                          <Plus size={14} />
                          <span className="dash-business-item-main">
                            <strong>Add a business</strong>
                            <span>New domain, new mailboxes, same platform</span>
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        {newBusinessOpen && (
          <div className="modal-overlay" onClick={() => setNewBusinessOpen(false)} role="dialog" aria-modal="true" aria-label="Add a business">
            <div className="biz-form-modal glass" onClick={(event) => event.stopPropagation()}>
              <div className="compose-header">
                <div>
                  <h3><Building2 size={16} /> Add a business</h3>
                  <p>A new business lives in the same platform, with its own domain, mailboxes and team.</p>
                </div>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setNewBusinessOpen(false)}><X size={16} /></button>
              </div>
              <div className="admin-form">
                <div className="form-group">
                  <label htmlFor="new-business-name">Business name</label>
                  <input
                    id="new-business-name"
                    className="input"
                    placeholder="Acme Inc"
                    value={newBusiness.name}
                    onChange={(event) => setNewBusiness((current) => ({ ...current, name: event.target.value }))}
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="new-business-domain">Business domain</label>
                  <input
                    id="new-business-domain"
                    className="input"
                    placeholder="acme.com"
                    value={newBusiness.domain}
                    onChange={(event) => setNewBusiness((current) => ({ ...current, domain: event.target.value }))}
                  />
                  <span className="form-hint">This domain sends and receives the business mail. Publish the DNS records to activate it.</span>
                </div>
                <div className="form-group">
                  <label htmlFor="new-business-plan">Plan</label>
                  <select
                    id="new-business-plan"
                    className="input"
                    value={newBusiness.plan}
                    onChange={(event) => setNewBusiness((current) => ({ ...current, plan: event.target.value }))}
                  >
                    <option value="free">Free</option>
                    <option value="starter">Starter</option>
                    <option value="business">Business</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>
                <div className="admin-modal-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNewBusinessOpen(false)}>Cancel</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => { void handleCreateBusiness(); }}
                    disabled={creatingBusiness}
                  >
                    {creatingBusiness ? 'Creating...' : 'Create business'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'control-plane' && (
          <ErrorBoundary>
            <PlatformAdminPanel
              section={platformSection}
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

        {viewMode === 'workspace' && activeBizTab === 'domains' && <ErrorBoundary><DomainsPanel state={dashboardState} handleAddDomain={handleAddDomain} handleVerifyDomain={handleVerifyDomain} handleDeleteDomain={handleDeleteDomain} /></ErrorBoundary>}

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
