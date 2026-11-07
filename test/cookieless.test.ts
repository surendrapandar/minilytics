import { beforeEach, describe, expect, it } from 'vitest';
import { cookielessIds, cookielessVisitorId, dailySalt, dayKey, ipKey, resetSaltCache } from '../src/worker/cookieless';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 3, 12);

interface FakeSession {
  id: string;
  visitor: string;
  lastSeen: number;
  exit?: string;
  browser?: string | null;
  os?: string | null;
  device?: string | null;
  country?: string | null;
  city?: string | null;
}

const isCookielessVid = (v: string) => v.startsWith('c') && v.length === 32;

/** Just enough of D1 for the salts table and the session lookups in cookieless.ts. */
function fakeDb(sessions: FakeSession[] = []) {
  const salts = new Map<string, string>();
  const rows = (sql: string, args: unknown[]) => {
    if (sql.includes('AND id = ?')) {
      const [, id, since] = args as [string, string, number];
      return sessions
        .filter((s) => s.id === id && s.lastSeen > since && isCookielessVid(s.visitor))
        .map((s) => ({ visitor_id: s.visitor }));
    }
    if (sql.includes('exit_page = ?')) {
      const [, path, since, browser, os, device, country, city] = args as [string, string, number, ...(string | null)[]];
      return sessions
        .filter(
          (s) =>
            s.exit === path && s.lastSeen > since && isCookielessVid(s.visitor) &&
            (s.browser ?? null) === browser && (s.os ?? null) === os && (s.device ?? null) === device &&
            (s.country ?? null) === country && (s.city ?? null) === city,
        )
        .slice(0, 2)
        .map((s) => ({ id: s.id, visitor_id: s.visitor }));
    }
    const [, vid, since] = args as [string, string, number];
    return sessions.filter((s) => s.visitor === vid && s.lastSeen > since).map((s) => ({ id: s.id }));
  };
  const stmt = (sql: string, args: unknown[] = []) => ({
    sql,
    args,
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => rows(sql, args)[0] ?? null,
    all: async () => ({ results: rows(sql, args) }),
  });
  const db = {
    salts,
    sessions,
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
  return db as unknown as D1Database & { salts: Map<string, string>; sessions: FakeSession[] };
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
  it('stay the same while the browser rotates its IPv6 address within the /64', async () => {
    const a = await cookielessVisitorId('s1', 'site', '2a01:cb1d:8e0:5600:1c2f:3b4a:9d1e:77f0', 'UA');
    expect(await cookielessVisitorId('s1', 'site', '2a01:cb1d:8e0:5600:a8c1:4f02:e3b7:1d9c', 'UA')).toBe(a);
    expect(await cookielessVisitorId('s1', 'site', '2a01:cb1d:8e0:5601:1c2f:3b4a:9d1e:77f0', 'UA')).not.toBe(a);
  });
});

describe('ipKey', () => {
  it('keeps IPv4 addresses whole', () => {
    expect(ipKey('81.250.12.7')).toBe('81.250.12.7');
    expect(ipKey('::ffff:81.250.12.7')).toBe('81.250.12.7');
  });
  it('reduces IPv6 to its /64 prefix, however it is written', () => {
    expect(ipKey('2a01:cb1d:08e0:5600:1c2f:3b4a:9d1e:77f0')).toBe('2a01:cb1d:8e0:5600::/64');
    expect(ipKey('2A01:CB1D:8E0:5600::1')).toBe('2a01:cb1d:8e0:5600::/64');
    expect(ipKey('2a01:cb1d::1')).toBe('2a01:cb1d:0:0::/64');
    expect(ipKey('fe80::1%en0')).toBe('fe80:0:0:0::/64');
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

    const db = fakeDb([{ visitor: vid, id: 'sess-1', lastSeen: T0 - 10 * 60_000 }]);
    db.salts.set(dayKey(T0), probe.salts.get(dayKey(T0))!);
    expect(await cookielessIds(db, 'site', '1.2.3.4', 'UA', T0)).toEqual({ vid, sid: 'sess-1' });

    const later = await cookielessIds(db, 'site', '1.2.3.4', 'UA', T0 + 25 * 60_000);
    expect(later.vid).toBe(vid);
    expect(later.sid).not.toBe('sess-1');
  });
});

