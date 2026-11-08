/**
 * Shared types and small helpers used by the Worker.
 */

export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  JWT_SECRET?: string;
  JWT_ACCESS_TTL_SECONDS?: string;
  JWT_REFRESH_TTL_SECONDS?: string;
  RESEND_API_KEY?: string;
  PLATFORM_FROM_EMAIL?: string;
  PLATFORM_FROM_NAME?: string;
  OTP_FROM_EMAIL?: string;
  OTP_SIGNING_SECRET?: string;
  FEEDBACK_EMAIL_TO?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
  /** Svix signing secret for the Resend inbound webhook (`whsec_...`). */
  RESEND_WEBHOOK_SECRET?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_APP_ID?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  /** When "true", OTP responses include the code so a fresh deployment can be tested. */
  AUTH_DEV_OTP?: string;
  /** Address that receives platform notifications (bounces, feedback). */
  ALERT_EMAIL_TO?: string;
  /** When "true", the backend hosts database + outbound mail; the UI skips the infra steps. */
  MANAGED_INFRASTRUCTURE?: string;
}

export type Json = Record<string, unknown>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function fail(message: string, status = 400, code?: string): Response {
  return json({ success: false, error: { code: code ?? httpCode(status), message }, message }, status);
}

export function httpCode(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'payload_too_large';
  if (status === 429) return 'rate_limited';
  return status >= 500 ? 'internal_error' : 'error';
}

export function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.FRONTEND_URL || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const fallback = [
    'https://velismail.online',
    'https://www.velismail.online',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  const list = allowed.length ? allowed : fallback;
  const allowOrigin = list.includes(origin) ? origin : '';
  if (!allowOrigin) return {};
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Request-Id',
    'Access-Control-Expose-Headers': 'X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After',
    'Access-Control-Max-Age': '3600',
    Vary: 'Origin',
  };
}

export function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, env))) {
    headers.set(key, value);
  }
  headers.set('X-Request-Id', request.headers.get('X-Request-Id') || uuid());
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function readJson<T = Json>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) {
    const text = await request.text();
    if (!text.trim()) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(400, 'Request body must be valid JSON.');
    }
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

export class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function isEmail(value: string): boolean {
  if (!value || value.length > 254 || value.includes('..')) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !domain.includes('.')) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)
    && domain.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-') && /^[a-z0-9-]+$/.test(label));
}

export function normalizeDomain(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^mail\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.+$/, '');
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(local.length - 2, 2))}@${domain}`;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha256(key: string | Uint8Array, value: string): Promise<Uint8Array> {
  const rawKey = typeof key === 'string' ? utf8(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, utf8(value));
  return new Uint8Array(signature);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

export function randomDigits(length = 6): string {
  const buffer = new Uint32Array(1);
  let digits = '';
  while (digits.length < length) {
    crypto.getRandomValues(buffer);
    digits += String(buffer[0] % 10);
  }
  return digits.slice(0, length);
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export async function parseBody<T>(request: Request): Promise<T> {
  return readJson<T>(request);
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function asBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseJsonObject(value: unknown): Json {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}
