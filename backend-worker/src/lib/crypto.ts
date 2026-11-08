import {
  base32Decode,
  base32Encode,
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  hmacSha256,
  timingSafeEqual,
  utf8,
} from './util';

/**
 * Password hashing.
 *
 * PBKDF2-SHA256 with a per-password salt. The iteration count is deliberately
 * kept lower than a native server would use because the Workers Free plan caps
 * CPU time at 10 ms per request. Raise `PBKDF2_ITERATIONS` after upgrading to
 * Workers Paid; the stored format carries the iteration count, so old hashes
 * keep verifying.
 */
const DEFAULT_ITERATIONS = 20_000;

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return `pbkdf2$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = base64UrlDecode(parts[2]);
  const expected = parts[3];
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return timingSafeEqual(base64UrlEncode(new Uint8Array(bits)), expected);
}

// ---------------------------------------------------------------------------
// JWT (HS256)
// ---------------------------------------------------------------------------

export type AccessClaims = {
  sub: string;
  email: string;
  tenant_id: string;
  role: string;
  is_platform_admin?: boolean;
  session_id: string;
  jti: string;
  iat: number;
  exp: number;
  typ: 'access';
};

function b64Json(value: unknown): string {
  return base64UrlEncode(utf8(JSON.stringify(value)));
}

export async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64Json({ alg: 'HS256', typ: 'JWT' });
  const body = b64Json(payload);
  const signature = base64UrlEncode(await hmacSha256(secret, `${header}.${body}`));
  return `${header}.${body}.${signature}`;
}

export async function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): Promise<T | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = base64UrlEncode(await hmacSha256(secret, `${header}.${body}`));
  if (!timingSafeEqual(expected, signature)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body))) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238, SHA-1, 6 digits, 30 second step)
// ---------------------------------------------------------------------------

export async function generateTotpSecret(): Promise<string> {
  const raw = new Uint8Array(20);
  crypto.getRandomValues(raw);
  return base32Encode(raw);
}

export function totpUri(secret: string, account: string, issuer = 'VelisMail'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export async function totpCode(secret: string, counter: number): Promise<string> {
  const keyBytes = base32Decode(secret);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, buffer));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary = ((signature[offset] & 0x7f) << 24)
    | ((signature[offset + 1] & 0xff) << 16)
    | ((signature[offset + 2] & 0xff) << 8)
    | (signature[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const normalized = code.replace(/\D/g, '');
  if (normalized.length !== 6) return false;
  const counter = Math.floor(Date.now() / 30_000);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidate = await totpCode(secret, counter + offset);
    if (timingSafeEqual(candidate, normalized)) return true;
  }
  return false;
}

export async function sha256Short(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(value));
  return bytesToHex(new Uint8Array(digest)).slice(0, 12);
}
