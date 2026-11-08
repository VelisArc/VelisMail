/**
 * VelisMail API Worker entrypoint.
 *
 * Routes mirror the public API surface the frontend already consumes
 * (`/api/v1/...`). The router below supports both `/api/v1` and `/v1`
 * prefixes and falls back to the bare path so `api.velismail.online/health`
 * keeps working.
 */

import {
  type Env,
  HttpError,
  asString,
  fail,
  json,
  readJson,
  withCors,
} from './lib/util';
import { parseMime } from './lib/mime';
import { requireAuth } from './lib/auth';
import { storeInboundEmail } from './routes/mail';
import * as auth from './routes/auth';
import * as mail from './routes/mail';
import * as company from './routes/company';
import * as tenants from './routes/tenants';
import * as payments from './routes/payments';
import * as team from './routes/team';
import * as admin from './routes/admin';

type ParamMap = Record<string, string>;
type Handler = (request: Request, env: Env, params: ParamMap) => Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const routes: Route[] = [];

function add(method: string, path: string, handler: Handler): void {
  routes.push({
    method,
    segments: path.split('/').filter(Boolean),
    handler,
  });
}

function many(methods: string[], path: string, handler: Handler): void {
  for (const method of methods) add(method, path, handler);
}

// ---------------------------------------------------------------------------
// System / health
// ---------------------------------------------------------------------------
add('GET', '/', async (_request, _env, _params) => json({
  service: 'velismail-api',
  status: 'ok',
  runtime: 'cloudflare-workers',
  version: '5.3.0',
}));
many(['GET'], '/health', () => auth.health());
many(['GET'], '/health/live', () => auth.health());
many(['GET'], '/health/ready', (_request, env) => auth.ready(env));
many(['GET'], '/ready', (_request, env) => auth.ready(env));
many(['GET'], '/config/public', (_request, env) => auth.publicConfig(env));

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
many(['POST'], '/auth/register', (request, env) => auth.register(request, env));
many(['POST'], '/auth/login', (request, env) => auth.login(request, env));
many(['POST'], '/auth/login/password', (request, env) => auth.login(request, env));
many(['POST'], '/auth/firebase', (request, env) => auth.firebaseLogin(request, env));
many(['POST'], '/auth/send-otp', (request, env) => auth.sendOtp(request, env));
many(['POST'], '/auth/otp/send', (request, env) => auth.sendOtp(request, env));
many(['POST'], '/auth/password-reset/request', (request, env) => auth.sendOtp(request, env));
many(['POST'], '/auth/verify-otp', (request, env) => auth.verifyOtp(request, env));
many(['POST'], '/auth/otp/verify', (request, env) => auth.verifyOtp(request, env));
many(['POST'], '/auth/reset-password', (request, env) => auth.resetPassword(request, env));
many(['POST'], '/auth/token/refresh', (request, env) => auth.refreshSession(request, env));
many(['POST'], '/auth/logout', (request, env) => auth.logout(request, env));
many(['GET'], '/auth/me', (request, env) => auth.me(request, env));

add('PATCH', '/auth/account', (request, env) => auth.updateAccount(request, env));
add('POST', '/auth/change-password', (request, env) => auth.changePassword(request, env));
add('GET', '/auth/sessions', (request, env) => auth.listSessions(request, env));
add('POST', '/auth/sessions/revoke-others', (request, env) => auth.revokeOtherSessions(request, env));
add('DELETE', '/auth/sessions/:id', (request, env, params) => auth.revokeSession(request, env, params.id));

add('POST', '/auth/mfa/setup', (request, env) => auth.mfaSetup(request, env));
add('POST', '/auth/mfa/enable', (request, env) => auth.mfaEnable(request, env));
add('POST', '/auth/mfa/disable', (request, env) => auth.mfaDisable(request, env));
add('POST', '/auth/mfa/verify', (request, env) => auth.mfaVerify(request, env));
add('POST', '/auth/mfa/recovery/send-otp', (request, env) => auth.mfaRecoverySendOtp(request, env));
add('POST', '/auth/mfa/recovery/verify', (request, env) => auth.mfaRecoveryVerify(request, env));
add('POST', '/auth/mfa/recovery/complete', (request, env) => auth.mfaRecoveryComplete(request, env));

