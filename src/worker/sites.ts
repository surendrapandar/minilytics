import { isHosted, siteAccessSql, type User } from './auth';
import { forgetSite, type Env, type Site } from './env';
import { randomId } from './lib/crypto';
import { UserError } from './lib/errors';
import type { FunnelStep } from './stats';

/**
 * Managing sites, funnels and goals. Shared by the dashboard API and the MCP tools, so both behave the same.
 */

export function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/;

export function validTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const mask = (secret: string | null | undefined) => (secret ? '••••••••' : null);
export const publicSite = (s: Site) => ({ ...s, dodo_webhook_secret: mask(s.dodo_webhook_secret), stripe_webhook_secret: mask(s.stripe_webhook_secret) });

/** A site this user may see, by id (or, for agents, by domain). */
export async function findSite(env: Env, user: User, idOrDomain: string): Promise<Site | null> {
  const access = siteAccessSql(env, user);
  return env.DB.prepare(`SELECT s.* FROM sites s WHERE (s.id = ? OR s.domain = ?) AND ${access.sql} ORDER BY s.id = ? DESC, s.created_at LIMIT 1`)
    .bind(idOrDomain, cleanDomain(idOrDomain), idOrDomain, ...access.params)
    .first<Site>();
}

export async function listSites(env: Env, user: User) {
  const now = Date.now();
  const access = siteAccessSql(env, user);
  const [sites, stats] = await env.DB.batch([
    env.DB.prepare(`SELECT s.* FROM sites s WHERE ${access.sql} ORDER BY s.created_at`).bind(...access.params),
    env.DB.prepare(
      `SELECT site_id, COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(DISTINCT CASE WHEN last_seen_at > ? THEN visitor_id END) AS online
       FROM sessions WHERE started_at > ? GROUP BY site_id`,
    ).bind(now - 5 * 60_000, now - 86_400_000),
  ]);
  const by = new Map((stats.results as any[]).map((r) => [r.site_id, r]));
  return (sites.results as unknown as Site[]).map((s) => ({
    ...publicSite(s),
    visitors24h: (by.get(s.id)?.visitors ?? 0) as number,
    online: (by.get(s.id)?.online ?? 0) as number,
  }));
}

