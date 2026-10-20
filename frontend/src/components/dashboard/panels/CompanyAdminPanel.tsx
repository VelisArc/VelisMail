import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  FileText,
  Globe2,
  KeyRound,
  Mail,
  Menu,
  Plus,
  RefreshCw,
  Shield,
  ShieldAlert,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  AdminApiError,
  companyAdminApi,
  type CompanyMember,
  type CompanyOverview,
  type Invoice,
} from '../../../api/admin';
import type { DashboardState } from '../types';

type Tab = 'overview' | 'team' | 'usage' | 'billing' | 'security' | 'api' | 'audit' | 'integrations';

const TABS: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'api', label: 'API Keys', icon: KeyRound },
  { id: 'audit', label: 'Audit Log', icon: FileText },
  { id: 'integrations', label: 'Integrations', icon: Globe2 },
];

function number(value?: number | null): string {
  return new Intl.NumberFormat('en-IN').format(value || 0);
}

function money(paise?: number | null): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format((paise || 0) / 100);
}

function bytes(value?: number | null): string {
  const size = value || 0;
  if (size <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function date(value?: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
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

function Badge({ value, children }: { value?: string | null; children: ReactNode }) {
  const normalized = (value || '').toLowerCase();
  const tone = ['active', 'delivered', 'paid', 'owner', 'resolved', 'verified', 'good', 'info'].includes(normalized)
    ? 'success'
    : ['suspended', 'failed', 'critical', 'high', 'revoked', 'bad'].includes(normalized)
      ? 'danger'
      : ['pending', 'open', 'medium', 'warning', 'past_due'].includes(normalized)
        ? 'primary'
        : 'neutral';
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function Stat({ label, value, hint, icon, tone }: { label: string; value: string; hint?: string; icon: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`admin-stat ${tone ? `admin-stat-${tone}` : ''}`}>
      <div className="admin-stat-label"><i>{icon}</i><span>{label}</span></div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export default function CompanyAdminPanel({ state }: { state: DashboardState }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [overview, setOverview] = useState<CompanyOverview | null>(null);
  const [members, setMembers] = useState<CompanyMember[]>([]);
  const [seatLimit, setSeatLimit] = useState({ used: 0, max: 5 });
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof companyAdminApi.usage>> | null>(null);
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof companyAdminApi.billing>> | null>(null);
  const [security, setSecurity] = useState<Awaited<ReturnType<typeof companyAdminApi.security>> | null>(null);
  const [keys, setKeys] = useState<Awaited<ReturnType<typeof companyAdminApi.apiKeys>> | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof companyAdminApi.audit>> | null>(null);
  const [integrations, setIntegrations] = useState<Awaited<ReturnType<typeof companyAdminApi.integrations>> | null>(null);
  const [days, setDays] = useState(30);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: '', scopes: ['mail.send'], expiresInDays: 365 });
  const [newKey, setNewKey] = useState('');
  const [savingMember, setSavingMember] = useState('');

  const canManage = state.user?.role === 'admin'
    || overview?.company.role === 'owner'
    || overview?.company.role === 'admin';

  const load = useCallback(async (target: Tab) => {
    setLoading(true);
    setError('');
    try {
      if (target === 'overview') setOverview(await companyAdminApi.overview());
      if (target === 'team') {
        const result = await companyAdminApi.members();
        setMembers(result.members);
        setSeatLimit(result.seatLimit);
      }
      if (target === 'usage') setUsage(await companyAdminApi.usage(days));
      if (target === 'billing') setBilling(await companyAdminApi.billing());
      if (target === 'security') setSecurity(await companyAdminApi.security());
      if (target === 'api') setKeys(await companyAdminApi.apiKeys());
      if (target === 'audit') setAudit(await companyAdminApi.audit());
      if (target === 'integrations') setIntegrations(await companyAdminApi.integrations());
    } catch (err) {
      if (err instanceof AdminApiError && (err.status === 401 || err.status === 403)) {
        setError('Your company admin session is not authorized. Sign in again with a company administrator account.');
      } else {
        setError(err instanceof Error ? err.message : 'Unable to load company administration data.');
      }
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load(tab);
  }, [tab, load]);

  useEffect(() => {
    if (tab === 'usage') void load('usage');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const updateMember = async (member: CompanyMember, payload: { role?: string; status?: string }) => {
    setSavingMember(member.id);
    setError('');
    try {
      await companyAdminApi.updateMember(member.id, payload);
      setNotice(`${member.email} updated.`);
      const result = await companyAdminApi.members();
      setMembers(result.members);
      setSeatLimit(result.seatLimit);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update team member.');
    } finally {
      setSavingMember('');
    }
  };

  const createKey = async () => {
    setError('');
    try {
      const result = await companyAdminApi.createApiKey({
        name: keyForm.name,
        scopes: keyForm.scopes,
        expiresInDays: keyForm.expiresInDays,
      });
      setNewKey(result.key);
      setKeys(await companyAdminApi.apiKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create API key.');
    }
  };

  const revokeKey = async (id: string) => {
    setError('');
    try {
      await companyAdminApi.revokeApiKey(id);
      setKeys(await companyAdminApi.apiKeys());
      setNotice('API key revoked.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke API key.');
    }
  };

  const status = overview?.company.status || state.user?.status || 'active';

  return (
    <div className="dash-panel">
      <div className="panel-header">
        <button type="button" className="toolbar-icon sidebar-toggle" onClick={() => state.setSidebarOpen(true)}><Menu size={18} /></button>
        <h3><Building2 size={16} /> Company Administration</h3>
        <div className="toolbar-spacer" />
        <div className="panel-header-actions">
          <Badge value={status}>{status}</Badge>
          <Badge value={overview?.company.plan || state.user?.plan}>{overview?.company.plan || state.user?.plan || 'Free'} plan</Badge>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(tab)} disabled={loading}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
      </div>

      <div className="dash-body">
        <div className="admin-company-head">
          <h2>{overview?.company.name || state.user?.displayName || 'Your workspace'}</h2>
          <p className="text-sm text-muted">Manage the people, mail operations, security and billing for this company.</p>
        </div>

        <nav className="admin-tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn btn-sm ${tab === item.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(item.id)}
            >
              <item.icon size={15} /> {item.label}
            </button>
          ))}
        </nav>

        {notice && <div className="badge badge-success admin-inline-banner" onClick={() => setNotice('')}><CheckCircle2 size={15} /> {notice}<X size={13} /></div>}
        {error && <div className="badge badge-danger admin-inline-banner" onClick={() => setError('')}><AlertTriangle size={15} /> {error}<X size={13} /></div>}

        {loading && !overview && <div className="admin-loading"><span className="spinner spinner-sm" /> Loading company data…</div>}

      {tab === 'overview' && overview && (
        <>
          <div className="admin-grid-4">
            <Stat label="Team members" value={number(overview.counts.members)} hint={`Seat limit ${overview.limits.seats}`} icon={<Users size={17} />} />
            <Stat label="Emails / 30d" value={number(overview.counts.sent30d)} hint={`${overview.usage.emailPercent.toFixed(1)}% of plan`} icon={<Mail size={17} />} />
            <Stat label="Queue" value={number(overview.counts.queueDepth)} hint={`${number(overview.counts.failed30d)} failed in 30d`} icon={<Activity size={17} />} tone={overview.counts.queueDepth > 0 ? 'warn' : undefined} />
            <Stat label="Storage" value={bytes(overview.counts.storageBytes)} hint={`${overview.usage.storagePercent.toFixed(1)}% of quota`} icon={<Database size={17} />} />
            <Stat label="Domains" value={number(overview.counts.domains)} hint={`${number(overview.counts.apiKeys)} API keys`} icon={<Globe2 size={17} />} />
            <Stat label="Security" value={number(overview.counts.activeSessions)} hint="Active sessions" icon={<Shield size={17} />} tone={overview.counts.openCases > 0 ? 'bad' : 'good'} />
          </div>

          <div className="admin-grid-2">
            <section className="glass-card">
              <div className="admin-card-head"><div><h3>Plan consumption</h3><p>Current billing period</p></div><BarChart3 size={16} /></div>
              <div className="admin-progress"><div><span>Email volume</span><strong>{number(overview.counts.sent30d)} / {number(overview.limits.emailsPerMonth)}</strong></div><div className="admin-progress-track"><i className={overview.usage.emailPercent > 85 ? 'warn' : ''} style={{ width: `${Math.max(1, overview.usage.emailPercent)}%` }} /></div></div>
              <div className="admin-progress"><div><span>Storage</span><strong>{bytes(overview.counts.storageBytes)} / {bytes(overview.limits.storageBytes)}</strong></div><div className="admin-progress-track"><i className={overview.usage.storagePercent > 85 ? 'warn' : ''} style={{ width: `${Math.max(1, overview.usage.storagePercent)}%` }} /></div></div>
              <div className="admin-progress"><div><span>Seats</span><strong>{number(overview.counts.members)} / {number(overview.limits.seats)}</strong></div><div className="admin-progress-track"><i style={{ width: `${Math.min(100, (overview.counts.members / Math.max(1, overview.limits.seats)) * 100)}%` }} /></div></div>
              <div className="admin-usage-foot"><span>{number(overview.counts.apiKeys)} active API keys</span><span>{overview.company.role} access</span></div>
            </section>

            <section className="glass-card">
              <div className="admin-card-head"><div><h3>30-day mail activity</h3><p>Delivery engine volume</p></div><Mail size={16} /></div>
              <div className="admin-bar-chart">
                {overview.activity.map((point) => {
                  const max = Math.max(1, ...overview.activity.map((item) => item.sent));
                  return <div key={point.date} className="admin-bar" title={`${point.date}: ${number(point.sent)} sent · ${number(point.delivered)} delivered`} style={{ height: `${Math.max(4, (point.sent / max) * 100)}%` }} />;
                })}
              </div>
              <div className="admin-usage-foot"><span>{number(overview.activity.reduce((sum, point) => sum + point.sent, 0))} emails sent</span><span>{number(overview.activity.reduce((sum, point) => sum + point.delivered, 0))} delivered</span></div>
            </section>
          </div>

          <div className="admin-grid-2">
            <section className="glass-card">
              <div className="admin-card-head"><div><h3>Team snapshot</h3><p>People with workspace access</p></div><Users size={16} /></div>
              <div className="admin-mini-list">
                {overview.members.map((member) => (
                  <div key={member.email} className="admin-user-row">
                    <span className="avatar avatar-sm">{(member.name || member.email).charAt(0).toUpperCase()}</span>
                    <div><strong>{member.name || member.email}</strong><span>{member.email}</span></div>
                    <Badge value={member.role}>{member.role}</Badge>
                  </div>
                ))}
                {overview.members.length === 0 && <p className="text-sm text-muted">No active team members.</p>}
              </div>
              <button type="button" className="btn btn-primary btn-sm btn btn-ghost btn-sm btn btn-ghost btn-sm w-full mt-8" onClick={() => setTab('team')}>Manage team</button>
            </section>

            <section className="glass-card">
              <div className="admin-card-head"><div><h3>Recent company activity</h3><p>Administrative changes and security events</p></div><FileText size={16} /></div>
              <div className="admin-mini-list">
                {overview.recentActivity.map((entry) => (
                  <div key={entry.id} className="admin-user-row">
                    <i className={`status-dot ${entry.severity === 'critical' ? 'bad' : entry.severity === 'warning' ? 'warn' : 'good'}`} />
                    <div><strong>{entry.action.replaceAll('.', ' ')}</strong><span>{entry.actor} · {ago(entry.createdAt)}</span></div>
                  </div>
                ))}
                {overview.recentActivity.length === 0 && <p className="text-sm text-muted">Administrative actions will appear here.</p>}
              </div>
              <button type="button" className="btn btn-primary btn-sm btn btn-ghost btn-sm btn btn-ghost btn-sm w-full mt-8" onClick={() => setTab('audit')}>Open audit log</button>
            </section>
          </div>
        </>
      )}

      {tab === 'team' && (
        <section className="glass-card">
          <div className="admin-card-head">
            <div><h3>Workspace members</h3><p>{seatLimit.used} of {seatLimit.max} seats used</p></div>
            <div className="panel-header-actions">
              <button type="button" className="btn btn-primary btn-sm btn btn-primary btn-sm" onClick={() => state.setActiveBizTab('team')}><UserPlus size={15} /> Invite teammate</button>
            </div>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Last active</th><th>Joined</th><th>Actions</th></tr></thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id}>
                    <td><div className="admin-person"><span className="avatar avatar-sm">{(member.name || member.email).charAt(0).toUpperCase()}</span><div><strong>{member.name || member.email}</strong><span>{member.email}</span></div></div></td>
                    <td>
                      <select className="input input-auto" value={member.role} disabled={!canManage || savingMember === member.id} onChange={(event) => void updateMember(member, { role: event.target.value })}>
                        <option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option><option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td><Badge value={member.status}>{member.status}</Badge></td>
                    <td>{ago(member.lastActiveAt)}</td>
                    <td>{date(member.joinedAt)}</td>
                    <td>
                      {member.email === state.user?.email ? <span className="text-sm text-muted">You</span> : (
                        <select className="input input-auto" value={member.status} disabled={!canManage || savingMember === member.id} onChange={(event) => void updateMember(member, { status: event.target.value })}>
                          <option value="active">Active</option><option value="suspended">Suspended</option><option value="removed">Remove</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {members.length === 0 && <p className="admin-empty-state">No members found.</p>}
          </div>
          {!canManage && <p className="text-xs text-muted">Only company owners and admins can change roles or suspend access.</p>}
        </section>
      )}

      {tab === 'usage' && usage && (
        <>
          <div className="admin-controls-bar">
            <div className="admin-segmented">{[7, 30, 90].map((value) => <button key={value} type="button" className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{value} days</button>)}</div>
            <span className="text-sm text-muted">{number(usage.totals.messages)} lifetime messages</span>
          </div>
          <div className="admin-grid-4">
            <Stat label="Sent" value={number(usage.totals.sent30d)} hint="Last 30 days" icon={<Mail size={17} />} />
            <Stat label="Delivered" value={number(usage.totals.delivered30d)} hint="Last 30 days" icon={<CheckCircle2 size={17} />} tone="good" />
            <Stat label="Failed" value={number(usage.totals.failed30d)} hint="Last 30 days" icon={<AlertTriangle size={17} />} tone={usage.totals.failed30d > 0 ? 'bad' : undefined} />
            <Stat label="Storage" value={bytes(usage.totals.storageBytes)} hint={`${bytes(usage.limits.storageBytes)} plan limit`} icon={<Database size={17} />} />
            <Stat label="Plan usage" value={`${usage.usagePercent.toFixed(1)}%`} hint={`${number(usage.limits.emailsPerMonth)} monthly quota`} icon={<Activity size={17} />} tone={usage.usagePercent > 85 ? 'warn' : 'good'} />
          </div>
          <section className="glass-card">
            <div className="admin-card-head"><div><h3>Mail volume</h3><p>Sent, delivered and failed by day</p></div><BarChart3 size={16} /></div>
            <div className="admin-bar-chart">
              {usage.series.map((point) => {
                const max = Math.max(1, ...usage.series.map((row) => row.sent));
                return (
                  <div key={point.date} className="admin-bar-col" title={`${point.date}: ${point.sent} sent, ${point.delivered} delivered, ${point.failed} failed`}>
                    <div className="admin-bar-track">
                      <i className="sent" style={{ height: `${(point.sent / max) * 100}%` }} />
                      <i className="delivered" style={{ height: `${(point.delivered / max) * 100}%` }} />
                    </div>
                    <span>{point.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
            <div className="admin-legend"><span><i className="admin-legend-sent" /> Sent</span><span><i className="admin-legend-delivered" /> Delivered</span></div>
          </section>
          {usage.history.length > 0 && (
            <section className="glass-card">
              <div className="admin-card-head"><div><h3>Daily operational history</h3><p>Database-backed usage rollups</p></div><Activity size={16} /></div>
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Date</th><th>Sent</th><th>Received</th><th>API requests</th><th>Queue</th><th>Bounces</th><th>Spam blocked</th><th>Latency</th></tr></thead><tbody>{usage.history.map((row, index) => <tr key={String(row.date || index)}><td>{String(row.date || '—')}</td><td>{number(Number(row.sent || 0))}</td><td>{number(Number(row.received || 0))}</td><td>{number(Number(row.apiRequests || 0))}</td><td>{number(Number(row.queueDepth || 0))}</td><td>{number(Number(row.bounces || 0))}</td><td>{number(Number(row.spamBlocked || 0))}</td><td>{Number(row.avgLatencyMs || 0)} ms</td></tr>)}</tbody></table></div>
            </section>
          )}
        </>
      )}

      {tab === 'billing' && billing && (
        <>
          <div className="admin-billing-hero">
            <div><span className="text-xs text-muted uppercase">Current subscription</span><h3>{billing.plan} <Badge value={billing.status}>{billing.status}</Badge></h3><p>{number(billing.limits.seats)} seats · {number(billing.limits.emailsPerMonth)} emails/month · {bytes(billing.limits.storageBytes)} storage</p></div>
            <div className="admin-billing-total"><span>Total paid</span><strong>{money(billing.summary.totalPaidPaise)}</strong><small>{number(billing.summary.invoiceCount)} invoices</small></div>
          </div>
          <div className="admin-grid-4 admin-grid-4">
            {billing.catalog.map((plan) => (
              <div key={plan.key} className={`billing-plan-card ${plan.key === billing.plan.toLowerCase() ? 'current' : ''}`}>
                <div><strong>{plan.name}</strong>{plan.key === billing.plan.toLowerCase() && <Badge value="active">Current</Badge>}</div>
                <span>{money(plan.monthlyPaise)}<small>/mo</small></span>
                <ul><li>{number(plan.limits.seats)} seats</li><li>{number(plan.limits.emailsPerMonth)} emails/mo</li><li>{bytes(plan.limits.storageBytes)} storage</li></ul>
                {plan.key !== billing.plan.toLowerCase() && <button type="button" className="btn btn-primary btn-sm btn btn-ghost btn-sm" onClick={() => state.setActiveBizTab('billing')}>Change plan</button>}
              </div>
            ))}
          </div>
          <section className="glass-card">
            <div className="admin-card-head"><div><h3>Invoice history</h3><p>Server-verified payments only</p></div><CreditCard size={16} /></div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Invoice</th><th>Plan</th><th>Cycle</th><th>Amount</th><th>Status</th><th>Issued</th><th>Paid</th></tr></thead>
                <tbody>{billing.invoices.map((invoice: Invoice) => <tr key={invoice.id}><td><strong>{invoice.number}</strong></td><td>{invoice.plan}</td><td>{invoice.billingCycle}</td><td>{money(invoice.amountPaise)}</td><td><Badge value={invoice.status}>{invoice.status}</Badge></td><td>{date(invoice.issuedAt)}</td><td>{date(invoice.paidAt)}</td></tr>)}</tbody>
              </table>
              {billing.invoices.length === 0 && <p className="admin-empty-state">No invoices yet. Your first verified payment will create one.</p>}
            </div>
            <p className="text-xs text-muted">Payment gateway: {billing.paymentGateway.configured ? `${billing.paymentGateway.provider} connected` : 'not configured'}.</p>
          </section>
        </>
      )}

      {tab === 'security' && security && (
        <>
          <div className="admin-grid-4">
            <Stat label="Active sessions" value={number(security.sessionCount)} hint="Across your team" icon={<Shield size={17} />} />
            <Stat label="Failed logins" value={number(security.failedLogins.length)} hint="Last 30 days" icon={<AlertTriangle size={17} />} tone={security.failedLogins.length > 0 ? 'warn' : 'good'} />
            <Stat label="Security events" value={number(security.events.length)} hint="Access and policy changes" icon={<ShieldAlert size={17} />} />
            <Stat label="API keys" value={number(security.apiKeys.length)} hint="Active credentials" icon={<KeyRound size={17} />} />
          </div>
          <section className="glass-card">
            <div className="admin-card-head"><div><h3>Active sessions</h3><p>Devices currently signed in</p></div><Shield size={16} /></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Device</th><th>IP</th><th>Last active</th><th>Expires</th><th>MFA</th></tr></thead><tbody>{security.sessions.map((session) => <tr key={session.id}><td>{session.email}</td><td className="admin-mono">{session.device.slice(0, 22)}</td><td>{session.ip || '—'}</td><td>{ago(session.lastActive)}</td><td>{date(session.expiresAt)}</td><td>{session.mfaVerified ? <Badge value="verified">Verified</Badge> : <Badge value="pending">Not verified</Badge>}</td></tr>)}</tbody></table>{security.sessions.length === 0 && <p className="admin-empty-state">No active sessions.</p>}</div>
          </section>
          <div className="admin-grid-2">
            <section className="glass-card"><div className="admin-card-head"><div><h3>Failed login attempts</h3><p>Last 30 days</p></div><AlertTriangle size={16} /></div><div className="admin-mini-list">{security.failedLogins.map((item) => <div key={item.id} className="admin-user-row"><span className="avatar avatar-sm"><AlertTriangle size={14} /></span><div><strong>{item.email}</strong><span>{item.ip || 'unknown IP'} · {ago(item.attemptedAt)}</span></div></div>)}{security.failedLogins.length === 0 && <p className="text-sm text-muted">No failed login attempts.</p>}</div></section>
            <section className="glass-card"><div className="admin-card-head"><div><h3>Security events</h3><p>Durable security log</p></div><ShieldAlert size={16} /></div><div className="admin-mini-list">{security.events.map((event) => <div key={event.id} className="admin-user-row"><i className={`status-dot ${event.severity === 'critical' ? 'bad' : event.severity === 'warning' ? 'warn' : 'good'}`} /><div><strong>{event.eventType.replaceAll('_', ' ')}</strong><span>{event.ip || 'unknown IP'} · {ago(event.createdAt)}</span></div></div>)}{security.events.length === 0 && <p className="text-sm text-muted">No security events logged.</p>}</div></section>
          </div>
        </>
      )}

      {tab === 'api' && keys && (
        <>
          <div className="admin-controls-bar"><span className="text-sm text-muted">{keys.keys.filter((key) => !key.revokedAt).length} active credentials</span><button type="button" className="btn btn-primary btn-sm btn btn-primary btn-sm" onClick={() => { setNewKey(''); setKeyOpen(true); }} disabled={!canManage}><Plus size={15} /> Create API key</button></div>
          {!canManage && <p className="text-xs text-muted">Only owners and admins can create or revoke API keys.</p>}
          <section className="glass-card">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Name</th><th>Key prefix</th><th>Scopes</th><th>Created by</th><th>Last used</th><th>Expires</th><th>Status</th><th>Action</th></tr></thead>
                <tbody>{keys.keys.map((key) => <tr key={key.id}><td><strong>{key.name}</strong></td><td className="admin-mono">{key.prefix}…</td><td>{key.scopes.join(', ')}</td><td>{key.createdBy}</td><td>{ago(key.lastUsedAt)}</td><td>{date(key.expiresAt)}</td><td>{key.revokedAt ? <Badge value="revoked">Revoked</Badge> : <Badge value="active">Active</Badge>}</td><td>{!key.revokedAt && canManage ? <button type="button" className="btn btn-primary btn-sm btn btn-danger btn-sm" onClick={() => void revokeKey(key.id)}>Revoke</button> : <span className="text-sm text-muted">—</span>}</td></tr>)}</tbody>
              </table>
              {keys.keys.length === 0 && <p className="admin-empty-state">No API keys yet. Create one for server-to-server mail sending.</p>}
            </div>
          </section>
          <section className="glass-card">
            <div className="admin-card-head"><div><h3>API access</h3><p>Use keys with the VelisMail API gateway</p></div><KeyRound size={16} /></div>
            <div className="admin-code-block"><code>Authorization: Bearer vsk_live_…</code><code>POST /api/v1/mail/send</code></div>
            <p className="text-xs text-muted">Scopes limit what a key can do. Secrets are hashed in PostgreSQL and shown only once at creation.</p>
          </section>
        </>
      )}

      {tab === 'audit' && audit && (
        <section className="glass-card">
          <div className="admin-card-head"><div><h3>Company audit trail</h3><p>Platform and workspace actions for this company</p></div><FileText size={16} /></div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Source</th><th>Category</th><th>Severity</th><th>Resource</th></tr></thead>
              <tbody>{audit.entries.map((entry) => <tr key={entry.id}><td>{date(entry.createdAt)}</td><td>{entry.actor}</td><td><strong>{entry.action}</strong></td><td>{entry.source}</td><td>{entry.category}</td><td><Badge value={entry.severity}>{entry.severity}</Badge></td><td>{entry.resourceType}</td></tr>)}</tbody>
            </table>
            {audit.entries.length === 0 && <p className="admin-empty-state">No audit events recorded for this company yet.</p>}
          </div>
        </section>
      )}

      {tab === 'integrations' && integrations && (
        <>
          <div className="admin-grid-4 admin-grid-4">
            <Stat label="Domains" value={number(integrations.domains.length)} hint={`${integrations.domains.filter((domain) => domain.status === 'verified').length} verified`} icon={<Globe2 size={17} />} />
            <Stat label="Inbound" value={integrations.mailboxes.inboundConfigured ? 'Ready' : 'Setup needed'} hint="MX delivery" icon={<Mail size={17} />} tone={integrations.mailboxes.inboundConfigured ? 'good' : 'warn'} />
            <Stat label="Outbound" value={integrations.mailboxes.outboundConfigured ? 'Ready' : 'Setup needed'} hint={integrations.mailboxes.provider} icon={<Activity size={17} />} tone={integrations.mailboxes.outboundConfigured ? 'good' : 'warn'} />
            <Stat label="API keys" value={number(integrations.apiKeys)} hint="Active credentials" icon={<KeyRound size={17} />} />
          </div>
          <section className="glass-card">
            <div className="admin-card-head"><div><h3>Domains & DNS</h3><p>Deliverability configuration</p></div><Globe2 size={16} /></div>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Domain</th><th>Status</th><th>SPF</th><th>DKIM</th><th>DMARC</th><th>Added</th><th>Verified</th></tr></thead><tbody>{integrations.domains.map((domain) => <tr key={domain.id}><td><strong>{domain.domain}</strong></td><td><Badge value={domain.status}>{domain.status}</Badge></td><td>{domain.spfRecord ? 'Configured' : 'Missing'}</td><td>{domain.dkimRecord ? 'Configured' : 'Missing'}</td><td>{domain.dmarcRecord ? 'Configured' : 'Missing'}</td><td>{date(domain.addedAt)}</td><td>{date(domain.verifiedAt)}</td></tr>)}</tbody></table>{integrations.domains.length === 0 && <p className="admin-empty-state">No custom domains connected.</p>}</div>
          </section>
          <div className="admin-grid-2">
            <section className="glass-card"><div className="admin-card-head"><div><h3>Workspace features</h3><p>Enabled for this company</p></div><Activity size={16} /></div><div className="admin-mini-list">{integrations.features.map((feature) => <div key={feature.key} className="admin-user-row"><div><strong>{feature.name}</strong><span>{feature.key}</span></div><Badge value={feature.enabled ? 'active' : 'disabled'}>{feature.enabled ? 'Enabled' : 'Disabled'}</Badge></div>)}{integrations.features.length === 0 && <p className="text-sm text-muted">No company-specific feature flags.</p>}</div></section>
            <section className="glass-card"><div className="admin-card-head"><div><h3>Connection status</h3><p>Mail infrastructure</p></div><Database size={16} /></div><div className="admin-kv-list"><div><span>Delivery engine</span><strong>{integrations.mailboxes.provider}</strong></div><div><span>Inbound routing</span><strong>{integrations.mailboxes.inboundConfigured ? 'Operational' : 'Not configured'}</strong></div><div><span>Outbound mail</span><strong>{integrations.mailboxes.outboundConfigured ? 'Operational' : 'Not configured'}</strong></div><div><span>Webhooks</span><strong>{integrations.webhooks.length} configured</strong></div><div><span>SMTP relay</span><strong>{integrations.smtp.enabled ? 'Enabled' : 'Disabled'}</strong></div></div></section>
          </div>
        </>
      )}
      </div>

      {keyOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" onClick={() => setKeyOpen(false)}>
          <div className="biz-form-modal glass" onClick={(event) => event.stopPropagation()}>
            <div className="compose-header"><div><h3>Create API key</h3><p>Store the secret immediately — it is only shown once.</p></div><button type="button" className="btn btn-ghost btn-icon" onClick={() => setKeyOpen(false)}><X size={16} /></button></div>
            {!newKey ? (
              <div className="admin-form">
                <label>Key name<input className="input" value={keyForm.name} onChange={(event) => setKeyForm((current) => ({ ...current, name: event.target.value }))} placeholder="Transactional mail — production" /></label>
                <label>Expiry (days)<input className="input" type="number" min={1} max={3650} value={keyForm.expiresInDays} onChange={(event) => setKeyForm((current) => ({ ...current, expiresInDays: Number(event.target.value) }))} /></label>
                <fieldset><legend>Scopes</legend>{['mail.send', 'mail.read', 'contacts.read', 'domains.read', 'analytics.read'].map((scope) => <label key={scope} className="admin-check"><input type="checkbox" checked={keyForm.scopes.includes(scope)} onChange={(event) => setKeyForm((current) => ({ ...current, scopes: event.target.checked ? [...current.scopes, scope] : current.scopes.filter((item) => item !== scope) }))} />{scope}</label>)}</fieldset>
                <div className="admin-modal-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeyOpen(false)}>Cancel</button><button type="button" className="btn btn-primary btn-sm" onClick={() => void createKey()} disabled={keyForm.name.trim().length < 2 || keyForm.scopes.length === 0}>Create key</button></div>
              </div>
            ) : (
              <div className="admin-form">
                <div className="admin-secret-box"><span>New API secret</span><code>{newKey}</code><button type="button" className="btn btn-primary btn-sm" onClick={() => { state.copyToClipboard(newKey); setNotice('API key copied to clipboard.'); }}><Copy size={14} /> Copy</button></div>
                <p className="text-xs text-muted">This secret cannot be retrieved again. If it is lost, revoke the key and create another.</p>
                <div className="admin-modal-actions"><button type="button" className="btn btn-primary btn-sm" onClick={() => { setNewKey(''); setKeyOpen(false); setKeyForm({ name: '', scopes: ['mail.send'], expiresInDays: 365 }); }}>Done</button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

