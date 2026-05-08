import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Inbox, Send, FileEdit, Star, Archive, Trash2, LogOut,
  Search, Plus, X, Paperclip, RefreshCw, Settings, ArrowLeft,
  Reply, Forward, Loader2, CheckCircle2,
  AlertTriangle, Sun, Moon, BarChart3, Users, Globe, Shield, ShieldCheck,
  Server, Activity, Clock, AlertCircle, Database,
  CheckSquare, Square, Tag, Bell, BellOff,
  ExternalLink, Copy, Zap, Filter, Check,
  Mail, Volume2, VolumeX, RefreshCcw, Pause,
  Trash, Archive as ArchiveIcon, Edit3, Eye,
  Download, KeyRound, Lock, XCircle,
  Layers, CreditCard,
  List, Grid, SortAsc, SortDesc, Menu,
  Rocket, Briefcase, Building2
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  auth,
  businessAudit,
  businessGroups,
  businessMailboxes,
  businessQueue,
  businessTeam,
  businessTemplates,
  connections,
  domains,
  fetchApiJsonDetailed,
  isScamEmail,
  mail,
  teamAccess,
  type BusinessAuditEntry,
  type BusinessGroup,
  type BusinessMailbox,
  type BusinessTeamMember,
  type BusinessTemplate,
  type ConnectionUsage,
  type CustomDomain,
  type Email,
  type TeamAccessInvite,
} from '../api/client';
import Composer from '../components/Composer';
import { useNavigation, useSessionStore } from '../store/sessionStore';
import { useEmails } from '../hooks/useMail';
import './BusinessDashboard.css';
import './Pricing.css';

type BizFolder = {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
};

type DomainHealth = {
  key: string;
  label: string;
  status: 'verified' | 'pending' | 'failed' | 'checking';
  detail: string;
  lastCheck: string;
};

type MailQueueItem = {
  id: string;
  domain?: string;
  fromAddress?: string;
  to: string;
  recipients?: string[];
  subject: string;
  body?: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'deferred';
  queuedAt: string;
  updatedAt?: string;
  retryCount: number;
  error?: string;
  scheduledAt?: string;
};

type DomainRecord = {
  id: string;
  domain: string;
  status: 'active' | 'suspended' | 'pending' | 'failed';
  health: DomainHealth[];
  mxReady: boolean;
  spfReady: boolean;
  dkimReady: boolean;
  dmarcReady: boolean;
  addedAt: string;
  mailCount: number;
  reputation: number;
};

type DomainVerifyRuntimeCheck = {
  key: string;
  label: string;
  status: 'verified' | 'failed';
  detail: string;
  category?: 'success' | 'network' | 'config' | 'software';
  recommendation?: string | null;
};

type ProviderDnsRecord = {
  recordType: string;
  name: string;
  value: string;
  status?: string | null;
  priority?: number | null;
};

const BIZ_FOLDERS: BizFolder[] = [
  { id: 'inbox', label: 'Inbox', icon: Inbox, badge: 'unread' },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'drafts', label: 'Drafts', icon: FileEdit },
  { id: 'archive', label: 'Archive', icon: Archive },
  { id: 'trash', label: 'Trash', icon: Trash2 },
  { id: 'priority', label: 'Priority', icon: Zap, badge: 'priority' },
  { id: 'scheduled', label: 'Scheduled', icon: Clock },
  { id: 'spam', label: 'Spam', icon: AlertCircle },
];

function toDomainRecord(domain: CustomDomain): DomainRecord {
  const statusFor = (key: string) => domain.checks.find(check => check.key === key)?.status || 'pending';
  const verifiedCount = domain.checks.filter(check => check.status === 'verified').length;

  return {
    id: domain.id,
    domain: domain.domain,
    status: domain.status === 'verified' ? 'active' : domain.status,
    health: domain.checks.map(check => ({
      key: check.key,
      label: check.label,
      status: check.status,
      detail: check.actual || check.expected,
      lastCheck: domain.lastCheckedAt || domain.addedAt,
    })),
    mxReady: statusFor('mx') === 'verified',
    spfReady: statusFor('spf') === 'verified',
    dkimReady: statusFor('dkim') === 'verified',
    dmarcReady: statusFor('dmarc') === 'verified',
    addedAt: domain.addedAt,
    mailCount: mail.getBusinessByFolderSync(domain.domain, 'sent').length,
    reputation: Math.round((verifiedCount / Math.max(domain.checks.length, 1)) * 100),
  };
}

function formatRelative(iso: string): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 'unknown';
  const diff = Date.now() - target;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < 60000) return diff >= 0 ? 'just now' : 'in less than 1m';
  if (abs < 3600000) return `${Math.floor(abs / 60000)}m ${suffix}`;
  if (abs < 86400000) return `${Math.floor(abs / 3600000)}h ${suffix}`;
  if (abs < 604800000) return `${Math.floor(abs / 86400000)}d ${suffix}`;
  return new Date(iso).toLocaleDateString();
}

function formatInviteExpiry(expiresAt?: string | null): string {
  return expiresAt ? `Expires ${formatRelative(expiresAt)}` : 'Never expires';
}

type BizTab = 'mail' | 'domains' | 'mailboxes' | 'groups' | 'team' | 'queue' | 'analytics' | 'audit' | 'templates' | 'settings' | 'billing';

const ROLE_ALLOWED_TABS: Record<BusinessTeamMember['role'], BizTab[]> = {
  admin: ['mail', 'domains', 'mailboxes', 'groups', 'team', 'queue', 'analytics', 'audit', 'templates', 'settings', 'billing'],
  member: ['mail', 'team', 'queue', 'analytics', 'templates'],
  viewer: ['mail', 'team', 'analytics'],
};

function hasRoleAccess(role: BusinessTeamMember['role'], tab: BizTab): boolean {
  return ROLE_ALLOWED_TABS[role].includes(tab);
}

function formatINR(amount: number): string {
  if (amount === 0) return '0';
  return amount.toLocaleString('en-IN');
}

