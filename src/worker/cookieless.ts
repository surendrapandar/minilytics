/**
 * Cookieless mode (`<script data-cookieless ...>`): the tracker stores nothing in the browser, and the server
 * derives the ids instead.
 *
 * - visitor: a hash of a random daily salt + site + IP + user agent. The salt is deleted when its UTC day ends,
 *   so the same person is a new visitor every day and a hash can't be traced back to an IP (same approach as
 *   Plausible). The raw IP is never stored.
 * - session: that visitor's latest session if it was active in the last 30 minutes, else a new one.
 */

const SESSION_MS = 30 * 60_000;

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

let cached: { day: string; salt: string } | null = null;

/** Today's salt, created on first use. Older salts are deleted at the same time. */
export async function dailySalt(db: D1Database, now: number): Promise<string> {
  const day = dayKey(now);
  if (cached?.day === day) return cached.salt;
  const fresh = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  // INSERT OR IGNORE then read back, so concurrent isolates agree on one salt for the day.
  const [, , row] = await db.batch<{ salt: string }>([
    db.prepare('INSERT OR IGNORE INTO salts (day, salt) VALUES (?, ?)').bind(day, fresh),
    db.prepare('DELETE FROM salts WHERE day < ?').bind(day),
    db.prepare('SELECT salt FROM salts WHERE day = ?').bind(day),
  ]);
  const salt = row.results[0]?.salt ?? fresh;
  cached = { day, salt };
  return salt;
}

/** Visitor id for the day: 'c' + 31 hex chars (fits the tracker's id format, and tells cookieless ids apart). */
export async function cookielessVisitorId(salt: string, siteId: string, ip: string, ua: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${siteId}|${ip}|${ua}`));
  return 'c' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 31);
}

export async function cookielessIds(
  db: D1Database,
  siteId: string,
  ip: string,
  ua: string,
  now: number,
): Promise<{ vid: string; sid: string }> {
  const vid = await cookielessVisitorId(await dailySalt(db, now), siteId, ip, ua);
  const open = await db
    .prepare('SELECT id FROM sessions WHERE site_id = ? AND visitor_id = ? AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 1')
    .bind(siteId, vid, now - SESSION_MS)
    .first<{ id: string }>();
  return { vid, sid: open?.id ?? crypto.randomUUID() };
}

/** For tests. */
export function resetSaltCache() {
  cached = null;
}
