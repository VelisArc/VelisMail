import {
  type Env,
  HttpError,
  asString,
  fail,
  hmacSha256,
  json,
  normalizeDomain,
  normalizeEmail,
  nowIso,
  parseJsonArray,
  parseJsonObject,
  readJson,
  timingSafeEqual,
  today,
  uuid,
} from '../lib/util';
import { type UserRow, logAudit, requireAuth } from '../lib/auth';
import { sendWorkspaceEmail } from '../lib/email';

interface EmailRow {
  id: string;
  tenant_id: string;
  domain: string;
  folder: string;
  direction: string;
  from_addr: string;
  from_name: string;
  to_addrs: string;
  cc_addrs: string;
  subject: string;
  body: string;
  html_body: string | null;
  email_date: string;
  unread: number;
  starred: number;
  labels: string;
  has_attachment: number;
  message_id: string | null;
  thread_id: string | null;
  in_reply_to: string | null;
  scheduled_at: string | null;
  client_id: string | null;
  created_at: string;
  updated_at: string;
}

function tenantIdOf(user: UserRow): string {
  if (!user.tenant_id) throw new HttpError(409, 'This account has no workspace.');
  return user.tenant_id;
}

function emailJson(row: EmailRow): Record<string, unknown> {
  return {
    id: row.id,
    from: row.from_addr,
    fromName: row.from_name,
    from_name: row.from_name,
    to: parseJsonArray(row.to_addrs),
    cc: parseJsonArray(row.cc_addrs),
    subject: row.subject,
    body: row.body,
    htmlBody: row.html_body,
    html_body: row.html_body,
    date: row.email_date,
    folder: row.folder,
    direction: row.direction,
    unread: Boolean(row.unread),
    read: !row.unread,
    starred: Boolean(row.starred),
    labels: parseJsonArray(row.labels),
    hasAttachment: Boolean(row.has_attachment),
    messageId: row.message_id,
    message_id: row.message_id,
    threadId: row.thread_id,
    thread_id: row.thread_id,
    inReplyTo: row.in_reply_to,
    in_reply_to: row.in_reply_to,
    scheduledAt: row.scheduled_at,
    clientId: row.client_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function queryEmails(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
  const domain = normalizeDomain(body.domain ?? '');
  const folder = asString(body.folder);
  const limit = Math.min(Number(body.limit ?? 500) || 500, 1000);

  const filters: string[] = ['tenant_id = ?'];
  const values: unknown[] = [tenantId];
  if (domain) {
    filters.push('(domain = ? OR to_addrs LIKE ?)');
    values.push(domain, `%${domain}%`);
  }
  if (folder) {
    filters.push('folder = ?');
    values.push(folder);
  }
  values.push(limit);
  const rows = await env.DB.prepare(
    `SELECT * FROM emails WHERE ${filters.join(' AND ')} ORDER BY email_date DESC LIMIT ?`,
  ).bind(...values).all<EmailRow>();
  return json({ success: true, emails: (rows.results ?? []).map(emailJson) });
}

export async function saveEmail(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);
  const raw = (body.email ?? body) as Record<string, unknown>;
  const id = asString(raw.id) || uuid();
  const now = nowIso();
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const to = Array.isArray(raw.to) ? raw.to.map(normalizeEmail).filter(Boolean) : [];
  const from = normalizeEmail(raw.from);
  const recipientDomain = to.find((address) => address.includes('@'))?.split('@')[1] ?? '';
  const domain = normalizeDomain(raw.domain ?? (recipientDomain || (from.includes('@') ? from.split('@')[1] : '')));
  const unread = typeof raw.unread === 'boolean' ? raw.unread : !raw.read;

  await env.DB.prepare(
    `INSERT INTO emails (id, tenant_id, domain, folder, direction, from_addr, from_name, to_addrs, cc_addrs, subject, body,
       html_body, email_date, unread, starred, labels, has_attachment, message_id, thread_id, in_reply_to, scheduled_at, client_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET folder = excluded.folder, unread = excluded.unread, starred = excluded.starred,
       labels = excluded.labels, body = excluded.body, html_body = excluded.html_body, updated_at = excluded.updated_at`,
  ).bind(
    id,
    tenantId,
    domain,
    asString(raw.folder, 'inbox'),
    asString(raw.direction, 'inbound'),
    from,
    asString(raw.fromName ?? raw.from_name, from.split('@')[0] ?? ''),
    JSON.stringify(to),
    JSON.stringify(Array.isArray(raw.cc) ? raw.cc : []),
    asString(raw.subject),
    asString(raw.body),
    asString(raw.htmlBody ?? raw.html_body) || null,
    asString(raw.date ?? raw.createdAt, now),
    unread ? 1 : 0,
    raw.starred ? 1 : 0,
    JSON.stringify(labels),
    raw.hasAttachment ? 1 : 0,
    asString(raw.messageId ?? raw.message_id) || null,
    asString(raw.threadId ?? raw.thread_id) || null,
    asString(raw.inReplyTo ?? raw.in_reply_to) || null,
    asString(raw.scheduledAt) || null,
    asString(raw.clientId ?? raw.client_id) || null,
    now,
    now,
  ).run();

  return json({ success: true, id });
}

export async function deleteEmail(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);
  const id = asString(body.id);
  const result = await env.DB.prepare('DELETE FROM emails WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!result.meta.changes) throw new HttpError(404, 'Email was not found.');
  return json({ success: true });
}

// ---------------------------------------------------------------------------
// Business mailboxes (legacy routes used by the frontend sync layer)
// ---------------------------------------------------------------------------

export async function queryBusinessMailboxes(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
  const domain = normalizeDomain(body.domain ?? '');
  const rows = domain
    ? await env.DB.prepare('SELECT * FROM mailboxes WHERE tenant_id = ? AND domain = ? ORDER BY created_at ASC').bind(tenantId, domain).all<Record<string, unknown>>()
    : await env.DB.prepare('SELECT * FROM mailboxes WHERE tenant_id = ? ORDER BY created_at ASC').bind(tenantId).all<Record<string, unknown>>();
  return json({
    success: true,
    mailboxes: (rows.results ?? []).map((row) => ({
      id: row.id,
      domain: row.domain,
      address: row.address,
      displayName: row.display_name,
      display_name: row.display_name,
      kind: row.kind,
      aliases: parseJsonArray(row.aliases),
      active: Boolean(row.active),
      source: row.source,
      createdAt: row.created_at,
      created_at: row.created_at,
      lastUsedAt: row.last_used_at,
      last_used_at: row.last_used_at,
    })),
  });
}

export async function upsertBusinessMailbox(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);
  const mailbox = (body.mailbox ?? body) as Record<string, unknown>;
  const domain = normalizeDomain(mailbox.domain);
  const address = normalizeEmail(mailbox.address);
  if (!domain || !address.includes('@')) throw new HttpError(400, 'Mailbox domain and address are required.');

  const existing = await env.DB.prepare('SELECT id FROM mailboxes WHERE tenant_id = ? AND address = ? COLLATE NOCASE')
    .bind(tenantId, address).first<{ id: string }>();
  const id = existing?.id || asString(mailbox.id) || uuid();
  const active = mailbox.active === false ? 0 : 1;
  if (active) {
    await env.DB.prepare("UPDATE mailboxes SET active = 0, kind = CASE WHEN kind = 'primary' THEN 'mailbox' ELSE kind END WHERE tenant_id = ? AND domain = ? AND address != ?")
      .bind(tenantId, domain, address).run();
  }
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO mailboxes (id, tenant_id, domain, address, display_name, kind, aliases, active, source, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, kind = excluded.kind, aliases = excluded.aliases,
       active = excluded.active, last_used_at = excluded.last_used_at`,
  ).bind(
    id,
    tenantId,
    domain,
    address,
    asString(mailbox.displayName ?? mailbox.display_name) || address.split('@')[0],
    asString(mailbox.kind, 'mailbox'),
    JSON.stringify(Array.isArray(mailbox.aliases) ? mailbox.aliases : []),
    active,
    asString(mailbox.source, 'custom'),
    asString(mailbox.createdAt ?? mailbox.created_at, now),
    asString(mailbox.lastUsedAt ?? mailbox.last_used_at) || null,
  ).run();
  return json({ success: true, id, address });
}

export async function deleteBusinessMailbox(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);
  const domain = normalizeDomain(body.domain);
  const address = normalizeEmail(body.address);
  const result = await env.DB.prepare('DELETE FROM mailboxes WHERE tenant_id = ? AND domain = ? AND address = ? COLLATE NOCASE')
    .bind(tenantId, domain, address).run();
  if (!result.meta.changes) throw new HttpError(404, 'Mailbox was not found.');
  return json({ success: true });
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

export async function sendMail(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const tenantId = tenantIdOf(user);
  const body = await readJson<Record<string, unknown>>(request);

  const from = normalizeEmail(body.from);
  const fromName = asString(body.fromName) || user.display_name;
  const recipients = (Array.isArray(body.to) ? body.to : [body.to])
    .map(normalizeEmail)
    .filter(Boolean);
  const subject = asString(body.subject);
  const text = asString(body.body);
  const html = asString(body.htmlBody) || undefined;
  const clientId = asString(body.clientId) || undefined;
  const provider = asString(body.provider);
  const apiKey = asString(body.apiKey);

  if (!from || !from.includes('@')) throw new HttpError(400, 'A valid sender address is required.');
  if (recipients.length === 0) throw new HttpError(400, 'At least one recipient is required.');
  if (!subject.trim() || !text.trim()) throw new HttpError(400, 'Subject and message body are required.');

  const mailbox = await env.DB.prepare('SELECT * FROM mailboxes WHERE tenant_id = ? AND address = ? COLLATE NOCASE')
    .bind(tenantId, from).first<{ id: string; active: number; domain: string }>();
  if (!mailbox) throw new HttpError(400, `${from} is not a connected mailbox for this workspace.`);

  const settings = parseJsonObject(user.settings);
  if (provider) settings.businessMailProvider = provider;
  if (apiKey) settings.businessApiKey = apiKey;
  if (body.providerEndpoint) settings.businessMailProviderEndpoint = body.providerEndpoint;

  const attachments = Array.isArray(body.attachments)
    ? body.attachments as Array<{ filename?: string; content?: string; mimeType?: string }>
    : [];

  const result = await sendWorkspaceEmail(env, settings, {
    to: recipients,
    subject,
    text,
    html,
    from,
    fromName,
    replyTo: from,
    attachments: attachments
      .filter((attachment) => attachment.filename && attachment.content)
      .map((attachment) => ({
        filename: String(attachment.filename),
        content: String(attachment.content),
        mimeType: attachment.mimeType,
      })),
  });

  const now = nowIso();
  const emailId = uuid();
  const domain = normalizeDomain(mailbox.domain || from.split('@')[1] || '');

  if (!result.ok) {
    await env.DB.prepare(
      `INSERT INTO mail_queue (id, tenant_id, domain, from_address, recipients, subject, body, status, error, retry_count, queued_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?, 0, ?, ?)`,
    ).bind(uuid(), tenantId, domain, from, JSON.stringify(recipients), subject, text, result.error ?? 'Delivery failed', now, now).run();
    return json({
      success: false,
      error: { code: 'delivery_failed', message: result.error || 'Mail delivery failed.' },
      message: result.error || 'Mail delivery failed.',
      provider: result.provider,
    }, 502);
  }

  await env.DB.prepare(
    `INSERT INTO emails (id, tenant_id, domain, folder, direction, from_addr, from_name, to_addrs, cc_addrs, subject, body,
       html_body, email_date, unread, starred, labels, has_attachment, message_id, thread_id, client_id, created_at, updated_at)
     VALUES (?, ?, ?, 'sent', 'outbound', ?, ?, ?, '[]', ?, ?, ?, ?, 0, 0, '[]', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    emailId,
    tenantId,
    domain,
    from,
    fromName,
    JSON.stringify(recipients),
    subject,
    text,
    html ?? null,
    now,
    attachments.length > 0 ? 1 : 0,
    result.messageId ?? null,
    result.messageId ?? null,
    clientId ?? null,
    now,
    now,
  ).run();

  if (attachments.length > 0) {
    for (const attachment of attachments) {
      if (!attachment.filename || !attachment.content) continue;
      const content = String(attachment.content);
      await env.DB.prepare(
        'INSERT INTO attachments (id, email_id, filename, mime_type, size, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        uuid(),
        emailId,
        attachment.filename,
        attachment.mimeType ?? 'application/octet-stream',
        Math.round(content.length * 0.75),
        content.slice(0, 1_500_000),
        now,
      ).run();
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO usage_daily (tenant_id, day, sent) VALUES (?, ?, 1)
       ON CONFLICT(tenant_id, day) DO UPDATE SET sent = sent + 1`,
    ).bind(tenantId, today()),
    env.DB.prepare('UPDATE mailboxes SET last_used_at = ? WHERE id = ?').bind(now, mailbox.id),
  ]);

  await logAudit(env, {
    tenantId,
    actor: from,
    action: 'mail.sent',
    category: 'mail',
    resourceType: 'email',
    resourceId: emailId,
    details: { recipients, subject, provider: result.provider },
  });

  return json({
    success: true,
    provider: result.provider,
    messageId: result.messageId ?? null,
    id: emailId,
  });
}

// ---------------------------------------------------------------------------
// Inbound mail
// ---------------------------------------------------------------------------

export async function storeInboundEmail(
  env: Env,
  input: {
    from: string;
    fromName?: string;
    to: string[];
    cc?: string[];
    subject: string;
    text: string;
    html?: string;
    messageId?: string;
    date?: string;
    rawSize?: number;
  },
): Promise<{ stored: boolean; id?: string; tenantId?: string; reason?: string }> {
  const to = input.to.map(normalizeEmail).filter(Boolean);
  if (to.length === 0) return { stored: false, reason: 'no_recipients' };

  let tenantId: string | null = null;
  let domain = '';
  for (const address of to) {
    const addressDomain = address.split('@')[1] ?? '';
    const row = await env.DB.prepare('SELECT tenant_id, domain FROM domains WHERE domain = ? COLLATE NOCASE')
      .bind(addressDomain).first<{ tenant_id: string; domain: string }>();
    if (row) {
      tenantId = row.tenant_id;
      domain = row.domain;
      break;
    }
  }
  if (!tenantId) return { stored: false, reason: 'unknown_domain' };

  const id = uuid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO emails (id, tenant_id, domain, folder, direction, from_addr, from_name, to_addrs, cc_addrs, subject, body,
       html_body, email_date, unread, starred, labels, has_attachment, message_id, thread_id, created_at, updated_at)
     VALUES (?, ?, ?, 'inbox', 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '[]', 0, ?, ?, ?, ?)`,
  ).bind(
    id,
    tenantId,
    domain,
    normalizeEmail(input.from),
    input.fromName || normalizeEmail(input.from).split('@')[0] || '',
    JSON.stringify(to),
    JSON.stringify((input.cc ?? []).map(normalizeEmail).filter(Boolean)),
    input.subject || '(No subject)',
    input.text || '',
    input.html ?? null,
    input.date || now,
    input.messageId ?? null,
    input.messageId ?? id,
    now,
    now,
  ).run();

  await env.DB.prepare(
    `INSERT INTO usage_daily (tenant_id, day, received) VALUES (?, ?, 1)
     ON CONFLICT(tenant_id, day) DO UPDATE SET received = received + 1`,
  ).bind(tenantId, today()).run();

  return { stored: true, id, tenantId };
}

/**
 * Verify the Svix signature that Resend attaches to inbound webhooks.
 * Secret must be the `whsec_…` value Resend shows when the webhook is created.
 */
async function verifySvixSignature(rawBody: string, headers: Headers, secret: string): Promise<boolean> {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signatureHeader = headers.get('svix-signature');
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

  let key: Uint8Array;
  try {
    const encoded = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
    const binary = atob(encoded);
    key = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) key[i] = binary.charCodeAt(i);
  } catch {
    return false;
  }

  const digest = await hmacSha256(key, `${id}.${timestamp}.${rawBody}`);
  let binaryDigest = '';
  for (const byte of digest) binaryDigest += String.fromCharCode(byte);
  const expected = btoa(binaryDigest);

  return signatureHeader.split(' ').some((part) => {
    const index = part.indexOf(',');
    if (index < 0 || part.slice(0, index) !== 'v1') return false;
    return timingSafeEqual(part.slice(index + 1), expected);
  });
}

/** Resend inbound webhook (`email.received`). Requires RESEND_WEBHOOK_SECRET. */
export async function inboundWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return fail('RESEND_WEBHOOK_SECRET is not configured on the Worker. Create the Resend webhook first.', 503, 'webhook_not_configured');
  }
  const rawBody = await request.text();
  if (!(await verifySvixSignature(rawBody, request.headers, secret))) {
    return fail('Invalid webhook signature.', 401, 'invalid_signature');
  }
  const body = JSON.parse(rawBody) as Record<string, unknown>;
  const type = asString(body.type);
  const data = (body.data ?? body) as Record<string, unknown>;
  if (type && type !== 'email.received') {
    return json({ success: true, ignored: true, type });
  }

  const to = Array.isArray(data.to) ? data.to.map((value) => String(value)) : [String(data.to ?? '')];
  const emailId = asString(data.email_id) || asString(data.emailId);

  // The webhook only carries metadata. Fetch the real body from the Receiving
  // API so the workspace inbox gets the content, not an empty shell.
  let text = '';
  let html: string | undefined;
  let fromName = asString(data.fromName) || asString(data.from_name);
  let fetchedMessageId = asString(data.message_id) || asString(data.messageId);
  let date = asString(data.created_at) || new Date().toISOString();
  let attachments: Array<{ filename: string; mime_type: string; size: number }> = [];

  if (emailId && env.RESEND_API_KEY) {
    try {
      const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
      });
      if (response.ok) {
        const email = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        text = asString(email.text);
        html = asString(email.html) || undefined;
        fetchedMessageId = asString(email.message_id) || fetchedMessageId;
        date = asString(email.created_at) || date;
        const headers = (email.headers ?? {}) as Record<string, unknown>;
        const rawFrom = asString(headers.from);
        const nameMatch = rawFrom.match(/^\s*"?([^"<]+)"?\s*</);
        if (nameMatch) fromName = nameMatch[1].trim();
        if (Array.isArray(email.attachments)) {
          attachments = (email.attachments as Array<Record<string, unknown>>).map((attachment) => ({
            filename: asString(attachment.filename, 'attachment'),
            mime_type: asString(attachment.content_type, 'application/octet-stream'),
            size: Number(attachment.size ?? 0) || 0,
          }));
        }
      } else {
        console.warn('Resend Receiving API call failed', { status: response.status, emailId });
      }
    } catch (error) {
      console.error('Resend Receiving API call failed', { emailId, error: error instanceof Error ? error.message : 'unknown' });
    }
  }

  if (!text && !html) {
    text = '(The message body could not be retrieved. It may exceed the fetch window.)';
  }

  const result = await storeInboundEmail(env, {
    from: asString(data.from),
    fromName,
    to,
    cc: Array.isArray(data.cc) ? data.cc.map((value) => String(value)) : [],
    subject: asString(data.subject, '(No subject)'),
    text,
    html,
    messageId: fetchedMessageId || undefined,
    date,
  });

  if (result.stored && result.id && attachments.length > 0) {
    for (const attachment of attachments) {
      await env.DB.prepare(
        'INSERT INTO attachments (id, email_id, filename, mime_type, size, content, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
      ).bind(uuid(), result.id, attachment.filename, attachment.mime_type, attachment.size, nowIso()).run();
    }
    await env.DB.prepare('UPDATE emails SET has_attachment = 1, updated_at = ? WHERE id = ?').bind(nowIso(), result.id).run();
  }

  for (const address of to) {
    const addressDomain = normalizeDomain(address.split('@')[1] ?? '');
    if (!addressDomain) continue;
    await env.DB.prepare(
      `INSERT INTO inbound_webhooks (tenant_id, domain, provider, verified, created_at)
       SELECT tenant_id, domain, 'resend', 1, ? FROM domains WHERE domain = ? COLLATE NOCASE LIMIT 1
       ON CONFLICT(tenant_id, domain) DO UPDATE SET verified = 1`,
    ).bind(nowIso(), addressDomain).run();
  }

  return json({ success: true, ...result });
}
