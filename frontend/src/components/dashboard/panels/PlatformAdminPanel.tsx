import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Crown,
  FileText,
  Flag,
  Globe,
  KeyRound,
  Menu,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Server,
  Shield,
  Users,
  X,
} from 'lucide-react';
import {
  AdminApiError,
  platformAdminApi,
  type Announcement,
  type AuditEntry,
  type Company,
  type CompanyDetail,
  type FeatureFlag,
  type Investigation,
  type PlatformBroadcast,
  type PlatformBroadcastSender,
  type PlatformSetting,
  type PlatformTeam,
  type PlatformUser,
  type SupportTicket,
  type SystemInfo,
} from '../../../api/admin';
import type { DashboardState } from '../types';
import { AdminConfirmSelect } from '../AdminConfirm';
import { useAdminConfirm } from '../useAdminConfirm';
import LoadingSpinner from '../../LoadingSpinner';
import { downloadBase64Image, imageSourceFromBase64 } from '../utils';

export type PlatformSection =
  | 'overview'
  | 'companies'
  | 'users'
  | 'investigations'
  | 'usage'
  | 'revenue'
  | 'support'
  | 'team'
  | 'audit'
  | 'config'
  | 'health'
  | 'broadcast'
  | 'api-keys'
  | 'feedback';

interface PlatformAdminPanelProps {
  section: PlatformSection;
  state: DashboardState;
}

type PlatformFeedbackItem = NonNullable<
  Awaited<ReturnType<typeof platformAdminApi.feedback>>['feedback'][number]
>;

type Banner = { tone: 'success' | 'error'; message: string } | null;


function number(value?: number | null): string {
  return new Intl.NumberFormat('en-IN').format(value || 0);
}

function money(paise?: number | null): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format((paise || 0) / 100);
}

function bytes(value?: number | null): string {
  const size = value || 0;
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function dateTime(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ago(value?: string | null): string {
  if (!value) return 'never';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff) || diff < 0) return 'just now';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function badgeTone(value?: string | null): 'success' | 'danger' | 'neutral' | 'primary' {
  const normalized = (value || '').toLowerCase();
  if (['active', 'delivered', 'paid', 'owner', 'resolved', 'verified', 'published', 'healthy'].includes(normalized)) return 'success';
  if (['suspended', 'failed', 'critical', 'revoked', 'closed', 'bounced', 'error'].includes(normalized)) return 'danger';
  if (['admin', 'investigating', 'contained', 'contained'].includes(normalized)) return 'primary';
  return 'neutral';
}

function Badge({ value, children }: { value?: string | null; children: ReactNode }) {
  return <span className={`badge badge-${badgeTone(value)}`}>{children || value || '—'}</span>;
}

function StatCard({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon: ReactNode }) {
  return (
    <div className="admin-stat">
      <div className="flex items-center gap-2 text-muted text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="admin-empty-state">
      <strong>{title}</strong>
      {detail && <span className="text-sm text-muted">{detail}</span>}
    </div>
  );
}

function BarChart({ data, unit = '' }: { data: Array<{ label: string; value: number }>; unit?: string }) {
  const max = Math.max(1, ...data.map((point) => point.value));
  return (
    <div className="admin-bar-chart">
      {data.map((point, index) => (
        <div
          key={point.label}
          className="admin-bar-col"
          title={`${point.label}: ${number(point.value)}${unit}`}
        >
          <div className="admin-bar-track">
            <div className="admin-bar" style={{ height: `${Math.round((point.value / max) * 100)}%` }} />
          </div>
          {(index % 5 === 0 || index === data.length - 1) && (
            <span className="text-xs text-muted">{point.label}</span>
          )}
        </div>
      ))}
    </div>
  );
}

type ConfirmSpec = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'danger' | 'primary';
};

const COMPANY_ACTION_CONFIRM: Record<string, ConfirmSpec> = {
  suspend: {
    title: 'Suspend company',
    message: 'every mailbox on it stops sending and receiving mail immediately. Members keep their data and the change can be reverted.',
    confirmLabel: 'Suspend company',
    tone: 'danger',
  },
  activate: {
    title: 'Reactivate company',
    message: 'it becomes active again and its mailboxes start delivering again.',
    confirmLabel: 'Reactivate company',
    tone: 'primary',
  },
  revoke_api_keys: {
    title: 'Revoke all API keys',
    message: 'every API key of this company stops working immediately. Integrations that use them fail until new keys are issued.',
    confirmLabel: 'Revoke all keys',
    tone: 'danger',
  },
  terminate_sessions: {
    title: 'End all sessions',
    message: 'all members of this company are signed out and have to sign in again.',
    confirmLabel: 'End all sessions',
    tone: 'danger',
  },
  close_cases: {
    title: 'Close investigations',
    message: 'every open investigation of this company is closed.',
    confirmLabel: 'Close investigations',
    tone: 'danger',
  },
  set_plan: {
    title: 'Change plan',
    message: 'the plan and the entitlements that come with it change right away.',
    confirmLabel: 'Change plan',
    tone: 'primary',
  },
  set_seats: {
    title: 'Change seat limit',
    message: 'the number of seats this company can use changes right away.',
    confirmLabel: 'Change seats',
    tone: 'primary',
  },
};

const USER_ACTION_CONFIRM: Record<string, ConfirmSpec> = {
  suspend: {
    title: 'Suspend user',
    message: 'the account is blocked. The user cannot sign in or send mail until it is reactivated.',
    confirmLabel: 'Suspend user',
    tone: 'danger',
  },
  activate: {
    title: 'Reactivate user',
    message: 'the account is unblocked and the user can sign in again.',
    confirmLabel: 'Reactivate user',
    tone: 'primary',
  },
  terminate_sessions: {
    title: 'End sessions',
    message: 'every active session of this user is ended immediately.',
    confirmLabel: 'End sessions',
    tone: 'danger',
  },
  set_role: {
    title: 'Change role',
    message: 'the workspace role of this user changes right away. The new role is applied immediately.',
    confirmLabel: 'Change role',
    tone: 'primary',
  },
};