add('POST', '/auth/feedback', (request, env) => auth.submitFeedback(request, env));

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------
many(['GET'], '/mail/business-emails', (request, env) => mail.queryEmails(request, env));
many(['POST'], '/mail/business-emails', (request, env) => mail.saveEmail(request, env));
many(['DELETE'], '/mail/business-emails', (request, env) => mail.deleteEmail(request, env));
many(['POST'], '/mail/business-emails/query', (request, env) => mail.queryEmails(request, env));

many(['GET'], '/mail/business-mailboxes', (request, env) => mail.queryBusinessMailboxes(request, env));
many(['POST'], '/mail/business-mailboxes', (request, env) => mail.upsertBusinessMailbox(request, env));
many(['DELETE'], '/mail/business-mailboxes', (request, env) => mail.deleteBusinessMailbox(request, env));
many(['POST'], '/mail/business-mailboxes/query', (request, env) => mail.queryBusinessMailboxes(request, env));

many(['POST'], '/mail/send', (request, env) => mail.sendMail(request, env));
many(['POST'], '/mail/emails', (request, env) => mail.sendMail(request, env));
many(['POST'], '/mail/inbound', (request, env) => mail.inboundWebhook(request, env));

// ---------------------------------------------------------------------------
// Team invites (external collaborators)
// ---------------------------------------------------------------------------
add('POST', '/team/invites', (request, env) => team.createInvite(request, env));
add('POST', '/team/invites/validate', (request, env) => team.validateInvite(request, env));
add('POST', '/team/invites/complete', (request, env) => team.completeInvite(request, env));
add('POST', '/team/invites/revoke', (request, env) => team.revokeInvite(request, env));
add('POST', '/team/logout-everywhere', (request, env) => team.logoutEverywhere(request, env));

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------
add('POST', '/tenants/verify-domain', (request, env) => tenants.verifyTenantDomain(request, env));
add('POST', '/tenants/:id/domains', (request, env, params) => tenants.createTenantDomain(request, env, params.id));

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
add('POST', '/payments/webhook', (request, env) => payments.razorpayWebhook(request, env));
add('POST', '/payments/create-order', (request, env) => payments.createOrder(request, env));
add('POST', '/payments/verify', (request, env) => payments.verifyPayment(request, env));
add('GET', '/payments/invoices', (request, env) => payments.listInvoices(request, env));

// ---------------------------------------------------------------------------
// Company workspace
// ---------------------------------------------------------------------------
add('GET', '/company/setup-state', (request, env) => company.setupState(request, env));
add('GET', '/company/team', (request, env) => company.team(request, env));
add('POST', '/company/team/invitations', (request, env) => company.inviteMember(request, env));
add('DELETE', '/company/team/invitations/:id', (request, env, params) => company.revokeInvitation(request, env, params.id));
add('POST', '/company/team/remove', (request, env) => company.removeMember(request, env));

add('GET', '/company/businesses', (request, env) => company.listBusinesses(request, env));
add('POST', '/company/businesses', (request, env) => company.createBusiness(request, env));
add('POST', '/company/businesses/switch', (request, env) => company.switchBusiness(request, env));

add('GET', '/company/domains', (request, env) => company.listDomains(request, env));
add('POST', '/company/domains', (request, env) => company.createDomain(request, env));
add('GET', '/company/domains/dns-requirements', (request, env) => company.dnsRequirements(request, env));
add('POST', '/company/domains/:id/verify', (request, env, params) => company.verifyDomain(request, env, params.id));
add('DELETE', '/company/domains/:id', (request, env, params) => company.deleteDomain(request, env, params.id));