describe('keeping a visit together when the IP changes', () => {
  const MAC = { browser: 'Chrome', os: 'Mac OS', device: 'Desktop', country: 'FR', city: 'Aix-les-Bains' };
  const left = (over: Partial<FakeSession> = {}): FakeSession => ({
    id: 'sess-1',
    visitor: 'c' + 'a'.repeat(31),
    lastSeen: T0 - 60_000,
    exit: '/guides',
    ...MAC,
    ...over,
  });

  it('continues the session the tracker already knows for this page', async () => {
    const db = fakeDb([left()]);
    expect(await cookielessIds(db, 'site', '9.9.9.9', 'UA', T0, { sid: 'sess-1' })).toEqual({ vid: left().visitor, sid: 'sess-1' });
  });

  it('ignores a known session id that is closed, unknown, or from cookie mode', async () => {
    const stale = await cookielessIds(fakeDb([left({ lastSeen: T0 - 31 * 60_000 })]), 'site', '9.9.9.9', 'UA', T0, { sid: 'sess-1' });
    expect(stale.sid).not.toBe('sess-1');
    resetSaltCache();
    const unknown = await cookielessIds(fakeDb([left()]), 'site', '9.9.9.9', 'UA', T0, { sid: 'sess-2' });
    expect(unknown.sid).not.toBe('sess-1');
    resetSaltCache();
    const cookie = await cookielessIds(fakeDb([left({ visitor: '0b5f3c1e-7d2a-4f6b-9c8e-1a2b3c4d5e6f' })]), 'site', '9.9.9.9', 'UA', T0, { sid: 'sess-1' });
    expect(cookie.sid).not.toBe('sess-1');
    expect(cookie.vid).toMatch(/^c[0-9a-f]{31}$/);
  });

  it('continues the one session that just left the referring page with the same browser and location', async () => {
    const db = fakeDb([left()]);
    expect(await cookielessIds(db, 'site', '9.9.9.9', 'UA', T0, { from: { path: '/guides', ...MAC } })).toEqual({
      vid: left().visitor,
      sid: 'sess-1',
    });
  });

  it('prefers the visitor\'s own open session over a referrer match', async () => {
    const probe = fakeDb();
    const { vid } = await cookielessIds(probe, 'site', '9.9.9.9', 'UA', T0);
    resetSaltCache();
    const db = fakeDb([left(), { id: 'own', visitor: vid, lastSeen: T0 - 5 * 60_000 }]);
    db.salts.set(dayKey(T0), probe.salts.get(dayKey(T0))!);
    expect(await cookielessIds(db, 'site', '9.9.9.9', 'UA', T0, { from: { path: '/guides', ...MAC } })).toEqual({ vid, sid: 'own' });
  });

  it('starts a new visit when the referring page, browser or location differ, or the session is closed', async () => {
    const cases: [FakeSession, string, typeof MAC][] = [
      [left(), '/tarifs', MAC],
      [left(), '/guides', { ...MAC, browser: 'Safari' }],
      [left(), '/guides', { ...MAC, city: 'Chambéry' }],
      [left({ lastSeen: T0 - 31 * 60_000 }), '/guides', MAC],
    ];
    for (const [session, path, ua] of cases) {
      resetSaltCache();
      const ids = await cookielessIds(fakeDb([session]), 'site', '9.9.9.9', 'UA', T0, { from: { path, ...ua } });
      expect(ids.sid).not.toBe('sess-1');
    }
  });

  it('never merges when several sessions could match', async () => {
    const db = fakeDb([left(), left({ id: 'sess-2', visitor: 'c' + 'b'.repeat(31) })]);
    const ids = await cookielessIds(db, 'site', '9.9.9.9', 'UA', T0, { from: { path: '/guides', ...MAC } });
    expect(['sess-1', 'sess-2']).not.toContain(ids.sid);
  });
});
