const enc = new TextEncoder();

export function randomId(bytes = 12): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, bytes * 2);
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let r = 0;
  for (let i = 0; i < a.byteLength; i++) r |= a[i] ^ b[i];
  return r === 0;
}

/**
 * HMAC keys for Standard Webhooks-style signatures.
 * Dodo (and Polar secrets generated on/after 8 Sep 2026) sign with the
 * base64-decoded bytes after `whsec_`. Older Polar secrets sign with the
 * UTF-8 bytes of the full secret string. Polar's SDK tries both; so do we.
 */
function webhookHmacKeys(secret: string): Uint8Array<ArrayBuffer>[] {
  const utf8 = enc.encode(secret) as Uint8Array<ArrayBuffer>;
  const keys: Uint8Array<ArrayBuffer>[] = [utf8];
  const remainder = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  try {
    const decoded = b64ToBytes(remainder);
    if (decoded.byteLength > 0 && !bytesEqual(decoded, utf8)) keys.push(decoded);
  } catch {
    // Remainder wasn't valid base64; the UTF-8 key is the only candidate.
  }
  return keys;
}

/**
 * Verify a Standard Webhooks signature (Dodo Payments and Polar).
 * Signed content is `${id}.${timestamp}.${body}`, HMAC-SHA256.
 */
export async function verifyStandardWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 5 * 60) return false;
  const keys = webhookHmacKeys(secret);
  if (!keys.length) return false;
  const signed = `${id}.${timestamp}.${body}`;
  const expected = await Promise.all(keys.map(async (key) => bytesToB64(await hmac(key, signed))));
  return signature
    .split(' ')
    .map((s) => s.split(',')[1] ?? '')
    .some((sig) => expected.some((exp) => safeEqual(sig, exp)));
}

/**
 * Verify a Stripe webhook signature. The `Stripe-Signature` header is `t=<unix>,v1=<hex>[,v1=<hex>]`;
 * signed content is `${t}.${body}`, HMAC-SHA256 with the whole `whsec_...` secret as the key.
 */
export async function verifyStripeWebhook(secret: string, header: string | null, body: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1] ?? '';
  if (!/^\d+$/.test(t) || Math.abs(now / 1000 - Number(t)) > 5 * 60) return false;
  const mac = new Uint8Array(await hmac(enc.encode(secret.trim()), `${t}.${body}`));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  return parts.some(([k, v]) => k === 'v1' && !!v && safeEqual(v, expected));
}

/** Sign a value for the dashboard login cookie. */
export async function signToken(secret: string, value: string): Promise<string> {
  const sig = bytesToB64(await hmac(enc.encode(secret), value)).replace(/=+$/, '');
  return `${value}.${sig}`;
}

export async function verifyToken(secret: string, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const value = token.slice(0, i);
  const expected = await signToken(secret, value);
  return safeEqual(expected, token) ? value : null;
}

export function passwordsMatch(a: string, b: string): boolean {
  return safeEqual(a, b);
}

// ---------- account passwords (PBKDF2-SHA256; Workers allow at most 100k iterations)

const PBKDF2_ITERATIONS = 100_000;

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}

/** Returns "pbkdf2$<iterations>$<salt>$<hash>" for storing in the database. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt.buffer)}$${bytesToB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [kind, iter, salt, hash] = (stored ?? '').split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, b64ToBytes(salt), Number(iter));
  return safeEqual(bytesToB64(actual), hash);
}
