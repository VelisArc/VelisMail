import { type Env, HttpError, asString, hmacSha256, json, nowIso, readJson, timingSafeEqual, uuid } from '../lib/util';
import { requireAuth } from '../lib/auth';

const PLAN_PRICES: Record<string, { monthly: number; annual: number; name: string }> = {
  starter: { monthly: 499, annual: 4990, name: 'Starter' },
  growth: { monthly: 1499, annual: 14990, name: 'Growth' },
  scale: { monthly: 3999, annual: 39990, name: 'Scale' },
  enterprise: { monthly: 9999, annual: 99990, name: 'Enterprise' },
};

function razorpayAuth(env: Env): string {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new HttpError(503, 'Payment gateway is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }
  return `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;
}

export async function createOrder(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const planKey = asString(body.plan).toLowerCase();
  const plan = PLAN_PRICES[planKey];
  const amount = Number(body.amount ?? (plan ? (asString(body.billing) === 'annual' ? plan.annual : plan.monthly) * 100 : 0));
  if (!plan) throw new HttpError(400, 'Unknown plan.');
  const billing = asString(body.billing, 'monthly') === 'annual' ? 'annual' : 'monthly';
  const expected = (billing === 'annual' ? plan.annual : plan.monthly) * 100;
  if (!Number.isFinite(amount) || amount !== expected) {
    throw new HttpError(400, 'The order amount does not match the selected plan.');
  }

  const receipt = `vm_${Date.now()}_${user.id.slice(0, 8)}`;
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: razorpayAuth(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      currency: asString(body.currency, 'INR'),
      receipt,
      notes: { plan: planKey, billing, email: user.email, userId: user.id },
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { id?: string; amount?: number; currency?: string; message?: string; error?: { description?: string } };
  if (!response.ok || !data.id) {
    return json({
      success: false,
      message: data.error?.description || data.message || `Razorpay rejected the order (${response.status}).`,
    }, 502);
  }

  await env.DB.prepare(
    `INSERT INTO payments (id, tenant_id, user_id, email, plan, billing_cycle, amount_paise, currency, status, gateway, order_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', 'razorpay', ?, ?)`,
  ).bind(uuid(), user.tenant_id, user.id, user.email, plan.name, billing, amount, data.currency ?? 'INR', data.id, nowIso()).run();

  return json({
    success: true,
    order_id: data.id,
    id: data.id,
    amount: data.amount ?? amount,
    currency: data.currency ?? 'INR',
    razorpay_key_id: env.RAZORPAY_KEY_ID,
  });
}

export async function verifyPayment(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const body = await readJson<Record<string, unknown>>(request);
  const paymentId = asString(body.razorpay_payment_id);
  const orderId = asString(body.razorpay_order_id);
  const signature = asString(body.razorpay_signature);
  if (!paymentId || !orderId || !signature || !env.RAZORPAY_KEY_SECRET) {
    throw new HttpError(400, 'Payment reference is incomplete.');
  }

  const expected = Array.from(await hmacSha256(env.RAZORPAY_KEY_SECRET, `${orderId}|${paymentId}`))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (expected !== signature) {
    throw new HttpError(400, 'Payment signature verification failed.');
  }

  const payment = await env.DB.prepare('SELECT * FROM payments WHERE order_id = ?').bind(orderId)
    .first<{ id: string; plan: string; billing_cycle: string; amount_paise: number; tenant_id: string | null; user_id: string | null }>();
  if (!payment || payment.user_id !== user.id) throw new HttpError(404, 'Payment order was not found.');

  const now = new Date();
  const expires = new Date(now.getTime() + (payment.billing_cycle === 'annual' ? 365 : 30) * 86_400_000);
  await env.DB.batch([
    env.DB.prepare("UPDATE payments SET status = 'paid', payment_ref = ?, paid_at = ? WHERE id = ?")
      .bind(paymentId, now.toISOString(), payment.id),
    env.DB.prepare('UPDATE users SET plan = ?, updated_at = ? WHERE id = ?')
      .bind(payment.plan, now.toISOString(), user.id),
    ...(payment.tenant_id
      ? [env.DB.prepare('UPDATE tenants SET plan = ?, updated_at = ? WHERE id = ?')
        .bind(payment.plan, now.toISOString(), payment.tenant_id)]
      : []),
  ]);

  return json({
    success: true,
    plan: payment.plan,
    billing_cycle: payment.billing_cycle,
    paid_until: expires.toISOString(),
    amount_paise: payment.amount_paise,
    message: `${payment.plan} plan activated.`,
  });
}

async function applyPlanToPayment(
  env: Env,
  payment: { id: string; plan: string; billing_cycle: string; tenant_id: string | null; user_id: string | null },
  iso: string,
): Promise<void> {
  const statements: Array<D1PreparedStatement> = [];
  if (payment.user_id) {
    statements.push(env.DB.prepare('UPDATE users SET plan = ?, updated_at = ? WHERE id = ?').bind(payment.plan, iso, payment.user_id));
  }
  if (payment.tenant_id) {
    statements.push(env.DB.prepare('UPDATE tenants SET plan = ?, updated_at = ? WHERE id = ?').bind(payment.plan, iso, payment.tenant_id));
  }
  if (statements.length) {
    await env.DB.batch(statements);
  }
}

/**
 * Razorpay webhook (`payment.captured`, `order.paid`, `payment.failed`,
 * `refund.processed`). Public endpoint — authenticity comes from the
 * HMAC-SHA256 signature in `x-razorpay-signature`, never from a session.
 */
export async function razorpayWebhook(request: Request, env: Env): Promise<Response> {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return json({ success: false, message: 'RAZORPAY_WEBHOOK_SECRET is not configured on the Worker.' }, 503);
  }

  const signature = request.headers.get('x-razorpay-signature') || '';
  const body = await request.text();
  const digest = await hmacSha256(secret, body);
  const expected = Array.from(digest).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!signature || !timingSafeEqual(expected, signature)) {
    return json({ success: false, message: 'Invalid webhook signature.' }, 400);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return json({ success: false, message: 'Webhook payload is not valid JSON.' }, 400);
  }

  const event = asString(parsed.event);
  const payload = (parsed.payload ?? {}) as Record<string, unknown>;
  const paymentEntity = (((payload.payment ?? {}) as Record<string, unknown>).entity ?? null) as Record<string, unknown> | null;
  const orderEntity = (((payload.order ?? {}) as Record<string, unknown>).entity ?? null) as Record<string, unknown> | null;

  const paymentId = asString(paymentEntity?.id);
  const orderId = asString(paymentEntity?.order_id) || asString(orderEntity?.id);

  if (event === 'payment.captured' || event === 'order.paid') {
    if (!orderId) return json({ success: true, status: 'ignored', reason: 'order_not_found' });
    const payment = await env.DB.prepare(
      'SELECT id, plan, billing_cycle, tenant_id, user_id, status FROM payments WHERE order_id = ?',
    ).bind(orderId).first<{ id: string; plan: string; billing_cycle: string; tenant_id: string | null; user_id: string | null; status: string }>();
    if (!payment) return json({ success: true, status: 'ignored', reason: 'unknown_order' });
    if (payment.status === 'paid') return json({ success: true, status: 'already_paid' });
    const iso = nowIso();
    await env.DB.prepare("UPDATE payments SET status = 'paid', payment_ref = ?, paid_at = ? WHERE id = ?")
      .bind(paymentId || null, iso, payment.id)
      .run();
    await applyPlanToPayment(env, payment, iso);
    return json({ success: true, status: 'paid' });
  }

  if (event === 'payment.failed') {
    if (orderId) {
      await env.DB.prepare("UPDATE payments SET status = 'failed' WHERE order_id = ? AND status != 'paid'").bind(orderId).run();
    }
    return json({ success: true, status: 'failed' });
  }

  if (event === 'refund.processed' || event === 'refund.failed') {
    if (orderId) {
      await env.DB.prepare("UPDATE payments SET status = 'refunded' WHERE order_id = ?").bind(orderId).run();
    }
    return json({ success: true, status: 'refunded' });
  }

  return json({ success: true, status: 'ignored', event });
}

export async function listInvoices(request: Request, env: Env): Promise<Response> {
  const { user } = await requireAuth(request, env);
  const rows = await env.DB.prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 100')
    .bind(user.id).all<Record<string, unknown>>();
  return json({
    success: true,
    invoices: (rows.results ?? []).map((row) => ({
      id: row.id,
      number: `INV-${String(row.id).slice(0, 8).toUpperCase()}`,
      plan: row.plan,
      billingCycle: row.billing_cycle,
      amountPaise: row.amount_paise,
      currency: row.currency,
      status: row.status,
      issuedAt: row.created_at,
      paidAt: row.paid_at,
      gateway: row.gateway,
      paymentRef: row.payment_ref,
    })),
  });
}
