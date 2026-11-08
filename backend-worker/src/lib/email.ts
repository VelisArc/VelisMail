import { type Env, HttpError, normalizeEmail, parseJsonObject } from './util';

export interface EmailMessage {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string;
  fromName?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: string; mimeType?: string }>;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  messageId?: string;
  error?: string;
  skipped?: boolean;
}

function fromHeader(env: Env, message: EmailMessage): string {
  const address = message.from || env.PLATFORM_FROM_EMAIL || 'noreply@velismail.online';
  const name = message.fromName || env.PLATFORM_FROM_NAME || 'VelisMail';
  return name ? `${name} <${address}>` : address;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Send mail through the platform Resend account (OTP, recovery, feedback). */
export async function sendPlatformEmail(env: Env, message: EmailMessage): Promise<SendResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, provider: 'resend', error: 'RESEND_API_KEY is not configured on the Worker.', skipped: true };
  }
  const payload: Record<string, unknown> = {
    from: fromHeader(env, message),
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  };
  if (message.replyTo) payload.reply_to = message.replyTo;
  if (message.attachments?.length) {
    payload.attachments = message.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      content_type: attachment.mimeType,
    }));
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      return { ok: false, provider: 'resend', error: data.message || data.name || `Resend rejected the message (${response.status}).` };
    }
    return { ok: true, provider: 'resend', messageId: data.id };
  } catch (error) {
    return { ok: false, provider: 'resend', error: error instanceof Error ? error.message : 'Resend request failed.' };
  }
}

export function otpEmail(env: Env, code: string, purpose: string): { subject: string; html: string; text: string } {
  const brand = env.PLATFORM_FROM_NAME || 'VelisMail';
  const action = purpose === 'password_reset'
    ? 'reset your password'
    : purpose === 'recovery_email'
      ? 'verify your recovery email'
      : 'verify your email address';
  const subject = `${code} is your ${brand} verification code`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#111a2c;border-radius:16px;padding:32px;color:#e8eefc">
        <tr><td>
          <h1 style="margin:0 0 8px;font-size:22px;color:#ffffff">${escapeHtml(brand)}</h1>
          <p style="margin:0 0 24px;color:#aebbd6;font-size:15px">Use this code to ${escapeHtml(action)}.</p>
          <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#6ea8ff;background:#0a1424;border-radius:12px;padding:18px 8px;text-align:center">${code}</div>
          <p style="margin:24px 0 0;color:#aebbd6;font-size:13px">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const text = `${brand}: your verification code is ${code}. It expires in 10 minutes.`;
  return { subject, html, text };
}

/**
 * Deliver workspace mail using the provider configured for the tenant.
 *
 * `amazonses` needs SigV4 signing which is intentionally handled by the
 * provider webhook path instead; a workspace on SES is expected to set a
 * custom webhook (or use Resend/SendGrid/Postmark).
 */
export async function sendWorkspaceEmail(
  env: Env,
  settings: Record<string, unknown>,
  message: EmailMessage,
): Promise<SendResult> {
  const provider = String(settings.businessMailProvider ?? settings.business_mail_provider ?? '').toLowerCase();
  const apiKey = String(settings.businessApiKey ?? settings.business_api_key ?? '');
  const endpoint = String(
    settings.businessMailProviderEndpoint ?? settings.business_mail_provider_endpoint ?? '',
  ).trim();

  if (!provider) {
    return { ok: false, provider: 'none', error: 'No mail provider is configured for this workspace.' };
  }

  if (provider === 'resend') {
    const key = apiKey || env.RESEND_API_KEY;
    if (!key) return { ok: false, provider, error: 'Resend API key is missing.' };
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromHeader(env, message),
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo,
          attachments: message.attachments?.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            content_type: attachment.mimeType,
          })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!response.ok) return { ok: false, provider, error: data.message || `Resend rejected the message (${response.status}).` };
      return { ok: true, provider, messageId: data.id };
    } catch (error) {
      return { ok: false, provider, error: error instanceof Error ? error.message : 'Resend request failed.' };
    }
  }

  if (provider === 'sendgrid') {
    if (!apiKey) return { ok: false, provider, error: 'SendGrid API key is missing.' };
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: message.to.map((email) => ({ email })) }],
        from: { email: message.from || env.PLATFORM_FROM_EMAIL, name: message.fromName || env.PLATFORM_FROM_NAME },
        reply_to: message.replyTo ? { email: message.replyTo } : undefined,
        subject: message.subject,
        content: [
          ...(message.text ? [{ type: 'text/plain', value: message.text }] : []),
          ...(message.html ? [{ type: 'text/html', value: message.html }] : []),
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, provider, error: `SendGrid rejected the message (${response.status}). ${detail.slice(0, 180)}` };
    }
    return { ok: true, provider, messageId: response.headers.get('X-Message-Id') || undefined };
  }

  if (provider === 'postmark') {
    if (!apiKey) return { ok: false, provider, error: 'Postmark server token is missing.' };
    const response = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'X-Postmark-Server-Token': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        From: fromHeader(env, message),
        To: message.to.join(','),
        Subject: message.subject,
        HtmlBody: message.html,
        TextBody: message.text,
        ReplyTo: message.replyTo,
        MessageStream: 'outbound',
      }),
    });
    const data = (await response.json().catch(() => ({}))) as { MessageID?: string; Message?: string };
    if (!response.ok) return { ok: false, provider, error: data.Message || `Postmark rejected the message (${response.status}).` };
    return { ok: true, provider, messageId: data.MessageID };
  }

  if (provider === 'custom_webhook') {
    if (!endpoint) return { ok: false, provider, error: 'Custom webhook endpoint is missing.' };
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VelisMail-Webhook-Secret': String(settings.businessMailWebhookSecret ?? ''),
        },
        body: JSON.stringify({
          from: message.from,
          fromName: message.fromName,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          replyTo: message.replyTo,
          attachments: message.attachments,
        }),
      });
      const text = await response.text().catch(() => '');
      if (!response.ok) return { ok: false, provider, error: `Webhook rejected the message (${response.status}). ${text.slice(0, 180)}` };
      return { ok: true, provider, messageId: text.slice(0, 64) || undefined };
    } catch (error) {
      return { ok: false, provider, error: error instanceof Error ? error.message : 'Webhook request failed.' };
    }
  }

  if (provider === 'amazonses') {
    // SES requires SigV4. Without a signing key in the Worker we route through
    // the platform Resend account when one exists, otherwise fail clearly.
    if (env.RESEND_API_KEY) {
      const result = await sendPlatformEmail(env, message);
      return { ...result, provider: 'amazonses-via-resend' };
    }
    return { ok: false, provider, error: 'Amazon SES signing is not configured on the Worker. Add a custom webhook instead.' };
  }

  return { ok: false, provider, error: `Unsupported mail provider: ${provider}` };
}

export function tenantProviderSettings(settingsJson: string): Record<string, unknown> {
  return parseJsonObject(settingsJson);
}

export function assertWorkableRecipients(to: unknown): string[] {
  const list = Array.isArray(to) ? to : [to];
  const recipients = list
    .map((value) => normalizeEmail(value))
    .filter(Boolean);
  if (recipients.length === 0) throw new HttpError(400, 'At least one recipient is required.');
  if (recipients.length > 50) throw new HttpError(400, 'A single message can address at most 50 recipients.');
  return recipients;
}
