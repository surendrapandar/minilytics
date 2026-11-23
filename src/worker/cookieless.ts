/**
 * Cookieless mode (`<script data-cookieless ...>`): the tracker stores nothing in the browser, and the server
 * derives the ids instead.
 *
 * - visitor: a hash of a random daily salt + site + IP + user agent. The salt is deleted when its UTC day ends,
 *   so the same person is a new visitor every day and a hash can't be traced back to an IP (same approach as
 *   Plausible). The raw IP is never stored. IPv6 addresses count by their /64 prefix, since browsers rotate
 *   the rest (privacy extensions) from one connection to the next.
 * - session: that visitor's latest session if it was active in the last 30 minutes, else a new one.
 *
 * The IP can still change mid-visit (IPv4/IPv6 alternation, VPN), so two hints keep a visit together:
 * - the ids the tracker got back for the current page (memory only), for its pings, goals and SPA pageviews;
 * - on a full page load from another page of the site, the one session that just left that page with the
 *   same browser and location.
 */

const SESSION_MS = 30 * 60_000;

/** Cookieless visitor ids: 'c' + 31 hex chars. Cookie mode ids are UUIDs, so they never match this. */
const COOKIELESS_VID = "visitor_id LIKE 'c%' AND length(visitor_id) = 32";

/** The part of an IP that identifies a connection: the whole IPv4 address, or the /64 prefix of an IPv6 one. */
export function ipKey(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/%.*$/, '');
  if (!s.includes(':')) return s;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return mapped[1];
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
}

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
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${siteId}|${ipKey(ip)}|${ua}`));
  return 'c' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 31);
}

export interface VisitHints {
  /** The session id the tracker got back for the current page, if any. */
  sid?: string;
  /** A full page load coming from another page of the site (same-site referrer). */
  from?: { path: string; browser: string | null; os: string | null; device: string | null; country: string | null; city: string | null };
}

export async function cookielessIds(
  db: D1Database,
  siteId: string,
  ip: string,
  ua: string,
  now: number,
  hints: VisitHints = {},
): Promise<{ vid: string; sid: string }> {
  const since = now - SESSION_MS;
  // Same page as the last event: the tracker already knows its session, even if the IP has changed since.
  if (hints.sid) {
    const known = await db
      .prepare(`SELECT visitor_id FROM sessions WHERE site_id = ? AND id = ? AND last_seen_at > ? AND ${COOKIELESS_VID}`)
      .bind(siteId, hints.sid, since)
      .first<{ visitor_id: string }>();
    if (known) return { vid: known.visitor_id, sid: hints.sid };
  }

  const vid = await cookielessVisitorId(await dailySalt(db, now), siteId, ip, ua);
  const open = await db
    .prepare('SELECT id FROM sessions WHERE site_id = ? AND visitor_id = ? AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 1')
    .bind(siteId, vid, since)
    .first<{ id: string }>();
  if (open) return { vid, sid: open.id };

  // Clicked through from another page of the site, but the hash changed: continue the session that left that
  // page, only when exactly one matches, so two people are never merged.
  const f = hints.from;
  if (f) {
    const { results } = await db
      .prepare(
        `SELECT id, visitor_id FROM sessions
         WHERE site_id = ? AND exit_page = ? AND last_seen_at > ? AND ${COOKIELESS_VID}
           AND browser IS ? AND os IS ? AND device IS ? AND country IS ? AND city IS ?
         LIMIT 2`,
      )
      .bind(siteId, f.path, since, f.browser, f.os, f.device, f.country, f.city)
      .all<{ id: string; visitor_id: string }>();
    if (results.length === 1) return { vid: results[0].visitor_id, sid: results[0].id };
  }
  return { vid, sid: crypto.randomUUID() };
}

/** For tests. */
export function resetSaltCache() {
  cached = null;
}
