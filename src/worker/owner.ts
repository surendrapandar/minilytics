import type { Context } from 'hono';
import type { User } from './auth';
import type { AppEnv, Site } from './env';

/** How long a dashboard visit keeps that browser excluded from the owner's stats. */
const REMEMBER_MS = 30 * 86_400_000;

/**
 * The visitor's real IP. When the tracker is proxied through the customer's own domain (Vercel),
 * Cloudflare sees the proxy, so use the forwarded address instead (same rule as geo).
 */
function clientIp(c: Context<AppEnv>): string {
  if (c.req.header('x-vercel-ip-country')) {
    const fwd = c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  return c.req.header('cf-connecting-ip') ?? '';
}

/** A hash of IP + browser, so the raw IP is never stored. Null when there's nothing to go on. */
async function fingerprint(c: Context<AppEnv>): Promise<string | null> {
  const ip = clientIp(c);
  const ua = c.req.header('user-agent') ?? '';
  if (!ip || !ua) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${ua}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Sites with no owner (self-hosted, or legacy hosted sites) belong to the admin. */
const ownerKey = (site: Site) => site.owner_id ?? '';

/** Called when someone uses the dashboard: remember this browser as theirs. */
export async function rememberOwnerDevice(c: Context<AppEnv>, user: User) {
  const fp = await fingerprint(c);
  if (!fp) return;
  const owners = user.admin ? [user.id, ''] : [user.id];
  const now = Date.now();
  await c.env.DB.batch(
    owners.map((o) =>
      c.env.DB.prepare('INSERT INTO owner_devices (owner, fp, seen_at) VALUES (?, ?, ?) ON CONFLICT (owner, fp) DO UPDATE SET seen_at = excluded.seen_at').bind(o, fp, now),
    ),
  );
}

/** Is this tracking request coming from the site owner's own browser? */
export async function isOwnerVisit(c: Context<AppEnv>, site: Site): Promise<boolean> {
  const fp = await fingerprint(c);
  if (!fp) return false;
  const row = await c.env.DB.prepare('SELECT 1 FROM owner_devices WHERE owner = ? AND fp = ? AND seen_at > ?')
    .bind(ownerKey(site), fp, Date.now() - REMEMBER_MS)
    .first();
  return !!row;
}
