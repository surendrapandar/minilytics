import { beforeEach, describe, expect, it } from 'vitest';
import { cookielessIds, cookielessVisitorId, dailySalt, dayKey, resetSaltCache } from '../src/worker/cookieless';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 3, 12);

/** Just enough of D1 for the salts table and the open-session lookup. */
function fakeDb(openSession: { visitor: string; id: string; lastSeen: number } | null = null) {
  const salts = new Map<string, string>();
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => {
      const [, vid, since] = args as [string, string, number];
      return openSession && openSession.visitor === vid && openSession.lastSeen > since ? { id: openSession.id } : null;
    },
  });
  const db = {
    salts,
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: ReturnType<typeof stmt>[]) =>
      stmts.map(({ sql, args }) => {
        if (sql.startsWith('INSERT')) {
          if (!salts.has(args[0] as string)) salts.set(args[0] as string, args[1] as string);
        } else if (sql.startsWith('DELETE')) {
          for (const d of salts.keys()) if (d < (args[0] as string)) salts.delete(d);
        } else {
          const salt = salts.get(args[0] as string);
          return { results: salt ? [{ salt }] : [] };
        }
        return { results: [] };
      }),
  };
  return db as unknown as D1Database & { salts: Map<string, string> };
}

beforeEach(resetSaltCache);

describe('cookieless visitor ids', () => {
  it('are stable for the same salt, site, IP and browser', async () => {
    const a = await cookielessVisitorId('s1', 'site', '1.2.3.4', 'UA');
    expect(a).toBe(await cookielessVisitorId('s1', 'site', '1.2.3.4', 'UA'));
    expect(a).toMatch(/^c[0-9a-f]{31}$/);
  });
  it('change with the salt, the site, the IP or the browser', async () => {
    const a = await cookielessVisitorId('s1', 'site', '1.2.3.4', 'UA');
    expect(await cookielessVisitorId('s2', 'site', '1.2.3.4', 'UA')).not.toBe(a);
    expect(await cookielessVisitorId('s1', 'other', '1.2.3.4', 'UA')).not.toBe(a);
    expect(await cookielessVisitorId('s1', 'site', '1.2.3.5', 'UA')).not.toBe(a);
    expect(await cookielessVisitorId('s1', 'site', '1.2.3.4', 'UA2')).not.toBe(a);
  });
});

describe('daily salt', () => {
  it('is kept for the day, then replaced and the old one deleted', async () => {
    const db = fakeDb();
    const today = await dailySalt(db, T0);
    expect(await dailySalt(db, T0 + 3_600_000)).toBe(today);
    resetSaltCache(); // another isolate reads the same row
    expect(await dailySalt(db, T0)).toBe(today);

    const tomorrow = await dailySalt(db, T0 + DAY);
    expect(tomorrow).not.toBe(today);
    expect([...db.salts.keys()]).toEqual([dayKey(T0 + DAY)]);
  });
});

describe('cookieless sessions', () => {
  it('continue an open session and start a new one after 30 minutes idle', async () => {
    const probe = fakeDb();
    const { vid } = await cookielessIds(probe, 'site', '1.2.3.4', 'UA', T0);
    resetSaltCache();

    const db = fakeDb({ visitor: vid, id: 'sess-1', lastSeen: T0 - 10 * 60_000 });
    db.salts.set(dayKey(T0), probe.salts.get(dayKey(T0))!);
    expect(await cookielessIds(db, 'site', '1.2.3.4', 'UA', T0)).toEqual({ vid, sid: 'sess-1' });

    const later = await cookielessIds(db, 'site', '1.2.3.4', 'UA', T0 + 25 * 60_000);
    expect(later.vid).toBe(vid);
    expect(later.sid).not.toBe('sess-1');
  });
});
