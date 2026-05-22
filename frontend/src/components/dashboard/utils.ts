import type { ProviderDnsRecordInput } from '../../api/client';
import type { Email } from '../../api/client';

export type RazorpayInstance = {
  on: (event: 'payment.failed', handler: (response: { error: { description?: string; code?: string } }) => void) => void;
  open: () => void;
};

export type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

export function getRazorpayConstructor(): RazorpayConstructor | undefined {
  return (window as typeof window & { Razorpay?: RazorpayConstructor }).Razorpay;
}

export function loadRazorpayCheckout(): Promise<RazorpayConstructor | undefined> {
  const existing = getRazorpayConstructor();
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const currentScript = document.querySelector<HTMLScriptElement>('script[data-velismail-razorpay="checkout"]');
    if (currentScript) {
      currentScript.addEventListener('load', () => resolve(getRazorpayConstructor()), { once: true });
      currentScript.addEventListener('error', () => resolve(undefined), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.velismailRazorpay = 'checkout';
    script.addEventListener('load', () => resolve(getRazorpayConstructor()), { once: true });
    script.addEventListener('error', () => resolve(undefined), { once: true });
    document.body.appendChild(script);
  });
}

export function providerRecordType(record: ProviderDnsRecordInput): string {
  return String(record.recordType || record.record_type || 'TXT').toUpperCase();
}

export function formatRelative(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function truncate(str: string, len: number): string {
  if (!str || str.length <= len) return str || '';
  return `${str.slice(0, len).trimEnd()}…`;
}

export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}

export function normalizeMailBody(body: string): string {
  return body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function stripQuoteMarker(line: string): string {
  return line.replace(/^\s*>+\s?/, '').trimEnd();
}

export function normalizeConversationLines(lines: string[]): string[] {
  const normalized = lines.map(line => line.trimEnd());
  const compacted: string[] = [];
  let previousBlank = false;
  for (const line of normalized) {
    const blank = !line.trim();
    if (blank && previousBlank) continue;
    compacted.push(line);
    previousBlank = blank;
  }
  return compacted;
}

export function cleanReplyHeader(line: string): string {
  const withoutQuote = stripQuoteMarker(line).replace(/^-\s*-+\s*/, '').trim();
  if (!withoutQuote) return 'Previous message';
  if (/^[-\s]*(original|forwarded) message[-\s]*$/i.test(withoutQuote)) return 'Forwarded message';
  if (/^on\s+.+wrote:\s*$/i.test(`${withoutQuote} `)) return `${withoutQuote} wrote:`;
  return withoutQuote;
}

export function isReplyHeader(line: string): boolean {
  const clean = stripQuoteMarker(line).trim();
  return /^on\s+.+wrote:\s*$/i.test(clean)
    || /^[-]{2,}\s*(original|forwarded)\s*[-]{2,}/i.test(clean)
    || /^(forwarded|original) message$/i.test(clean.trim());
}

export function nextMeaningfulLineIndex(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i++) {
    if (stripQuoteMarker(lines[i]).trim()) return i;
  }
  return -1;
}

export type ConversationSegment = { kind: 'message' | 'quote'; lines: string[] };

export function parseEmailConversation(body: string): ConversationSegment[] {
  const lines = normalizeMailBody(body).split('\n');
  const segments: ConversationSegment[] = [];
  let currentMessage: string[] = [];
  let currentQuote: string[] = [];
  let inQuote = false;

  const flushMessage = () => {
    const clean = normalizeConversationLines(currentMessage);
    if (clean.length) segments.push({ kind: 'message', lines: clean });
    currentMessage = [];
  };

  const flushQuote = () => {
    const clean = normalizeConversationLines(currentQuote.map(stripQuoteMarker));
    if (clean.length) segments.push({ kind: 'quote', lines: clean });
    currentQuote = [];
  };

  const startQuote = (header: string) => {
    if (inQuote) flushQuote();
    inQuote = true;
    currentQuote.push(header);
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trimEnd();
    const cleanLine = stripQuoteMarker(rawLine);
    const meaningfulNext = nextMeaningfulLineIndex(lines, i);
    const nextLine = meaningfulNext >= 0 ? stripQuoteMarker(lines[meaningfulNext]).trim() : '';
    const splitReplyHeader = /^on\s+.+/i.test(cleanLine.trim()) && /^wrote:\s*$/i.test(nextLine);

    if (rawLine.startsWith('>') && !splitReplyHeader) {
      const nextMeaningful = meaningfulNext >= 0 ? stripQuoteMarker(lines[meaningfulNext]) : '';
      if (!cleanLine.trim() && !nextMeaningful) continue;
      if (!inQuote) {
        flushMessage();
        startQuote(rawLine);
      } else {
        currentQuote.push(rawLine);
      }
    } else if (splitReplyHeader) {
      if (inQuote) flushQuote();
      flushMessage();
      const combined = `${cleanLine.trim()} ${nextLine.trim()}`;
      startQuote(combined);
      if (meaningfulNext >= 0) i = meaningfulNext;
    } else {
      if (inQuote) {
        flushQuote();
        inQuote = false;
      }
      currentMessage.push(rawLine);
    }
  }

  if (inQuote) flushQuote();
  flushMessage();

  return segments.length > 0 ? segments : [{ kind: 'message', lines: ['No message content.'] }];
}

export function getPrimaryConversationText(body: string): string {
  const primary = parseEmailConversation(body).find(segment => segment.kind === 'message');
  return (primary?.lines.join('\n') || normalizeMailBody(body)).trim();
}

export function getEmailPreview(body: string, maxLength: number): string {
  const text = getPrimaryConversationText(body).replace(/\s+/g, ' ').trim();
  if (!text) return 'No preview';
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : text;
}

export function buildReplyQuote(email: Email): string {
  const quotedText = getPrimaryConversationText(email.body)
    .split('\n')
    .map(line => line.trim() ? `> ${line}` : '>')
    .join('\n');
  const replyDate = new Date(email.date).toLocaleString(undefined, {
    dateStyle: 'long', timeStyle: 'short',
  });
  const senderName = email.fromName || email.from;
  return `\n\nOn ${replyDate}, ${senderName} <${email.from}> wrote:\n${quotedText}`;
}