add('GET', '/company/mailboxes', (request, env) => company.listMailboxes(request, env));
add('POST', '/company/mailboxes', (request, env) => company.createMailbox(request, env));
add('DELETE', '/company/mailboxes/delete', (request, env) => company.deleteMailbox(request, env));

add('GET', '/company/queue', (request, env) => company.listQueue(request, env));

add('GET', '/company/groups', (request, env) => company.listGroups(request, env));
add('POST', '/company/groups', (request, env) => company.saveGroup(request, env));
add('DELETE', '/company/groups/:id', (request, env, params) => company.deleteGroup(request, env, params.id));

add('GET', '/company/audit', (request, env) => company.listAudit(request, env));

add('GET', '/company/templates', (request, env) => company.listTemplates(request, env));
add('POST', '/company/templates', (request, env) => company.saveTemplate(request, env));
add('DELETE', '/company/templates/:id', (request, env, params) => company.deleteTemplate(request, env, params.id));

add('GET', '/company/contacts', (request, env) => company.listContacts(request, env));
add('POST', '/company/contacts', (request, env) => company.saveContact(request, env));
add('DELETE', '/company/contacts/:id', (request, env, params) => company.deleteContact(request, env, params.id));

add('GET', '/company/signatures', (request, env) => company.listSignatures(request, env));
add('POST', '/company/signatures', (request, env) => company.saveSignature(request, env));
add('DELETE', '/company/signatures/:id', (request, env, params) => company.deleteSignature(request, env, params.id));

// ---------------------------------------------------------------------------
// Platform control plane
// ---------------------------------------------------------------------------
add('GET', '/admin/platform/me', (request, env) => admin.platformMe(request, env));
add('GET', '/admin/platform/overview', (request, env) => admin.platformOverview(request, env));
add('GET', '/admin/platform/analytics', (request, env) => admin.platformAnalytics(request, env));

add('GET', '/admin/platform/companies', (request, env) => admin.platformCompanies(request, env));
add('GET', '/admin/platform/companies/:id', (request, env, params) => admin.platformCompanyDetail(request, env, params.id));
add('PATCH', '/admin/platform/companies/:id', (request, env, params) => admin.platformUpdateCompany(request, env, params.id));
add('POST', '/admin/platform/companies/:id/actions', (request, env, params) => admin.platformCompanyAction(request, env, params.id));

add('GET', '/admin/platform/users', (request, env) => admin.platformUsers(request, env));
add('POST', '/admin/platform/users/:id/actions', (request, env, params) => admin.platformUserAction(request, env, params.id));

add('GET', '/admin/platform/audit', (request, env) => admin.platformAudit(request, env));

add('GET', '/admin/platform/investigations', (request, env) => admin.platformInvestigations(request, env));
add('POST', '/admin/platform/investigations', (request, env) => admin.createInvestigation(request, env));
add('GET', '/admin/platform/investigations/:id', (request, env, params) => admin.platformInvestigationDetail(request, env, params.id));
add('PATCH', '/admin/platform/investigations/:id', (request, env, params) => admin.updateInvestigation(request, env, params.id));
add('POST', '/admin/platform/investigations/:id/events', (request, env, params) => admin.addInvestigationEvent(request, env, params.id));

add('GET', '/admin/platform/team', (request, env) => admin.platformTeam(request, env));
add('POST', '/admin/platform/team', (request, env) => admin.addPlatformAdmin(request, env));
add('POST', '/admin/platform/team/invitations', (request, env) => admin.invitePlatformAdmin(request, env));
add('POST', '/admin/platform/team/invitations/:id/revoke', (request, env, params) => admin.revokePlatformInvitation(request, env, params.id));
add('PATCH', '/admin/platform/team/:email', (request, env, params) => admin.updatePlatformAdmin(request, env, decodeURIComponent(params.email)));
add('DELETE', '/admin/platform/team/:email', (request, env, params) => admin.removePlatformAdmin(request, env, decodeURIComponent(params.email)));

