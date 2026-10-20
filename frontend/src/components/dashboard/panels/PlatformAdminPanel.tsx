import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  CreditCard,
  Crown,
  FileText,
  Flag,
  Globe,
  Menu,
  Plus,
  RefreshCw,
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
  type FeatureFlag,
  type Investigation,
  type PlatformSetting,
  type PlatformTeam,
  type PlatformUser,
  type SupportTicket,
  type SystemInfo,
} from '../../../api/admin';
import type { DashboardState } from '../types';

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
  | 'health';

interface PlatformAdminPanelProps {
  section: PlatformSection;
  onSectionChange: (section: PlatformSection) => void;
  state: DashboardState;
}

type Banner = { tone: 'success' | 'error'; message: string } | null;

const SECTIONS: Array<{ id: PlatformSection; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'companies', label: 'Companies' },
  { id: 'users', label: 'Users' },
  { id: 'investigations', label: 'Investigations' },
  { id: 'usage', label: 'Usage & Load' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'support', label: 'Support' },
  { id: 'team', label: 'Platform Team' },
  { id: 'audit', label: 'Audit Trail' },
  { id: 'config', label: 'Configuration' },
  { id: 'health', label: 'System Health' },
];

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

export default function PlatformAdminPanel({ section, onSectionChange, state }: PlatformAdminPanelProps) {
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<Banner>(null);
  const [denied, setDenied] = useState('');

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

  const [companySearch, setCompanySearch] = useState('');
  const [caseFilter, setCaseFilter] = useState('all');
  const [auditFilter, setAuditFilter] = useState('');
  const [days, setDays] = useState(30);
  const [newAdmin, setNewAdmin] = useState({ email: '', role: 'admin' });
  const [newCase, setNewCase] = useState({ title: '', severity: 'medium', tenantId: '' });
  const [caseNote, setCaseNote] = useState('');
  const [activeCase, setActiveCase] = useState<Investigation | null>(null);
  const [caseEvents, setCaseEvents] = useState<Array<{ id: string; actor: string; kind: string; message: string; createdAt: string }>>([]);

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setBanner({ tone, message });
    state.showToast(message, tone);
    if (tone === 'success') setTimeout(() => setBanner(null), 4000);
  }, [state]);

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
  }, [section, companySearch, caseFilter, auditFilter, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const kpis = overview?.kpis;
  const traffic = analytics?.series.traffic || [];
  const trafficMax = Math.max(1, ...traffic.map((point) => point.requests));

  const growthSeries = useMemo(
    () => (overview?.growth.companies || []).map((point) => ({ label: point.date.slice(5), value: point.value })),
    [overview],
  );

  if (denied) {
    return (
      <div className="dash-panel">
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
                {denied} Add your Firebase UID to <code>PLATFORM_OWNER_UIDS</code> on the API server
                {state.user?.firebaseUid ? <> (your UID is <code>{state.user.firebaseUid}</code>)</> : null} and reload the console.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-panel">
      <div className="panel-header">
        <button className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={18} /></button>
        <h3><Crown size={16} /> Platform Control Plane</h3>
        <div className="toolbar-spacer" />
        <select
          className="input input-auto admin-section-select"
          value={section}
          onChange={(event) => onSectionChange(event.target.value as PlatformSection)}
          aria-label="Control plane section"
        >
          {SECTIONS.map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
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
                  <span>{company.email} · created {dateTime(company.createdAt)}</span>
                </div>
                <div className="admin-user-metrics">
                  <span>{number(company.users)} users</span>
                  <span>{number(company.domains)} domains</span>
                  <span>{number(company.sent)} sent</span>
                  <Badge value={company.plan}>{company.plan}</Badge>
                  <Badge value={company.status}>{company.status}</Badge>
                </div>
                <div className="admin-row-actions">
                  <select
                    className="input input-auto"
                    value={company.plan}
                    onChange={async (event) => {
                      try {
                        await platformAdminApi.updateCompany(company.id, { plan: event.target.value });
                        notify(`${company.name} moved to ${event.target.value}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                  >
                    {['free', 'starter', 'business', 'enterprise'].map((plan) => (
                      <option key={plan} value={plan}>{plan}</option>
                    ))}
                  </select>
                  <select
                    className="input input-auto"
                    value={company.status}
                    onChange={async (event) => {
                      try {
                        await platformAdminApi.updateCompany(company.id, { status: event.target.value });
                        notify(`${company.name} is now ${event.target.value}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                  >
                    {['active', 'suspended', 'pending_verification', 'disabled'].map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
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
                  <span>{item.email} · {item.company || 'No company'}</span>
                </div>
                <div className="admin-user-metrics">
                  <span>{item.plan}</span>
                  <span>{number(item.sent)} sent</span>
                  <span>{number(item.activeSessions)} sessions</span>
                  <Badge value={item.status}>{item.status}</Badge>
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
                onClick={async () => {
                  if (newCase.title.trim().length < 4) {
                    notify('Case title is too short', 'error');
                    return;
                  }
                  try {
                    await platformAdminApi.createInvestigation({
                      title: newCase.title.trim(),
                      severity: newCase.severity,
                      type: 'abuse',
                      priority: newCase.severity === 'critical' ? 'P1' : 'P2',
                      summary: 'Created from the control plane console',
                    });
                    setNewCase({ title: '', severity: 'medium', tenantId: '' });
                    notify('Investigation created');
                    void load();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : 'Unable to create investigation', 'error');
                  }
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
                    onClick={async () => {
                      const next = item.status === 'resolved' ? 'open' : 'resolved';
                      try {
                        await platformAdminApi.updateInvestigation(item.id, { status: next });
                        notify(`Case marked ${next}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
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
                  <select
                    className="input input-auto"
                    value={ticket.status}
                    onChange={async (event) => {
                      try {
                        await platformAdminApi.updateTicket(ticket.id, { status: event.target.value });
                        notify(`Ticket moved to ${event.target.value}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                  >
                    {['open', 'pending', 'resolved', 'closed'].map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
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
                <option value="admin">admin</option>
                <option value="superadmin">superadmin</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                className="btn btn-primary btn-sm"
                onClick={async () => {
                  if (!newAdmin.email.includes('@')) {
                    notify('Enter a valid email address', 'error');
                    return;
                  }
                  try {
                    await platformAdminApi.addAdmin({ email: newAdmin.email.trim(), role: newAdmin.role });
                    setNewAdmin({ email: '', role: 'admin' });
                    notify('Administrator added');
                    void load();
                  } catch (error) {
                    notify(error instanceof Error ? error.message : 'Unable to add administrator', 'error');
                  }
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
                  <select
                    className="input input-auto"
                    value={admin.role}
                    onChange={async (event) => {
                      try {
                        await platformAdminApi.updateAdmin(admin.email, { role: event.target.value });
                        notify(`${admin.email} is now ${event.target.value}`);
                        void load();
                      } catch (error) {
                        notify(error instanceof Error ? error.message : 'Update failed', 'error');
                      }
                    }}
                  >
                    {(team?.roles || []).map((role) => (
                      <option key={role.key} value={role.key}>{role.key}</option>
                    ))}
                  </select>
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
                      onClick={async () => {
                        try {
                          await platformAdminApi.updateFlag({ key: flag.key, enabled: !flag.enabled });
                          notify(`${flag.name} ${flag.enabled ? 'disabled' : 'enabled'}`);
                          void load();
                        } catch (error) {
                          notify(error instanceof Error ? error.message : 'Update failed', 'error');
                        }
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
                      onClick={async () => {
                        const next = announcement.status === 'published' ? 'archived' : 'published';
                        try {
                          await platformAdminApi.updateAnnouncement(announcement.id, next);
                          notify(`Announcement ${next}`);
                          void load();
                        } catch (error) {
                          notify(error instanceof Error ? error.message : 'Update failed', 'error');
                        }
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
                        try {
                          const parsed = JSON.parse(raw);
                          void platformAdminApi.updateSetting(key, parsed).then(() => {
                            notify(`${key} updated`);
                            void load();
                          }).catch((error: unknown) => {
                            notify(error instanceof Error ? error.message : 'Update failed', 'error');
                          });
                        } catch {
                          notify('Value must be valid JSON', 'error');
                        }
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
      </div>

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
                  onClick={async () => {
                    if (!caseNote.trim()) return;
                    try {
                      await platformAdminApi.addInvestigationEvent(activeCase.id, { message: caseNote.trim(), kind: 'note' });
                      setCaseNote('');
                      const detail = await platformAdminApi.investigation(activeCase.id);
                      setActiveCase(detail.investigation);
                      setCaseEvents(detail.events);
                      notify('Note added to the case');
                    } catch (error) {
                      notify(error instanceof Error ? error.message : 'Unable to add note', 'error');
                    }
                  }}
                >
                  <Plus size={13} /> Add note
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
