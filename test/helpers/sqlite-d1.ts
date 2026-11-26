import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export type Plan = { sql: string; plan: string[] };

/** The real schema, applied in migration order to an in-memory SQLite. Needs Node 22.5+ for node:sqlite. */
export function schemaDb() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(f, dir), 'utf8'));
  return db;
}

/** A minimal D1 stand-in over node:sqlite. Pass `plans` to record the query plan of every statement run. */
export function d1(db: DatabaseSync, plans?: Plan[]): D1Database {
  const stmt = (sql: string, params: any[] = []) => {
    const exec = () => {
      plans?.push({ sql, plan: db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => String(r.detail)) });
      return db.prepare(sql).all(...params);
    };
    return {
      bind: (...p: any[]) => stmt(sql, p.map((v) => (v === undefined ? null : v))),
      all: async () => ({ results: exec() }),
      first: async () => exec()[0] ?? null,
      run: async () => ({ results: exec(), meta: {} }),
      _all: () => ({ results: exec() }),
    };
  };
  return { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => list.map((s) => s._all()) } as unknown as D1Database;
}