const plans = [
  {
    id: 'free',
    name: 'Free',
    icon: Zap,
    desc: 'For individuals & testing.',
    monthlyPrice: 0,
    annualPrice: 0,
    popular: false,
    cta: 'Current Plan',
    ctaStyle: 'btn-outline',
    features: [
      { text: '3,000 emails/mo', highlight: true },
      { text: '100 emails/day limit', highlight: false },
      { text: '500MB Storage', highlight: false },
      { text: '3 team members', highlight: false },
      { text: '1 custom domain', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: '3 mail templates', highlight: false },
      { text: '7 days audit logs', highlight: false },
    ],
    disabledFeatures: [
      'Custom branding',
      'Priority support',
      'Advanced routing',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    icon: Rocket,
    desc: 'For small teams getting serious.',
    monthlyPrice: 799,
    annualPrice: 7999,
    popular: false,
    cta: 'Upgrade to Starter',
    ctaStyle: 'btn-outline',
    features: [
      { text: '150,000 emails/mo', highlight: true },
      { text: 'No daily email limit', highlight: false },
      { text: '10GB Storage', highlight: false },
      { text: '15 team members', highlight: false },
      { text: '3 custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: '25 mail templates', highlight: false },
      { text: '30 days audit logs', highlight: false },
      { text: 'Email support', highlight: false },
      { text: '99.5% platform SLA', highlight: false },
    ],
    disabledFeatures: [
      'Custom branding',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    icon: Briefcase,
    desc: 'For growing companies.',
    monthlyPrice: 2499,
    annualPrice: 24999,
    popular: true,
    cta: 'Upgrade to Business',
    ctaStyle: 'btn-primary',
    features: [
      { text: '750,000 emails/mo', highlight: true },
      { text: 'No daily email limit', highlight: false },
      { text: '50GB Storage', highlight: false },
      { text: '75 team members', highlight: false },
      { text: '10 custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: 'Unlimited mail templates', highlight: false },
      { text: '90 days audit logs', highlight: false },
      { text: 'Custom branding', highlight: true },
      { text: 'Email + chat support', highlight: false },
      { text: '99.9% platform SLA', highlight: false },
    ],
    disabledFeatures: [],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    icon: Building2,
    desc: 'For large organizations.',
    monthlyPrice: 6999,
    annualPrice: 69999,
    popular: false,
    cta: 'Upgrade to Enterprise',
    ctaStyle: 'btn-primary',
    features: [
      { text: 'Unlimited emails', highlight: true },
      { text: 'No daily email limit', highlight: false },
      { text: 'Unlimited Storage', highlight: false },
      { text: 'Unlimited team members', highlight: false },
      { text: 'Unlimited custom domains', highlight: false },
      { text: 'SPF, DKIM, DMARC', highlight: false },
      { text: 'E2E encryption', highlight: false },
      { text: 'Passkey authentication', highlight: false },
      { text: 'Unlimited mail templates', highlight: false },
      { text: '1 year audit logs', highlight: false },
      { text: 'Dedicated Account Manager', highlight: false },
      { text: '99.99% platform SLA', highlight: false },
    ],
    disabledFeatures: [],
  },
];

export default function BusinessDashboard() {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const updateNavigation = useSessionStore(state => state.updateNavigation);
  const user = auth.getSession();
  const currentRole: BusinessTeamMember['role'] = user?.teamAccessRole || 'admin';
  const canCompose = currentRole !== 'viewer';
  const canManageWorkspace = currentRole === 'admin';
  const canManageTemplates = currentRole === 'admin' || currentRole === 'member';
  const storedDomainRecords = domains.getAll().map(toDomainRecord);
  const initialDomainRecords = storedDomainRecords;
  const initialDomainId = initialDomainRecords.find(d => d.domain === user?.businessDomain)?.id || initialDomainRecords[0]?.id || '';

  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }
    // Enforce infrastructure connectivity — all 4 must be present
    const hasDb = Boolean(user.businessDbUrl?.trim());
    const hasApiKey = Boolean(user.businessApiKey?.trim());
    const hasDomain = Boolean(user.businessDomain?.trim());
    const hasProvider = Boolean(user.businessMailProvider?.trim());
    const infraComplete = hasDb && hasApiKey && hasDomain && hasProvider;

    if (!infraComplete || !user.isBusinessSetupComplete) {
      navigate('/business-setup');
      return;
    }
    if (!user.businessDomainVerified || storedDomainRecords.length === 0) {
      navigate('/business-setup');
      return;
    }
  }, [navigate, user, storedDomainRecords.length]);

  const [activeBizTab, setActiveBizTab] = useState<BizTab>((navigation.activeTab as BizTab) || 'domains');
  const [activeFolder, setActiveFolder] = useState(navigation.activeFolder || 'inbox');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [searchQuery, setSearchQuery] = useState(navigation.searchQuery || '');
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [selectedFromAddress, setSelectedFromAddress] = useState('');

  // Payment State
  const [annual, setAnnual] = useState(false);
  const [loadingPayment, setLoadingPayment] = useState<string | null>(null);

  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    document.body.appendChild(script);
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  const handleUpgrade = (plan: typeof plans[0]) => {
    if (plan.id === 'free') return;
    
    setLoadingPayment(plan.id);
    
    const amountInPaise = (annual ? plan.annualPrice : plan.monthlyPrice) * 100;
    
    const options = {
      key: import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_live_SA0FP7UH9KHLNQ',
      amount: amountInPaise,
      currency: 'INR',
      name: 'VelisMail',
      description: `Upgrade to ${plan.name} Plan`,
      handler: function (response: { razorpay_payment_id: string }) {
        showToast(`${plan.name} upgrade successful! Verification ID: ${response.razorpay_payment_id}`);
        setLoadingPayment(null);
      },
      prefill: {
        name: user?.displayName || '',
        email: user?.email || '',
      },
      theme: {
        color: '#7b61ff'
      },
      modal: {
        ondismiss: function() {
          setLoadingPayment(null);
        }
      }
    };

    // @ts-expect-error: Razorpay is loaded dynamically via script tag
    if (window.Razorpay) {
      // @ts-expect-error: Razorpay is loaded dynamically via script tag
      const rzp = new window.Razorpay(options);
      rzp.open();
    } else {
      showToast('Payment gateway not loaded. Please try again.', 'error');
      setLoadingPayment(null);
    }
  };

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ id: string; role: BusinessTeamMember['role']; step: 1 | 2 } | null>(null);

  const [activeDomain, setActiveDomain] = useState<string>(initialDomainId);
  const [domainsList, setDomainsList] = useState<DomainRecord[]>(initialDomainRecords);
  const [domainMailboxes, setDomainMailboxes] = useState<BusinessMailbox[]>([]);
  const [domainGroups, setDomainGroups] = useState<BusinessGroup[]>([]);
  const [teamMembers, setTeamMembers] = useState<BusinessTeamMember[]>([]);
  const [mailQueue, setMailQueue] = useState<MailQueueItem[]>([]);
  const [auditLog, setAuditLog] = useState<BusinessAuditEntry[]>([]);
  const [templates, setTemplates] = useState<BusinessTemplate[]>([]);
  const [connectionUsage, setConnectionUsage] = useState<ConnectionUsage[]>([]);

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [mailStatusFilter, setMailStatusFilter] = useState<'all' | 'unread' | 'read' | 'starred' | 'priority' | 'attachments'>('all');
  const [notificationEnabled, setNotificationEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showQueueFilters, setShowQueueFilters] = useState(false);
  const [queueStatusFilter, setQueueStatusFilter] = useState<string>('all');
  const [templateSearch, setTemplateSearch] = useState('');
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [auditFilter, setAuditFilter] = useState<string>('all');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState(() => document.documentElement.getAttribute('data-theme') || 'light');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviteExpiresHours, setInviteExpiresHours] = useState(24);
  const [issuedInvite, setIssuedInvite] = useState<TeamAccessInvite | null>(null);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<BusinessTemplate | null>(null);
  const [domainDetails, setDomainDetails] = useState<DomainRecord | null>(null);
  const [mailboxDetails, setMailboxDetails] = useState<BusinessMailbox | null>(null);
  const [groupDetails, setGroupDetails] = useState<BusinessGroup | null>(null);
  const [mailboxLocalPart, setMailboxLocalPart] = useState('');
  const [mailboxDisplayName, setMailboxDisplayName] = useState('');
  const [mailboxKind, setMailboxKind] = useState<BusinessMailbox['kind']>('mailbox');
  const [groupName, setGroupName] = useState('');
  const [groupLocalPart, setGroupLocalPart] = useState('');
  const [groupMembers, setGroupMembers] = useState('');
  const [verifyingDomainId, setVerifyingDomainId] = useState('');
  const [domainVerifyOpen, setDomainVerifyOpen] = useState(false);
  const [domainVerifySteps, setDomainVerifySteps] = useState<Array<{ label: string; detail: string; status: 'verified' | 'failed' | 'pending'; recommendation?: string | null }>>([]);
  const [domainVerifyProviderRecords, setDomainVerifyProviderRecords] = useState<ProviderDnsRecord[]>([]);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const activeDomainRecord = domainsList.find(d => d.id === activeDomain);
  const activeDomainName = activeDomainRecord?.domain || user?.businessDomain || '';

  useEffect(() => {
    if (!user) {
      navigate('/login');
    } else if (!user.isBusinessSetupComplete || !user.businessDbUrl?.trim() || !user.businessApiKey?.trim() || !user.businessMailProvider?.trim()) {
      navigate('/business-setup');
    }
  }, [navigate, user]);

  useEffect(() => {
    if (!hasRoleAccess(currentRole, activeBizTab)) {
      setActiveBizTab(ROLE_ALLOWED_TABS[currentRole][0]);
      setSelectedEmail(null);
    }
  }, [activeBizTab, currentRole]);

  const { data: rawEmails = [], refetch: refetchEmails } = useEmails(activeDomainName, activeFolder);

  const emails = useMemo(() => {
    if (activeBizTab !== 'mail') return [];
    
    const statusFiltered = rawEmails.filter(e => {
      if (mailStatusFilter === 'unread') return e.unread;
      if (mailStatusFilter === 'read') return !e.unread;
      if (mailStatusFilter === 'starred') return e.starred;
      if (mailStatusFilter === 'priority') return e.labels?.includes('priority');
      if (mailStatusFilter === 'attachments') return e.hasAttachment;
      return true;
    });

    const filtered = searchQuery
      ? statusFiltered.filter(e =>
          e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.from.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.fromName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (e.labels || []).join(' ').toLowerCase().includes(searchQuery.toLowerCase())
        )
      : statusFiltered;
      
    return [...filtered].sort((a, b) => {
      const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
      return sortOrder === 'desc' ? diff : -diff;
    });
  }, [rawEmails, activeBizTab, searchQuery, sortOrder, mailStatusFilter]);

  useEffect(() => {
    if (!activeDomainName) {
      setDomainMailboxes([]);
      setDomainGroups([]);
      setSelectedFromAddress('');
      return;
    }

    const nextMailboxes = businessMailboxes.getByDomain(activeDomainName);
    const nextGroups = businessGroups.getByDomain(activeDomainName);
    
    // Deduplicate mailboxes by address
    const uniqueMailboxes = Array.from(new Map(nextMailboxes.map(m => [m.address, m])).values());
    
    setDomainMailboxes(uniqueMailboxes);
    setDomainGroups(nextGroups);
    setSelectedFromAddress((current) => (
      uniqueMailboxes.some((entry) => entry.address === current)
        ? current
        : (uniqueMailboxes.find((entry) => entry.active)?.address || uniqueMailboxes[0]?.address || '')
    ));
  }, [activeDomainName]);

  useEffect(() => {
    setTeamMembers(businessTeam.getAll());
    setTemplates(businessTemplates.getAll());
    setAuditLog(businessAudit.getAll());
    setConnectionUsage(connections.getUsage());
    setMailQueue(businessQueue.getAll(activeDomainName));
  }, [activeDomainName]);

  useEffect(() => {
    updateNavigation({
      accountType: 'business',
      activeTab: activeBizTab,
      activeFolder,
      searchQuery,
      selectedEmailId: selectedEmail?.id || null,
    });
  }, [activeBizTab, activeFolder, searchQuery, selectedEmail?.id, updateNavigation]);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
    updateNavigation({ selectedEmailId: email.id });
    if (email.unread) {
      mail.markRead(email.id);
      refetchEmails();
    }
  };

  const handleSend = async (toArg: string, subjectArg: string, bodyArg: string, attachmentsArg?: File[], scheduledAt?: string) => {
    if (!canCompose) {
      showToast('Viewer access can read mail but cannot send messages.', 'error');
      return;
    }
    setComposeTo(toArg);
    setComposeSubject(subjectArg);
    setComposeBody(bodyArg);
    setSending(true);
    const domain = domainsList.find(d => d.id === activeDomain)?.domain || user?.businessDomain;
    if (!domain) {
      setSending(false);
      showToast('Select and verify a business domain first.', 'error');
      return;
    }

    // Process attachments to base64
    let processedAttachments: { filename: string, content: string, contentType: string }[] | undefined = undefined;
    if (attachmentsArg && attachmentsArg.length > 0) {
      processedAttachments = await Promise.all(attachmentsArg.map(async (file) => {
        return new Promise<{ filename: string, content: string, contentType: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64Content = result.split(',')[1];
            resolve({
              filename: file.name,
              content: base64Content,
              contentType: file.type || 'application/octet-stream'
            });
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }));
    }

    const toAddresses = toArg.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await mail.sendBusiness(domain, toAddresses, subjectArg, bodyArg, selectedFromAddress, processedAttachments, scheduledAt);
      showToast(scheduledAt ? `Business email scheduled for ${new Date(scheduledAt).toLocaleString()}` : `Business email dispatched via ${domain}`);
      setComposeOpen(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setAuditLog(businessAudit.getAll());
      setMailQueue(businessQueue.getAll(domain));
      refetchEmails();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Business email send failed', 'error');
      setMailQueue(businessQueue.getAll(domain));
    } finally {
      setSending(false);
    }
  };

  const handleReply = () => {
    if (!selectedEmail) return;
    if (!canCompose) {
      showToast('Viewer access cannot reply to messages.', 'error');
      return;
    }
    setComposeOpen(true);
    setComposeTo(selectedEmail.from);
    setComposeSubject(`Re: ${selectedEmail.subject.replace(/^Re:\s*/i, '')}`);
    setComposeBody(`\n\n---\nOn ${new Date(selectedEmail.date).toLocaleString()}, ${selectedEmail.fromName} wrote:\n> ${selectedEmail.body.split('\n').join('\n> ')}`);
  };

  const handleForward = () => {
    if (!selectedEmail) return;
    if (!canCompose) {
      showToast('Viewer access cannot forward messages.', 'error');
      return;
    }
    setComposeOpen(true);
    setComposeTo('');
    setComposeSubject(`Fwd: ${selectedEmail.subject.replace(/^Fwd:\s*/i, '')}`);
    setComposeBody(`\n\n--- Forwarded Message ---\nFrom: ${selectedEmail.from}\nDate: ${new Date(selectedEmail.date).toLocaleString()}\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.body}`);
  };

  const handleArchive = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    mail.archive(emailId);
    refetchEmails();
    setSelectedEmail(null);
    showToast('Email archived');
  };

  const handleDeleteEmail = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    mail.delete(emailId);
    refetchEmails();
    setSelectedEmail(null);
    showToast('Email moved to trash');
  };

  const handleMoveToInbox = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    mail.moveFolder(emailId, 'inbox');
    refetchEmails();
    setSelectedEmail(null);
    showToast('Email restored to inbox');
  };

  const handlePermanentDelete = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    mail.permanentDelete(emailId);
    refetchEmails();
    setSelectedEmail(null);
    showToast('Email permanently deleted');
  };

  const handleMarkSpam = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    mail.moveFolder(emailId, 'spam');
    refetchEmails();
    setSelectedEmail(null);
    showToast('Email moved to spam');
  };

  const handleMarkSafe = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    mail.markSafe(emailId);
    refetchEmails();
    setSelectedEmail(null);
    showToast('Message marked safe and moved to Inbox');
  };

  const handleTogglePriority = (id?: string) => {
    const emailId = id || selectedEmail?.id;
    if (!emailId) return;
    const isPriority = mail.togglePriority(emailId);
    refetchEmails();
    showToast(isPriority ? 'Marked as priority' : 'Priority removed');
  };

  const handleInviteMember = async (email: string, name: string, role: 'admin' | 'member' | 'viewer') => {
    if (!user || !canManageWorkspace) {
      showToast('Only admins can invite team members.', 'error');
      return false;
    }
    let invite: TeamAccessInvite;
    try {
      invite = await teamAccess.createInvite({
        issuer: user,
        email,
        name,
        role,
        expiresInHours: inviteExpiresHours,
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to generate team access key.', 'error');
      return false;
    }
    const newMember: BusinessTeamMember = {
      id: invite.id,
      name,
      email: invite.email,
      role,
      status: 'pending',
      inviteToken: invite.token,
      inviteExpiresAt: invite.expiresAt,
      addedAt: new Date().toISOString(),
      lastActive: new Date().toISOString(),
    };
    const next = [...teamMembers, newMember];
    setTeamMembers(next);
    businessTeam.save(next);
    businessAudit.add({
      action: 'Invited team member',
      actor: user?.email || 'current user',
      target: invite.email,
      severity: 'info',
    });
    setAuditLog(businessAudit.getAll());
    setIssuedInvite(invite);
    navigator.clipboard.writeText(invite.token).catch(() => undefined);
    showToast(`Access key generated for ${invite.email}`);
    return true;
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) {
      showToast('Member email is required.', 'error');
      return;
    }
    const invited = await handleInviteMember(inviteEmail.trim(), inviteName.trim() || inviteEmail.split('@')[0], inviteRole);
    if (!invited) return;
    setInviteOpen(false);
    setInviteName('');
    setInviteEmail('');
    setInviteRole('member');
    setInviteExpiresHours(24);
  };

  const handleRemoveMember = (id: string) => {
    if (!canManageWorkspace) {
      showToast('Only admins can remove team members.', 'error');
      return;
    }
    const member = teamMembers.find((entry) => entry.id === id);
    const next = teamMembers.filter(m => m.id !== id);
    setTeamMembers(next);
    businessTeam.save(next);
    if (member) {
      if (member.inviteToken) {
        void teamAccess.revoke(member.inviteToken);
      }
      businessAudit.add({
        action: 'Removed team member',
        actor: user?.email || 'current user',
        target: member.email,
        severity: 'warn',
      });
      setAuditLog(businessAudit.getAll());
    }
    showToast('Team member removed');
  };

  const applyMemberRoleChange = (id: string, role: 'admin' | 'member' | 'viewer') => {
    if (!canManageWorkspace) {
      showToast('Only admins can update team roles.', 'error');
      return;
    }
    const next = teamMembers.map(m => m.id === id ? { ...m, role } : m);
    setTeamMembers(next);
    businessTeam.save(next);
    const member = next.find((entry) => entry.id === id);
    if (member) {
      businessAudit.add({
        action: 'Updated member role',
        actor: user?.email || 'current user',
        target: `${member.email} → ${role}`,
        severity: 'info',
      });
      setAuditLog(businessAudit.getAll());
    }
    showToast('Member role updated');
  };

  const handleUpdateMemberRole = (id: string, role: 'admin' | 'member' | 'viewer') => {
    const member = teamMembers.find((entry) => entry.id === id);
    if (!member || member.role === role) return;
    setPendingRoleChange({ id, role, step: 1 });
  };

  const confirmRoleChangeStep = () => {
    if (!pendingRoleChange) return;
    if (pendingRoleChange.step === 1) {
      setPendingRoleChange({ ...pendingRoleChange, step: 2 });
      return;
    }
    applyMemberRoleChange(pendingRoleChange.id, pendingRoleChange.role);
    setPendingRoleChange(null);
  };

  const refreshQueue = () => {
    setMailQueue(businessQueue.getAll(activeDomainName));
  };

  useEffect(() => {
    if (!activeDomainName) return;
    let cancelled = false;
    const runDueScheduledMail = async () => {
      const delivered = await mail.dispatchScheduledDue(activeDomainName);
      if (!cancelled && delivered > 0) {
        setMailQueue(businessQueue.getAll(activeDomainName));
        refetchEmails();
        setAuditLog(businessAudit.getAll());
        showToast(`${delivered} scheduled email${delivered === 1 ? '' : 's'} delivered`);
      }
    };
    void runDueScheduledMail();
    const timer = window.setInterval(runDueScheduledMail, 60000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeDomainName, refetchEmails]);

  const handleRetryQueueItem = async (id: string) => {
    if (!canCompose) {
      showToast('Viewer access cannot retry deliveries.', 'error');
      return;
    }
    const item = mailQueue.find((entry) => entry.id === id);
    if (!item || !item.domain || !item.body) {
      showToast('Queue item is missing delivery details.', 'error');
      return;
    }
    businessQueue.mark(id, { status: 'sending', error: undefined });
    refreshQueue();
    try {
      await mail.sendBusiness(item.domain, item.recipients || item.to.split(','), item.subject, item.body, item.fromAddress);
      businessQueue.mark(id, { status: 'sent', error: undefined });
      showToast('Queued message delivered');
    } catch (error) {
      const retryCount = item.retryCount + 1;
      businessQueue.mark(id, {
        status: retryCount >= 3 ? 'failed' : 'deferred',
        retryCount,
        error: error instanceof Error ? error.message : 'Retry failed',
      });
      showToast('Retry failed. Message kept in queue.', 'error');
    } finally {
      refreshQueue();
      setAuditLog(businessAudit.getAll());
    }
  };

  const handlePauseQueueItem = (id: string) => {
    if (!canManageWorkspace) {
      showToast('Only admins can pause queued messages.', 'error');
      return;
    }
    businessQueue.mark(id, { status: 'deferred', error: 'Paused by workspace admin.' });
    refreshQueue();
    showToast('Message paused');
  };

  const handleDeleteQueueItem = (id: string) => {
    if (!canManageWorkspace) {
      showToast('Only admins can delete queued messages.', 'error');
      return;
    }
    businessQueue.remove(id);
    refreshQueue();
    showToast('Message deleted from queue');
  };

  const handleRunScheduledQueue = async () => {
    if (!canCompose) {
      showToast('Viewer access cannot dispatch scheduled mail.', 'error');
      return;
    }
    const delivered = await mail.dispatchScheduledDue(activeDomainName);
    refreshQueue();
    refetchEmails();
    setAuditLog(businessAudit.getAll());
    showToast(delivered > 0 ? `${delivered} scheduled email${delivered === 1 ? '' : 's'} delivered` : 'No scheduled emails are due yet');
  };

  const handleCreateTemplate = () => {
    if (!canManageTemplates) {
      showToast('Your role cannot create templates.', 'error');
      return;
    }
    setTemplateName('');
    setTemplateSubject('');
    setTemplateBody('');
    setTemplateEditorOpen(true);
  };

  const handleTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageTemplates) {
      showToast('Your role cannot create templates.', 'error');
      return;
    }
    if (!templateName.trim()) {
      showToast('Template name is required.', 'error');
      return;
    }
    const newTemplate: BusinessTemplate = {
      id: crypto.randomUUID(),
      name: templateName.trim(),
      subject: templateSubject.trim(),
      body: templateBody.trim(),
      usageCount: 0,
    };
    const next = [...templates, newTemplate];
    setTemplates(next);
    businessTemplates.save(next);
    businessAudit.add({
      action: 'Created template',
      actor: user?.email || 'current user',
      target: newTemplate.name,
      severity: 'info',
    });
    setAuditLog(businessAudit.getAll());
    setTemplateEditorOpen(false);
    showToast(`Template "${newTemplate.name}" created`);
  };

  const handleUseTemplate = (template: BusinessTemplate) => {
    if (!canCompose) {
      showToast('Viewer access cannot compose from templates.', 'error');
      return;
    }
    setComposeOpen(true);
    setComposeSubject(template.subject);
    setComposeBody(template.body.replace(/\{\{name\}\}/g, ''));
    const next = templates.map((entry) => (
      entry.id === template.id
        ? { ...entry, usageCount: entry.usageCount + 1, lastUsed: new Date().toISOString() }
        : entry
    ));
    setTemplates(next);
    businessTemplates.save(next);
    showToast(`Template "${template.name}" loaded`);
  };

  const handleDeleteTemplate = (id: string) => {
    if (!canManageTemplates) {
      showToast('Your role cannot delete templates.', 'error');
      return;
    }
    const template = templates.find((entry) => entry.id === id);
    const next = templates.filter(t => t.id !== id);
    setTemplates(next);
    businessTemplates.save(next);
    if (template) {
      businessAudit.add({
        action: 'Deleted template',
        actor: user?.email || 'current user',
        target: template.name,
        severity: 'warn',
      });
      setAuditLog(businessAudit.getAll());
    }
    showToast('Template deleted');
  };

  const refreshConnectionUsage = () => {
    setConnectionUsage(connections.getUsage());
  };

  const handleCreateMailbox = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageWorkspace) {
      showToast('Only admins can create mailboxes.', 'error');
      return;
    }
    if (!mailboxLocalPart.trim()) {
      showToast('Please enter a mailbox address (local part).', 'error');
      return;
    }
    if (!activeDomainName) {
      showToast('Select a business domain first.', 'error');
      return;
    }
    try {
      const created = businessMailboxes.create(activeDomainName, {
        localPart: mailboxLocalPart,
        displayName: mailboxDisplayName,
        kind: mailboxKind,
      });
      const next = businessMailboxes.getByDomain(activeDomainName);
      // Deduplicate by address
      const uniqueNext = Array.from(new Map(next.map(m => [m.address, m])).values());
      setDomainMailboxes(uniqueNext);
      setMailboxLocalPart('');
      setMailboxDisplayName('');
      setMailboxKind('mailbox');
      businessAudit.add({
        action: 'Created business mailbox',
        actor: user?.email || 'current user',
        target: created.address,
        severity: 'info',
      });
      setAuditLog(businessAudit.getAll());
      showToast(`Mailbox ${created.address} created`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Mailbox create failed', 'error');
    }
  };

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageWorkspace) {
      showToast('Only admins can create groups.', 'error');
      return;
    }
    if (!activeDomainName) {
      showToast('Select a business domain first.', 'error');
      return;
    }
    try {
      const created = businessGroups.create(activeDomainName, {
        name: groupName,
        localPart: groupLocalPart,
        members: groupMembers.split(',').map((entry) => entry.trim()).filter(Boolean),
      });
      setDomainGroups(businessGroups.getByDomain(activeDomainName));
      setGroupName('');
      setGroupLocalPart('');
      setGroupMembers('');
      businessAudit.add({
        action: 'Created business group',
        actor: user?.email || 'current user',
        target: created.address,
        severity: 'info',
      });
      setAuditLog(businessAudit.getAll());
      showToast(`Group ${created.address} created`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Group create failed', 'error');
    }
  };

  const handleRunDomainVerification = async (domainId: string) => {
    if (!canManageWorkspace) {
      showToast('Only admins can verify domains.', 'error');
      return;
    }
    const selectedDomain = domains.getById(domainId);
    if (!selectedDomain || !user?.businessDbUrl || !user.businessApiKey || !user.businessMailProvider) {
      showToast('Domain, database, or provider configuration is incomplete.', 'error');
      return;
    }

    setVerifyingDomainId(domainId);
    setDomainVerifyOpen(true);
    setDomainVerifyProviderRecords([]);
    setDomainVerifySteps([
      { label: 'Starting verification', detail: selectedDomain.domain, status: 'pending' },
    ]);

    try {
      const result = await fetchApiJsonDetailed<{
        success: boolean;
        message: string;
        checks?: Array<{ label: string; actual?: string; expected: string; status: 'verified' | 'failed' }>;
        runtimeChecks?: DomainVerifyRuntimeCheck[];
        providerRecords?: ProviderDnsRecord[];
      }>('/tenants/verify-domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: selectedDomain.domain,
          verificationToken: selectedDomain.verificationToken,
          dbUrl: user.businessDbUrl,
          apiKey: user.businessApiKey,
          provider: user.businessMailProvider,
          providerEndpoint: user.businessMailProviderEndpoint,
        }),
      });

      const dnsSteps = Array.isArray(result.data?.checks)
        ? result.data!.checks!.map((check) => ({
            label: check.label,
            detail: check.actual || check.expected,
            status: check.status,
          }))
        : [];
      const runtimeSteps = Array.isArray(result.data?.runtimeChecks)
        ? result.data!.runtimeChecks!.map((check) => ({
            label: check.label,
            detail: check.detail,
            status: check.status,
            recommendation: check.recommendation,
          }))
        : [];

      setDomainVerifySteps([...dnsSteps, ...runtimeSteps]);
      setDomainVerifyProviderRecords(Array.isArray(result.data?.providerRecords) ? result.data!.providerRecords! : []);

      if (!result.ok || !result.data?.success) {
        throw new Error(result.data?.message || `Verification failed with status ${result.status}.`);
      }

      domains.runVerification(domainId, result.data.checks);
      domains.setPrimary(domainId);
      setDomainsList(domains.getAll().map(toDomainRecord));
      businessAudit.add({
        action: 'Verified domain',
        actor: user.email,
        target: selectedDomain.domain,
        severity: 'info',
      });
      setAuditLog(businessAudit.getAll());
      showToast(`Domain ${selectedDomain.domain} verified`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Domain verification failed', 'error');
    } finally {
      setVerifyingDomainId('');
    }
  };

  const unreadCount = activeDomainName ? mail.getBusinessUnreadCount(activeDomainName) : 0;
  const priorityCount = activeDomainName
    ? mail.getBusinessByFolderSync(activeDomainName, 'inbox').filter(e => e.labels?.includes('priority')).length
    : 0;

  const toggleEmailSelection = (id: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkAction = () => {
    if (!bulkAction || selectedEmails.size === 0) return;
    selectedEmails.forEach((emailId: string) => {
      if (bulkAction === 'delete') mail.delete(emailId);
      else if (bulkAction === 'archive') mail.archive(emailId);
      else if (bulkAction === 'read') mail.markRead(emailId);
      else if (bulkAction === 'unread') mail.markUnread(emailId);
      else if (bulkAction === 'unarchive') mail.moveFolder(emailId, 'inbox');
      else if (bulkAction === 'spam') mail.moveFolder(emailId, 'spam');
      else if (bulkAction === 'safe') mail.markSafe(emailId);
      else if (bulkAction === 'priority') mail.togglePriority(emailId);
      else if (bulkAction === 'star') mail.toggleStar(emailId);
      else if (bulkAction === 'permanentDelete') mail.permanentDelete(emailId);
    });
    refetchEmails();
    showToast(`Bulk action "${bulkAction}" applied to ${selectedEmails.size} emails`);
    setSelectedEmails(new Set());
    setBulkAction('');
  };

  const handleAddDomain = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageWorkspace) {
      showToast('Only admins can add domains.', 'error');
      return;
    }
    if (!newDomainInput.trim()) return;
    setAddingDomain(true);
    const created = domains.addDomain(newDomainInput);
    const record = toDomainRecord(created);
    setDomainsList(prev => prev.some(d => d.id === record.id) ? prev : [...prev, record]);
    setActiveDomain(record.id);
    setActiveBizTab('domains');
    setAuditLog(prev => [{
      id: crypto.randomUUID(),
      action: 'Domain added',
      actor: user?.email || 'current user',
      target: record.domain,
      timestamp: new Date().toISOString(),
      severity: 'info',
    }, ...prev]);
    setAddingDomain(false);
    setNewDomainInput('');
    setShowAddDomain(false);
    showToast(`Domain ${record.domain} added. Complete DNS verification before using it.`);
  };

  const copyToClipboard = (text: string, fieldId?: string) => {
    navigator.clipboard.writeText(text);
    if (fieldId) {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    }
    showToast('Copied to clipboard');
  };

  const toggleTheme = () => {
    const next = themeMode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('velismail_theme', next);
    setThemeMode(next);
  };

  if (!user || !user.isBusinessSetupComplete || !user.businessDbUrl?.trim() || !user.businessApiKey?.trim()) return null;

  const businessMailbox = user.businessMailboxAddress || (activeDomainName ? `admin@${activeDomainName}` : user.email);

  return (
    <div className="biz-dash animate-page">
      <div className={`dash-sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}></div>
      {/* Sidebar */}
      <aside className={`biz-sidebar glass ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="dash-brand" onClick={() => navigate('/')}>
            <img src="/ZeeResizer.png" alt="VelisMail" style={{ height: '20px', width: 'auto' }} />
            <div className="dash-brand-info">
              <span className="dash-brand-name">VelisMail</span>
              <span className="badge badge-accent dash-brand-sub" style={{ fontSize: '0.65rem', padding: '2px 6px' }}>Business</span>
            </div>
          </div>

          <button className="btn btn-primary compose-btn" onClick={() => canCompose ? setComposeOpen(true) : showToast('Viewer access cannot compose messages.', 'error')} disabled={!canCompose}>
            <Plus size={18} /> <span>Compose</span>
          </button>

          <nav className="sidebar-folders">
            {canManageWorkspace && (
              <>
                <div className="sidebar-section-title">Management</div>
                <button className="folder-btn add-domain-shortcut" onClick={() => { setActiveBizTab('domains'); setShowAddDomain(true); setSidebarOpen(false); }}>
                  <Plus size={17} />
                  <span className="folder-label">Add Domain</span>
                </button>
              </>
            )}
            {/* Mail & Communications */}
            <div className="sidebar-section-title">Mail & Communications</div>
            <button className={`folder-btn ${activeBizTab === 'mail' && !activeFolder ? 'active' : ''}`} onClick={() => { setActiveBizTab('mail'); setSidebarOpen(false); }}>
              <Mail size={17} />
              <span className="folder-label">Mailbox</span>
            </button>
            
            {activeBizTab === 'mail' && (
              <div style={{ marginLeft: '16px', marginBottom: '8px', borderLeft: '1px solid var(--border-primary)', paddingLeft: '8px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                {BIZ_FOLDERS.map(f => {
                  const Icon = f.icon;
                  const count = f.id === 'inbox' ? unreadCount : f.id === 'priority' ? priorityCount : 0;
                  return (
                    <button key={f.id}
                      className={`folder-btn ${activeFolder === f.id ? 'active' : ''}`}
                      onClick={() => { setActiveFolder(f.id); setSelectedEmail(null); setSidebarOpen(false); }}
                      style={{ padding: '4px 8px', fontSize: '0.8rem', minHeight: '30px' }}
                    >
                      <Icon size={15} />
                      <span className="folder-label">{f.label}</span>
                      {count > 0 && <span className="folder-count">{count}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {hasRoleAccess(currentRole, 'templates') && (
              <button className={`folder-btn ${activeBizTab === 'templates' ? 'active' : ''}`} onClick={() => { setActiveBizTab('templates'); setSidebarOpen(false); }}>
                <Layers size={17} />
                <span className="folder-label">Templates</span>
              </button>
            )}
            {hasRoleAccess(currentRole, 'queue') && (
              <button className={`folder-btn ${activeBizTab === 'queue' ? 'active' : ''}`} onClick={() => { setActiveBizTab('queue'); setSidebarOpen(false); }}>
                <Server size={17} />
                <span className="folder-label">Mail Queue</span>
                {mailQueue.filter(q => q.status === 'queued' || q.status === 'sending').length > 0 && (
                  <span className="folder-count">{mailQueue.filter(q => q.status === 'queued' || q.status === 'sending').length}</span>
                )}
              </button>
            )}

            {(canManageWorkspace || hasRoleAccess(currentRole, 'team')) && (
              <div className="sidebar-section-title" style={{ marginTop: '16px' }}>Organization</div>
            )}
            {canManageWorkspace && (
              <>
                <button className={`folder-btn ${activeBizTab === 'domains' ? 'active' : ''}`} onClick={() => { setActiveBizTab('domains'); setSidebarOpen(false); }}>
                  <Globe size={17} />
                  <span className="folder-label">Domains</span>
                </button>
                <button className={`folder-btn ${activeBizTab === 'mailboxes' ? 'active' : ''}`} onClick={() => { setActiveBizTab('mailboxes'); setSidebarOpen(false); }}>
                  <Inbox size={17} />
                  <span className="folder-label">Business Mailboxes</span>
                </button>
                <button className={`folder-btn ${activeBizTab === 'groups' ? 'active' : ''}`} onClick={() => { setActiveBizTab('groups'); setSidebarOpen(false); }}>
                  <Users size={17} />
                  <span className="folder-label">Groups</span>
                </button>
              </>
            )}
            {hasRoleAccess(currentRole, 'team') && (
              <button className={`folder-btn ${activeBizTab === 'team' ? 'active' : ''}`} onClick={() => { setActiveBizTab('team'); setSidebarOpen(false); }}>
                <Shield size={17} />
                <span className="folder-label">Team Access</span>
              </button>
            )}

            <div className="sidebar-section-title" style={{ marginTop: '16px' }}>Administration</div>
            {hasRoleAccess(currentRole, 'analytics') && (
              <button className={`folder-btn ${activeBizTab === 'analytics' ? 'active' : ''}`} onClick={() => { setActiveBizTab('analytics'); setSidebarOpen(false); }}>
                <BarChart3 size={17} />
                <span className="folder-label">Analytics</span>
              </button>
            )}
            {canManageWorkspace && (
              <>
                <button className={`folder-btn ${activeBizTab === 'audit' ? 'active' : ''}`} onClick={() => { setActiveBizTab('audit'); setSidebarOpen(false); }}>
                  <Activity size={17} />
                  <span className="folder-label">Audit Log</span>
                </button>
                <button className={`folder-btn ${activeBizTab === 'settings' ? 'active' : ''}`} onClick={() => { setActiveBizTab('settings'); setSidebarOpen(false); }}>
                  <Settings size={17} />
                  <span className="folder-label">Settings</span>
                </button>
                <button className={`folder-btn ${activeBizTab === 'billing' ? 'active' : ''}`} onClick={() => { setActiveBizTab('billing'); setSidebarOpen(false); }}>
                  <CreditCard size={17} />
                  <span className="folder-label">Billing & Premium</span>
                </button>
              </>
            )}


          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="sidebar-user">
            <div className="user-avatar biz-avatar">{user.displayName?.charAt(0) || 'A'}</div>
            <div className="user-info">
              <span className="user-name">{user.displayName}</span>
              <span className="user-email">{businessMailbox}</span>
            </div>
          </div>
          <div className="sidebar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/settings')} title="Settings">
              <Settings size={16} />
            </button>

            <button className="btn btn-ghost btn-sm" onClick={toggleTheme} title="Toggle Theme">
              {themeMode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowLogoutConfirm(true)} title="Log out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className={`biz-main ${selectedEmail ? 'reader-open' : ''}`}>
        {/* Mobile Global Header */}
        <div className="mobile-dash-header">
          <button className="btn btn-icon btn-ghost" onClick={() => setSidebarOpen(true)}>
            <Menu size={20} />
          </button>
          <div className="mobile-brand" style={{ fontSize: '1.05rem' }}>
            <span style={{ textTransform: 'capitalize' }}>
              {activeBizTab === 'mail' 
                ? (BIZ_FOLDERS.find(f => f.id === activeFolder)?.label || 'Mailbox') 
                : activeBizTab.replace('-', ' ')}
            </span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
            <button className="btn btn-icon btn-ghost" onClick={() => canCompose ? setComposeOpen(true) : showToast('Viewer access cannot compose messages.', 'error')} title="Compose" disabled={!canCompose}>
              <Plus size={20} />
            </button>
            <button className="btn btn-icon btn-ghost" onClick={() => setActiveBizTab('analytics')} title="Analytics">
              <BarChart3 size={20} />
            </button>
          </div>
        </div>

        {/* ===== MAIL TAB ===== */}
        {activeBizTab === 'mail' && (
          <>
            {selectedEmail ? (
              <div className="dash-reader glass">
                <div className="reader-content animate-fade">
                  <div className="reader-toolbar">
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedEmail(null)}>
                      <ArrowLeft size={16} /> Back
                    </button>
                    <div className="reader-toolbar-actions" style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-ghost btn-icon" title="Reply" onClick={handleReply} style={{ width: '42px', height: '42px' }}><Reply size={22} /></button>
                      <button className="btn btn-ghost btn-icon" title="Forward" onClick={handleForward} style={{ width: '42px', height: '42px' }}><Forward size={22} /></button>
                      <button className="btn btn-ghost btn-icon" title="Print" onClick={() => { window.print(); showToast('Preparing print view...'); }} style={{ width: '42px', height: '42px' }}><ExternalLink size={22} /></button>
                      <button className="btn btn-ghost btn-icon" title="Toggle Priority" onClick={() => handleTogglePriority()} style={{ width: '42px', height: '42px' }}><Zap size={22} /></button>
                      {selectedEmail.folder === 'archive' || selectedEmail.folder === 'trash' || selectedEmail.folder === 'spam' ? (
                        <button className="btn btn-ghost btn-icon" title="Move to Inbox" onClick={() => handleMoveToInbox()} style={{ width: '42px', height: '42px' }}><Inbox size={22} /></button>
                      ) : (
                        <button className="btn btn-ghost btn-icon" title="Archive" onClick={() => handleArchive()} style={{ width: '42px', height: '42px' }}><ArchiveIcon size={22} /></button>
                      )}
                      {selectedEmail.folder !== 'spam' && <button className="btn btn-ghost btn-icon" title="Mark as Spam" onClick={() => handleMarkSpam()} style={{ width: '42px', height: '42px' }}><AlertCircle size={22} /></button>}
                      {(selectedEmail.folder === 'spam' || isScamEmail(selectedEmail)) && (
                        <button className="btn btn-ghost btn-icon" title="Mark Safe" onClick={() => handleMarkSafe()} style={{ width: '42px', height: '42px' }}><ShieldCheck size={22} /></button>
                      )}
                      {selectedEmail.folder === 'trash' ? (
                        <button className="btn btn-danger btn-icon" title="Delete permanently" onClick={() => handlePermanentDelete()} style={{ width: '42px', height: '42px' }}><Trash size={22} /></button>
                      ) : (
                        <button className="btn btn-danger btn-icon" title="Move to Trash" onClick={() => handleDeleteEmail()} style={{ width: '42px', height: '42px' }}><Trash size={22} /></button>
                      )}
                    </div>
                  </div>
                  <div className="reader-header">
                    <h1 className="reader-subject">{selectedEmail.subject}</h1>
                    {selectedEmail.labels.length > 0 && (
                      <div className="reader-labels">
                        {selectedEmail.labels.map(l => <span key={l} className="badge badge-primary">{l}</span>)}
                      </div>
                    )}
                  </div>
                  <div className="reader-meta">
                    <div className="reader-sender-info">
                      <div className="reader-avatar biz-reader-avatar">{(selectedEmail.fromName || selectedEmail.from).charAt(0)}</div>
                      <div>
                        <div className="reader-sender-name">{selectedEmail.fromName || selectedEmail.from}</div>
                        <div className="reader-sender-email">{selectedEmail.from} -&gt; {selectedEmail.to?.join(', ')}</div>
                        {selectedEmail.scheduledAt && (
                          <div className="reader-schedule">
                            <Clock size={13} /> Scheduled for {new Date(selectedEmail.scheduledAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="reader-date">{new Date(selectedEmail.date).toLocaleString()}</div>
                  </div>
                  <div className="divider" />
                  <div className="reader-body">
                    {selectedEmail.body.split('\n').map((line, i) => <p key={i}>{line || <br />}</p>)}
                  </div>
                  {selectedEmail.hasAttachment && (
                    <div className="reader-attachment glass-card">
                      <Paperclip size={16} />
                      <span>1 Attachment</span>
                      <button className="btn btn-ghost btn-sm"><Download size={14} /> Download</button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="dash-list glass">
                <div className="list-header">
                  <h2 className="list-title">
                    <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                      <Menu size={20} />
                    </button>
                    {BIZ_FOLDERS.find(f => f.id === activeFolder)?.label || 'Inbox'}
                    {unreadCount > 0 && <span className="badge badge-primary">{unreadCount}</span>}
                  </h2>
                  <div className="list-actions">
                    <button className="btn btn-icon btn-ghost" title="Refresh" onClick={() => refetchEmails()}><RefreshCw size={16} /></button>
                    <button className="btn btn-icon btn-ghost" title={viewMode === 'list' ? 'Grid View' : 'List View'} onClick={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}>
                      {viewMode === 'list' ? <Grid size={16} /> : <List size={16} />}
                    </button>
                    <button className="btn btn-icon btn-ghost" onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')} title={`Sort ${sortOrder === 'desc' ? 'Oldest' : 'Newest'}`}>
                      {sortOrder === 'desc' ? <SortDesc size={16} /> : <SortAsc size={16} />}
                    </button>
                  </div>
                </div>

                <div className="list-search">
                  <button
                    className="btn btn-ghost btn-sm select-all-btn"
                    onClick={() => {
                      const allSelected = emails.length > 0 && emails.every(email => selectedEmails.has(email.id));
                      setSelectedEmails(allSelected ? new Set() : new Set(emails.map(email => email.id)));
                    }}
                    disabled={emails.length === 0}
                    title="Select all visible emails"
                  >
                    {emails.length > 0 && emails.every(email => selectedEmails.has(email.id)) ? <CheckSquare size={16} /> : <Square size={16} />}
                    Select all
                  </button>
                  <Search size={16} />
                  <input type="text" placeholder="Search sender, subject, body, labels..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  <select className="input input-sm mail-filter-select" value={mailStatusFilter} onChange={e => setMailStatusFilter(e.target.value as typeof mailStatusFilter)}>
                    <option value="all">All mail</option>
                    <option value="unread">Unread</option>
                    <option value="read">Read</option>
                    <option value="starred">Starred</option>
                    <option value="priority">Priority</option>
                    <option value="attachments">Attachments</option>
                  </select>
                  {searchQuery && <button className="search-clear" onClick={() => setSearchQuery('')}><X size={14} /></button>}
                </div>

                {selectedEmails.size > 0 && (
                  <div className="bulk-bar glass-card">
                    <span>{selectedEmails.size} selected</span>
                    <select className="input input-sm" value={bulkAction} onChange={e => setBulkAction(e.target.value)}>
                      <option value="">Bulk Action</option>
                      <option value="read">Mark as read</option>
                      <option value="unread">Mark as unread</option>
                      <option value="star">Toggle star</option>
                      <option value="priority">Toggle priority</option>
                      <option value="archive">Archive</option>
                      <option value="unarchive">Move to inbox</option>
                      <option value="spam">Mark as spam</option>
                      <option value="safe">Mark safe</option>
                      <option value="delete">Delete</option>
                      <option value="permanentDelete">Delete permanently</option>
                    </select>
                    <button className="btn btn-primary btn-sm" onClick={handleBulkAction} disabled={!bulkAction}>Apply</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedEmails(new Set())}>Clear</button>
                  </div>
                )}

                <div className="mail-list">
                  {emails.length === 0 ? (
                    <div className="list-empty">
                      <Mail size={32} opacity={0.2} />
                      <p>No emails</p>
                      <span className="list-empty-sub">Emails for {activeDomainName || 'your selected domain'} will appear here</span>
                    </div>
                  ) : viewMode === 'list' ? (
                    emails.map(email => (
                      <div key={email.id}
                        className={`mail-row ${email.unread ? 'unread' : ''}`}
                        onClick={() => handleSelectEmail(email)}
                      >
                        <button className="select-btn" onClick={(e) => { e.stopPropagation(); toggleEmailSelection(email.id); }}>
                          {selectedEmails.has(email.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                        <button className={`star-btn ${email.starred ? 'starred' : ''}`} onClick={(e) => { e.stopPropagation(); mail.toggleStar(email.id); refetchEmails(); }}>
                          <Star size={15} fill={email.starred ? '#facc15' : 'none'} color={email.starred ? '#facc15' : 'var(--text-muted)'} />
                        </button>
                        <div className="mail-row-body">
                          <div className="mail-row-top">
                            <span className="mail-sender">{email.fromName || email.from}</span>
                            {isScamEmail(email) && <span className="badge badge-danger" style={{ marginLeft: 8 }}>Scam</span>}
                            {email.scheduledAt && <span className="badge badge-warning" style={{ marginLeft: 8 }}>Scheduled {formatRelative(email.scheduledAt)}</span>}
                            <span className="mail-date">{formatRelative(email.date)}</span>
                          </div>
                          <div className="mail-subject">{email.subject}</div>
                          <div className="mail-preview">{email.body.slice(0, 80)}…</div>
                          {email.labels.length > 0 && (
                            <div className="mail-labels">
                              {email.labels.map(l => <span key={l} className="badge badge-sm">{l}</span>)}
                            </div>
                          )}
                        </div>
                        {email.hasAttachment && <Paperclip size={14} className="attach-icon" />}
                      </div>
                    ))
                  ) : (
                    <div className="mail-grid">
                      {emails.map(email => (
                        <div key={email.id}
                          className={`mail-card ${email.unread ? 'unread' : ''}`}
                          onClick={() => handleSelectEmail(email)}
                        >
                          <div className="mail-card-header">
                            <div className="reader-avatar biz-reader-avatar" style={{ width: 32, height: 32, fontSize: '0.8rem' }}>
                              {(email.fromName || email.from).charAt(0)}
                            </div>
                            <div className="mail-card-info">
                              <div className="mail-sender" style={{ fontWeight: email.unread ? 700 : 500 }}>{email.fromName || email.from}</div>
                              <div className="mail-date" style={{ fontSize: '0.7rem' }}>{formatRelative(email.date)}</div>
                            </div>
                            {email.starred && <Star size={14} fill="#facc15" color="#facc15" />}
                          </div>
                          {email.scheduledAt && <span className="badge badge-warning">Scheduled {formatRelative(email.scheduledAt)}</span>}
                          <div className="mail-card-subject">{email.subject}</div>
                          <div className="mail-card-preview">{email.body.slice(0, 60)}…</div>
                          {email.labels.length > 0 && (
                            <div className="mail-labels">
                              {email.labels.slice(0, 2).map(l => <span key={l} className="badge badge-sm">{l}</span>)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== DOMAINS TAB ===== */}
        {activeBizTab === 'domains' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <Globe size={20} /> Domain Management
                </h2>
                <p>Manage sending domains, DNS configuration, and mail routing for your organization.</p>
              </div>
              <button className="btn btn-primary" onClick={() => setShowAddDomain(true)}>
                <Plus size={16} /> Add Domain
              </button>
              {activeDomain && <button className="btn btn-ghost" style={{ marginLeft: 8 }} onClick={() => setActiveDomain('')}>Show All</button>}
            </div>

            {showAddDomain && (
              <div className="glass-card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 12 }}>Add New Domain</h3>
                <form onSubmit={handleAddDomain} style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder="domain.com" value={newDomainInput} onChange={e => setNewDomainInput(e.target.value)} />
                  <button className="btn btn-primary" type="submit" disabled={addingDomain}>
                    {addingDomain ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                    Add
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => setShowAddDomain(false)}>Cancel</button>
                </form>
              </div>
            )}

            <div className="domain-cards">
              {domainsList.filter(domain => !activeDomain || activeDomain === domain.id).map(domain => (
                <div key={domain.id} className="glass-card domain-card-full">
                  <div className="domain-card-header">
                    <div className="domain-card-title">
                      <Globe size={18} />
                      <div>
                        <div className="domain-name-lg">{domain.domain}</div>
                        <div className="domain-meta">Added {formatRelative(domain.addedAt)} · {domain.mailCount} emails sent</div>
                      </div>
                      <span className={`badge ${domain.status === 'active' ? 'badge-accent' : 'badge-secondary'}`}>{domain.status}</span>
                      <span className="badge badge-primary">Reputation: {domain.reputation}/100</span>
                    </div>
                    <div className="domain-card-actions">
                      <button className={`btn btn-ghost btn-sm ${activeDomain === domain.id ? 'active' : ''}`} onClick={() => { setActiveDomain(domain.id); domains.setPrimary(domain.id); }}>
                        {activeDomain === domain.id ? <CheckCircle2 size={14} /> : <Square size={14} />}
                        {activeDomain === domain.id ? 'Active' : 'Set Active'}
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleRunDomainVerification(domain.id)} disabled={verifyingDomainId === domain.id}>
                        {verifyingDomainId === domain.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                        Live Verify
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setDomainDetails(domain)}><Settings size={14} /> Manage</button>
                    </div>
                  </div>

                  <div className="domain-health-grid">
                    {domain.health.map(h => (
                      <div key={h.key} className={`health-card ${h.status}`}>
                        <div className="health-card-header">
                          <Shield size={16} />
                          <span className="health-label">{h.label}</span>
                          <span className={`badge badge-sm`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            backgroundColor: h.status === 'verified' ? 'var(--success-glow)' : h.status === 'failed' ? 'var(--danger-glow)' : 'var(--bg-hover)',
                            color: h.status === 'verified' ? 'var(--success)' : h.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)'
                          }}>
                            {h.status === 'verified' ? <CheckCircle2 size={12} /> : h.status === 'failed' ? <XCircle size={12} /> : <Loader2 size={12} className={h.status === 'checking' ? 'animate-spin' : ''} />}
                            {h.status}
                          </span>
                        </div>
                        <div className="health-detail">{h.detail}</div>
                        <div className="health-last-check">Checked {formatRelative(h.lastCheck)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="domain-dns-section">
                    <div className="dns-section-header">
                      <Tag size={14} />
                      <span>DNS records for <strong>{domain.domain}</strong></span>
                    </div>
                    <div className="dns-records-table">
                      <div className="dns-table-header">
                        <span className="dns-col-type">Type</span>
                        <span className="dns-col-name">Host / Name</span>
                        <span className="dns-col-value">Value / Points To</span>
                        <span className="dns-col-priority">Priority</span>
                        <span className="dns-col-ttl">TTL</span>
                      </div>
                      {(domains.getById(domain.id)?.dnsRecords || []).map((record, index) => {
                        const recordKey = `${domain.id}-${index}`;
                        return (
                          <div key={recordKey} className="dns-table-row">
                            <span className="dns-col-type">
                              <span className={`dns-type-badge dns-type-${record.type.toLowerCase()}`}>{record.type}</span>
                            </span>
                            <span className="dns-col-name">
                              <code className="dns-field-value">{record.name}</code>
                              <button
                                className="dns-copy-btn"
                                onClick={() => copyToClipboard(record.name, `name-${recordKey}`)}
                                title="Copy host name"
                              >
                                {copiedField === `name-${recordKey}` ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                              </button>
                            </span>
                            <span className="dns-col-value">
                              <code className="dns-field-value">{record.value}</code>
                              <button
                                className="dns-copy-btn"
                                onClick={() => copyToClipboard(record.value, `value-${recordKey}`)}
                                title="Copy value"
                              >
                                {copiedField === `value-${recordKey}` ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                              </button>
                            </span>
                            <span className="dns-col-priority">
                              {record.priority ? (
                                <>
                                  <code className="dns-field-value">{record.priority}</code>
                                  <button
                                    className="dns-copy-btn"
                                    onClick={() => copyToClipboard(String(record.priority), `pri-${recordKey}`)}
                                    title="Copy priority"
                                  >
                                    {copiedField === `pri-${recordKey}` ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                                  </button>
                                </>
                              ) : <span className="dns-field-na">—</span>}
                            </span>
                            <span className="dns-col-ttl">
                              <code className="dns-field-value">{record.ttl || 3600}</code>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== MAILBOXES TAB ===== */}
        {activeBizTab === 'mailboxes' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <Mail size={20} /> Business Mailboxes
                </h2>
                <p>Create extra sender addresses, aliases, and shared inbox identities for {activeDomainName || 'your selected domain'}.</p>
              </div>
            </div>

            <div className="glass-card" style={{ marginBottom: 16, padding: '24px' }}>
              <h3 style={{ marginBottom: 12 }}>Create Mailbox</h3>
              <form onSubmit={handleCreateMailbox} style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.1fr 0.8fr auto', gap: 12 }}>
                <input className="input" value={mailboxLocalPart} onChange={(e) => setMailboxLocalPart(e.target.value)} placeholder="sales" />
                <input className="input" value={mailboxDisplayName} onChange={(e) => setMailboxDisplayName(e.target.value)} placeholder="Sales Desk" />
                <select className="input" value={mailboxKind} onChange={(e) => setMailboxKind(e.target.value as BusinessMailbox['kind'])}>
                  <option value="mailbox">User Mailbox</option>
                  <option value="alias">Alias Address</option>
                  <option value="shared">Shared Inbox</option>
                </select>
                <button className="btn btn-primary" type="submit"><Plus size={16} /> Add</button>
              </form>
            </div>

            <div className="team-list">
              {domainMailboxes.map((mailbox) => (
                <div key={mailbox.id} className="team-row glass-card">
                  <div className="team-avatar-wrap">
                    <div className="user-avatar biz-avatar">{mailbox.address.charAt(0).toUpperCase()}</div>
                  </div>
                  <div className="team-info">
                    <div className="team-name">{mailbox.displayName}</div>
                    <div className="team-email">{mailbox.address}</div>
                  </div>
                  <div className="team-meta">
                    <div className="team-last-active"><Clock size={12} /> {mailbox.lastUsedAt ? `Used ${formatRelative(mailbox.lastUsedAt)}` : 'Never used yet'}</div>
                    <div className="team-joined">Created {formatRelative(mailbox.createdAt)}</div>
                  </div>
                  <span className={`badge ${mailbox.active ? 'badge-accent' : 'badge-secondary'}`}>{mailbox.kind}</span>
                  <div className="team-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => { businessMailboxes.setPrimary(activeDomainName, mailbox.address); setDomainMailboxes(businessMailboxes.getByDomain(activeDomainName)); setSelectedFromAddress(mailbox.address); showToast(`${mailbox.address} is now the active sender.`); }}>
                      {mailbox.active ? 'Active Sender' : 'Set Sender'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setMailboxDetails(mailbox)}><Eye size={14} /> Manage</button>
                    {mailbox.source !== 'system' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => { businessMailboxes.remove(activeDomainName, mailbox.address); setDomainMailboxes(businessMailboxes.getByDomain(activeDomainName)); showToast('Mailbox removed'); }}>
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== GROUPS TAB ===== */}
        {activeBizTab === 'groups' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <Users size={20} color="var(--primary)" /> Distribution Groups
                </h2>
                <p>Create reusable recipient lists so one email address can fan out to multiple team members.</p>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 24, padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                <div style={{ background: 'var(--primary-glow)', color: 'var(--primary)', padding: '8px', borderRadius: '8px' }}>
                  <Plus size={16} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Create New Group</h3>
              </div>
              <form onSubmit={handleCreateGroup} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 200px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Group Name</label>
                  <input className="input input-sm" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="e.g. Sales Team" required />
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Group Address</label>
                  <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface-2)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius-md)', paddingRight: '12px' }}>
                    <input style={{ flex: 1, background: 'transparent', border: 'none', padding: '6px 12px', color: 'var(--text-primary)', outline: 'none' }} value={groupLocalPart} onChange={(e) => setGroupLocalPart(e.target.value)} placeholder="sales" required />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>@{activeDomainName}</span>
                  </div>
                </div>
                <div style={{ flex: '2 1 300px' }}>
                  <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Members (comma separated)</label>
                  <input className="input input-sm" value={groupMembers} onChange={(e) => setGroupMembers(e.target.value)} placeholder="alice@, bob@" required />
                </div>
                <button className="btn btn-primary btn-sm" type="submit" style={{ minHeight: '34px' }}>Add Group</button>
              </form>
            </div>

            {domainGroups.length === 0 ? (
              <div className="card" style={{ padding: '40px', textAlign: 'center', border: '1px dashed var(--border-primary)', background: 'transparent' }}>
                <div style={{ width: '48px', height: '48px', background: 'var(--bg-surface-2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: 'var(--text-muted)' }}>
                  <Users size={24} />
                </div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '8px' }}>No Groups Yet</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '400px', margin: '0 auto' }}>Create your first distribution group to start managing team email lists efficiently.</p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
                {domainGroups.map((group) => (
                  <div key={group.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-md)', background: 'var(--primary-glow)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem' }}>
                          {group.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <h4 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{group.name}</h4>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{group.address}</span>
                        </div>
                      </div>
                      <button className="btn btn-icon btn-ghost btn-sm" onClick={() => setGroupDetails(group)} title="Manage group">
                        <Eye size={14} />
                      </button>
                      <button className="btn btn-icon btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => { businessGroups.remove(activeDomainName, group.id); setDomainGroups(businessGroups.getByDomain(activeDomainName)); showToast('Group removed'); }}>
                        <Trash size={14} />
                      </button>
                    </div>
                    
                    <div style={{ background: 'var(--bg-surface-2)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
                      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '8px' }}>Members ({group.members.length})</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {group.members.slice(0, 3).map((m, i) => (
                          <span key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            {m}
                          </span>
                        ))}
                        {group.members.length > 3 && (
                          <span style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-primary)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            +{group.members.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== TEAM TAB ===== */}
        {activeBizTab === 'team' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <Users size={20} /> Team Members
                </h2>
                <p>Manage your organization team, roles, and access permissions.</p>
              </div>
              {canManageWorkspace && (
                <button className="btn btn-primary" onClick={() => { setIssuedInvite(null); setInviteOpen(true); }}><Plus size={16} /> Invite Member</button>
              )}
            </div>

            <div className="team-filter-bar">
              <button className={`btn btn-sm ${teamFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTeamFilter('all')}>All ({teamMembers.length})</button>
              <button className={`btn btn-sm ${teamFilter === 'admin' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTeamFilter('admin')}>Admins</button>
              <button className={`btn btn-sm ${teamFilter === 'member' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTeamFilter('member')}>Members</button>
              <button className={`btn btn-sm ${teamFilter === 'viewer' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTeamFilter('viewer')}>Viewers</button>
            </div>

            <div className="team-list">
              {teamMembers.filter(m => teamFilter === 'all' || m.role === teamFilter).map(member => (
                <div key={member.id} className="team-row glass-card">
                  <div className="team-avatar-wrap">
                    <div className="user-avatar biz-avatar">{member.name.charAt(0)}</div>
                  </div>
                  <div className="team-info">
                    <div className="team-name">{member.name}</div>
                    <div className="team-email">{member.email}</div>
                  </div>
                  <div className="team-meta">
                    <div className="team-last-active"><Clock size={12} /> Active {formatRelative(member.lastActive)}</div>
                    <div className="team-joined">
                      {member.status === 'pending'
                        ? `Invite ${formatInviteExpiry(member.inviteExpiresAt).toLowerCase()}`
                        : `Joined ${formatRelative(member.addedAt)}`}
                    </div>
                  </div>
                  <span className={`badge ${member.role === 'admin' ? 'badge-accent' : member.role === 'member' ? 'badge-primary' : 'badge-secondary'}`}>{member.role}</span>
                  <div className="team-actions">
                    {member.inviteToken && (
                      <button className="btn btn-ghost btn-sm team-api-copy-btn" onClick={() => copyToClipboard(member.inviteToken || '')}>
                        <KeyRound size={14} /> Copy API Key
                      </button>
                    )}
                    {canManageWorkspace && (
                      <>
                        <select className="input input-sm role-select" value={member.role} onChange={e => handleUpdateMemberRole(member.id, e.target.value as BusinessTeamMember['role'])}>
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button className="btn btn-ghost btn-sm" onClick={() => handleRemoveMember(member.id)}><XCircle size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="roles-info glass-card">
              <h3><KeyRound size={16} /> Role Permissions</h3>
              <div className="roles-grid">
                <div className="role-card">
                  <div className="role-title badge badge-accent">Admin</div>
                  <ul>
                    <li>Full domain management</li>
                    <li>Team member control</li>
                    <li>API key management</li>
                    <li>Audit log access</li>
                    <li>Billing management</li>
                  </ul>
                </div>
                <div className="role-card">
                  <div className="role-title badge badge-primary">Member</div>
                  <ul>
                    <li>Send/receive emails</li>
                    <li>Manage templates</li>
                    <li>View team members</li>
                    <li>Analytics view</li>
                  </ul>
                </div>
                <div className="role-card">
                  <div className="role-title badge badge-secondary">Viewer</div>
                  <ul>
                    <li>Read emails</li>
                    <li>View analytics</li>
                    <li>No sending</li>
                    <li>No configuration</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== QUEUE TAB ===== */}
        {activeBizTab === 'queue' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <Server size={20} /> Mail Queue
                </h2>
                <p>Monitor outgoing mail delivery, retries, and deferred messages.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowQueueFilters(!showQueueFilters)}>
                  <Filter size={16} /> Filters
                </button>
                <button className="btn btn-ghost btn-sm" onClick={refreshQueue}><RefreshCcw size={16} /> Refresh</button>
                <button className="btn btn-ghost btn-sm" onClick={handleRunScheduledQueue}><Clock size={16} /> Run Due</button>
                <button className="btn btn-ghost btn-sm" onClick={() => { businessQueue.clearSent(); refreshQueue(); }}>
                  <Trash2 size={16} /> Clear Sent
                </button>
              </div>
            </div>

            {showQueueFilters && (
              <div className="glass-card queue-filters" style={{ marginBottom: 16 }}>
                <label>Status:</label>
                <select className="input input-sm" value={queueStatusFilter} onChange={e => setQueueStatusFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value="queued">Queued</option>
                  <option value="sending">Sending</option>
                  <option value="sent">Sent</option>
                  <option value="failed">Failed</option>
                  <option value="deferred">Deferred</option>
                </select>
              </div>
            )}

            <div className="queue-stats">
              <div className="queue-stat glass-card">
                <div className="queue-stat-value">{mailQueue.filter(q => q.status === 'queued').length}</div>
                <div className="queue-stat-label">Queued</div>
              </div>
              <div className="queue-stat glass-card">
                <div className="queue-stat-value">{mailQueue.filter(q => q.status === 'queued' && q.scheduledAt).length}</div>
                <div className="queue-stat-label">Scheduled</div>
              </div>
              <div className="queue-stat glass-card">
                <div className="queue-stat-value">{mailQueue.filter(q => q.status === 'sending').length}</div>
                <div className="queue-stat-label">Sending</div>
              </div>
              <div className="queue-stat glass-card">
                <div className="queue-stat-value">{mailQueue.filter(q => q.status === 'failed').length}</div>
                <div className="queue-stat-label">Failed</div>
              </div>
              <div className="queue-stat glass-card">
                <div className="queue-stat-value">{mailQueue.filter(q => q.status === 'deferred').length}</div>
                <div className="queue-stat-label">Deferred</div>
              </div>
            </div>

            <div className="queue-table-wrap">
              <table className="queue-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>To</th>
                    <th>Subject</th>
                    <th>Queued</th>
                    <th>Scheduled For</th>
                    <th>Retries</th>
                    <th>Error</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {mailQueue.filter(q => queueStatusFilter === 'all' || q.status === queueStatusFilter).map(item => (
                    <tr key={item.id} className={`queue-row queue-${item.status}`}>
                      <td>
                        <span className={`badge ${item.status === 'sent' ? 'badge-accent' : item.status === 'failed' ? 'badge-danger' : item.status === 'deferred' ? 'badge-warning' : 'badge-primary'}`}>
                          {item.status === 'sending' ? <Loader2 size={12} className="animate-spin" /> : null}
                          {item.status}
                        </span>
                      </td>
                      <td className="queue-to">{item.to}</td>
                      <td className="queue-subject">{item.subject}</td>
                      <td className="queue-time">{formatRelative(item.queuedAt)}</td>
                      <td className="queue-time">
                        {item.scheduledAt ? (
                          <span className="queue-schedule">
                            <Clock size={12} /> {new Date(item.scheduledAt).toLocaleString()} ({formatRelative(item.scheduledAt)})
                          </span>
                        ) : 'Send now'}
                      </td>
                      <td className="queue-retries">{item.retryCount}/{item.retryCount >= 3 ? 'MAX' : '3'}</td>
                      <td className="queue-error">{item.error || '—'}</td>
                      <td className="queue-actions">
                        {item.status === 'queued' && <button className="btn btn-ghost btn-icon btn-sm" title="Pause" onClick={() => handlePauseQueueItem(item.id)}><Pause size={14} /></button>}
                        {item.status === 'deferred' && <button className="btn btn-ghost btn-icon btn-sm" title="Retry" onClick={() => handleRetryQueueItem(item.id)}><RefreshCcw size={14} /></button>}
                        {item.status === 'failed' && <button className="btn btn-ghost btn-icon btn-sm" title="Retry" onClick={() => handleRetryQueueItem(item.id)}><RefreshCcw size={14} /></button>}
                        <button className="btn btn-danger btn-icon btn-sm" title="Delete" onClick={() => handleDeleteQueueItem(item.id)}><Trash size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  {mailQueue.filter(q => queueStatusFilter === 'all' || q.status === queueStatusFilter).length === 0 && (
                    <tr>
                      <td colSpan={8} className="queue-empty">
                        No messages match this queue view.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== ANALYTICS TAB ===== */}
        {activeBizTab === 'analytics' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <BarChart3 size={20} /> Mail Analytics
                  <span className="live-dot" title="Live" />
                </h2>
                <p>Real-time delivery performance and domain health metrics.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => refetchEmails()}><RefreshCw size={16} /> Refresh</button>
              </div>
            </div>

            <div className="analytics-cards">
              <div className="analytics-card glass-card">
                <div className="analytics-card-label"><Mail size={16} /> Emails Sent</div>
                <div className="analytics-card-value">{mail.getBusinessByFolderSync(activeDomainName, 'sent').length}</div>
                <div className="analytics-card-change neutral">From {activeDomainName}</div>
                <div className="analytics-bar">
                  <div className="analytics-bar-fill" style={{ width: `${Math.min(mail.getBusinessByFolderSync(activeDomainName, 'sent').length * 2, 100)}%` }} />
                </div>
              </div>
              <div className="analytics-card glass-card">
                <div className="analytics-card-label"><Inbox size={16} /> Inbox Count</div>
                <div className="analytics-card-value">{mail.getBusinessByFolderSync(activeDomainName, 'inbox').length}</div>
                <div className="analytics-card-change neutral">Total received</div>
                <div className="analytics-bar">
                  <div className="analytics-bar-fill accent" style={{ width: `${Math.min(mail.getBusinessByFolderSync(activeDomainName, 'inbox').length * 2, 100)}%` }} />
                </div>
              </div>
              <div className="analytics-card glass-card">
                <div className="analytics-card-label"><Globe size={16} /> Active Domains</div>
                <div className="analytics-card-value">{domainsList.filter(d => d.status === 'active').length}/{domainsList.length}</div>
                <div className="analytics-card-change neutral">Verified domains</div>
                <div className="analytics-bar">
                  <div className="analytics-bar-fill accent" style={{ width: `${domainsList.length > 0 ? (domainsList.filter(d => d.status === 'active').length / domainsList.length) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="analytics-card glass-card">
                <div className="analytics-card-label"><Shield size={16} /> Domain Reputation</div>
                <div className="analytics-card-value">{activeDomainRecord?.reputation ?? 0}/100</div>
                <div className="analytics-card-change neutral">DNS health score</div>
                <div className="analytics-bar">
                  <div className="analytics-bar-fill accent" style={{ width: `${activeDomainRecord?.reputation ?? 0}%` }} />
                </div>
              </div>
              <div className="analytics-card glass-card">
                <div className="analytics-card-label"><Users size={16} /> Team Members</div>
                <div className="analytics-card-value">{teamMembers.length}</div>
                <div className="analytics-card-change neutral">{teamMembers.filter(m => m.role === 'admin').length} admins</div>
                <div className="analytics-bar">
                  <div className="analytics-bar-fill muted" style={{ width: `${Math.min(teamMembers.length * 10, 100)}%` }} />
                </div>
              </div>
              <div className="analytics-card glass-card">
                <div className="analytics-card-label"><Activity size={16} /> Audit Events</div>
                <div className="analytics-card-value">{auditLog.length}</div>
                <div className="analytics-card-change neutral">{auditLog.filter(e => e.severity === 'critical' || e.severity === 'warn').length} warnings</div>
                <div className="analytics-bar">
                  <div className="analytics-bar-fill warning" style={{ width: `${auditLog.length > 0 ? Math.min((auditLog.filter(e => e.severity === 'warn').length / auditLog.length) * 100, 100) : 0}%` }} />
                </div>
              </div>
            </div>

            <div className="analytics-charts glass-card">
              <h3><Activity size={16} /> Connection Status</h3>
              <div style={{ display: 'grid', gap: '12px', marginTop: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--bg-surface-2)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                  <span className="live-dot" />
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Mail Provider</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.businessMailProvider || 'Not configured'}</div>
                  </div>
                  <span className="badge badge-accent" style={{ marginLeft: 'auto' }}>{user?.businessMailProvider ? 'Connected' : 'Pending'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--bg-surface-2)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                  <span className={`live-dot ${user?.businessDbUrl ? '' : 'offline'}`} />
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Database</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user?.businessDbUrl ? 'BYOD Connected' : 'Not connected'}</div>
                  </div>
                  <span className={`badge ${user?.businessDbUrl ? 'badge-accent' : 'badge-secondary'}`} style={{ marginLeft: 'auto' }}>{user?.businessDbUrl ? 'Connected' : 'Disconnected'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'var(--bg-surface-2)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                  <span className={`live-dot ${activeDomainRecord?.status === 'active' ? '' : 'offline'}`} />
                  <div>
                    <strong style={{ color: 'var(--text-primary)' }}>Primary Domain</strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{activeDomainName}</div>
                  </div>
                  <span className={`badge ${activeDomainRecord?.status === 'active' ? 'badge-accent' : 'badge-warning'}`} style={{ marginLeft: 'auto' }}>{activeDomainRecord?.status || 'Unknown'}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== AUDIT TAB ===== */}
        {activeBizTab === 'audit' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button className="btn btn-icon btn-ghost mobile-menu-btn" onClick={() => setSidebarOpen(true)}>
                    <Menu size={20} />
                  </button>
                  <Shield size={20} /> Audit Log
                </h2>
                <p>Track all configuration changes, domain operations, and team activity.</p>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="input input-sm" value={auditFilter} onChange={e => setAuditFilter(e.target.value)}>
                  <option value="all">All Events</option>
                  <option value="critical">Critical Only</option>
                  <option value="warn">Warnings</option>
                  <option value="info">Info</option>
                </select>
                <button className="btn btn-ghost btn-sm"><Download size={16} /> Export</button>
              </div>
            </div>

            <div className="audit-log">
              {auditLog.filter(e => auditFilter === 'all' || e.severity === auditFilter).map(entry => (
                <div key={entry.id} className={`audit-row glass-card audit-${entry.severity}`}>
                  <div className="audit-severity-indicator" />
                  <div className="audit-content">
                    <div className="audit-action">
                      <span className={`badge badge-sm badge-${entry.severity === 'critical' ? 'danger' : entry.severity === 'warn' ? 'warning' : 'primary'}`}>{entry.severity}</span>
                      <strong>{entry.action}</strong>
                    </div>
                    <div className="audit-meta">
                      <span><Mail size={12} /> {entry.actor}</span>
                      <span>→</span>
                      <span>{entry.target}</span>
                      <span><Clock size={12} /> {formatRelative(entry.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== TEMPLATES TAB ===== */}
        {activeBizTab === 'templates' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <div>
                <h2><Layers size={20} /> Email Templates</h2>
                <p>Create and manage reusable email templates for consistent communication.</p>
              </div>
              <button className="btn btn-primary" onClick={handleCreateTemplate}><Plus size={16} /> New Template</button>
            </div>

            <div className="list-search" style={{ marginBottom: 16 }}>
              <Search size={16} />
              <input type="text" placeholder="Search templates…" value={templateSearch} onChange={e => setTemplateSearch(e.target.value)} />
            </div>

            <div className="templates-grid">
              {templates.filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase())).map(tpl => (
                <div key={tpl.id} className="template-card glass-card">
                  <div className="template-header">
                    <div className="template-icon"><Layers size={20} /></div>
                    <div className="template-info">
                      <div className="template-name">{tpl.name}</div>
                      <div className="template-subject">{tpl.subject}</div>
                    </div>
                    <div className="template-actions">
                      <button className="btn btn-ghost btn-sm" onClick={() => handleUseTemplate(tpl)}><Edit3 size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setPreviewTemplate(tpl)}><Eye size={14} /></button>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDeleteTemplate(tpl.id)}><Trash size={14} /></button>
                    </div>
                  </div>
                  <div className="template-preview">{tpl.body.slice(0, 80)}…</div>
                  <div className="template-footer">
                    <span className="template-usage"><Mail size={12} /> Used {tpl.usageCount} times</span>
                    {tpl.lastUsed && <span className="template-last">Last: {formatRelative(tpl.lastUsed)}</span>}
                    <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => handleUseTemplate(tpl)}>Use Template</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== SETTINGS TAB (within biz) ===== */}
        {activeBizTab === 'settings' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <h2><Settings size={20} /> Business Settings</h2>
            </div>
            <div className="biz-settings-sections">
              <div className="glass-card">
                <h3><Bell size={16} /> Notifications</h3>
                <div className="toggle-row">
                  <div>
                    <div className="toggle-label">Email Notifications</div>
                    <div className="toggle-desc">Get notified for new business emails</div>
                  </div>
                  <button className={`toggle-btn ${notificationEnabled ? 'on' : ''}`} onClick={() => setNotificationEnabled(!notificationEnabled)}>
                    {notificationEnabled ? <Bell size={16} /> : <BellOff size={16} />}
                  </button>
                </div>
                <div className="toggle-row">
                  <div>
                    <div className="toggle-label">Sound Alerts</div>
                    <div className="toggle-desc">Play sound for new messages</div>
                  </div>
                  <button className={`toggle-btn ${soundEnabled ? 'on' : ''}`} onClick={() => setSoundEnabled(!soundEnabled)}>
                    {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                  </button>
                </div>
              </div>
              <div className="glass-card">
                <h3><Mail size={16} /> Default Sending Domain</h3>
                <select className="input" value={activeDomain} onChange={(e) => { setActiveDomain(e.target.value); domains.setPrimary(e.target.value); }}>
                  {domainsList.map(d => <option key={d.id} value={d.id}>{d.domain}</option>)}
                </select>
              </div>
              <div className="glass-card">
                <h3><Server size={16} /> Connected Infrastructure</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                  {connectionUsage.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', border: '1px dashed var(--danger)', borderRadius: 'var(--radius-md)', background: 'rgba(239, 68, 68, 0.05)' }}>
                      <AlertTriangle size={32} color="var(--danger)" style={{ marginBottom: 8 }} />
                      <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--danger)' }}>No Infrastructure Connected</p>
                      <p style={{ margin: '0 0 16px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Your database and mail provider API keys are not configured. Dashboard functionality requires connected infrastructure.</p>
                      <button className="btn btn-primary btn-sm" onClick={() => navigate('/business-setup')}>
                        <Server size={14} /> Reconfigure Infrastructure
                      </button>
                    </div>
                  ) : (
                    connectionUsage.map((usage) => (
                      <div key={usage.id} className="queue-row glass-card" style={{ padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {usage.type === 'database' ? <Database size={16} color="var(--primary)" /> : <KeyRound size={16} color="var(--accent)" />}
                          <div>
                            <strong>{usage.label}</strong>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{usage.maskedValue}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                          {usage.ownerDisplayName}
                          {usage.provider ? ` · ${usage.provider}` : ''}
                        </div>
                        <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>Connected</span>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => setConfirmRevokeId(usage.id)}>
                          <XCircle size={14} /> Revoke
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="glass-card">
                <h3><Lock size={16} /> Security</h3>
                <div className="toggle-row">
                  <div>
                    <div className="toggle-label">Two-Factor Authentication</div>
                    <div className="toggle-desc">Require 2FA for all team members</div>
                  </div>
                  <button className="toggle-btn on"><Lock size={16} /></button>
                </div>
                <div className="toggle-row">
                  <div>
                    <div className="toggle-label">API Access Logging</div>
                    <div className="toggle-desc">Log all API calls to audit trail</div>
                  </div>
                  <button className="toggle-btn on"><Shield size={16} /></button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== BILLING TAB ===== */}
        {activeBizTab === 'billing' && (
          <div className="biz-panel animate-fade">
            <div className="panel-header">
              <h2><CreditCard size={20} /> Billing & Premium</h2>
              <p>Manage your workspace subscription and upgrade to premium features.</p>
            </div>
            
            <div className="billing-pricing-container" style={{ paddingBottom: '40px' }}>
              <div className="billing-toggle-wrap" style={{ margin: '0 auto 32px' }}>
                <span className={!annual ? 'active' : ''}>Monthly</span>
                <button 
                  className={`billing-toggle ${annual ? 'annual' : ''}`}
                  onClick={() => setAnnual(!annual)}
                >
                  <div className="toggle-knob" />
                </button>
                <span className={annual ? 'active' : ''}>
                  Annually
                </span>
                <span className="billing-save-badge">Save 16%</span>
              </div>

              <div className="pricing-grid compact-dash-pricing" style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', 
                gap: '16px',
                padding: '0 8px',
                maxWidth: '100%'
              }}>
                {plans.map((plan) => (
                  <div key={plan.id} className={`pricing-card ${plan.popular ? 'popular' : ''}`} style={{ padding: '20px', fontSize: '0.85rem', borderRadius: '8px' }}>
                    {plan.popular && <div className="popular-badge" style={{ fontSize: '0.7rem', top: '-10px' }}>Most Popular</div>}
                    
                    <div className="plan-header" style={{ marginBottom: '12px' }}>
                      <div className="plan-icon" style={{ width: '36px', height: '36px', borderRadius: '6px', marginBottom: '12px' }}>
                        <plan.icon size={18} />
                      </div>
                      <h3 style={{ fontSize: '1.2rem', marginBottom: '4px' }}>{plan.name}</h3>
                      <p className="plan-desc" style={{ fontSize: '0.8rem', marginBottom: '12px', minHeight: '38px' }}>{plan.desc}</p>
                    </div>

                    <div className="plan-price" style={{ marginBottom: '16px' }}>
                      <span className="currency" style={{ fontSize: '1.1rem' }}>₹</span>
                      <span className="amount" style={{ fontSize: '1.8rem' }}>{formatINR(annual ? Math.round(plan.annualPrice / 12) : plan.monthlyPrice)}</span>
                      <span className="period" style={{ fontSize: '0.8rem' }}>/mo</span>
                    </div>

                    <button 
                      className={`btn ${plan.ctaStyle} btn-block`}
                      onClick={() => handleUpgrade(plan)}
                      disabled={plan.id === 'free' || loadingPayment === plan.id}
                      style={{ height: '36px', fontSize: '0.9rem', marginBottom: '20px' }}
                    >
                      {loadingPayment === plan.id ? 'Processing...' : plan.cta}
                    </button>

                    <ul className="plan-features" style={{ gap: '8px', margin: 0, padding: 0 }}>
                      {plan.features.map((feature, idx) => (
                        <li key={idx} className={feature.highlight ? 'highlight' : ''} style={{ fontSize: '0.8rem', display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <Check size={14} color={feature.highlight ? 'var(--primary)' : 'var(--success)'} />
                          <span>{feature.text}</span>
                        </li>
                      ))}
                      {plan.disabledFeatures.map((feat, idx) => (
                        <li key={`disabled-${idx}`} className="disabled" style={{ fontSize: '0.8rem', display: 'flex', gap: '8px', alignItems: 'center', opacity: 0.5 }}>
                          <X size={14} />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {domainVerifyOpen && (
        <div className="modal-overlay" onClick={() => !verifyingDomainId && setDomainVerifyOpen(false)}>
          <div className="biz-form-modal glass animate-scale" onClick={(e) => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Globe size={16} /> Domain Verification Diagnostics</h3>
              <button className="btn btn-ghost btn-icon" type="button" disabled={Boolean(verifyingDomainId)} onClick={() => setDomainVerifyOpen(false)}><X size={18} /></button>
            </div>
            <div className="diag-steps">
              {domainVerifySteps.map((step, index) => (
                <div key={`${step.label}-${index}`} className={`diag-step diag-${step.status === 'verified' ? 'success' : step.status === 'failed' ? 'error' : 'pending'}`}>
                  <div className="diag-step-icon">
                    {step.status === 'pending'
                      ? <Loader2 size={16} className="animate-spin" />
                      : step.status === 'verified'
                        ? <CheckCircle2 size={16} />
                        : <XCircle size={16} />}
                  </div>
                  <div className="diag-step-info">
                    <span className="diag-step-label">{step.label}</span>
                    <span className="diag-step-detail">{step.detail}</span>
                    {step.recommendation && <span className="diag-step-detail">{step.recommendation}</span>}
                  </div>
                </div>
              ))}
            </div>
            {domainVerifyProviderRecords.length > 0 && (
              <div className="bsetup-dns" style={{ marginTop: 20 }}>
                <p className="dns-instruction-text">Provider-specific DNS records:</p>
                <div className="dns-records-table">
                  <div className="dns-table-header">
                    <span className="dns-col-type">Type</span>
                    <span className="dns-col-name">Host / Name</span>
                    <span className="dns-col-value">Value / Points To</span>
                    <span className="dns-col-priority">Priority</span>
                    <span className="dns-col-ttl">Status</span>
                  </div>
                  {domainVerifyProviderRecords.map((record, index) => {
                    const recordKey = `provider-${index}`;
                    return (
                      <div key={recordKey} className="dns-table-row">
                        <span className="dns-col-type">
                          <span className={`dns-type-badge dns-type-${record.recordType.toLowerCase()}`}>{record.recordType}</span>
                        </span>
                        <span className="dns-col-name">
                          <code className="dns-field-value">{record.name}</code>
                          <button
                            className="dns-copy-btn"
                            onClick={() => copyToClipboard(record.name, `pname-${recordKey}`)}
                            title="Copy host name"
                          >
                            {copiedField === `pname-${recordKey}` ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span className="dns-col-value">
                          <code className="dns-field-value">{record.value}</code>
                          <button
                            className="dns-copy-btn"
                            onClick={() => copyToClipboard(record.value, `pvalue-${recordKey}`)}
                            title="Copy value"
                          >
                            {copiedField === `pvalue-${recordKey}` ? <Check size={12} color="var(--success)" /> : <Copy size={12} />}
                          </button>
                        </span>
                        <span className="dns-col-priority">
                          {record.priority ? (
                            <code className="dns-field-value">{record.priority}</code>
                          ) : <span className="dns-field-na">—</span>}
                        </span>
                        <span className="dns-col-ttl">
                          <span className={`badge badge-sm`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                            backgroundColor: record.status === 'verified' ? 'var(--success-glow)' : record.status === 'failed' ? 'var(--danger-glow)' : 'var(--bg-hover)',
                            color: record.status === 'verified' ? 'var(--success)' : record.status === 'failed' ? 'var(--danger)' : 'var(--text-muted)'
                          }}>
                            {record.status === 'verified' ? <CheckCircle2 size={12} /> : record.status === 'failed' ? <XCircle size={12} /> : <Loader2 size={12} className="animate-spin" />}
                            {record.status || 'pending'}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="biz-modal-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setDomainVerifyOpen(false)} disabled={Boolean(verifyingDomainId)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Compose Modal */}
      {composeOpen && (
        <div className="modal-overlay" onClick={() => !sending && setComposeOpen(false)}>
          <div className="compose-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Mail size={16} /> New Business Email</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => !sending && setComposeOpen(false)} disabled={sending}><X size={18} /></button>
            </div>
            <Composer
              initialTo={composeTo}
              initialSubject={composeSubject}
              initialBody={composeBody}
              onSend={handleSend}
              onClose={() => setComposeOpen(false)}
              sending={sending}
              fromControl={domainMailboxes.length > 1 ? (
                <select className="input" value={selectedFromAddress} onChange={(e) => setSelectedFromAddress(e.target.value)}>
                  {domainMailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={mailbox.address}>
                      {mailbox.displayName} · {mailbox.address}
                    </option>
                  ))}
                </select>
              ) : undefined}
              fromBadge={<div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-primary)' }}><Mail size={14} color="var(--text-muted)" /> {selectedFromAddress || businessMailbox}</div>}
            />
          </div>
        </div>
      )}

      {inviteOpen && (
        <div className="modal-overlay" onClick={() => setInviteOpen(false)}>
          <form className="biz-form-modal glass animate-scale" onSubmit={handleInviteSubmit} onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Users size={16} /> Invite Team Member</h3>
              <button className="btn btn-ghost btn-icon" type="button" onClick={() => setInviteOpen(false)}><X size={18} /></button>
            </div>
            <div style={{ padding: '20px' }}>
              <div className="biz-modal-grid">
                <label>Name<input className="input" value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Jane Doe" /></label>
                <label>Email<input className="input" type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder={`member@${activeDomainName || 'domain.com'}`} required /></label>
                <label>Role
                  <select className="input" value={inviteRole} onChange={e => setInviteRole(e.target.value as BusinessTeamMember['role'])}>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </label>
                <label>Expires
                  <select className="input" value={inviteExpiresHours} onChange={e => setInviteExpiresHours(Number(e.target.value))}>
                    <option value={1}>1 hour</option>
                    <option value={24}>24 hours</option>
                    <option value={72}>3 days</option>
                    <option value={168}>7 days</option>
                    <option value={720}>30 days</option>
                    <option value={0}>No expiry</option>
                  </select>
                </label>
                {issuedInvite && (
                  <label className="biz-modal-full">Team Access API Key
                    <div className="invite-token-panel">
                      <div className="invite-token-header">
                        <span><KeyRound size={14} /> API key for {issuedInvite.email}</span>
                        <strong>{formatInviteExpiry(issuedInvite.expiresAt)}</strong>
                      </div>
                      <div className="invite-token-row">
                        <code>{issuedInvite.token}</code>
                        <button className="btn btn-primary btn-sm" type="button" onClick={() => copyToClipboard(issuedInvite.token)}>
                          <Copy size={14} /> Copy API Key
                        </button>
                      </div>
                    </div>
                  </label>
                )}
              </div>
              <div className="biz-modal-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setInviteOpen(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit"><Plus size={16} /> Send Invite</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {templateEditorOpen && (
        <div className="modal-overlay" onClick={() => setTemplateEditorOpen(false)}>
          <form className="biz-form-modal glass animate-scale" onSubmit={handleTemplateSubmit} onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Layers size={16} /> New Template</h3>
              <button className="btn btn-ghost btn-icon" type="button" onClick={() => setTemplateEditorOpen(false)}><X size={18} /></button>
            </div>
            <div style={{ padding: '20px' }}>
              <div className="biz-modal-grid">
                <label>Template Name<input className="input" value={templateName} onChange={e => setTemplateName(e.target.value)} placeholder="Client onboarding" required /></label>
                <label>Subject<input className="input" value={templateSubject} onChange={e => setTemplateSubject(e.target.value)} placeholder="Welcome to {{company}}" /></label>
                <label className="biz-modal-full">Body<textarea className="input" value={templateBody} onChange={e => setTemplateBody(e.target.value)} placeholder="Hi {{name}}, ..." /></label>
              </div>
              <div className="biz-modal-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setTemplateEditorOpen(false)}>Cancel</button>
                <button className="btn btn-primary" type="submit"><CheckCircle2 size={16} /> Save Template</button>
              </div>
            </div>
          </form>
        </div>
      )}

      {previewTemplate && (
        <div className="modal-overlay" onClick={() => setPreviewTemplate(null)}>
          <div className="biz-form-modal glass animate-scale" onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Eye size={16} /> {previewTemplate.name}</h3>
              <button className="btn btn-ghost btn-icon" type="button" onClick={() => setPreviewTemplate(null)}><X size={18} /></button>
            </div>
            <div className="template-preview-modal">
              <strong>{previewTemplate.subject || 'No subject'}</strong>
              <p>{previewTemplate.body || 'No body content yet.'}</p>
            </div>
            <div className="biz-modal-actions">
              <button className="btn btn-primary" onClick={() => { handleUseTemplate(previewTemplate); setPreviewTemplate(null); }}>Use Template</button>
            </div>
          </div>
        </div>
      )}

      {domainDetails && (
        <div className="modal-overlay" onClick={() => setDomainDetails(null)}>
          <div className="biz-form-modal glass animate-scale detail-modal" onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Globe size={16} /> {domainDetails.domain}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setDomainDetails(null)}><X size={18} /></button>
            </div>
            <div className="detail-modal-body">
              <div className="detail-summary-grid">
                <div><span>Status</span><strong>{domainDetails.status}</strong></div>
                <div><span>Reputation</span><strong>{domainDetails.reputation}/100</strong></div>
                <div><span>Sent</span><strong>{domainDetails.mailCount}</strong></div>
                <div><span>Added</span><strong>{formatRelative(domainDetails.addedAt)}</strong></div>
              </div>
              <div className="detail-list">
                {domainDetails.health.map(item => (
                  <div key={item.key} className={`detail-row ${item.status}`}>
                    <Shield size={15} />
                    <div><strong>{item.label}</strong><span>{item.detail}</span></div>
                    <span className="badge badge-sm">{item.status}</span>
                  </div>
                ))}
              </div>
              <div className="biz-modal-actions">
                <button className="btn btn-ghost" onClick={() => copyToClipboard(domainDetails.domain)}><Copy size={14} /> Copy Domain</button>
                <button className="btn btn-primary" onClick={() => handleRunDomainVerification(domainDetails.id)}><RefreshCcw size={14} /> Verify</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mailboxDetails && (
        <div className="modal-overlay" onClick={() => setMailboxDetails(null)}>
          <div className="biz-form-modal glass animate-scale detail-modal" onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Mail size={16} /> {mailboxDetails.displayName}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setMailboxDetails(null)}><X size={18} /></button>
            </div>
            <div className="detail-modal-body">
              <div className="detail-summary-grid">
                <div><span>Address</span><strong>{mailboxDetails.address}</strong></div>
                <div><span>Type</span><strong>{mailboxDetails.kind}</strong></div>
                <div><span>Active</span><strong>{mailboxDetails.active ? 'Yes' : 'No'}</strong></div>
                <div><span>Created</span><strong>{formatRelative(mailboxDetails.createdAt)}</strong></div>
              </div>
              <div className="biz-modal-actions">
                <button className="btn btn-ghost" onClick={() => copyToClipboard(mailboxDetails.address)}><Copy size={14} /> Copy</button>
                <button className="btn btn-primary" onClick={() => { businessMailboxes.setPrimary(activeDomainName, mailboxDetails.address); setDomainMailboxes(businessMailboxes.getByDomain(activeDomainName)); setSelectedFromAddress(mailboxDetails.address); setMailboxDetails(null); }}><CheckCircle2 size={14} /> Set Sender</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {groupDetails && (
        <div className="modal-overlay" onClick={() => setGroupDetails(null)}>
          <div className="biz-form-modal glass animate-scale detail-modal" onClick={e => e.stopPropagation()}>
            <div className="compose-header">
              <h3><Users size={16} /> {groupDetails.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setGroupDetails(null)}><X size={18} /></button>
            </div>
            <div className="detail-modal-body">
              <div className="detail-summary-grid">
                <div><span>Address</span><strong>{groupDetails.address}</strong></div>
                <div><span>Members</span><strong>{groupDetails.members.length}</strong></div>
                <div><span>Created</span><strong>{formatRelative(groupDetails.createdAt)}</strong></div>
                <div><span>Updated</span><strong>{formatRelative(groupDetails.updatedAt)}</strong></div>
              </div>
              <div className="detail-list">
                {groupDetails.members.map(member => (
                  <div key={member} className="detail-row">
                    <Mail size={15} />
                    <div><strong>{member}</strong><span>Distribution recipient</span></div>
                    <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(member)}><Copy size={12} /></button>
                  </div>
                ))}
              </div>
              <div className="biz-modal-actions">
                <button className="btn btn-ghost" onClick={() => copyToClipboard(groupDetails.address)}><Copy size={14} /> Copy Group</button>
                <button className="btn btn-primary" onClick={() => { setComposeOpen(true); setComposeTo(groupDetails.address); setGroupDetails(null); }}><Send size={14} /> Email Group</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingRoleChange && (
        <div className="modal-overlay" onClick={() => setPendingRoleChange(null)}>
          <div className="biz-form-modal glass animate-scale" style={{ maxWidth: '460px', padding: '28px' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(245, 158, 11, 0.12)', color: 'var(--warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Shield size={28} />
              </div>
              <h3 style={{ marginBottom: '10px', fontSize: '1.15rem', fontWeight: 700 }}>
                {pendingRoleChange.step === 1 ? 'Review role change' : 'Final confirmation'}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                {pendingRoleChange.step === 1
                  ? `You are changing this user to ${pendingRoleChange.role}. Review permissions before continuing.`
                  : `This is the second confirmation. Apply ${pendingRoleChange.role} access now?`}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-primary)' }}>
              <button className="btn btn-ghost" onClick={() => setPendingRoleChange(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmRoleChangeStep}>
                {pendingRoleChange.step === 1 ? 'Continue' : 'Apply Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation */}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="logout-confirm-modal glass-card animate-scale" onClick={e => e.stopPropagation()}>
            <div className="logout-confirm-icon">
              <AlertTriangle size={40} color="var(--danger)" />
            </div>
            <h3>Confirm Logout</h3>
            <p>Are you sure you want to disconnect your business session?</p>
            <div className="logout-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleLogout}><LogOut size={16} /> Yes, Log Out</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <div className={`toast toast-${toast.type}`}><CheckCircle2 size={16} />{toast.msg}</div>
        </div>
      )}

      {confirmRevokeId && (
        <div className="modal-overlay" onClick={() => setConfirmRevokeId(null)}>
          <div className="biz-form-modal glass animate-scale" style={{ maxWidth: '440px', padding: '28px' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <AlertTriangle size={28} />
              </div>
              <h3 style={{ marginBottom: '10px', fontSize: '1.15rem', fontWeight: 700 }}>Confirm Disconnect</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, margin: 0 }}>
                Are you absolutely sure you want to revoke this connection? Your application will immediately lose access to this database or API provider, which may cause downtime.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-primary)' }}>
              <button className="btn btn-ghost" style={{ minWidth: '100px' }} onClick={() => setConfirmRevokeId(null)}>Cancel</button>
              <button 
                className="btn btn-primary" 
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)', minWidth: '140px' }}
                onClick={() => {
                  const revoked = connections.revoke(confirmRevokeId);
                  if (revoked) {
                    refreshConnectionUsage();
                    showToast('Connection access revoked');
                    const updatedUser = auth.getSession();
                    if (updatedUser && (!updatedUser.businessDbUrl?.trim() || !updatedUser.businessApiKey?.trim())) {
                      navigate('/business-setup');
                    }
                  } else {
                    showToast('Unable to revoke this connection', 'error');
                  }
                  setConfirmRevokeId(null);
                }}
              >
                Yes, Disconnect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
