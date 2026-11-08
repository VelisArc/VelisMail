import { normalizeDomain } from './util';

export interface DnsCheck {
  key: 'txt' | 'mx' | 'spf' | 'dkim' | 'dmarc';
  label: string;
  status: 'pending' | 'verified' | 'failed';
  expected: string;
  actual?: string;
}

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

const DOH_URL = 'https://cloudflare-dns.com/dns-query';

async function dohQuery(name: string, type: string): Promise<DohAnswer[]> {
  try {
    const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      cf: { cacheTtl: 30, cacheEverything: true },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { Answer?: DohAnswer[] };
    return Array.isArray(data.Answer) ? data.Answer : [];
  } catch {
    return [];
  }
}

function txtValues(answers: DohAnswer[]): string[] {
  return answers.map((answer) => answer.data.replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

export async function checkDns(domainInput: string, verificationToken: string): Promise<DnsCheck[]> {
  const domain = normalizeDomain(domainInput);
  const [txtAnswers, mxAnswers, spfAnswers, dkimAnswers, dmarcAnswers] = await Promise.all([
    dohQuery(`_velismail-verify.${domain}`, 'TXT'),
    dohQuery(domain, 'MX'),
    dohQuery(domain, 'TXT'),
    dohQuery(`resend._domainkey.${domain}`, 'TXT'),
    dohQuery(`_dmarc.${domain}`, 'TXT'),
  ]);

  const ownershipValues = txtValues(txtAnswers);
  const ownershipOk = ownershipValues.some((value) => value.trim() === verificationToken.trim())
    || ownershipValues.some((value) => value.includes('velismail-verify='));

  const mxValues = mxAnswers.map((answer) => answer.data).filter(Boolean);
  const mxOk = mxValues.some((value) => /inbound-smtp\.[a-z0-9-]+\.amazonaws\.com/i.test(value))
    || mxValues.some((value) => /mail|mx/i.test(value));

  const rootTxt = txtValues(spfAnswers);
  const spfValue = rootTxt.find((value) => value.toLowerCase().startsWith('v=spf1'));
  const spfOk = Boolean(spfValue && /include:|ip4:|ip6:|-all|~all/.test(spfValue));

  const dkimValue = txtValues(dkimAnswers).find((value) => value.toLowerCase().includes('v=dkim1') || value.length > 40);
  const dmarcValue = txtValues(dmarcAnswers).find((value) => value.toLowerCase().startsWith('v=dmarc1'));

  const checks: DnsCheck[] = [
    {
      key: 'txt',
      label: 'Ownership TXT',
      status: ownershipOk ? 'verified' : ownershipValues.length ? 'failed' : 'pending',
      expected: verificationToken,
      actual: ownershipValues[0],
    },
    {
      key: 'mx',
      label: 'Receiving MX',
      status: mxOk ? 'verified' : mxValues.length ? 'failed' : 'pending',
      expected: 'Inbound MX record from your mail provider',
      actual: mxValues[0],
    },
    {
      key: 'spf',
      label: 'Provider SPF',
      status: spfOk ? 'verified' : spfValue ? 'failed' : 'pending',
      expected: 'v=spf1 include:... ~all',
      actual: spfValue,
    },
    {
      key: 'dkim',
      label: 'Provider DKIM',
      status: dkimValue ? 'verified' : 'pending',
      expected: 'Provider DKIM TXT record',
      actual: dkimValue,
    },
    {
      key: 'dmarc',
      label: 'DMARC',
      status: dmarcValue ? 'verified' : 'pending',
      expected: `v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`,
      actual: dmarcValue,
    },
  ];

  return checks;
}

export function overallStatus(checks: DnsCheck[]): 'verified' | 'failed' | 'pending' {
  if (checks.every((check) => check.status === 'verified')) return 'verified';
  return 'pending';
}
