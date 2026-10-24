import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleCheck,
  Database,
  Globe,
  KeyRound,
  Mail,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { workspaceApi, type DnsRequirement } from '../../api/company';
import type { User } from '../../api/client';

export type SetupCheckKey =
  | 'database'
  | 'apiKey'
  | 'provider'
  | 'webhook'
  | 'domain'
  | 'dns'
  | 'receiving';

export type SetupCheck = {
  key: SetupCheckKey;
  label: string;
  description: string;
  icon: LucideIcon;
  done: boolean;
  /** The current state of this item, in one line. */
  detail: string;
};

export type ReadinessDomain = {
  id: string;
  domain: string;
  status: string;
  primary: boolean;
  /** True once the provider receiving webhook is verified on the server. */
  webhookVerified: boolean;
};

export type WorkspaceReadiness = {
  /** True while the first live state is being read. */
  loading: boolean;
  /** True while a background re-check is running. */
  refreshing: boolean;
  /** True once the live state has been read at least once. */
  loaded: boolean;
  /** A message that stopped the check. The setup has to be completed. */
  error: string;
  checks: SetupCheck[];
  /** Every DNS record of the primary domain. */
  records: DnsRequirement[];
  /** The records that are not active yet. */
  pending: DnsRequirement[];
  /** The primary domain of the active business, when one exists. */
  primaryDomain: ReadinessDomain | null;
  /** True only when every single item of the setup is done. */
  ready: boolean;
  /** Read the live state again. Resolves after the new state is applied. */
  reload: () => Promise<void>;
};

const POLL_INTERVAL_MS = 15_000;

function readableCheckError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown; error?: unknown; detail?: unknown };
    for (const value of [record.message, record.error, record.detail]) {
      if (typeof value === 'string' && value.trim()) return value;
    }
    try {
      const text = JSON.stringify(error);
      if (text && text !== '{}') return text;
    } catch {
      // Fall through to the generic message.
    }
  }
  return 'The setup could not be verified. Complete the setup and try again.';
}

/**
 * Read the live state of the workspace setup.
 *
 * The dashboard is only opened when every item of the setup is done, so this
 * check combines what the session knows (database, key, provider) with the
 * live DNS of the primary domain (records, receiving). A domain that is not
 * fully published keeps the dashboard closed.
 *
 * It also re-checks in the background and whenever the window regains focus,
 * which is what makes access open automatically as soon as the last DNS
 * record becomes active - no manual reload, no sign-out.
 */
