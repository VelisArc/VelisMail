import { useCallback, useEffect, useMemo, useState } from 'react';
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

export type WorkspaceReadiness = {
  /** True while the live state is being read. */
  loading: boolean;
  /** A message that stopped the check. The setup has to be completed. */
  error: string;
  checks: SetupCheck[];
  /** Every DNS record of the primary domain. */
  records: DnsRequirement[];
  /** The records that are not active yet. */
  pending: DnsRequirement[];
  /** True only when every single item of the setup is done. */
  ready: boolean;
  /** Read the live state again. */
  reload: () => void;
};

type DomainSummary = { id: string; domain: string; status: string };

/**
 * Read the live state of the workspace setup.
 *
 * The dashboard is only opened when every item of the setup is done, so this
 * check combines what the session knows (database, key, provider) with the
 * live DNS of the domain (records, receiving). A domain that is not fully
 * published keeps the dashboard closed.
 */
export default function useWorkspaceReadiness(user: User | null): WorkspaceReadiness {
  const dbUrl = user?.businessDbUrl?.trim() || '';
  const apiKey = user?.businessApiKey?.trim() || '';
  const provider = user?.businessMailProvider?.trim() || '';
  const webhookSecret = user?.businessMailWebhookSecret?.trim() || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [records, setRecords] = useState<DnsRequirement[]>([]);
  const [complete, setComplete] = useState(false);
  const [checked, setChecked] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const domainList = await workspaceApi.domains();
      const summary = domainList.domains.map((entry) => ({
        id: entry.id,
        domain: entry.domain,
        status: entry.status,
      }));
      setDomains(summary);

      const primary = summary[0];
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
      // The stored status is kept in sync when the live DNS is complete.
      if (requirements.complete && primary.status !== 'verified') {
        void workspaceApi.verifyDomain(primary.id).catch(() => undefined);
      }
    } catch (err) {
      setRecords([]);
      setComplete(false);
      setChecked(true);
      setError(
        err instanceof Error
          ? err.message
          : 'The setup could not be verified. Complete the setup and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const receiving = useMemo(
    () =>
      records.find(
        (record) =>
          record.recordType === 'MX' && record.purpose.toLowerCase().includes('receiving'),
      ),
    [records],
  );
  const pending = useMemo(
    () => records.filter((record) => record.status !== 'verified'),
    [records],
  );

  const checks = useMemo<SetupCheck[]>(() => {
    const primary = domains[0];
    const dnsReady = checked && complete && records.length > 0;
    // The live DNS is the truth: a domain whose records are all active is
    // ready, even when the stored status is still out of date.
    const domainReady = Boolean(primary) && (primary.status === 'verified' || dnsReady);

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
        done: provider.toLowerCase() === 'resend' ? Boolean(webhookSecret) : true,
        detail:
          provider.toLowerCase() === 'resend'
            ? webhookSecret
              ? 'Configured'
              : 'No webhook secret yet'
            : 'Not needed for this provider',
      },
      {
        key: 'domain',
        label: 'Primary domain',
        description: 'The domain your company sends from. It has to be verified.',
        icon: Globe,
        done: domainReady,
        detail: primary
          ? `${primary.domain} - ${domainReady ? 'verified' : primary.status}`
          : 'No domain connected yet',
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
            ? `${records.length - pending.length} of ${records.length} records active`
            : 'No records to check yet',
      },
      {
        key: 'receiving',
        label: 'Receiving enabled',
        description: 'The inbound MX record has to be active so the domain can receive mail.',
        icon: CircleCheck,
        done: Boolean(receiving && receiving.status === 'verified'),
        detail: receiving
          ? `MX ${receiving.name} -> ${receiving.value} (${receiving.status})`
          : 'Add the inbound MX record to enable receiving',
      },
    ];
  }, [apiKey, checked, complete, dbUrl, domains, loading, pending.length, provider, records.length, receiving, webhookSecret]);

  const ready = useMemo(
    () => !loading && !error && checks.length > 0 && checks.every((check) => check.done),
    [checks, error, loading],
  );

  return {
    loading,
    error,
    checks,
    records,
    pending,
    ready,
    reload: () => {
      void load();
    },
  };
}