export async function createSite(env: Env, user: User, b: Partial<Site>) {
  if (isHosted(env) && !user.paid) throw new UserError(402, 'Choose a plan to add websites.');
  const domain = cleanDomain(b.domain ?? '');
  if (!DOMAIN.test(domain)) throw new UserError(400, 'Enter a domain like example.com');
  const tz = b.timezone && validTimezone(b.timezone) ? b.timezone : 'UTC';
  const site: Site = {
    id: randomId(8),
    name: (b.name || domain).slice(0, 100),
    domain,
    timezone: tz,
    currency: (b.currency || 'USD').toUpperCase().slice(0, 3),
    api_key: 'ml_' + randomId(16),
    dodo_webhook_secret: null,
    created_at: Date.now(),
  };
  await env.DB.prepare(
    'INSERT INTO sites (id, name, domain, timezone, currency, api_key, dodo_webhook_secret, created_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(site.id, site.name, site.domain, site.timezone, site.currency, site.api_key, null, site.created_at, isHosted(env) ? user.id : null)
    .run();
  return publicSite(site);
}

export async function updateSite(env: Env, site: Site, b: Partial<Site>) {
  const next = { ...site };
  if (typeof b.name === 'string' && b.name.trim()) next.name = b.name.trim().slice(0, 100);
  if (typeof b.domain === 'string') {
    const d = cleanDomain(b.domain);
    if (!DOMAIN.test(d)) throw new UserError(400, 'Enter a domain like example.com');
    next.domain = d;
  }
  if (typeof b.timezone === 'string') {
    if (!validTimezone(b.timezone)) throw new UserError(400, 'Unknown timezone');
    next.timezone = b.timezone;
  }
  if (typeof b.currency === 'string' && /^[A-Za-z]{3}$/.test(b.currency)) next.currency = b.currency.toUpperCase();
  if (typeof b.dodo_webhook_secret === 'string' && !b.dodo_webhook_secret.includes('•')) {
    next.dodo_webhook_secret = b.dodo_webhook_secret.trim() || null;
  }
  if (typeof b.stripe_webhook_secret === 'string' && !b.stripe_webhook_secret.includes('•')) {
    next.stripe_webhook_secret = b.stripe_webhook_secret.trim() || null;
  }
  if (typeof b.dodo_product_ids === 'string') {
    const ids = b.dodo_product_ids.split(/[\s,]+/).filter((x) => /^pdt_[\w-]+$/.test(x));
    next.dodo_product_ids = ids.join(',') || null;
  }
  await env.DB.prepare(
    'UPDATE sites SET name = ?, domain = ?, timezone = ?, currency = ?, dodo_webhook_secret = ?, dodo_product_ids = ?, stripe_webhook_secret = ? WHERE id = ?',
  )
    .bind(
      next.name,
      next.domain,
      next.timezone,
      next.currency,
      next.dodo_webhook_secret,
      next.dodo_product_ids ?? null,
      next.stripe_webhook_secret ?? null,
      site.id,
    )
    .run();
  forgetSite(site.id);
  return publicSite(next);
}

export async function rotateApiKey(env: Env, site: Site) {
  const key = 'ml_' + randomId(16);
  await env.DB.prepare('UPDATE sites SET api_key = ? WHERE id = ?').bind(key, site.id).run();
  return { api_key: key };
}

export async function deleteSite(env: Env, site: Site) {
  await env.DB.batch(
    ['events', 'sessions', 'visitors', 'payments', 'funnels']
      .map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE site_id = ?`).bind(site.id))
      .concat(env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(site.id)),
  );
  forgetSite(site.id);
  return { ok: true };
}

// ---------- funnels

export interface Funnel {
  id: string;
  name: string;
  steps: FunnelStep[];
  created_at: number;
}

export async function listFunnels(db: D1Database, site: Site): Promise<Funnel[]> {
  const res = await db.prepare('SELECT * FROM funnels WHERE site_id = ? ORDER BY created_at').bind(site.id).all();
  return res.results.map((f: any) => ({ id: f.id, name: f.name, created_at: f.created_at, steps: JSON.parse(f.steps) }));
}

export async function getFunnel(db: D1Database, site: Site, id: string): Promise<Funnel | null> {
  const f = await db.prepare('SELECT * FROM funnels WHERE id = ? AND site_id = ?').bind(id, site.id).first<any>();
  return f ? { id: f.id, name: f.name, created_at: f.created_at, steps: JSON.parse(f.steps) } : null;
}

function cleanSteps(steps: unknown): FunnelStep[] {
  return (Array.isArray(steps) ? (steps as FunnelStep[]) : [])
    .filter((s) => (s?.type === 'page' || s?.type === 'goal') && typeof s.value === 'string' && s.value.trim())
    .slice(0, 10)
    .map((s) => ({ type: s.type, value: s.value.trim().slice(0, 200) }));
}

export async function createFunnel(db: D1Database, site: Site, b: { name?: string; steps?: unknown }) {
  const steps = cleanSteps(b.steps);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name || steps.length < 2) throw new UserError(400, 'A funnel needs a name and at least 2 steps');
  const id = randomId(8);
  await db
    .prepare('INSERT INTO funnels (id, site_id, name, steps, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, site.id, name.slice(0, 100), JSON.stringify(steps), Date.now())
    .run();
  return { id, name, steps };
}

export async function updateFunnel(db: D1Database, site: Site, id: string, b: { name?: string; steps?: unknown }) {
  const f = await getFunnel(db, site, id);
  if (!f) throw new UserError(404, 'funnel not found');
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 100) : f.name;
  let steps = f.steps;
  if (b.steps !== undefined) {
    steps = cleanSteps(b.steps);
    if (steps.length < 2) throw new UserError(400, 'A funnel needs at least 2 steps');
  }
  await db.prepare('UPDATE funnels SET name = ?, steps = ? WHERE id = ? AND site_id = ?').bind(name, JSON.stringify(steps), id, site.id).run();
  return { ...f, name, steps };
}

export async function deleteFunnel(db: D1Database, site: Site, id: string) {
  const r = await db.prepare('DELETE FROM funnels WHERE id = ? AND site_id = ?').bind(id, site.id).run();
  return { ok: true, deleted: r.meta.changes > 0 };
}

// ---------- goals (they exist once something records them; these tidy up recorded ones)

const GOAL_NAME = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** Rename a goal everywhere: its recorded completions and the funnel steps that use it. */
export async function renameGoal(db: D1Database, site: Site, from: string, to: string) {
  const newName = GOAL_NAME(to);
  if (!newName) throw new UserError(400, 'new_name is required');
  const funnels = (await listFunnels(db, site)).filter((f) => f.steps.some((s) => s.type === 'goal' && s.value === from));
  const [events] = await db.batch([
    db.prepare("UPDATE events SET name = ? WHERE site_id = ? AND type = 'goal' AND name = ?").bind(newName, site.id, from),
    ...funnels.map((f) =>
      db
        .prepare('UPDATE funnels SET steps = ? WHERE id = ? AND site_id = ?')
        .bind(JSON.stringify(f.steps.map((s) => (s.type === 'goal' && s.value === from ? { ...s, value: newName } : s))), f.id, site.id),
    ),
  ]);
  if (!events.meta.changes && !funnels.length) throw new UserError(404, `no goal named "${from}"`);
  return { ok: true, renamed_completions: events.meta.changes, updated_funnels: funnels.map((f) => f.name) };
}

/** Delete every recorded completion of a goal. Visits keep their pageviews; their goal counts go down. */
export async function deleteGoal(db: D1Database, site: Site, name: string) {
  const match = "site_id = ? AND type = 'goal' AND name = ?";
  const [, events] = await db.batch([
    db
      .prepare(
        `UPDATE sessions SET goals = MAX(0, goals - (SELECT COUNT(*) FROM events e WHERE e.site_id = sessions.site_id AND e.session_id = sessions.id AND e.type = 'goal' AND e.name = ?))
         WHERE site_id = ? AND id IN (SELECT session_id FROM events WHERE ${match})`,
      )
      .bind(name, site.id, site.id, name),
    db.prepare(`DELETE FROM events WHERE ${match}`).bind(site.id, name),
  ]);
  if (!events.meta.changes) throw new UserError(404, `no goal named "${name}"`);
  const usedBy = (await listFunnels(db, site)).filter((f) => f.steps.some((s) => s.type === 'goal' && s.value === name)).map((f) => f.name);
  return { ok: true, deleted_completions: events.meta.changes, funnels_still_using_it: usedBy };
}
