import type { Context } from 'hono';
import type { AppEnv, Site } from './env';
import { forgetSite } from './env';
import type { GeneratedBatch } from '../shared/importDatafast';

const D1_BATCH_LIMIT = 100;

export async function handleImportBatch(c: Context<AppEnv>) {
  const site = c.get('site');
  const body = await c.req.json<GeneratedBatch>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);

  const { visitors = [], sessions = [], events = [], payments = [], earliestTs } = body;
  const db = c.env.DB;
  const stmts: D1PreparedStatement[] = [];

  // 1. Visitors
  for (const v of visitors) {
    stmts.push(
      db.prepare(
        'INSERT OR IGNORE INTO visitors (site_id, id, first_seen, name, email) VALUES (?, ?, ?, ?, ?)',
      ).bind(site.id, v.id, v.first_seen, v.name ?? null, v.email ?? null),
    );
  }

  // 2. Sessions
  for (const s of sessions) {
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO sessions (
          site_id, id, visitor_id, started_at, last_seen_at, duration, pageviews, goals,
          hostname, entry_page, exit_page, referrer, referrer_domain, source, channel,
          country, city, browser, os, device
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        site.id,
        s.id,
        s.visitor_id,
        s.started_at,
        s.last_seen_at,
        s.duration,
        s.pageviews,
        s.goals,
        s.hostname || site.domain,
        s.entry_page,
        s.exit_page,
        s.referrer ?? null,
        s.referrer_domain ?? null,
        s.source,
        s.channel,
        s.country ?? null,
        s.city ?? null,
        s.browser ?? null,
        s.os ?? null,
        s.device ?? null,
      ),
    );
  }

  // 3. Events
  for (const e of events) {
    stmts.push(
      db.prepare(
        'INSERT INTO events (site_id, session_id, visitor_id, ts, type, name, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(site.id, e.session_id, e.visitor_id, e.ts, e.type, e.name ?? null, e.path),
    );
  }

  // 4. Payments
  for (const p of payments) {
    stmts.push(
      db.prepare(
        `INSERT OR REPLACE INTO payments (
          id, site_id, provider, ts, amount, kind, currency, visitor_id, session_id, customer_id, email, name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        p.id,
        site.id,
        p.provider || 'datafast',
        p.ts,
        p.amount,
        p.kind || 'payment',
        p.currency || site.currency,
        p.visitor_id ?? null,
        p.session_id ?? null,
        p.customer_id ?? null,
        p.email ?? null,
        p.name ?? null,
      ),
    );
  }

  // 5. Update site.created_at if earliest imported data is older
  if (earliestTs && earliestTs < site.created_at) {
    stmts.push(
      db.prepare('UPDATE sites SET created_at = ? WHERE id = ?').bind(earliestTs, site.id),
    );
    forgetSite(site.id);
  }

  // Execute in chunks under D1 limit
  for (let i = 0; i < stmts.length; i += D1_BATCH_LIMIT) {
    const chunk = stmts.slice(i, i + D1_BATCH_LIMIT);
    await db.batch(chunk);
  }

  return c.json({
    ok: true,
    inserted: {
      visitors: visitors.length,
      sessions: sessions.length,
      events: events.length,
      payments: payments.length,
    },
  });
}

/** Clear only imported DataFast data without deleting real tracking data */
export async function handleClearDatafastImport(c: Context<AppEnv>) {
  const site = c.get('site');
  const db = c.env.DB;

  await db.batch([
    db.prepare("DELETE FROM events WHERE site_id = ? AND session_id LIKE 's_df_%'").bind(site.id),
    db.prepare("DELETE FROM payments WHERE site_id = ? AND (provider = 'datafast' OR id LIKE 'pay_df_%')").bind(site.id),
    db.prepare("DELETE FROM sessions WHERE site_id = ? AND id LIKE 's_df_%'").bind(site.id),
    db.prepare("DELETE FROM visitors WHERE site_id = ? AND id LIKE 'v_df_%'").bind(site.id),
  ]);

  return c.json({ ok: true });
}
