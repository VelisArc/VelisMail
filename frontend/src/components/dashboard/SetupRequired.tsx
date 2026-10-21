import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Database, Globe, KeyRound, Mail, RefreshCw } from 'lucide-react';
import { workspaceApi, type DnsRequirement } from '../../api/company';
import type { User } from '../../api/client';

interface SetupRequiredProps {
  user: User | null;
}

type SetupItem = {
  key: string;
  label: string;
  description: string;
  icon: typeof Database;
  done: boolean;
  detail?: string;
  action?: { label: string; onClick: () => void };
};

/**
 * Shown while the workspace is not fully configured.
 *
 * Nothing in the product works before the infrastructure is in place, so the
 * dashboard explains exactly what is missing - including the live status of
 * every DNS record - and takes the user straight into the setup flow.
 */
export default function SetupRequired({ user }: SetupRequiredProps) {
  const navigate = useNavigate();
  const [dns, setDns] = useState<{ loading: boolean; records: DnsRequirement[]; message: string; complete: boolean }>({
    loading: true,
    records: [],
    message: '',
    complete: false,
  });
  const [domains, setDomains] = useState<Array<{ id: string; domain: string; status: string }>>([]);

  const load = useCallback(async () => {
    setDns((current) => ({ ...current, loading: true }));
    try {
      const domainList = await workspaceApi.domains();
      const active = domainList.domains[0];
      setDomains(domainList.domains.map((entry) => ({ id: entry.id, domain: entry.domain, status: entry.status })));
      if (!active) {
        setDns({ loading: false, records: [], message: 'No domain is connected yet.', complete: false });
        return;
      }
      const requirements = await workspaceApi.dnsRequirements(active.domain);
      setDns({
        loading: false,
        records: requirements.records,
        message: requirements.message,
        complete: requirements.complete,
      });
    } catch (error) {
      setDns({
        loading: false,
        records: [],
        message: error instanceof Error ? error.message : 'Unable to read the DNS status.',
        complete: false,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const receiving = dns.records.find((record) => record.purpose.toLowerCase().includes('receiv'));
  const pendingRecords = dns.records.filter((record) => record.status !== 'verified');

  const items: SetupItem[] = [
    {
      key: 'database',
      label: 'Business database',
      description: 'The PostgreSQL database that stores your mail, domains and team.',
      icon: Database,
      done: Boolean(user?.businessDbUrl?.trim()),
    },
    {
      key: 'apiKey',
      label: 'Mail API key',
      description: 'Your sending credential. Every plan starts with a free trial allowance.',
      icon: KeyRound,
      done: Boolean(user?.businessApiKey?.trim()),
    },
    {
      key: 'domain',
      label: 'Primary domain',
      description: 'The domain your company sends from. It has to be verified.',
      icon: Globe,
      done: domains.length > 0 && domains[0].status === 'verified',
      detail: domains[0] ? `${domains[0].domain} (${domains[0].status})` : 'No domain connected yet',
    },
    {
      key: 'dns',
      label: 'DNS records active',
      description: 'SPF, DKIM, DMARC and MX have to be published and active before mail flows.',
      icon: AlertTriangle,
      done: dns.complete,
      detail: dns.loading
        ? 'Checking the live DNS...'
        : dns.records.length
          ? `${dns.records.length - pendingRecords.length} of ${dns.records.length} records active`
          : 'No records to check yet',
      action: { label: 'Check DNS', onClick: () => void load() },
    },
    {
      key: 'receiving',
      label: 'Receiving enabled',
      description: 'The inbound MX record has to be active so the domain can receive mail.',
      icon: Mail,
      done: Boolean(receiving && receiving.status === 'verified'),
      detail: receiving
        ? `MX @ -> ${receiving.value} (${receiving.status})`
        : 'Add the inbound MX record to enable receiving',
    },
    {
      key: 'provider',
      label: 'Mail provider',
      description: 'VelisMail delivery or your own provider for transactional mail.',
      icon: Mail,
      done: Boolean(user?.businessMailProvider?.trim()),
    },
  ];

  const completed = items.filter((item) => item.done).length;
  const progress = Math.round((completed / items.length) * 100);

  return (
    <div className="setup-required">
      <div className="setup-required-card glass-card">
        <span className="setup-required-eyebrow">
          <AlertTriangle size={14} /> Setup required
        </span>
        <h1>Finish setting up your workspace</h1>
        <p className="text-sm text-muted">
          Your workspace needs a database, a mail API key, a verified domain with active DNS records and a
          mail provider before any feature can be used. The dashboard stays locked until every item is
          green.
        </p>

        <div className="setup-progress">
          <div className="setup-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-muted">{completed} of {items.length} complete</span>
        </div>

        <ul className="setup-list">
          {items.map((item) => (
            <li key={item.key} className={`setup-item ${item.done ? 'done' : ''}`}>
              <span className="setup-item-icon">
                {item.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              </span>
              <span className="setup-item-icon-alt"><item.icon size={16} /></span>
              <span className="setup-item-copy">
                <strong>{item.label}</strong>
                <span className="text-xs text-muted">{item.description}</span>
                {item.detail && <span className="text-xs text-muted">{item.detail}</span>}
              </span>
              {item.action && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={item.action.onClick}>
                  <RefreshCw size={12} /> {item.action.label}
                </button>
              )}
              <span className={`badge badge-${item.done ? 'success' : 'neutral'}`}>
                {item.done ? 'ready' : 'missing'}
              </span>
            </li>
          ))}
        </ul>

        {pendingRecords.length > 0 && (
          <div className="setup-record-list">
            <strong className="text-xs">Records that still need to be published</strong>
            {pendingRecords.map((record) => (
              <div key={`${record.recordType}-${record.name}`} className="setup-record">
                <span>
                  {record.recordType} · name <code>{record.name}</code> · {record.purpose}
                </span>
                <code>{record.value}</code>
              </div>
            ))}
          </div>
        )}

        <div className="setup-actions">
          <button className="btn btn-primary" onClick={() => navigate('/business-setup')}>
            Continue setup <ArrowRight size={14} />
          </button>
          <button className="btn btn-ghost" onClick={() => void load()}>
            <RefreshCw size={14} /> Re-check
          </button>
          <span className="text-xs text-muted">
            Signed in as {user?.email}
          </span>
        </div>
      </div>
    </div>
  );
}
