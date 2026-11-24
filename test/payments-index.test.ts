import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { Site } from '../src/worker/env';
import { breakdown, parseFilters, realtime, visitorProfile, visitors } from '../src/worker/stats';

/**
 * Regression for the D1 free-tier outage of 2026-11-24: queries that join payments by visitor
 * rescanned the payments table for every visitor row, so rows read grew with pageviews × payments
 * (73k rows per dashboard load on a site with under 2k events). Every per-visitor payments lookup
 * must be an index search on (site_id, visitor_id). Needs Node 22.5+ for node:sqlite.
 */

type Plan = { sql: string; plan: string[] };

/** The real schema, applied in migration order to an in-memory SQLite. */
function schemaDb() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  return db;
}

/** A minimal D1 stand-in over node:sqlite that records the query plan of every statement run. */
function d1(db: DatabaseSync, plans: Plan[]): D1Database {
  const stmt = (sql: string, params: any[] = []) => {
    const exec = () => {
      plans.push({ sql, plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => String(r.detail)) });
      return db.prepare(sql).all(...params);
    };
    return {
      bind: (...p: any[]) => stmt(sql, p),
      all: async () => ({ results: exec() }),
      first: async () => exec()[0] ?? null,
      run: async () => ({ results: exec() }),
      _all: () => ({ results: exec() }),
    };
  };
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => list.map((s) => s._all()) } as unknown as D1Database;
}

/** For each statement that looks payments up by visitor, the plan steps that read payments (under its alias). */
function paymentsLookups(plans: Plan[]) {
  return plans.flatMap(({ sql, plan }) => {
    const m = sql.match(/\b(?:FROM|JOIN)\s+payments(?:\s+(?!WHERE\b|ON\b)(\w+))?/i);
    if (!m) return [];
    const alias = m[1] ?? 'payments';
    // A lookup by visitor filters payments on visitor_id; listing recent payments merely selects it.
    const byVisitor = m[1] ? new RegExp(`\\b${alias}\\.visitor_id\\s*=`) : /\bvisitor_id\s*=\s*\?/;
    if (!byVisitor.test(sql)) return [];
    return plan.filter((d) => new RegExp(`^(SCAN|SEARCH) ${alias}\\b`).test(d)).map((step) => ({ alias, step }));
  });
}

const site = { id: 'site1', domain: 'example.com', timezone: 'UTC', currency: 'USD' } as Site;
const ctx = (db: D1Database) => ({ db, site, range: { from: 0, to: Date.now(), granularity: 'day' as const }, filters: parseFilters(undefined), offset: 0 });

describe('payments are looked up by visitor through an index', () => {
  it.each([
    ['revenue by page', (db: D1Database) => breakdown(ctx(db), 'page')],
    ['revenue by goal', (db: D1Database) => breakdown(ctx(db), 'goal')],
    ['visitor list with total spent', (db: D1Database) => visitors(ctx(db))],
    ['realtime visitors with total spent', (db: D1Database) => realtime(db, site)],
    ['visitor profile', (db: D1Database) => visitorProfile(db, site, 'visitor1')],
  ])('%s', async (_name, run) => {
    const plans: Plan[] = [];
    await run(d1(schemaDb(), plans));
    const steps = paymentsLookups(plans);
    expect(steps.length).toBeGreaterThan(0);
    for (const { alias, step } of steps) expect(step).toMatch(new RegExp(`^SEARCH ${alias} USING (COVERING )?INDEX \\w+ \\(site_id=\\? AND visitor_id=\\?`));
  });
});