add('GET', '/admin/platform/api-keys', (request, env) => admin.platformApiKeys(request, env));
add('POST', '/admin/platform/api-keys', (request, env) => admin.createApiKey(request, env, null));
add('DELETE', '/admin/platform/api-keys/:id', (request, env, params) => admin.revokeApiKey(request, env, params.id, null));

add('GET', '/admin/platform/billing', (request, env) => admin.platformBilling(request, env));
add('GET', '/admin/platform/feature-flags', (request, env) => admin.platformFlags(request, env));
add('PATCH', '/admin/platform/feature-flags', (request, env) => admin.updateFlag(request, env));

add('GET', '/admin/platform/announcements', (request, env) => admin.platformAnnouncements(request, env));
add('POST', '/admin/platform/announcements', (request, env) => admin.createAnnouncement(request, env));
add('PATCH', '/admin/platform/announcements/:id', (request, env, params) => admin.updateAnnouncement(request, env, params.id));
add('DELETE', '/admin/platform/announcements/:id', (request, env, params) => admin.deleteAnnouncement(request, env, params.id));

add('POST', '/admin/platform/broadcast', (request, env) => admin.platformBroadcast(request, env));
add('GET', '/admin/platform/broadcast/senders', (request, env) => admin.platformBroadcastSenders(request, env));
add('GET', '/admin/platform/broadcasts', (request, env) => admin.platformBroadcasts(request, env));

add('GET', '/admin/platform/support', (request, env) => admin.platformSupport(request, env));
add('PATCH', '/admin/platform/support/:id', (request, env, params) => admin.updateTicket(request, env, params.id));

add('GET', '/admin/platform/system', (request, env) => admin.platformSystem(request, env));

add('GET', '/admin/platform/feedback', (request, env) => admin.platformFeedback(request, env));
add('PATCH', '/admin/platform/feedback/:id', (request, env, params) => admin.updateFeedback(request, env, params.id));
add('POST', '/admin/platform/feedback/:id/escalate', (request, env, params) => admin.escalateFeedback(request, env, params.id));

add('GET', '/admin/platform/settings', (request, env) => admin.platformSettings(request, env));
add('PATCH', '/admin/platform/settings', (request, env) => admin.updateSetting(request, env));

// ---------------------------------------------------------------------------
// Company control plane
// ---------------------------------------------------------------------------
add('GET', '/admin/company/overview', (request, env) => admin.companyOverview(request, env));
add('GET', '/admin/company/members', (request, env) => admin.companyMembers(request, env));
add('PATCH', '/admin/company/members/:id', (request, env, params) => admin.updateCompanyMember(request, env, params.id));
add('GET', '/admin/company/roles', (request, env) => admin.companyRoles(request, env));
add('GET', '/admin/company/usage', (request, env) => admin.companyUsage(request, env));
add('GET', '/admin/company/audit', (request, env) => admin.companyAudit(request, env));
add('GET', '/admin/company/security', (request, env) => admin.companySecurity(request, env));

add('GET', '/admin/company/api-keys', (request, env) => admin.companyApiKeys(request, env));
add('POST', '/admin/company/api-keys', async (request, env) => {
  const { user } = await requireAuth(request, env);
  return admin.createApiKey(request, env, user.tenant_id);
});
add('DELETE', '/admin/company/api-keys/:id', async (request, env, params) => {
  const { user } = await requireAuth(request, env);
  return admin.revokeApiKey(request, env, params.id, user.tenant_id);
});

add('GET', '/admin/company/billing', (request, env) => admin.companyBilling(request, env));
add('GET', '/admin/company/integrations', (request, env) => admin.companyIntegrations(request, env));
add('GET', '/admin/company/announcements', (request, env) => admin.companyAnnouncements(request, env));

add('POST', '/admin/company/feedback', (request, env) => admin.submitCompanyFeedback(request, env));
add('GET', '/admin/company/feedback', (request, env) => admin.companyFeedback(request, env));

