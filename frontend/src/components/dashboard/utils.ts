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

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Browsers without the async clipboard, or a page that lost the
    // permission, fall back to the old selection based copy.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      return copied;
    } catch {
      return false;
    }
  }
}

/** Read a file as base64, so it can be sent as an attachment. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      // The data url carries the type as well, the mail service expects the
      // plain value.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

/**
 * The mime type of a screenshot that was stored before the gateway kept its
 * type. The first bytes of the image identify it without any guesswork.
 */
function sniffImageMimeType(encoded: string): string {
  let decoded: string;
  try {
    decoded = atob(encoded.slice(0, 32));
  } catch {
    return 'image/png';
  }
  const bytes = decoded;
  let hex = '';
  for (let index = 0; index < 12 && index < bytes.length; index += 1) {
    hex += bytes.charCodeAt(index).toString(16).padStart(2, '0');
  }
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif';
  if (hex.startsWith('424d')) return 'image/bmp';
  if (hex.startsWith('00000100')) return 'image/x-icon';
  if (hex.slice(0, 12) === '52494646' && hex.slice(16, 24) === '57454250') return 'image/webp';
  return 'image/png';
}

/**
 * Read an image that was stored as base64 (optionally still carrying its data
 * url prefix) and turn it into the source that can be used on an <img>.
 *
 * Only raster data URLs are allowed. An http(s) value used to be rendered
 * directly, which let a workspace member make an administrator's browser fetch
 * an arbitrary intranet URL.
 */
export function imageSourceFromBase64(value?: string | null): string {
  if (!value) return '';
  const dataUrl = /^data:image\/(png|jpe?g|gif|webp);base64,/i.exec(value);
  if (dataUrl) return value;
  if (value.startsWith('data:') || value.startsWith('blob:') || /^https?:/i.test(value)) {
    return '';
  }
  // A value with no prefix is a screenshot the gateway accepted before it kept
  // the mime type, so the type is read back from the image bytes themselves.
  return `data:${sniffImageMimeType(value)};base64,${value}`;
}

/** The file extension for a stored screenshot, taken from its mime type. */
export function imageExtensionFromBase64(value?: string | null): string {
  const source = imageSourceFromBase64(value);
  const subtype = /^data:image\/([a-zA-Z0-9.+-]+)/.exec(source)?.[1]?.toLowerCase() || 'png';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  if (subtype === 'x-icon' || subtype === 'vnd.microsoft.icon') return 'ico';
  return subtype;
}

/**
 * Save a stored screenshot to disk as a real image file.
 *
 * The data url is decoded into bytes first and handed to the browser as a blob
 * with the original mime type and a proper file name, so the download is the
 * exact image the reporter attached - never the base64 text, and never a file
 * without an extension that the operating system refuses to open.
 */
export function downloadBase64Image(value: string, fileNameBase: string): boolean {
  const source = imageSourceFromBase64(value);
  if (!source.startsWith('data:')) return false;
  const [header, encoded] = source.split(',', 2);
  if (!encoded) return false;
  const mime = /^data:([^;]+)/.exec(header)?.[1] || 'image/png';
  let bytes: BlobPart;
  try {
    const binary = atob(encoded);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
      view[index] = binary.charCodeAt(index);
    }
    bytes = view;
  } catch {
    return false;
  }
  const blob = new Blob([bytes], { type: mime });
  const extension = imageExtensionFromBase64(value);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${fileNameBase}.${extension}`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the download has already started.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  return true;
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
  return /^on\s+.+wrote:?\s*$/i.test(clean)
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
  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  const cleanBody = isHtml ? stripHtmlTags(body) : body;
  const lines = normalizeMailBody(cleanBody).split('\n');
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
    const singleLineReplyHeader = isReplyHeader(cleanLine);

    if (splitReplyHeader) {
      if (inQuote) flushQuote();
      flushMessage();
      const combined = `${cleanLine.trim()} ${nextLine.trim()}`;
      startQuote(combined);
      if (meaningfulNext >= 0) i = meaningfulNext;
    } else if (singleLineReplyHeader) {
      if (inQuote) flushQuote();
      flushMessage();
      startQuote(rawLine);
    } else if (rawLine.startsWith('>') || inQuote) {
      if (!inQuote) {
        flushMessage();
        inQuote = true;
      }
      currentQuote.push(rawLine);
    } else {
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

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildReplyQuote(email: Email): string {
  const cleanBody = stripHtmlTags(getPrimaryConversationText(email.body));
  const quotedText = cleanBody
    .split('\n')
    .map(line => line.trim() ? `> ${line}` : '>')
    .join('\n');
  const replyDate = new Date(email.date).toLocaleString(undefined, {
    dateStyle: 'long', timeStyle: 'short',
  });
  const senderName = email.fromName || email.from;
  return `\n\nOn ${replyDate}, ${senderName} <${email.from}> wrote:\n${quotedText}`;
}

/**
 * Build the collapsed block used when forwarding.
 *
 * Forwarding used to copy the whole message straight into the editor, so the
 * cursor landed below a wall of quoted text and the original logo/signature
 * looked like it belonged to the new mail. The composer now keeps this block
 * behind the same trimmed-content toggle it uses for replies.
 */
export function buildForwardQuote(email: Email): string {
  const cleanBody = stripHtmlTags(getPrimaryConversationText(email.body));
  const forwardedDate = new Date(email.date).toLocaleString(undefined, {
    dateStyle: 'long', timeStyle: 'short',
  });
  const senderName = email.fromName || email.from;
  const recipients = Array.isArray(email.to) ? email.to.join(', ') : email.to;
  const header = [
    '---------- Forwarded message ----------',
    `From: ${senderName} <${email.from}>`,
    `Date: ${forwardedDate}`,
    `Subject: ${email.subject || '(No subject)'}`,
    recipients ? `To: ${recipients}` : '',
  ].filter(Boolean).join('\n');
  return `\n\n${header}\n\n${cleanBody}`;
}