export default function PlatformAdminPanel({ section, state }: PlatformAdminPanelProps) {
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);
  const [denied, setDenied] = useState('');
  // Every state-changing action in the control plane needs a second,
  // explicit confirmation before it is sent to the API.
  const { confirm, dialog } = useAdminConfirm();

  const [overview, setOverview] = useState<Awaited<ReturnType<typeof platformAdminApi.overview>> | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [caseCounts, setCaseCounts] = useState({ total: 0, open: 0, investigating: 0, critical: 0, overdue: 0 });
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof platformAdminApi.analytics>> | null>(null);
  const [revenue, setRevenue] = useState<Awaited<ReturnType<typeof platformAdminApi.billing>> | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [team, setTeam] = useState<PlatformTeam | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditCategories, setAuditCategories] = useState<string[]>([]);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);

  // Management API - the keys that run the control plane.
  const [apiKeys, setApiKeys] = useState<Awaited<ReturnType<typeof platformAdminApi.apiKeys>> | null>(null);
  const [canManageKeys, setCanManageKeys] = useState(false);
  const [platformFeedback, setPlatformFeedback] = useState<Awaited<ReturnType<typeof platformAdminApi.feedback>> | null>(null);
  const [keyForm, setKeyForm] = useState({ name: '', scopes: [] as string[], expiresInDays: 365, presetId: '' });
  // Feedback triage state
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState('all');
  const [feedbackPriorityFilter, setFeedbackPriorityFilter] = useState('all');
  const [selectedFeedback, setSelectedFeedback] = useState<PlatformFeedbackItem | null>(null);
  const [feedbackDraftStatus, setFeedbackDraftStatus] = useState('');
  const [feedbackDraftPriority, setFeedbackDraftPriority] = useState('');
  const [feedbackDraftAssignee, setFeedbackDraftAssignee] = useState('');
  const [feedbackDraftReply, setFeedbackDraftReply] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [feedbackImageOpen, setFeedbackImageOpen] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);

  const [companySearch, setCompanySearch] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [auditFilter, setAuditFilter] = useState('');
  const [days, setDays] = useState(30);
  const [newAdmin, setNewAdmin] = useState({ email: '', role: 'admin' });
  const [newCase, setNewCase] = useState({ title: '', severity: 'medium', tenantId: '' });
  const [caseNote, setCaseNote] = useState('');
  const [activeCase, setActiveCase] = useState<Investigation | null>(null);
  const [companyDetail, setCompanyDetail] = useState<CompanyDetail | null>(null);
  const [caseEvents, setCaseEvents] = useState<Array<{ id: string; actor: string; kind: string; message: string; createdAt: string }>>([]);

  // Broadcast composer
  const [broadcastRecipients, setBroadcastRecipients] = useState<PlatformUser[]>([]);  const [broadcastSelected, setBroadcastSelected] = useState<string[]>([]);
  const [broadcastSearch, setBroadcastSearch] = useState('');
  const [broadcastAudience, setBroadcastAudience] = useState('all');
  const [broadcastCategory, setBroadcastCategory] = useState('notification');
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastExtra, setBroadcastExtra] = useState('');
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState<{
    recipientCount: number;
    deliveredCount: number;
    failedCount: number;
    status: string;
  } | null>(null);
  const [broadcastHistory, setBroadcastHistory] = useState<PlatformBroadcast[]>([]);
  const [broadcastSenders, setBroadcastSenders] = useState<PlatformBroadcastSender[]>([]);
  const [broadcastDefaultSender, setBroadcastDefaultSender] = useState({
    address: 'no-reply@velismail.online',
    name: 'VelisMail',
  });
  const [broadcastFrom, setBroadcastFrom] = useState('');

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setBanner({ tone, message });
    state.showToast(message, tone);
    if (tone === 'success') setTimeout(() => setBanner(null), 4000);
  }, [state]);

  const openFeedback = useCallback((item: PlatformFeedbackItem) => {
    setSelectedFeedback(item);
    setFeedbackDraftStatus(item.status);
    setFeedbackDraftPriority(item.priority);
    setFeedbackDraftAssignee(item.assigneeEmail || '');
    setFeedbackDraftReply(item.reply || '');
    setFeedbackImageOpen(false);
  }, []);

  const saveFeedback = useCallback(async () => {
    if (!selectedFeedback) return;
    setFeedbackSaving(true);
    try {
      await platformAdminApi.updateFeedback(selectedFeedback.id, {
        status: feedbackDraftStatus,
        priority: feedbackDraftPriority,
        assigneeEmail: feedbackDraftAssignee.trim() || undefined,
        reply: feedbackDraftReply.trim() || undefined,
      });
      const fresh = await platformAdminApi.feedback();
      setPlatformFeedback(fresh);
      const updated = fresh.feedback.find((entry) => entry.id === selectedFeedback.id);
      if (updated) setSelectedFeedback(updated as PlatformFeedbackItem);
      notify('Feedback updated.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not update feedback.', 'error');
    } finally {
      setFeedbackSaving(false);
    }
  }, [selectedFeedback, feedbackDraftStatus, feedbackDraftPriority, feedbackDraftAssignee, feedbackDraftReply, notify]);

  const escalateSelected = useCallback(async () => {
    if (!selectedFeedback) return;
    try {
      const result = await platformAdminApi.escalateFeedback(selectedFeedback.id);
      notify(`Escalated to investigation ${result.caseNumber}.`, 'success');
      const fresh = await platformAdminApi.feedback();
      setPlatformFeedback(fresh);
      const updated = fresh.feedback.find((entry) => entry.id === selectedFeedback.id);
      if (updated) setSelectedFeedback(updated as PlatformFeedbackItem);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not escalate feedback.', 'error');
    }
  }, [selectedFeedback, notify]);

  const filteredPlatformFeedback = useMemo(() => {
    if (!platformFeedback) return [];
    const query = feedbackSearch.trim().toLowerCase();
    return platformFeedback.feedback.filter((item) => {
      if (feedbackStatusFilter !== 'all' && item.status !== feedbackStatusFilter) return false;
      if (feedbackPriorityFilter !== 'all' && item.priority !== feedbackPriorityFilter) return false;
      if (!query) return true;
      return [item.subject, item.body, item.userEmail, item.category, item.tenantId || '', item.assigneeEmail || '']
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [platformFeedback, feedbackSearch, feedbackStatusFilter, feedbackPriorityFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setDenied('');
    try {
      if (section === 'overview') {
        setOverview(await platformAdminApi.overview());
      } else if (section === 'companies') {
        const result = await platformAdminApi.companies({ search: companySearch || undefined, limit: 200 });
        setCompanies(result.companies);
      } else if (section === 'users') {
        const result = await platformAdminApi.users();
        setUsers(result.users);
      } else if (section === 'investigations') {
        const result = await platformAdminApi.investigations({ status: caseFilter === 'all' ? undefined : caseFilter });
        setInvestigations(result.investigations);
        setCaseCounts(result.counts);
      } else if (section === 'usage') {
        setAnalytics(await platformAdminApi.analytics(days));
      } else if (section === 'revenue') {
        setRevenue(await platformAdminApi.billing());
      } else if (section === 'support') {
        const result = await platformAdminApi.support();
        setTickets(result.tickets);
      } else if (section === 'team') {
        setTeam(await platformAdminApi.team());
      } else if (section === 'audit') {
        const result = await platformAdminApi.audit({ category: auditFilter || undefined });
        setAudit(result.logs);
        setAuditCategories(result.categories);
      } else if (section === 'config') {
        const [flagResult, announcementResult, settingResult] = await Promise.all([
          platformAdminApi.flags(),
          platformAdminApi.announcements(),
          platformAdminApi.settings(),
        ]);
        setFlags(flagResult.flags);
        setAnnouncements(announcementResult.announcements);
        setSettings(settingResult.settings);
      } else if (section === 'health') {
        setSystem(await platformAdminApi.system());
      } else if (section === 'api-keys') {
        const [keysResult, meResult] = await Promise.all([
          platformAdminApi.apiKeys(),
          platformAdminApi.me().catch(() => null),
        ]);
        setApiKeys(keysResult);
        // The keys are owner only, but the console should still show the
        // catalogue so everybody can see what a key can do.
        setCanManageKeys(Boolean(meResult?.owner));
      } else if (section === 'feedback') {
        setPlatformFeedback(await platformAdminApi.feedback());
      } else if (section === 'broadcast') {
        const [recipientResult, historyResult, senderResult] = await Promise.all([
          platformAdminApi.users({
            search: broadcastSearch || undefined,
            status: broadcastAudience === 'active' || broadcastAudience === 'suspended' ? broadcastAudience : undefined,
            plan: broadcastAudience === 'free' || broadcastAudience === 'paid' ? broadcastAudience : undefined,
          }),
          platformAdminApi.broadcasts(),
          // Every sender comes from the real workspace mailbox index. When the
          // endpoint is unavailable the composer falls back to the platform
          // default instead of guessing an address.
          platformAdminApi.broadcastSenders().catch(() => null),
        ]);
        setBroadcastRecipients(recipientResult.users);
        setBroadcastHistory(historyResult.broadcasts);
        setBroadcastSenders(senderResult?.mailboxes || []);
        if (senderResult?.defaultSender?.address) {
          setBroadcastDefaultSender(senderResult.defaultSender);
        }
      }
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 403) {
        setDenied(error.message || 'This account is not authorized for the platform control plane.');
      } else {
        setBanner({
          tone: 'error',
          message: error instanceof Error ? error.message : 'Unable to load control plane data.',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [section, companySearch, caseFilter, auditFilter, days, broadcastSearch, broadcastAudience]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCompany = useCallback(async (id: string) => {
    try {
      setCompanyDetail(await platformAdminApi.company(id));
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Unable to open the company.', 'error');
    }
  }, [notify]);

  const runCompanyAction = useCallback(async (
    id: string,
    action: 'suspend' | 'activate' | 'set_plan' | 'set_seats' | 'revoke_api_keys' | 'terminate_sessions' | 'close_cases',
    extra: Record<string, unknown> = {},
  ) => {
    try {
      const result = await platformAdminApi.companyAction(id, { action, ...extra } as never);
      notify(`${action.replace(/_/g, ' ')} applied to ${result.affected} record(s)`);
      await openCompany(id);
      void load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The action failed.', 'error');
    }
  }, [notify, openCompany, load]);

  const runUserAction = useCallback(async (
    id: string,
    action: 'suspend' | 'activate' | 'terminate_sessions' | 'set_role',
    role?: string,
  ) => {
    try {
      const result = await platformAdminApi.userAction(id, { action, role } as never);
      notify(`${action.replace(/_/g, ' ')} applied to ${result.affected} record(s)`);
      void load();
    } catch (error) {
      notify(error instanceof Error ? error.message : 'The action failed.', 'error');
    }
  }, [notify, load]);

  const confirmCompanyAction = useCallback((
    id: string,
    action: 'suspend' | 'activate' | 'set_plan' | 'set_seats' | 'revoke_api_keys' | 'terminate_sessions' | 'close_cases',
    extra: Record<string, unknown> = {},
    subject = 'This company',
  ) => {
    const spec = COMPANY_ACTION_CONFIRM[action];
    confirm({
      title: spec.title,
      message: `${subject} - ${spec.message}`,
      confirmLabel: spec.confirmLabel,
      tone: spec.tone,
      onConfirm: () => runCompanyAction(id, action, extra),
    });
  }, [confirm, runCompanyAction]);

  const confirmUserAction = useCallback((
    id: string,
    action: 'suspend' | 'activate' | 'terminate_sessions' | 'set_role',
    role?: string,
    subject = 'This account',
  ) => {
    const spec = USER_ACTION_CONFIRM[action];
    confirm({
      title: spec.title,
      message: `${subject} - ${role ? spec.message.replace('the new role', `the ${role} role`) : spec.message}`,
      confirmLabel: spec.confirmLabel,
      tone: spec.tone,
      onConfirm: () => runUserAction(id, action, role),
    });
  }, [confirm, runUserAction]);

  // ─── Broadcast composer ───
  const broadcastExtraEmails = useMemo(
    () => broadcastExtra.split(/[\s,;]+/).map((value) => value.trim()).filter((value) => value.includes('@')),
    [broadcastExtra],
  );
  const broadcastAudienceSize = broadcastRecipients.length;
  const broadcastTargetCount = broadcastSelected.length > 0
    ? broadcastSelected.length + broadcastExtraEmails.length
    : (broadcastExtraEmails.length > 0 ? broadcastExtraEmails.length : broadcastAudienceSize);
  const broadcastSubjectLength = broadcastSubject.trim().length;
  const broadcastBodyLength = broadcastBody.trim().length;
  const broadcastSenderChoices = useMemo(() => {
    const seen = new Set<string>();
    const options: PlatformBroadcastSender[] = [];
    broadcastSenders.forEach((mailbox) => {
      const address = (mailbox.address || '').trim().toLowerCase();
      if (!address || seen.has(address)) return;
      seen.add(address);
      options.push({
        address,
        displayName: mailbox.displayName || '',
        domain: mailbox.domain || address.split('@')[1] || '',
        company: mailbox.company || '',
        source: mailbox.source || 'custom',
        domainStatus: mailbox.domainStatus || 'unknown',
      });
    });
    return options.sort((left, right) => left.address.localeCompare(right.address));
  }, [broadcastSenders]);

  useEffect(() => {
    if (broadcastFrom && !broadcastSenderChoices.some((mailbox) => mailbox.address === broadcastFrom)) {
      setBroadcastFrom('');
    }
  }, [broadcastFrom, broadcastSenderChoices]);

  const toggleBroadcastRecipient = useCallback((id: string) => {
    setBroadcastSelected((current) => (
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    ));
  }, []);

  const sendBroadcast = useCallback(() => {
    const subject = broadcastSubject.trim();
    const body = broadcastBody.trim();
    const targetCount = broadcastTargetCount;

    // The button stays clickable whenever there is at least one recipient so
    // the operator gets an explanation instead of a silent disabled control.
    if (targetCount === 0) {
      notify('Choose at least one recipient or add a custom email address.', 'error');
      return;
    }
    if (subject.length < 4) {
      notify('Add a subject with at least 4 characters.', 'error');
      return;
    }
    if (body.length < 10) {
      notify(`Add at least ${10 - body.length} more character(s) to the message.`, 'error');
      return;
    }

    const senderLabel = broadcastFrom
      ? broadcastFrom
      : `${broadcastDefaultSender.name} (${broadcastDefaultSender.address})`;
    confirm({
      title: 'Send platform broadcast',
      message: `"${subject}" is sent from ${senderLabel} privately to ${targetCount} recipient(s) as a ${broadcastCategory} message. Every recipient receives their own copy on their recovery address, and nobody sees the other addresses.`,
      confirmLabel: 'Send now',
      tone: 'danger',
      onConfirm: async () => {
        setBroadcastSending(true);
        setBroadcastResult(null);
        try {
          const result = await platformAdminApi.broadcast({
            subject,
            body,
            category: broadcastCategory,
            audience: broadcastAudience,
            recipientIds: broadcastSelected,
            additionalEmails: broadcastExtraEmails,
            from: broadcastFrom || undefined,
          });
          setBroadcastResult({
            recipientCount: result.recipientCount || 0,
            deliveredCount: result.deliveredCount || 0,
            failedCount: result.failedCount || 0,
            status: result.status || 'sent',
          });
          notify(`Broadcast delivered to ${result.deliveredCount || 0} recipient(s).`);
          setBroadcastSubject('');
          setBroadcastBody('');
          setBroadcastSelected([]);
          setBroadcastExtra('');
          void load();
        } catch (error) {
          notify(error instanceof Error ? error.message : 'The broadcast failed.', 'error');
        } finally {
          setBroadcastSending(false);
        }
      },
    });
  }, [
    broadcastAudience,
    broadcastBody,
    broadcastCategory,
    broadcastDefaultSender,
    broadcastExtraEmails,
    broadcastFrom,
    broadcastSelected,
    broadcastSubject,
    broadcastTargetCount,
    confirm,
    load,
    notify,
  ]);

  // The gateway only hands out the roles the signed-in staff member is
  // allowed to grant, so a non-owner never even sees the privileged ones.
  const assignableRoles = useMemo(
    () => (team?.roles || []).filter((role) => role.key !== 'owner'),
    [team?.roles],
  );
  const selectedRoleDescription = useMemo(
    () => assignableRoles.find((role) => role.key === newAdmin.role)?.description || '',
    [assignableRoles, newAdmin.role],
  );

  const kpis = overview?.kpis;  const traffic = analytics?.series.traffic || [];
  const trafficMax = Math.max(1, ...traffic.map((point) => point.requests));

  const growthSeries = useMemo(
    () => (overview?.growth.companies || []).map((point) => ({ label: point.date.slice(5), value: point.value })),
    [overview],
  );

  if (denied) {
    return (
      <div className="dash-panel dash-panel-admin">
        <div className="panel-header">
          <button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={18} /></button>
          <h3><Crown size={16} /> Platform Control Plane</h3>
        </div>
        <div className="dash-body">
          <div className="glass-card admin-owner-lock">
            <Shield size={20} />
            <div>
              <strong>Control plane access is restricted</strong>
              <span>
                {denied} Ask the platform owner to add you to
                {' '}<code>PLATFORM_OWNER_EMAILS</code> (your email is <code>{state.user?.email || 'unknown'}</code>)
                or <code>PLATFORM_OWNER_UIDS</code> (your UID is <code>{state.user?.firebaseUid || 'unknown'}</code>)
                {' '}on the API server, or to invite you with a platform role.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-panel dash-panel-admin">
      <div className="panel-header">
        <button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={18} /></button>
        <h3><Crown size={16} /> Platform Control Plane</h3>
        <div className="toolbar-spacer" />
        {banner && (
          <span className={`badge badge-${banner.tone === 'error' ? 'danger' : 'success'}`}>{banner.message}</span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => void load()} title="Refresh section">
          <RefreshCw size={14} />
        </button>
      </div>

      <div className="dash-body">
        {section === 'overview' && (
          <>
            <div className="admin-grid-4">
              <StatCard label="Companies" value={number(kpis?.companies)} hint={`${number(kpis?.activeCompanies)} active`} icon={<Building2 size={14} />} />
              <StatCard label="Users" value={number(kpis?.users)} hint={`${number(kpis?.newUsers30d)} new in 30 days`} icon={<Users size={14} />} />
              <StatCard label="MRR" value={money(kpis?.mrr)} hint={`ARR ${money(kpis?.arr)}`} icon={<CreditCard size={14} />} />
              <StatCard label="Emails / 30d" value={number(kpis?.emails30d)} hint={`${number(kpis?.delivered)} delivered`} icon={<Activity size={14} />} />
              <StatCard label="Queue depth" value={number(kpis?.queueDepth)} hint={`${number(kpis?.queueFailed)} failed`} icon={<Server size={14} />} />
              <StatCard label="Open cases" value={number(kpis?.openInvestigations)} hint={`${number(kpis?.criticalInvestigations)} critical`} icon={<AlertTriangle size={14} />} />
              <StatCard label="Requests today" value={number(kpis?.requestsToday)} hint={`${number(kpis?.errorsToday)} errors`} icon={<Globe size={14} />} />
              <StatCard label="Storage" value={bytes(kpis?.storageBytes)} hint={`${number(kpis?.paidSubscriptions)} paid plans`} icon={<BarChart3 size={14} />} />
            </div>

            <div className="admin-grid-2 mt-16">
              <div className="glass-card">
                <h4>Company growth</h4>
                <p className="text-sm text-muted">New workspaces in the selected window</p>
                <BarChart data={growthSeries} />
              </div>
              <div className="glass-card">
                <h4>Top companies</h4>
                <p className="text-sm text-muted">By delivered mail volume</p>
                {(overview?.topCompanies || []).length === 0 && <EmptyState title="No company activity yet" />}
                {(overview?.topCompanies || []).map((company) => (
                  <div key={company.id} className="admin-user-row">
                    <div className="admin-user-info">
                      <strong>{company.name}</strong>
                      <span>{company.users} users · {company.plan}</span>
                    </div>
                    <div className="admin-user-metrics">
                      <span>{number(company.sent)} sent</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card mt-16">
              <h4>Recent investigations</h4>
              {(overview?.investigations || []).length === 0 && <EmptyState title="No open investigations" />}
              {(overview?.investigations || []).map((item) => (
                <div key={item.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{item.title}</strong>
                    <span>{item.caseNumber} · {item.tenantName || 'Platform-wide'}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={item.severity}>{item.severity}</Badge>
                    <Badge value={item.status}>{item.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'companies' && (
          <>
            <div className="admin-controls-bar">
              <input
                className="input input-max-250"
                placeholder="Search company or email"
                value={companySearch}
                onChange={(event) => setCompanySearch(event.target.value)}
              />
              <div className="toolbar-spacer" />
              <span className="text-sm text-muted">{companies.length} companies</span>
            </div>
            {companies.length === 0 && !loading && <EmptyState title="No companies found" detail="Companies appear here as soon as a workspace is provisioned." />}
            {companies.map((company) => (
              <div key={company.id} className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{company.name}</strong>
                  <span>
                    {company.email} · created {dateTime(company.createdAt)}
                    {company.domainList?.length ? ` · ${company.domainList.join(', ')}` : ' · no domain yet'}
                  </span>
                </div>
                <div className="admin-user-metrics">
                  <span>{number(company.users)} users</span>
                  <span>{number(company.domains)} domains</span>
                  <span>{number(company.mailboxes)} mailboxes</span>
                  <span>{number(company.sent)} sent</span>
                  <Badge value={company.plan}>{company.plan}</Badge>
                  <Badge value={company.status}>{company.status}</Badge>
                </div>
                <div className="admin-row-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      void openCompany(company.id);
                    }}
                  >
                    Manage
                  </button>
                  <AdminConfirmSelect
                    value={company.plan}
                    options={['free', 'starter', 'business', 'enterprise']}
                    confirm={confirm}
                    title={(plan) => `Move to the ${plan} plan`}
                    message={(plan) => `${company.name} moves from the ${company.plan} plan to the ${plan} plan. Billing and entitlements change right away.`}
                    confirmLabel="Change plan"
                    tone="primary"
                    onApply={async (plan) => {
                      try {
                        await platformAdminApi.updateCompany(company.id, { plan });
                        notify(`${company.name} moved to ${plan}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                    ariaLabel={`Plan for ${company.name}`}
                  />
                  <AdminConfirmSelect
                    value={company.status}
                    options={['active', 'suspended', 'pending_verification', 'disabled']}
                    confirm={confirm}
                    title={(status) => `Set status to ${status}`}
                    message={(status) => `${company.name} changes from ${company.status} to ${status}. Mail delivery follows the new status right away.`}
                    confirmLabel="Change status"
                    tone={(status) => (status === 'suspended' || status === 'disabled' ? 'danger' : 'primary')}
                    onApply={async (status) => {
                      try {
                        await platformAdminApi.updateCompany(company.id, { status });
                        notify(`${company.name} is now ${status}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                    ariaLabel={`Status for ${company.name}`}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {section === 'users' && (
          <>
            {users.length === 0 && !loading && <EmptyState title="No accounts yet" />}
            {users.map((item) => (
              <div key={item.id} className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{item.displayName || item.email}</strong>
                  <span>
                    {item.email} · {item.company || 'No company'}
                    {item.domains?.length ? ` · ${item.domains.join(', ')}` : ''}
                  </span>
                </div>
                <div className="admin-user-metrics">
                  <span>{item.plan}</span>
                  <span>{item.companyRole || item.role}</span>
                  <span>{number(item.sent)} sent</span>
                  <span>{number(item.activeSessions)} sessions</span>
                  <Badge value={item.status}>{item.status}</Badge>
                  <Badge value={item.risk}>{item.risk} risk</Badge>
                </div>
                <div className="admin-row-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { confirmUserAction(item.id, item.status === 'active' ? 'suspend' : 'activate', undefined, item.email); }}
                  >
                    {item.status === 'active' ? 'Suspend' : 'Reactivate'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { confirmUserAction(item.id, 'terminate_sessions', undefined, item.email); }}
                  >
                    End sessions
                  </button>
                  <AdminConfirmSelect
                    value={item.companyRole || item.role}
                    options={['owner', 'admin', 'member', 'viewer']}
                    confirm={confirm}
                    title={(role) => `Change role to ${role}`}
                    message={(role) => `${item.email} changes from ${item.companyRole || item.role} to ${role}. The new role is applied right away.`}
                    confirmLabel="Change role"
                    tone="primary"
                    onApply={async (role) => { await runUserAction(item.id, 'set_role', role); }}
                    ariaLabel={`Role for ${item.email}`}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {section === 'investigations' && (
          <>
            <div className="admin-grid-4">
              <StatCard label="Total cases" value={number(caseCounts.total)} icon={<FileText size={14} />} />
              <StatCard label="Open" value={number(caseCounts.open)} icon={<AlertTriangle size={14} />} />
              <StatCard label="Investigating" value={number(caseCounts.investigating)} icon={<Activity size={14} />} />
              <StatCard label="Critical" value={number(caseCounts.critical)} icon={<AlertTriangle size={14} />} />
            </div>
            <div className="admin-controls-bar mt-16">
              <select className="input input-auto" value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="contained">Contained</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
              <input
                className="input input-max-250"
                placeholder="New case title"
                value={newCase.title}
                onChange={(event) => setNewCase((current) => ({ ...current, title: event.target.value }))}
              />
              <select className="input input-auto" value={newCase.severity} onChange={(event) => setNewCase((current) => ({ ...current, severity: event.target.value }))}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (newCase.title.trim().length < 4) {
                    notify('Case title is too short', 'error');
                    return;
                  }
                  const title = newCase.title.trim();
                  const severity = newCase.severity;
                  confirm({
                    title: 'Open a new case',
                    message: `"${title}" is opened as a ${severity} severity case and is written to the platform audit trail.`,
                    confirmLabel: 'Open case',
                    tone: 'primary',
                    onConfirm: async () => {
                      try {
                        await platformAdminApi.createInvestigation({
                          title,
                          severity,
                          type: 'abuse',
                          priority: severity === 'critical' ? 'P1' : 'P2',
                          summary: 'Created from the control plane console',
                        });
                        setNewCase({ title: '', severity: 'medium', tenantId: '' });
                        notify('Investigation created');
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Unable to create investigation', 'error');
                      }
                    },
                  });
                }}
              >
                <Plus size={13} /> New case
              </button>
            </div>
            {investigations.length === 0 && !loading && <EmptyState title="No investigations match this filter" />}
            {investigations.map((item) => (
              <div key={item.id} className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{item.title}</strong>
                  <span>{item.caseNumber} · {item.tenantName || 'Platform-wide'} · {ago(item.createdAt)}</span>
                </div>
                <div className="admin-user-metrics">
                  <Badge value={item.severity}>{item.severity}</Badge>
                  <Badge value={item.status}>{item.status}</Badge>
                  <span>{item.eventCount} events</span>
                </div>
                <div className="admin-row-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      try {
                        const detail = await platformAdminApi.investigation(item.id);
                        setActiveCase(detail.investigation);
                        setCaseEvents(detail.events);
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Unable to open case', 'error');
                      }
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const next = item.status === 'resolved' ? 'open' : 'resolved';
                      confirm({
                        title: item.status === 'resolved' ? 'Reopen case' : 'Resolve case',
                        message: `${item.caseNumber} (${item.title}) changes from ${item.status} to ${next}.`,
                        confirmLabel: item.status === 'resolved' ? 'Reopen case' : 'Resolve case',
                        tone: 'primary',
                        onConfirm: async () => {
                          try {
                            await platformAdminApi.updateInvestigation(item.id, { status: next });
                            notify(`Case marked ${next}`);
                            void load();
                          } catch (error) {
                            notify(error instanceof Error ? error.message : 'Update failed', 'error');
                          }
                        },
                      });
                    }}
                  >
                    {item.status === 'resolved' ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {section === 'usage' && (
          <>
            <div className="admin-controls-bar">
              {[7, 30, 90].map((window) => (
                <button
                  key={window}
                  className={`btn btn-sm ${days === window ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDays(window)}
                >
                  {window} days
                </button>
              ))}
              <div className="toolbar-spacer" />
              <span className="text-sm text-muted">Telemetry flushes every 30 seconds</span>
            </div>
            <div className="glass-card">
              <h4>Gateway traffic</h4>
              <p className="text-sm text-muted">Requests, errors and rate limiting over the selected window</p>
              {traffic.length === 0 && <EmptyState title="No traffic recorded yet" />}
              {traffic.map((point) => (
                <div key={point.date} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{point.date}</strong>
                    <span>{number(point.requests)} requests · {number(point.errors)} errors</span>
                  </div>
                  <div className="admin-user-metrics">
                    <div className="admin-bar-track" style={{ width: 120 }}>
                      <div className="admin-bar" style={{ height: `${Math.round((point.requests / trafficMax) * 100)}%` }} />
                    </div>
                    <span>{number(point.rateLimited)} limited</span>
                    <span>{number(point.overloads)} overloads</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="admin-grid-2 mt-16">
              <div className="glass-card">
                <h4>Mail volume</h4>
                <BarChart data={(analytics?.series.sent || []).map((point) => ({ label: point.date.slice(5), value: point.value }))} />
              </div>
              <div className="glass-card">
                <h4>Delivered</h4>
                <BarChart data={(analytics?.series.delivered || []).map((point) => ({ label: point.date.slice(5), value: point.value }))} />
              </div>
            </div>
            <div className="glass-card mt-16">
              <h4>Company leaderboard</h4>
              {(analytics?.leaderboard || []).map((entry) => (
                <div key={entry.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{entry.name}</strong>
                    <span>{entry.plan} · {number(entry.users)} users</span>
                  </div>
                  <div className="admin-user-metrics">
                    <span>{number(entry.sent)} sent</span>
                    <span>{bytes(entry.storage)}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'revenue' && (
          <>
            <div className="admin-grid-4">
              <StatCard label="MRR" value={money(revenue?.summary.mrr)} icon={<CreditCard size={14} />} />
              <StatCard label="ARR" value={money(revenue?.summary.arr)} icon={<BarChart3 size={14} />} />
              <StatCard label="Paid subscriptions" value={number(revenue?.summary.paidSubscriptions)} icon={<CheckCircle2 size={14} />} />
              <StatCard label="Collected" value={money(revenue?.summary.totalCollectedPaise)} hint={`${number(revenue?.summary.invoiceCount)} invoices`} icon={<CreditCard size={14} />} />
            </div>
            <div className="glass-card mt-16">
              <h4>Invoice ledger</h4>
              {(revenue?.invoices || []).length === 0 && <EmptyState title="No invoices yet" />}
              {(revenue?.invoices || []).map((invoice) => (
                <div key={invoice.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{invoice.number}</strong>
                    <span>{invoice.company} · {invoice.plan} · {dateTime(invoice.issuedAt)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <span>{money(invoice.amountPaise)}</span>
                    <Badge value={invoice.status}>{invoice.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'support' && (
          <>
            {tickets.length === 0 && !loading && <EmptyState title="No support tickets" />}
            {tickets.map((ticket) => (
              <div key={ticket.id} className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{ticket.subject}</strong>
                  <span>{ticket.company || 'Platform'} · {ticket.requester} · {ago(ticket.updatedAt)}</span>
                </div>
                <div className="admin-user-metrics">
                  <Badge value={ticket.priority}>{ticket.priority}</Badge>
                  <Badge value={ticket.status}>{ticket.status}</Badge>
                </div>
                <div className="admin-row-actions">
                  <AdminConfirmSelect
                    value={ticket.status}
                    options={['open', 'pending', 'resolved', 'closed']}
                    confirm={confirm}
                    title={(status) => `Move ticket to ${status}`}
                    message={(status) => `The ticket changes from ${ticket.status} to ${status}.`}
                    confirmLabel="Change status"
                    tone={(status) => (status === 'closed' ? 'danger' : 'primary')}
                    onApply={async (status) => {
                      try {
                        await platformAdminApi.updateTicket(ticket.id, { status });
                        notify(`Ticket moved to ${status}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                    ariaLabel={`Status for ticket ${ticket.id}`}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {section === 'broadcast' && (
          <>
            <div className="admin-broadcast-grid">
              {/* ── Recipient selection ── */}
              <section className="glass-card admin-broadcast-card">
                <div className="admin-card-head">
                  <div>
                    <h4>Select recipients</h4>
                    <p>Pick the accounts that should receive the message. Nothing is sent until you confirm.</p>
                  </div>
                  <span className="text-xs text-muted">{number(broadcastAudienceSize)} match</span>
                </div>

                <input
                  className="input"
                  placeholder="Search name or email"
                  value={broadcastSearch}
                  onChange={(event) => setBroadcastSearch(event.target.value)}
                  aria-label="Search recipients"
                />

                <div className="admin-segmented admin-broadcast-filters">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Active' },
                    { id: 'suspended', label: 'Suspended' },
                    { id: 'free', label: 'Free' },
                    { id: 'paid', label: 'Paid' },
                    { id: 'verified', label: 'Verified' },
                    { id: 'unverified', label: 'Unverified' },
                  ].map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={broadcastAudience === filter.id ? 'active' : ''}
                      onClick={() => setBroadcastAudience(filter.id)}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <div className="admin-broadcast-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBroadcastSelected(broadcastRecipients.map((user) => user.id))}
                  >
                    Select all ({number(broadcastAudienceSize)})
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setBroadcastSelected([])}
                    disabled={broadcastSelected.length === 0}
                  >
                    Clear selection
                  </button>
                  <span className="text-xs text-muted">
                    {broadcastSelected.length
                      ? `${number(broadcastSelected.length)} selected`
                      : 'No selection - the whole audience is used'}
                  </span>
                </div>

                <div className="admin-broadcast-list">
                  {broadcastRecipients.length === 0 && (
                    <p className="text-sm text-muted">No account matches this filter.</p>
                  )}
                  {broadcastRecipients.slice(0, 200).map((user) => (
                    <label key={user.id} className="admin-broadcast-row">
                      <input
                        type="checkbox"
                        checked={broadcastSelected.includes(user.id)}
                        onChange={() => toggleBroadcastRecipient(user.id)}
                      />
                      <span className="admin-person">
                        <span className="avatar avatar-sm">{(user.displayName || user.email).charAt(0).toUpperCase()}</span>
                        <span>
                          <strong>{user.displayName || user.email}</strong>
                          <span>{(user.recoveryEmail || user.email)} · {user.plan}</span>
                        </span>
                      </span>
                      <Badge value={user.status}>{user.status}</Badge>
                    </label>
                  ))}
                </div>
              </section>

              {/* ── Composer ── */}
              <section className="glass-card admin-broadcast-card">
                <div className="admin-card-head">
                  <div>
                    <h4>Compose broadcast</h4>
                    <p>Delivered individually in private batches. No recipient sees the other addresses.</p>
                  </div>
                </div>

                <div className="admin-broadcast-field">
                  <label htmlFor="broadcast-from">Send from</label>
                  <select
                    id="broadcast-from"
                    className="input"
                    value={broadcastFrom}
                    onChange={(event) => setBroadcastFrom(event.target.value)}
                  >
                    <option value="">
                      Platform default ({broadcastDefaultSender.address})
                    </option>
                    {broadcastSenderChoices.map((mailbox) => (
                      <option key={mailbox.address} value={mailbox.address}>
                        {mailbox.address}
                        {mailbox.company ? ` · ${mailbox.company}` : ''}
                        {mailbox.domainStatus && mailbox.domainStatus !== 'verified' && mailbox.domainStatus !== 'unknown'
                          ? ` · domain ${mailbox.domainStatus}`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <span className="form-hint">
                    {broadcastSenderChoices.length === 0
                      ? 'No workspace business mailbox exists yet, so broadcasts use the platform default address.'
                      : 'Every delivery uses this From address, including custom recipients. Pick one of the active workspace mailboxes or keep the platform default.'}
                  </span>
                </div>

                <div className="admin-broadcast-field">
                  <label htmlFor="broadcast-category">Category</label>
                  <select
                    id="broadcast-category"
                    className="input"
                    value={broadcastCategory}
                    onChange={(event) => setBroadcastCategory(event.target.value)}
                  >
                    <option value="notification">Notification</option>
                    <option value="event">Event</option>
                    <option value="feature">Feature update</option>
                    <option value="alert">Alert</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>

                <div className="admin-broadcast-field">
                  <label htmlFor="broadcast-subject">Subject</label>
                  <input
                    id="broadcast-subject"
                    className="input"
                    placeholder="What is this about?"
                    value={broadcastSubject}
                    onChange={(event) => setBroadcastSubject(event.target.value)}
                  />
                  <span className="form-hint">
                    At least 4 characters - {broadcastSubjectLength}/4.
                  </span>
                </div>

                <div className="admin-broadcast-field">
                  <label htmlFor="broadcast-body">Message</label>
                  <textarea
                    id="broadcast-body"
                    className="input"
                    rows={9}
                    placeholder="Write the message that every recipient receives."
                    value={broadcastBody}
                    onChange={(event) => setBroadcastBody(event.target.value)}
                  />
                  <span className="form-hint">
                    At least 10 characters - {broadcastBodyLength}/10.
                  </span>
                </div>

                <div className="admin-broadcast-field">
                  <label htmlFor="broadcast-extra">Custom additional emails</label>
                  <input
                    id="broadcast-extra"
                    className="input"
                    placeholder="Comma or space separated emails"
                    value={broadcastExtra}
                    onChange={(event) => setBroadcastExtra(event.target.value)}
                  />
                  <span className="form-hint">
                    {broadcastSelected.length === 0 && broadcastExtraEmails.length > 0
                      ? 'Only these addresses receive the message - nobody else is contacted.'
                      : 'These addresses are added to the recipients below.'}
                  </span>
                </div>

                <div className="admin-broadcast-summary">
                  <span>Send from: <strong>{broadcastFrom || broadcastDefaultSender.address}</strong></span>
                  <span>Recipients from selection: <strong>{number(broadcastSelected.length)}</strong></span>
                  <span>Custom addresses: <strong>{number(broadcastExtraEmails.length)}</strong></span>
                  <span>Total private deliveries: <strong>{number(broadcastTargetCount)}</strong></span>
                  <span>Each address gets its own email. To and Cc never contain another recipient.</span>
                  <span>Account recipients are delivered to their recovery address, never the company mailbox.</span>
                </div>

                {broadcastResult && (
                  <div className="admin-broadcast-result">
                    <strong>
                      {broadcastResult.deliveredCount} delivered
                      {broadcastResult.failedCount > 0 ? ` · ${broadcastResult.failedCount} failed` : ''}
                    </strong>
                    <span>{number(broadcastResult.recipientCount)} recipient(s) · {broadcastResult.status}</span>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-primary w-full"
                  disabled={broadcastSending || broadcastTargetCount === 0}
                  onClick={sendBroadcast}
                >
                  {broadcastSending
                    ? <LoadingSpinner size="sm" label="Sending" />
                    : <><Send size={15} /> Send to {number(broadcastTargetCount)} recipient{broadcastTargetCount === 1 ? '' : 's'}</>}
                </button>
                {broadcastTargetCount === 0 && (
                  <span className="form-hint">
                    Choose at least one account or add a custom email address to enable sending.
                  </span>
                )}
              </section>
            </div>

            {broadcastHistory.length > 0 && (
              <section className="glass-card mt-16">
                <div className="admin-card-head">
                  <div><h4>Broadcast history</h4><p>Everything the control plane sent to the accounts.</p></div>
                </div>
                <div className="admin-broadcast-list">
                  {broadcastHistory.map((entry) => (
                    <div key={entry.id} className="admin-broadcast-row">
                      <span className="admin-person">
                        <span>
                          <strong>{entry.subject}</strong>
                          <span>
                            {entry.category} · {entry.audience} · from {entry.fromAddress || 'platform default'} · {dateTime(entry.createdAt)}
                          </span>
                        </span>
                      </span>
                      <Badge value={entry.status}>{entry.status}</Badge>
                      <span className="text-xs text-muted">
                        {number(entry.deliveredCount)} delivered · {number(entry.failedCount)} failed
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {section === 'team' && (
          <>
            <div className="admin-controls-bar">
              <input
                className="input input-max-250"
                placeholder="admin@velismail.online"
                value={newAdmin.email}
                onChange={(event) => setNewAdmin((current) => ({ ...current, email: event.target.value }))}
              />
              <select className="input input-auto" value={newAdmin.role} onChange={(event) => setNewAdmin((current) => ({ ...current, role: event.target.value }))}>
                {assignableRoles.map((role) => (
                  <option key={role.key} value={role.key}>{role.name}</option>
                ))}
              </select>
              {selectedRoleDescription && (
                <span className="text-xs text-muted admin-role-hint">{selectedRoleDescription}</span>
              )}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  if (!newAdmin.email.includes('@')) {
                    notify('Enter a valid email address', 'error');
                    return;
                  }
                  const email = newAdmin.email.trim();
                  const role = newAdmin.role;
                  confirm({
                    title: 'Add platform administrator',
                    message: `${email} is added to the platform team with the ${role} role and can sign in to the control plane.`,
                    confirmLabel: 'Add administrator',
                    tone: 'primary',
                    onConfirm: async () => {
                      try {
                        await platformAdminApi.addAdmin({ email, role });
                        setNewAdmin({ email: '', role: 'admin' });
                        notify('Administrator added');
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Unable to add administrator', 'error');
                      }
                    },
                  });
                }}
              >
                <Plus size={13} /> Add administrator
              </button>
              <div className="toolbar-spacer" />
              <span className="text-sm text-muted">{team?.admins.length || 0} platform administrators</span>
            </div>
            {(team?.admins || []).map((admin) => (
              <div key={admin.email} className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{admin.displayName || admin.email}</strong>
                  <span>{admin.email} · last seen {ago(admin.lastSeenAt)}</span>
                </div>
                <div className="admin-user-metrics">
                  <Badge value={admin.role}>{admin.role}</Badge>
                  <Badge value={admin.status}>{admin.status}</Badge>
                  <span>{admin.permissions?.length || 0} permissions</span>
                </div>
                <div className="admin-row-actions">
                  <AdminConfirmSelect
                    value={admin.role}
                    options={assignableRoles.map((role) => ({ value: role.key, label: role.name }))}
                    confirm={confirm}
                    title={(role) => `Change role to ${role}`}
                    message={(role) => {
                      const next = assignableRoles.find((entry) => entry.key === role);
                      return `${admin.email} changes from ${admin.role} to ${role}.${next?.description ? ` ${next.description}` : ''}`;
                    }}
                    confirmLabel="Change role"
                    tone="primary"
                    onApply={async (role) => {
                      try {
                        await platformAdminApi.updateAdmin(admin.email, { role });
                        notify(`${admin.email} is now ${role}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                    ariaLabel={`Role for ${admin.email}`}
                  />
                </div>
              </div>
            ))}
          </>
        )}

        {section === 'audit' && (
          <>
            <div className="admin-controls-bar">
              <select className="input input-auto" value={auditFilter} onChange={(event) => setAuditFilter(event.target.value)}>
                <option value="">All categories</option>
                {auditCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
              <div className="toolbar-spacer" />
              <span className="text-sm text-muted">{audit.length} entries</span>
            </div>
            {audit.length === 0 && !loading && <EmptyState title="No audit entries" />}
            {audit.map((entry) => (
              <div key={entry.id} className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{entry.action}</strong>
                  <span>{entry.actor} · {entry.category} · {dateTime(entry.createdAt)}</span>
                </div>
                <div className="admin-user-metrics">
                  <Badge value={entry.severity}>{entry.severity}</Badge>
                </div>
              </div>
            ))}
          </>
        )}

        {section === 'config' && (
          <>
            <div className="glass-card">
              <h4>Feature flags</h4>
              {flags.map((flag) => (
                <div key={flag.key} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{flag.name}</strong>
                    <span>{flag.key} · {flag.description}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <span>{flag.rolloutPercent}% rollout</span>
                    <Badge value={flag.enabled ? 'active' : 'disabled'}>{flag.enabled ? 'enabled' : 'disabled'}</Badge>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const enabled = !flag.enabled;
                        confirm({
                          title: enabled ? 'Enable feature flag' : 'Disable feature flag',
                          message: `${flag.name} (${flag.key}) is ${enabled ? 'enabled' : 'disabled'} for every workspace on the platform.`,
                          confirmLabel: enabled ? 'Enable flag' : 'Disable flag',
                          tone: enabled ? 'primary' : 'danger',
                          onConfirm: async () => {
                            try {
                              await platformAdminApi.updateFlag({ key: flag.key, enabled });
                              notify(`${flag.name} ${enabled ? 'enabled' : 'disabled'}`);
                              void load();
                            } catch (error) {
                              notify(error instanceof Error ? error.message : 'Update failed', 'error');
                            }
                          },
                        });
                      }}
                    >
                      {flag.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="glass-card mt-16">
              <h4>Announcements</h4>
              {announcements.length === 0 && <EmptyState title="No announcements" />}
              {announcements.map((announcement) => (
                <div key={announcement.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{announcement.title}</strong>
                    <span>{announcement.audience} · {dateTime(announcement.publishedAt)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={announcement.status}>{announcement.status}</Badge>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const next = announcement.status === 'published' ? 'archived' : 'published';
                        confirm({
                          title: next === 'published' ? 'Publish announcement' : 'Archive announcement',
                          message: `"${announcement.title}" is ${next} for the ${announcement.audience} audience.`,
                          confirmLabel: next === 'published' ? 'Publish' : 'Archive',
                          tone: 'primary',
                          onConfirm: async () => {
                            try {
                              await platformAdminApi.updateAnnouncement(announcement.id, next);
                              notify(`Announcement ${next}`);
                              void load();
                            } catch (error) {
                              notify(error instanceof Error ? error.message : 'Update failed', 'error');
                            }
                          },
                        });
                      }}
                    >
                      {announcement.status === 'published' ? 'Archive' : 'Publish'}
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="glass-card mt-16">
              <h4>Platform settings</h4>
              {settings.map((setting) => (
                <div key={setting.key} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{setting.key}</strong>
                    <span>{setting.updatedBy || 'system'} · {ago(setting.updatedAt)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <span className="text-xs text-muted truncate" style={{ maxWidth: 260 }}>
                      {JSON.stringify(setting.value)}
                    </span>
                  </div>
                  <div className="admin-row-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        const key = setting.key;
                        const raw = window.prompt(`Value for ${key} (JSON)`, JSON.stringify(setting.value));
                        if (raw === null) return;
                        let parsed: unknown;
                        try {
                          parsed = JSON.parse(raw);
                        } catch {
                          notify('Value must be valid JSON', 'error');
                          return;
                        }
                        confirm({
                          title: 'Update platform setting',
                          message: `${key} is set to ${raw}. The new value applies to the whole platform right away.`,
                          confirmLabel: 'Save setting',
                          tone: 'primary',
                          onConfirm: async () => {
                            try {
                              await platformAdminApi.updateSetting(key, parsed);
                              notify(`${key} updated`);
                              void load();
                            } catch (error) {
                              notify(error instanceof Error ? error.message : 'Update failed', 'error');
                            }
                          },
                        });
                      }}
                    >
                      <Flag size={13} /> Edit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'health' && (
          <>
            <div className="admin-grid-4">
              <StatCard label="Database" value={system?.service.databaseConnected ? 'Connected' : 'Unavailable'} hint={`${number(system?.service.databaseLatencyMs)} ms probe`} icon={<Server size={14} />} />
              <StatCard label="Uptime" value={system?.service.uptimeSeconds ? `${Math.round(system.service.uptimeSeconds / 60)} min` : '—'} icon={<Activity size={14} />} />
              <StatCard label="Queued" value={number(system?.counts.queue)} icon={<Server size={14} />} />
              <StatCard label="Open cases" value={number(system?.counts.openCases)} icon={<AlertTriangle size={14} />} />
            </div>
            <div className="glass-card mt-16">
              <h4>Service</h4>
              <div className="admin-user-row">
                <div className="admin-user-info">
                  <strong>{system?.service.name} {system?.service.version}</strong>
                  <span>Payment gateway {system?.service.paymentGatewayConfigured ? 'configured' : 'not configured'} · owner gate {system?.service.firebaseOwnerGate ? 'active' : 'disabled'}</span>
                </div>
                <div className="admin-user-metrics">
                  <Badge value={system?.service.databaseConnected ? 'active' : 'failed'}>
                    {system?.service.databaseConnected ? 'healthy' : 'down'}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="glass-card mt-16">
              <h4>Live telemetry</h4>
              {Object.entries(system?.live || {}).map(([key, value]) => (
                <div key={key} className="admin-user-row">
                  <div className="admin-user-info"><strong>{key}</strong></div>
                  <div className="admin-user-metrics"><span>{number(Number(value))}</span></div>
                </div>
              ))}
            </div>
            <div className="glass-card mt-16">
              <h4>Record counters</h4>
              {Object.entries(system?.counts || {}).map(([key, value]) => (
                <div key={key} className="admin-user-row">
                  <div className="admin-user-info"><strong>{key}</strong></div>
                  <div className="admin-user-metrics"><span>{number(Number(value))}</span></div>
                </div>
              ))}
            </div>
          </>
        )}

        {section === 'api-keys' && apiKeys && (
          <>
            <div className="admin-controls-bar">
              <span className="text-sm text-muted">
                {apiKeys.keys.filter((key) => !key.revokedAt).length} active platform keys
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!canManageKeys}
                onClick={() => { setNewKey(''); setKeyForm({ name: '', scopes: [], expiresInDays: 365, presetId: '' }); setKeyOpen(true); }}
              >
                <Plus size={15} /> Create platform key
              </button>
            </div>

            {!canManageKeys && (
              <p className="text-xs text-muted">Only the platform owner can create or revoke platform keys.</p>
            )}

            <section className="glass-card">
              <div className="admin-card-head">
                <div>
                  <h3>Choose what the key is for</h3>
                  <p>A template fills in the right permissions, you can fine tune them afterwards</p>
                </div>
                <Bot size={16} />
              </div>
              <div className="key-preset-grid">
                {apiKeys.presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`key-preset ${keyForm.presetId === preset.id ? 'active' : ''}`}
                    disabled={!canManageKeys}
                    onClick={() => {
                      setKeyForm((current) => ({
                        ...current,
                        presetId: preset.id,
                        name: current.name || preset.name,
                        scopes: preset.scopes,
                      }));
                      setKeyOpen(true);
                    }}
                  >
                    <span className="key-preset-head">
                      <strong>{preset.name}</strong>
                      {preset.recommended && <span className="badge badge-primary">Recommended</span>}
                    </span>
                    <span className="key-preset-summary">{preset.summary}</span>
                    <span className="key-preset-scopes">
                      {preset.scopes.length} {preset.scopes.length === 1 ? 'permission' : 'permissions'}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="glass-card">
              <div className="admin-card-head">
                <div>
                  <h3>What a platform key can do</h3>
                  <p>Scopes are enforced by the API on every route, and a route the platform API does not know is refused</p>
                </div>
                <KeyRound size={16} />
              </div>
              <div className="scope-grid">
                {apiKeys.scopes.map((scope) => (
                  <div key={scope.id} className={`scope-card scope-${scope.risk}`}>
                    <strong>{scope.id}</strong>
                    <span className="text-xs text-muted">{scope.detail}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="glass-card">
              <div className="admin-card-head">
                <div>
                  <h3>Your platform keys</h3>
                  <p>Every action of a key is attributed to its creator in the audit trail</p>
                </div>
                <KeyRound size={16} />
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr><th>Name</th><th>Prefix</th><th>Access</th><th>Created by</th><th>Created</th><th>Last used</th><th>Status</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {apiKeys.keys.map((key) => (
                      <tr key={key.id}>
                        <td><strong>{key.name}</strong></td>
                        <td className="admin-mono">{key.prefix}…</td>
                        <td>
                          <span className="admin-key-scopes">
                            {key.scopes.map((scope) => <span key={scope} className="badge badge-neutral">{scope}</span>)}
                          </span>
                        </td>
                        <td>{key.createdBy}</td>
                        <td>{dateTime(key.createdAt)}</td>
                        <td>{key.lastUsedAt ? dateTime(key.lastUsedAt) : 'never'}</td>
                        <td>{key.revokedAt ? <Badge value="revoked">Revoked</Badge> : <Badge value="active">Active</Badge>}</td>
                        <td>
                          {!key.revokedAt && canManageKeys ? (
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              onClick={() => {
                                confirm({
                                  title: 'Revoke platform key',
                                  message: `"${key.name}" (${key.prefix}...) stops working immediately. Anything still calling the control plane with it will fail.`,
                                  confirmLabel: 'Revoke key',
                                  tone: 'danger',
                                  onConfirm: async () => {
                                    try {
                                      await platformAdminApi.revokeApiKey(key.id);
                                      setApiKeys(await platformAdminApi.apiKeys());
                                      notify('Platform key revoked');
                                    } catch (err) {
                                      notify(err instanceof Error ? err.message : 'Unable to revoke the key.', 'error');
                                    }
                                  },
                                });
                              }}
                            >
                              Revoke
                            </button>
                          ) : (
                            <span className="text-sm text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {apiKeys.keys.length === 0 && (
                  <p className="admin-empty-state">No platform keys yet. Create one to let an assistant run the control plane.</p>
                )}
              </div>
            </section>

            <section className="glass-card">
              <div className="admin-card-head">
                <div>
                  <h3>Calling the control plane</h3>
                  <p>One request proves the key can see the whole ecosystem</p>
                </div>
                <Server size={16} />
              </div>
              <div className="admin-code-block">
                <code>Authorization: Bearer vsk_plat_…</code>
                <code>GET https://api.velismail.online/api/v1/admin/platform/companies</code>
                <code>GET https://api.velismail.online/api/v1/admin/platform/users</code>
                <code>GET https://api.velismail.online/api/v1/admin/platform/support</code>
                <code>POST/…actions</code>
              </div>
              <p className="text-xs text-muted">
                A key is refused on endpoints that are not part of the platform API, so a route added later is never
                reachable with an old key.
              </p>
            </section>
          </>
        )}
        {section === 'feedback' && platformFeedback && (
          <div className="admin-grid-1">
            <div className="admin-controls-bar" style={{ flexWrap: 'wrap', gap: 'var(--space-3)' }}>
              <div className="admin-feedback-filters">
                <input
                  className="input input-sm"
                  placeholder="Search subject, body, reporter, workspace..."
                  value={feedbackSearch}
                  onChange={(e) => setFeedbackSearch(e.target.value)}
                  aria-label="Search feedback"
                />
                <select className="input input-sm" value={feedbackStatusFilter} onChange={(e) => setFeedbackStatusFilter(e.target.value)} aria-label="Filter by status">
                  <option value="all">All statuses</option>
                  <option value="open">Open</option>
                  <option value="investigating">Investigating</option>
                  <option value="escalated">Escalated</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
                <select className="input input-sm" value={feedbackPriorityFilter} onChange={(e) => setFeedbackPriorityFilter(e.target.value)} aria-label="Filter by priority">
                  <option value="all">All priorities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
              <div className="admin-feedback-counts">
                <span className="admin-feedback-count"><strong>{platformFeedback.counts.open}</strong> open</span>
                <span className="admin-feedback-count"><strong>{platformFeedback.counts.total}</strong> total</span>
                <span className="admin-feedback-count"><strong>{filteredPlatformFeedback.length}</strong> shown</span>
              </div>
            </div>

            <section className="glass-card">
              <div className="admin-card-head">
                <div>
                  <h3>Workspace feedback</h3>
                  <p>Complaints, ideas and bugs submitted from workspaces. Click a row to open the full report.</p>
                </div>
                <MessageSquare size={16} />
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table admin-feedback-table">
                  <thead><tr><th>Subject</th><th>From</th><th>Category</th><th>Priority</th><th>Status</th><th>Submitted</th></tr></thead>
                  <tbody>
                    {filteredPlatformFeedback.map((f) => (
                      <tr key={f.id} onClick={() => openFeedback(f as PlatformFeedbackItem)} className="admin-feedback-row">
                        <td>
                          <strong>{f.subject}</strong>
                          <br />
                          <span className="text-xs text-muted">{f.body.slice(0, 70)}{f.body.length > 70 ? '...' : ''}</span>
                          {f.hasImage && <span className="text-xs admin-feedback-attachment"> attachment</span>}
                        </td>
                        <td>
                          <div className="admin-feedback-reporter">
                            <strong>{f.userEmail}</strong>
                            {f.tenantId && <span className="text-xs text-muted">{f.tenantId.slice(0, 8)}...</span>}
                          </div>
                        </td>
                        <td>{f.category}</td>
                        <td><Badge value={f.priority}>{f.priority}</Badge></td>
                        <td><Badge value={f.status}>{f.status}</Badge></td>
                        <td>{dateTime(f.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {platformFeedback.feedback.length === 0 && (
                  <p className="admin-empty-state">No feedback submitted yet.</p>
                )}
                {platformFeedback.feedback.length > 0 && filteredPlatformFeedback.length === 0 && (
                  <p className="admin-empty-state">No feedback matches these filters.</p>
                )}
              </div>
            </section>
          </div>
        )}
      </div>

      {selectedFeedback && (
        <div className="modal-overlay" onClick={() => setSelectedFeedback(null)} role="dialog" aria-modal="true" aria-label="Feedback report">
          <div className="biz-form-modal glass admin-feedback-modal" onClick={(event) => event.stopPropagation()}>
            <div className="compose-header">
              <div>
                <h3><MessageSquare size={16} /> {selectedFeedback.subject}</h3>
                <p>Full report submitted from a workspace. Review, reply, resolve or escalate.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setSelectedFeedback(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="admin-feedback-modal-grid">
              <div className="admin-feedback-modal-main">
                <div className="admin-feedback-badges">
                  <Badge value={selectedFeedback.status}>{selectedFeedback.status}</Badge>
                  <Badge value={selectedFeedback.priority}>{selectedFeedback.priority}</Badge>
                  <span className="admin-feedback-category">{selectedFeedback.category}</span>
                  {selectedFeedback.hasImage && <span className="admin-feedback-attachment-chip">attachment</span>}
                </div>

                <div className="admin-feedback-block">
                  <span className="admin-feedback-label">Message</span>
                  <p className="admin-feedback-body">{selectedFeedback.body}</p>
                </div>

                {selectedFeedback.imageBase64 && (
                  <div className="admin-feedback-block">
                    <span className="admin-feedback-label">Screenshot</span>
                    <button type="button" className="admin-feedback-image-btn" onClick={() => setFeedbackImageOpen(true)}>
                      <img src={imageSourceFromBase64(selectedFeedback.imageBase64)} alt="Feedback screenshot" />
                      <span>Click to enlarge</span>
                    </button>
                    <div className="admin-feedback-image-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => { downloadBase64Image(selectedFeedback.imageBase64 || '', `feedback-${selectedFeedback.id.slice(0, 8)}`); }}
                      >
                        Download screenshot
                      </button>
                      <span className="text-xs text-muted">Saved with its original mime type and file name.</span>
                    </div>
                  </div>
                )}

                {selectedFeedback.reply && (
                  <div className="admin-feedback-block admin-feedback-reply">
                    <span className="admin-feedback-label">Reply sent</span>
                    <p>{selectedFeedback.reply}</p>
                  </div>
                )}

                <div className="admin-feedback-meta">
                  <div><span>Reporter</span><strong>{selectedFeedback.userEmail}</strong></div>
                  <div><span>Workspace / tenant</span><strong>{selectedFeedback.tenantId || '-'}</strong></div>
                  <div><span>User id</span><strong>{selectedFeedback.userId || '-'}</strong></div>
                  <div><span>Submitted</span><strong>{new Date(selectedFeedback.createdAt).toLocaleString()}</strong></div>
                  <div><span>Updated</span><strong>{new Date(selectedFeedback.updatedAt).toLocaleString()}</strong></div>
                  {selectedFeedback.resolvedAt && <div><span>Resolved</span><strong>{new Date(selectedFeedback.resolvedAt).toLocaleString()}</strong></div>}
                  {selectedFeedback.assigneeEmail && <div><span>Assignee</span><strong>{selectedFeedback.assigneeEmail}</strong></div>}
                </div>
              </div>

              <div className="admin-feedback-modal-side">
                <div className="admin-feedback-block">
                  <span className="admin-feedback-label">Triage</span>
                  <div className="admin-form">
                    <div className="form-group">
                      <label>Status</label>
                      <select className="input" value={feedbackDraftStatus} onChange={(e) => setFeedbackDraftStatus(e.target.value)}>
                        <option value="open">Open</option>
                        <option value="investigating">Investigating</option>
                        <option value="escalated">Escalated</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Priority</label>
                      <select className="input" value={feedbackDraftPriority} onChange={(e) => setFeedbackDraftPriority(e.target.value)}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Assignee email</label>
                      <input className="input" value={feedbackDraftAssignee} onChange={(e) => setFeedbackDraftAssignee(e.target.value)} placeholder="operator@velismail.online" />
                    </div>
                    <div className="form-group">
                      <label>Reply to reporter</label>
                      <textarea className="input" rows={4} value={feedbackDraftReply} onChange={(e) => setFeedbackDraftReply(e.target.value)} placeholder="What we did and what happens next..." />
                    </div>
                  </div>
                  <div className="admin-modal-actions" style={{ marginTop: 'var(--space-3)' }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveFeedback()} disabled={feedbackSaving}>
                      {feedbackSaving ? 'Saving...' : 'Save changes'}
                    </button>
                    {selectedFeedback.status === 'open' && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void escalateSelected()}>
                        Escalate to investigation
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {feedbackImageOpen && selectedFeedback?.imageBase64 && (
        <div className="modal-overlay" onClick={() => setFeedbackImageOpen(false)} role="dialog" aria-modal="true" aria-label="Screenshot">
          <div className="biz-form-modal glass" onClick={(event) => event.stopPropagation()} style={{ maxWidth: '90vw', padding: 'var(--space-2)' }}>
            <img src={imageSourceFromBase64(selectedFeedback.imageBase64)} alt="Feedback screenshot" style={{ maxWidth: '100%', maxHeight: '85vh', display: 'block' }} />
            <div className="admin-feedback-image-actions" style={{ marginTop: 'var(--space-2)' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => { downloadBase64Image(selectedFeedback.imageBase64 || '', `feedback-${selectedFeedback.id.slice(0, 8)}`); }}
              >
                Download screenshot
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFeedbackImageOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {companyDetail && (
        <div className="modal-overlay" onClick={() => setCompanyDetail(null)} role="dialog" aria-modal="true" aria-label="Company management">
          <div className="biz-form-modal glass admin-company-modal" onClick={(event) => event.stopPropagation()}>
            <div className="compose-header">
              <h3><Building2 size={16} /> {companyDetail.company.name}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setCompanyDetail(null)}><X size={16} /></button>
            </div>
            <div className="px-20 py-20 flex flex-col gap-4">
              <div className="admin-grid-4">
                <StatCard label="Plan" value={companyDetail.company.plan} icon={<CreditCard size={14} />} />
                <StatCard label="Status" value={companyDetail.company.status} icon={<Activity size={14} />} />
                <StatCard label="Seats" value={`${number(companyDetail.company.members)} / ${number(companyDetail.company.seatLimit)}`} icon={<Users size={14} />} />
                <StatCard label="Domains" value={number(companyDetail.domains.length)} icon={<Globe size={14} />} />
              </div>

              <div className="admin-card-head">
                <div>
                  <h4>Platform controls</h4>
                  <p>Every action is written to the platform audit trail.</p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {companyDetail.company.status === 'active' ? (
                  <button className="btn btn-danger btn-sm" onClick={() => { confirmCompanyAction(companyDetail.company.id, 'suspend', {}, companyDetail.company.name); }}>
                    Suspend company
                  </button>
                ) : (
                  <button className="btn btn-primary btn-sm" onClick={() => { confirmCompanyAction(companyDetail.company.id, 'activate', {}, companyDetail.company.name); }}>
                    Reactivate company
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => { confirmCompanyAction(companyDetail.company.id, 'revoke_api_keys', {}, companyDetail.company.name); }}>
                  Revoke all API keys
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { confirmCompanyAction(companyDetail.company.id, 'terminate_sessions', {}, companyDetail.company.name); }}>
                  End all sessions
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { confirmCompanyAction(companyDetail.company.id, 'close_cases', {}, companyDetail.company.name); }}>
                  Close investigations
                </button>
                <AdminConfirmSelect
                  value={companyDetail.company.plan}
                  options={['free', 'starter', 'business', 'enterprise']}
                  confirm={confirm}
                  title={(plan) => `Move to the ${plan} plan`}
                  message={(plan) => `${companyDetail.company.name} moves from the ${companyDetail.company.plan} plan to the ${plan} plan. Billing and entitlements change right away.`}
                  confirmLabel="Change plan"
                  tone="primary"
                  onApply={async (plan) => { await runCompanyAction(companyDetail.company.id, 'set_plan', { plan }); }}
                  ariaLabel={`Plan for ${companyDetail.company.name}`}
                />
                <input
                  className="input input-auto"
                  type="number"
                  min={1}
                  max={100000}
                  defaultValue={companyDetail.company.seatLimit}
                  onBlur={(event) => {
                    const seats = Number(event.target.value);
                    if (!seats || seats === companyDetail.company.seatLimit) return;
                    confirmCompanyAction(companyDetail.company.id, 'set_seats', { seatLimit: seats }, companyDetail.company.name);
                  }}
                  aria-label="Seat limit"
                />
              </div>

              <div className="admin-card-head">
                <div><h4>Email domains</h4><p>Every domain this company owns.</p></div>
              </div>
              {companyDetail.domains.length === 0 && <EmptyState title="No domain connected" />}
              {companyDetail.domains.map((domain) => (
                <div key={domain.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{domain.domain}</strong>
                    <span>added {dateTime(domain.addedAt)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={domain.status}>{domain.status}</Badge>
                    {domain.verifiedAt && <span>verified {dateTime(domain.verifiedAt)}</span>}
                  </div>
                </div>
              ))}

              <div className="admin-card-head">
                <div><h4>Team</h4><p>{companyDetail.members.length} members with workspace access.</p></div>
              </div>
              {companyDetail.members.map((member) => (
                <div key={member.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{member.name || member.email}</strong>
                    <span>{member.email} · joined {dateTime(member.joinedAt)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={member.role}>{member.role}</Badge>
                    <Badge value={member.status}>{member.status}</Badge>
                    {member.lastActiveAt && <span>active {ago(member.lastActiveAt)}</span>}
                  </div>
                </div>
              ))}

              <div className="admin-card-head">
                <div><h4>Mailboxes</h4><p>{companyDetail.mailboxes.length} mailboxes across their domains.</p></div>
              </div>
              {companyDetail.mailboxes.length === 0 && <EmptyState title="No mailbox provisioned" />}
              {companyDetail.mailboxes.slice(0, 50).map((mailbox) => (
                <div key={mailbox.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{mailbox.address}</strong>
                    <span>{mailbox.domain} · {mailbox.kind}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={mailbox.active ? 'active' : 'disabled'}>{mailbox.active ? 'active' : 'disabled'}</Badge>
                    {mailbox.lastUsedAt && <span>used {ago(mailbox.lastUsedAt)}</span>}
                  </div>
                </div>
              ))}

              <div className="admin-card-head">
                <div><h4>API keys</h4><p>{companyDetail.apiKeys.length} credentials issued to this company.</p></div>
              </div>
              {companyDetail.apiKeys.length === 0 && <EmptyState title="No API key issued" />}
              {companyDetail.apiKeys.map((key) => (
                <div key={key.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{key.name}</strong>
                    <span>{key.prefix}… · {key.scopes.join(', ')}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={key.revokedAt ? 'revoked' : 'active'}>{key.revokedAt ? 'revoked' : 'active'}</Badge>
                    {key.lastUsedAt && <span>used {ago(key.lastUsedAt)}</span>}
                  </div>
                </div>
              ))}

              <div className="admin-card-head">
                <div><h4>Active sessions</h4><p>{companyDetail.sessions.length} signed-in devices.</p></div>
              </div>
              {companyDetail.sessions.length === 0 && <EmptyState title="No active session" />}
              {companyDetail.sessions.map((session) => (
                <div key={session.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{session.email}</strong>
                    <span>{session.ip || 'unknown ip'} · {session.device.slice(0, 18)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <span>active {ago(session.lastActive)}</span>
                    <Badge value={session.mfaVerified ? 'verified' : 'pending'}>{session.mfaVerified ? 'mfa' : 'no mfa'}</Badge>
                  </div>
                </div>
              ))}

              <div className="admin-card-head">
                <div><h4>Usage (30 days)</h4><p>Daily rollups recorded for this workspace.</p></div>
              </div>
              {companyDetail.usage.length === 0 && <EmptyState title="No usage recorded yet" />}
              {companyDetail.usage.map((row) => (
                <div key={row.date} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{row.date}</strong>
                    <span>{number(row.sent)} sent · {number(row.received)} received · {number(row.apiRequests)} api calls</span>
                  </div>
                  <div className="admin-user-metrics">
                    <span>{number(row.activeUsers)} users</span>
                    <span>{number(row.queueDepth)} queued</span>
                    <span>{row.avgLatencyMs} ms</span>
                  </div>
                </div>
              ))}

              <div className="admin-card-head">
                <div><h4>Recent platform activity</h4><p>Actions recorded for this company.</p></div>
              </div>
              {companyDetail.recentAudit.map((entry) => (
                <div key={entry.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{entry.action}</strong>
                    <span>{entry.actor} ({entry.actorRole}) · {dateTime(entry.createdAt)}</span>
                  </div>
                  <div className="admin-user-metrics">
                    <Badge value={entry.severity}>{entry.severity}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeCase && (
        <div className="modal-overlay" onClick={() => setActiveCase(null)} role="dialog" aria-modal="true" aria-label="Investigation details">
          <div className="biz-form-modal glass" onClick={(event) => event.stopPropagation()}>
            <div className="compose-header">
              <h3><FileText size={16} /> {activeCase.title}</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setActiveCase(null)}><X size={16} /></button>
            </div>
            <div className="px-20 py-20 flex flex-col gap-3">
              <div className="flex gap-2 items-center">
                <Badge value={activeCase.severity}>{activeCase.severity}</Badge>
                <Badge value={activeCase.status}>{activeCase.status}</Badge>
                <span className="text-sm text-muted">{activeCase.caseNumber}</span>
              </div>
              <p className="text-sm">{activeCase.summary || 'No summary recorded.'}</p>
              <div className="admin-list-header">
                <span>Timeline</span>
                <span>{caseEvents.length} events</span>
              </div>
              {caseEvents.map((event) => (
                <div key={event.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <strong>{event.kind}</strong>
                    <span>{event.actor} · {dateTime(event.createdAt)}</span>
                  </div>
                  <div className="admin-user-metrics"><span className="text-sm">{event.message}</span></div>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="Add a note to the timeline"
                  value={caseNote}
                  onChange={(event) => setCaseNote(event.target.value)}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const message = caseNote.trim();
                    if (!message) return;
                    confirm({
                      title: 'Add note to the case',
                      message: `The note is appended to the ${activeCase.caseNumber} timeline and is written to the platform audit trail.`,
                      confirmLabel: 'Add note',
                      tone: 'primary',
                      onConfirm: async () => {
                        try {
                          await platformAdminApi.addInvestigationEvent(activeCase.id, { message, kind: 'note' });
                          setCaseNote('');
                          const detail = await platformAdminApi.investigation(activeCase.id);
                          setActiveCase(detail.investigation);
                          setCaseEvents(detail.events);
                          notify('Note added to the case');
                        } catch (error) {
                          notify(error instanceof Error ? error.message : 'Unable to add note', 'error');
                        }
                      },
                    });
                  }}
                >
                  <Plus size={13} /> Add note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {keyOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setKeyOpen(false)}>
          <div className="biz-form-modal glass" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3><KeyRound size={16} /> Create platform key</h3>
                <p>Store the secret immediately - it is only shown once.</p>
              </div>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setKeyOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            {!newKey ? (
              <>
                <div className="modal-body">
                  <div className="form-grid">
                    <div className="form-field">
                      <label htmlFor="platform-key-name">Key name</label>
                      <input
                        id="platform-key-name"
                        className="input"
                        value={keyForm.name}
                        onChange={(event) => setKeyForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Platform assistant - operations"
                      />
                    </div>
                    <div className="form-field">
                      <label htmlFor="platform-key-expiry">Expiry (days)</label>
                      <input
                        id="platform-key-expiry"
                        className="input"
                        type="number"
                        min={1}
                        max={3650}
                        value={keyForm.expiresInDays}
                        onChange={(event) => setKeyForm((current) => ({ ...current, expiresInDays: Number(event.target.value) }))}
                      />
                    </div>
                    <div className="form-field form-field-full">
                      <span className="form-label">Permissions</span>
                      {keyForm.presetId && (
                        <p className="text-xs text-muted key-preset-note">
                          Based on the <strong>{apiKeys?.presets.find((preset) => preset.id === keyForm.presetId)?.name}</strong> template. Tick or untick anything below to fine tune it.
                        </p>
                      )}
                      <div className="check-grid">
                        {(apiKeys?.scopes || []).map((scope) => (
                          <label key={scope.id} className="check-option">
                            <input
                              type="checkbox"
                              checked={keyForm.scopes.includes(scope.id)}
                              onChange={(event) => setKeyForm((current) => ({
                                ...current,
                                presetId: '',
                                scopes: event.target.checked
                                  ? [...current.scopes, scope.id]
                                  : current.scopes.filter((item) => item !== scope.id),
                              }))}
                            />
                            <span>
                              <strong>{scope.id}</strong>
                              <span className="text-xs text-muted"> {scope.detail}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeyOpen(false)}>Cancel</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={keyForm.name.trim().length < 2 || keyForm.scopes.length === 0}
                    onClick={() => {
                      const name = keyForm.name;
                      const scopes = keyForm.scopes;
                      confirm({
                        title: 'Create platform key',
                        message: `"${name}" is created with ${scopes.length === 1 && scopes[0] === 'platform.full' ? 'the full platform scope' : `the ${scopes.join(', ')} scope(s)`}. A platform key runs the control plane without a user session - the secret is only shown once, so store it immediately.`,
                        confirmLabel: 'Create key',
                        tone: 'primary',
                        onConfirm: async () => {
                          try {
                            const created = await platformAdminApi.createApiKey({ name, scopes, expiresInDays: keyForm.expiresInDays });
                            setNewKey(created.key);
                            setApiKeys(await platformAdminApi.apiKeys());
                            notify('Platform key created');
                          } catch (err) {
                            notify(err instanceof Error ? err.message : 'Unable to create the key.', 'error');
                            setKeyOpen(false);
                          }
                        },
                      });
                    }}
                  >
                    Create key
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-body">
                  <div className="admin-secret-box">
                    <span>New platform API secret</span>
                    <code>{newKey}</code>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => state.copyToClipboard(newKey)}><Copy size={14} /> Copy secret</button>
                  </div>
                  <p className="text-xs text-muted">This secret cannot be retrieved again. If it is lost, revoke the key and create another.</p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNewKey(''); setKeyOpen(false); setKeyForm({ name: '', scopes: [], expiresInDays: 365, presetId: '' }); }}>Done</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {dialog}
    </div>
  );
}