// ---------------------------------------------------------------------------
// Legacy infrastructure verification (managed backend: always available)
// ---------------------------------------------------------------------------
add('GET', '/verify/providers', async () => json({
  success: true,
  providers: ['resend', 'sendgrid', 'postmark', 'mailgun', 'amazonses', 'custom'],
  database: 'cloudflare-d1',
}));

add('POST', '/verify', async (request) => {
  const body = await readJson<Record<string, unknown>>(request).catch(() => ({} as Record<string, unknown>));
  const provider = asString(body.apiProvider) || asString(body.provider) || 'resend';
  return json({
    success: true,
    database: { provider: 'cloudflare-d1', status: 'ready', managed: true },
    mail: { provider, status: body.apiKey ? 'configured' : 'managed' },
    message: 'VelisMail managed infrastructure is ready. No external database connection is required.',
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

const PREFIXES = ['/api/v1', '/v1'];

function normalizePath(pathname: string): string {
  let path = pathname;
  for (const prefix of PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      path = path.slice(prefix.length) || '/';
      break;
    }
  }
  path = path.replace(/\/+$/, '');
  return path || '/';
}

interface Match {
  handler: Handler;
  params: ParamMap;
  methodMismatch: boolean;
}

function match(method: string, segments: string[]): Match | null {
  let pathMatched = false;
  for (const route of routes) {
    if (route.segments.length !== segments.length) continue;
    const params: ParamMap = {};
    let ok = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const want = route.segments[index];
      const value = segments[index];
      if (want.startsWith(':')) {
        params[want.slice(1)] = value;
      } else if (want !== value) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (route.method === method) {
      return { handler: route.handler, params, methodMismatch: false };
    }
  }
  return pathMatched
    ? { handler: async () => fail('Method not allowed.', 405, 'method_not_allowed'), params: {}, methodMismatch: true }
    : null;
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);

  if (request.method === 'OPTIONS') {
    return withCors(new Response(null, { status: 204 }), request, env);
  }

  const segments = path.split('/').filter(Boolean);
  const matched = match(request.method, segments);
  if (!matched) {
    return fail(`Route ${request.method} ${path} was not found.`, 404, 'not_found');
  }

  try {
    return await matched.handler(request, env, matched.params);
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(error.message, error.status, error.code);
    }
    console.error('Unhandled API error', {
      path,
      method: request.method,
      error: error instanceof Error ? error.stack : String(error),
    });
    return fail(
      env.ENVIRONMENT === 'production'
        ? 'Something went wrong. Please try again.'
        : error instanceof Error ? error.message : 'Unknown error',
      500,
      'internal_error',
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await handle(request, env);
    return withCors(response, request, env);
  },

  /**
   * Cloudflare Email Routing handler. Reads the raw MIME message and stores it
   * for the matching tenant domain. Unknown recipients are silently dropped.
   */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    try {
      const raw = await new Response(message.raw).text();
      const parsed = parseMime(raw);
      const recipients = [message.to, ...(parsed.to ?? [])]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());
      const uniqueRecipients = Array.from(new Set(recipients));

      const result = await storeInboundEmail(env, {
        from: parsed.from || message.from || '',
        fromName: parsed.fromName,
        to: uniqueRecipients,
        cc: parsed.cc,
        subject: parsed.subject || message.headers.get('subject') || '(No subject)',
        text: parsed.text,
        html: parsed.html,
        messageId: parsed.messageId || message.headers.get('message-id') || undefined,
        date: parsed.date,
        rawSize: message.rawSize,
      });

      if (!result.stored) {
        console.warn('Inbound email not stored', { to: uniqueRecipients, reason: result.reason });
      }
    } catch (error) {
      console.error('Inbound email failed', {
        from: message.from,
        to: message.to,
        error: error instanceof Error ? error.stack : String(error),
      });
    }
  },
};
