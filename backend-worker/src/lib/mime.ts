/**
 * Minimal MIME parser for Cloudflare Email Routing messages.
 *
 * It extracts the common headers plus the first text/plain and text/html
 * parts. Multipart bodies are walked recursively; encoded words are decoded
 * for the subject. Attachments are ignored by design (inbound attachments are
 * not stored yet).
 */

export interface ParsedEmail {
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html?: string;
  messageId?: string;
  inReplyTo?: string;
  date?: string;
}

export function parseMime(raw: string): ParsedEmail {
  const split = raw.search(/\r?\n\r?\n/);
  const headerBlock = split >= 0 ? raw.slice(0, split) : raw;
  const bodyBlock = split >= 0 ? raw.slice(split).replace(/^\r?\n\r?\n/, '') : '';

  const headers: Record<string, string> = {};
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (!(key in headers)) headers[key] = value;
  }

  const contentType = headers['content-type'] ?? 'text/plain';
  const parts = splitParts(bodyBlock, contentType);
  const text = decodeBody(parts.text, parts.encoding);
  const html = parts.html ? decodeBody(parts.html, parts.encoding) : undefined;

  const fromHeader = headers['from'] ?? '';
  const fromMatch = /^(.*?)<([^>]+)>/.exec(fromHeader);
  const fromAddress = (fromMatch ? fromMatch[2] : fromHeader).trim().toLowerCase();
  const fromName = fromMatch
    ? decodeWords(fromMatch[1].trim().replace(/^"|"$/g, ''))
    : fromAddress.split('@')[0] ?? '';

  return {
    from: fromAddress,
    fromName,
    to: parseAddressList(headers['to'] ?? ''),
    cc: parseAddressList(headers['cc'] ?? ''),
    subject: decodeWords(headers['subject'] ?? ''),
    text,
    html,
    messageId: headers['message-id'],
    inReplyTo: headers['in-reply-to'],
    date: headers['date'],
  };
}

function splitParts(body: string, contentType: string): { text: string; html?: string; encoding?: string } {
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(contentType);
  if (/multipart\//i.test(contentType) && boundaryMatch) {
    const boundary = `--${boundaryMatch[1]}`;
    const segments = body.split(boundary);
    let text = '';
    let html: string | undefined;
    let encoding: string | undefined;
    for (const segment of segments) {
      if (!segment.trim() || segment.trim() === '--') continue;
      const headerEnd = segment.search(/\r?\n\r?\n/);
      if (headerEnd < 0) continue;
      const partHeaders = segment.slice(0, headerEnd).toLowerCase();
      const partBody = segment.slice(headerEnd).replace(/^\r?\n\r?\n/, '').replace(/\r?\n--\s*$/, '');
      if (partHeaders.includes('text/html') && !html) {
        html = partBody;
        encoding = /base64/i.test(partHeaders) ? 'base64' : /quoted-printable/i.test(partHeaders) ? 'qp' : undefined;
      } else if (partHeaders.includes('text/plain') && !text) {
        text = partBody;
        encoding = /base64/i.test(partHeaders) ? 'base64' : /quoted-printable/i.test(partHeaders) ? 'qp' : undefined;
      } else if (partHeaders.includes('multipart/')) {
        const nested = splitParts(partBody, partHeaders);
        if (!text && nested.text) text = nested.text;
        if (!html && nested.html) html = nested.html;
      }
    }
    return { text: text || body, html, encoding };
  }
  const isHtml = /text\/html/i.test(contentType);
  return isHtml ? { text: '', html: body, encoding: undefined } : { text: body, encoding: undefined };
}

function decodeBody(value: string, encoding?: string): string {
  if (!value) return '';
  try {
    if (encoding === 'base64') {
      const binary = atob(value.replace(/\s+/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }
    if (encoding === 'qp') {
      return value
        .replace(/=\r?\n/g, '')
        .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    }
  } catch {
    return value;
  }
  return value;
}

function parseAddressList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => {
      const match = /<([^>]+)>/.exec(entry);
      return (match ? match[1] : entry).trim().toLowerCase();
    })
    .filter((entry) => entry.includes('@'));
}

function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, encoding: string, text: string) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      }
      return decodeURIComponent(
        text.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__: string, hex: string) => `%${hex}`),
      );
    } catch {
      return text;
    }
  });
}
