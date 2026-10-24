import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  AlertTriangle,
  CircleCheck,
  Database,
  Globe,
  KeyRound,
  Mail,
  Webhook,
} from 'lucide-react';
import SetupRequired from './SetupRequired';
import type { SetupCheck, WorkspaceReadiness } from './useWorkspaceReadiness';
import type { DnsRequirement } from '../../api/company';
import type { User } from '../../api/types';

const checks: SetupCheck[] = [
  {
    key: 'database',
    label: 'Business database',
    description: 'The database that stores mail.',
    icon: Database,
    done: true,
    detail: 'Connected',
  },
  {
    key: 'apiKey',
    label: 'Mail API key',
    description: 'The sending credential.',
    icon: KeyRound,
    done: true,
    detail: 'Configured',
  },
  {
    key: 'provider',
    label: 'Mail provider',
    description: 'The mail provider.',
    icon: Mail,
    done: true,
    detail: 'amazonses',
  },
  {
    key: 'webhook',
    label: 'Inbound webhook',
    description: 'The inbound webhook.',
    icon: Webhook,
    done: true,
    detail: 'Configured',
  },
  {
    key: 'dns',
    label: 'DNS records active',
    description: 'The records that make mail flow.',
    icon: AlertTriangle,
    done: false,
    detail: '3 of 4 records active — 1 needs attention',
  },
  {
    key: 'domain',
    label: 'Primary domain',
    description: 'The domain your company sends from.',
    icon: Globe,
    done: false,
    detail: 'velismail.online - waiting for DNS',
  },
  {
    key: 'receiving',
    label: 'Receiving enabled',
    description: 'The inbound MX record.',
    icon: CircleCheck,
    done: true,
    detail: 'MX velismail.online -> inbound-smtp (verified)',
  },
];

const records: DnsRequirement[] = [
  {
    recordType: 'MX',
    name: '@',
    host: 'velismail.online',
    value: '10 inbound-smtp.ap-northeast-1.amazonaws.com',
    ttl: 3600,
    purpose: 'Receive inbound mail',
    status: 'verified',
    actual: '10 inbound-smtp.ap-northeast-1.amazonaws.com',
    detail: '',
    matchMode: 'exact',
  },
  {
    recordType: 'TXT',
    name: 'send',
    host: 'send.velismail.online',
    value: 'v=spf1 include:amazonses.com ~all',
    ttl: 300,
    purpose: 'Sender policy (SPF)',
    status: 'verified',
    actual: 'v=spf1 include:amazonses.com ~all',
    detail: '',
    matchMode: 'spf',
  },
  {
    recordType: 'TXT',
    name: 'resend._domainkey',
    host: 'resend._domainkey.velismail.online',
    value: 'p=public-key',
    ttl: 300,
    purpose: 'DKIM signing key',
    status: 'verified',
    actual: 'p=public-key',
    detail: '',
    matchMode: 'exists',
  },
  {
    recordType: 'TXT',
    name: '_dmarc',
    host: '_dmarc.velismail.online',
    value: 'v=DMARC1; p=quarantine; pct=100; rua=mailto:postmaster@velismail.online',
    ttl: 300,
    purpose: 'DMARC policy',
    status: 'mismatch',
    actual:
      'v=DMARC1; p=none; rua=mailto:YOUR_MONITORED_EMAIL | v=DMARC1; p=quarantine',
    detail:
      '2 DMARC records are published for this name. Delete the placeholder record first: v=DMARC1; p=none; rua=mailto:YOUR_MONITORED_EMAIL.',
    matchMode: 'exact',
  },
];

const user = {
  email: 'admin@velismail.online',
  displayName: 'VelisMail Admin',
  businessDomain: 'velismail.online',
  businessDbUrl: 'postgres://user:password@db.example.com/velismail',
  businessApiKey: 're_test_key',
  businessMailProvider: 'amazonses',
  businessMailProviderEndpoint: 'ap-northeast-1',
  businessMailWebhookSecret: '',
} as User;

const readiness: WorkspaceReadiness = {
  loading: false,
  refreshing: false,
  loaded: true,
  error: '',
  checks,
  records,
  pending: records.filter((record) => record.status !== 'verified'),
  primaryDomain: {
    id: 'domain-1',
    domain: 'velismail.online',
    status: 'pending',
    primary: true,
    webhookVerified: false,
  },
  ready: false,
  reload: vi.fn().mockResolvedValue(undefined),
};

describe('setup gate', () => {
  it('opens the actionable DNS step when a domain is waiting for records', async () => {
    render(<SetupRequired user={user} readiness={readiness} />);

    expect(await screen.findByRole('heading', { name: 'DNS records active' })).toBeTruthy();
    expect(screen.getByText('One DNS record needs a fix')).toBeTruthy();
    expect(screen.getByText(/Delete the placeholder record first/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /DNS records active/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('asks for a domain before showing DNS records when none is attached', async () => {
    const noDomainChecks = checks.map((check) =>
      check.key === 'dns' ? { ...check, detail: 'No records to check yet' } : check,
    );

    render(
      <SetupRequired
        user={{ ...user, businessDomain: '' }}
        readiness={{
          ...readiness,
          checks: noDomainChecks,
          records: [],
          pending: [],
          primaryDomain: null,
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Primary domain' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /DNS records active/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('points the domain step at the exact DNS fix instead of a dead verify button', async () => {
    render(<SetupRequired user={user} readiness={readiness} />);
    await screen.findByRole('heading', { name: 'DNS records active' });

    fireEvent.click(screen.getByRole('button', { name: /Primary domain/i }));

    expect(await screen.findByRole('heading', { name: 'Primary domain' })).toBeTruthy();
    expect(screen.getByText('One DNS record still needs attention')).toBeTruthy();

    // Both the inline callout and the footer offer the same shortcut.
    const openButtons = screen.getAllByRole('button', { name: /Open DNS records/i });
    fireEvent.click(openButtons[0]);
    expect(await screen.findByRole('heading', { name: 'DNS records active' })).toBeTruthy();
  });

  it('shows the receiving webhook endpoint, event and status in its own step', async () => {
    const resendChecks = checks.map((check) =>
      check.key === 'webhook'
        ? { ...check, done: false, detail: 'Not verified yet' }
        : check,
    );

    render(
      <SetupRequired
        user={{ ...user, businessMailProvider: 'resend' }}
        readiness={{
          ...readiness,
          checks: resendChecks,
          primaryDomain: readiness.primaryDomain
            ? { ...readiness.primaryDomain, webhookVerified: false }
            : null,
        }}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Inbound webhook' })).toBeTruthy();
    expect(
      screen.getAllByText('https://api.velismail.online/api/v1/mail/inbound').length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('email.received').length).toBeGreaterThan(0);
    expect(screen.getByText('Not verified')).toBeTruthy();
  });
});