export default function useWorkspaceReadiness(user: User | null): WorkspaceReadiness {
  const dbUrl = user?.businessDbUrl?.trim() || '';
  const apiKey = user?.businessApiKey?.trim() || '';
  const provider = user?.businessMailProvider?.trim() || '';
  const webhookSecret = user?.businessMailWebhookSecret?.trim() || '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [domains, setDomains] = useState<ReadinessDomain[]>([]);
  const [records, setRecords] = useState<DnsRequirement[]>([]);
  const [complete, setComplete] = useState(false);
  const [checked, setChecked] = useState(false);
  const inFlight = useRef<Promise<void> | null>(null);

  const load = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      if (loaded) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const domainList = await workspaceApi.domains();
        const summary: ReadinessDomain[] = domainList.domains
          .map((entry) => ({
            id: entry.id,
            domain: entry.domain,
            status: entry.status,
            primary: Boolean(entry.primary),
            webhookVerified: Boolean(entry.webhookVerified),
          }))
          .sort((left, right) => Number(right.primary) - Number(left.primary));
        setDomains(summary);

        const primary = summary.find((entry) => entry.primary) || summary[0];
        if (!primary) {
          setRecords([]);
          setComplete(false);
          setChecked(true);
          return;
        }

        const requirements = await workspaceApi.dnsRequirements(primary.domain);
        setRecords(requirements.records);
        setComplete(requirements.complete);
        setChecked(true);

        // The stored verification status is kept in sync with the live DNS and
        // the provider webhook. A domain is only marked verified when both are
        // ready, so setup cannot open a workspace whose inbound path is broken.
        if (requirements.complete && (primary.status !== 'verified' || !primary.webhookVerified)) {
          const verification = await workspaceApi.verifyDomain(primary.id).catch(() => null);
          if (verification?.complete) {
            setDomains((current) =>
              current.map((entry) =>
                entry.id === primary.id
                  ? { ...entry, status: 'verified', webhookVerified: true }
                  : entry,
              ),
            );
          } else {
            setComplete(false);
            const webhook = verification?.webhook;
            if (webhook && webhook.status !== 'verified') {
              setError(webhook.detail || 'The provider receiving webhook could not be verified.');
            }
          }
        }
      } catch (err) {
        setError(readableCheckError(err));
      } finally {
        inFlight.current = null;
        setLoading(false);
        setRefreshing(false);
        setLoaded(true);
      }
    })();
    inFlight.current = run;
    return run;
  }, [loaded]);

  // A new session (or freshly saved infrastructure) has to be checked again.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbUrl, apiKey, provider, webhookSecret]);

  const receiving = useMemo(
    () =>
      records.find(
        (record) =>
          record.recordType === 'MX' && record.purpose.toLowerCase().includes('receiv'),
      ),
    [records],
  );
  const pending = useMemo(
    () => records.filter((record) => record.status !== 'verified'),
    [records],
  );

  const checks = useMemo<SetupCheck[]>(() => {
    const primary = domains.find((entry) => entry.primary) || domains[0];
    const dnsReady = checked && complete && records.length > 0;
    // The server only marks a domain verified after the DNS and the provider
    // receiving webhook pass. Trust that status instead of DNS alone, so a
    // broken webhook keeps the setup gate closed.
    const domainReady = Boolean(primary) && primary.status === 'verified' && primary.webhookVerified;

    return [
      {
        key: 'database',
        label: 'Business database',
        description: 'The PostgreSQL database that stores your mail, domains and team.',
        icon: Database,
        done: Boolean(dbUrl),
        detail: dbUrl ? 'Connected' : 'No database connected yet',
      },
      {
        key: 'apiKey',
        label: 'Mail API key',
        description: 'Your sending credential. Every plan starts with a free trial allowance.',
        icon: KeyRound,
        done: Boolean(apiKey),
        detail: apiKey ? 'Configured' : 'No mail API key yet',
      },
      {
        key: 'provider',
        label: 'Mail provider',
        description: 'VelisMail delivery or your own provider for transactional mail.',
        icon: Mail,
        done: Boolean(provider),
        detail: provider ? provider : 'No mail provider selected yet',
      },
      {
        key: 'webhook',
        label: 'Inbound webhook',
        description: 'The provider posts incoming mail to the platform, without it nothing arrives.',
        icon: Webhook,
        done:
          provider.toLowerCase() === 'resend'
            ? Boolean(primary?.webhookVerified) || (!primary && Boolean(webhookSecret))
            : true,
        detail:
          provider.toLowerCase() === 'resend'
            ? primary
              ? primary.webhookVerified
                ? 'Verified by the provider'
                : 'Not verified yet — verify the domain to create it automatically'
              : webhookSecret
                ? 'Secret saved — verified together with the domain'
                : 'Created automatically when you verify the domain'
            : 'Not needed for this provider',
      },
      {
        key: 'dns',
        label: 'DNS records active',
        description: 'SPF, DKIM and DMARC have to be published and active before mail flows.',
        icon: AlertTriangle,
        done: dnsReady,
        detail: loading
          ? 'Checking the live DNS...'
          : records.length
            ? `${records.length - pending.length} of ${records.length} records active${
                pending.length
                  ? ` — ${pending.length} ${pending.length === 1 ? 'needs' : 'need'} attention`
                  : ''
              }`
            : 'No records to check yet',
      },
      {
        key: 'domain',
        label: 'Primary domain',
        description: 'The domain your company sends from. It has to be verified.',
        icon: Globe,
        done: domainReady,
        detail: primary
          ? `${primary.domain} - ${
              domainReady
                ? 'verified'
                : primary.status === 'failed'
                  ? 'verification failed'
                  : 'waiting for DNS'
            }`
          : 'No domain connected yet',
      },
      {
        key: 'receiving',
        label: 'Receiving enabled',
        description: 'The inbound MX record has to be active so the domain can receive mail.',
        icon: CircleCheck,
        done: Boolean(receiving && receiving.status === 'verified'),
        detail: receiving
          ? `MX ${receiving.name} -> ${
              receiving.status === 'verified' && receiving.actual
                ? receiving.actual
                : receiving.value
            } (${receiving.status})`
          : 'Add the inbound MX record to enable receiving',
      },
    ];
  }, [apiKey, checked, complete, dbUrl, domains, loading, pending.length, provider, records.length, receiving, webhookSecret]);

  const ready = useMemo(
    () => !loading && !error && checks.length > 0 && checks.every((check) => check.done),
    [checks, error, loading],
  );

  // Keep the gate honest while the customer publishes records in another tab.
  useEffect(() => {
    if (ready) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load, ready]);

  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [load]);

  return {
    loading,
    refreshing,
    loaded,
    error,
    checks,
    records,
    pending,
    primaryDomain: domains.find((entry) => entry.primary) || domains[0] || null,
    ready,
    reload: load,
  };
}
