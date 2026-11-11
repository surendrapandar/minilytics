import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import { gscSearch } from '../src/worker/gsc';
import type { AppEnv, Site } from '../src/worker/env';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Search Console independent overview and breakdown responses', () => {
  it('only fetches GSC row data when changing breakdown dimensions', async () => {
    // Real ephemeral signing key exercises the existing service-account auth
    // without needing a Google connection or exposing production secrets.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const credentials = JSON.stringify({
      type: 'service_account',
      client_email: 'test-views@test-project.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      private_key_id: 'gsc-view-test',
    });
    const queries: { dimensions: string[]; dataState: string }[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'test-token', expires_in: 3600 });
      }
      const body = JSON.parse(String(init?.body)) as { dimensions: string[]; dataState: string };
      queries.push({ dimensions: body.dimensions, dataState: body.dataState });
      const keys = body.dimensions[0] === 'date' ? ['2026-10-01'] : ['example query'];
      return Response.json({ rows: [{
        keys, clicks: 10, impressions: 100, ctr: 0.1, position: 7.4,
      }] });
    });
    vi.stubGlobal('fetch', mockFetch);

    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', { admin: true } as AppEnv['Variables']['user']);
      c.set('site', {
        id: 'test-site', created_at: Date.parse('2025-01-01T00:00:00Z'),
        gsc_property: 'sc-domain:example.com',
      } as Site);
      await next();
    });
    app.get('/gsc', gscSearch);
    const env = { GSC_SERVICE_ACCOUNT_JSON: credentials } as AppEnv['Bindings'];
    const range = '&period=custom&from=2026-10-01&to=2026-10-03';

    const overview = await app.request('/gsc?view=overview' + range, undefined, env);
    expect(overview.status).toBe(200);
    const summary = await overview.json() as Record<string, unknown>;
    expect(summary).toHaveProperty('totals');
    expect(summary).toHaveProperty('series');
    expect(summary).not.toHaveProperty('rows');
    expect(queries).toHaveLength(3);
    expect(queries.map((request) => request.dimensions)).toEqual([['date'], [], []]);
    expect(queries.map((request) => request.dataState)).toEqual(['all', 'all', 'all']);

    queries.length = 0;
    const breakdown = await app.request('/gsc?view=breakdown&dimension=page' + range, undefined, env);
    expect(breakdown.status).toBe(200);
    const rows = await breakdown.json() as Record<string, unknown>;
    expect(rows).toHaveProperty('rows');
    expect(rows).not.toHaveProperty('totals');
    expect(rows).not.toHaveProperty('series');
    expect(queries).toEqual([{ dimensions: ['page'], dataState: 'all' }]);

    queries.length = 0;
    const legacy = await app.request('/gsc?dimension=query' + range, undefined, env);
    expect(legacy.status).toBe(200);
    const combined = await legacy.json() as Record<string, unknown>;
    expect(combined).toHaveProperty('totals');
    expect(combined).toHaveProperty('rows');
    expect(queries).toHaveLength(4);

    queries.length = 0;
    const invalid = await app.request('/gsc?view=unknown' + range, undefined, env);
    expect(invalid.status).toBe(400);
    expect(queries).toHaveLength(0);
  });
  it('serves the last 24 hours with hourly_all and keeps breakdown in the same snapshot', async () => {
    const now = Date.parse('2026-11-11T12:20:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 1024 });
    const credentials = JSON.stringify({
      type: 'service_account', client_email: 'hourly@test-hourly.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      private_key_id: 'gsc-hourly-test',
    });
    const queries: { dimensions: string[]; dataState: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'test-token', expires_in: 3600 });
      }
      const body = JSON.parse(String(init?.body)) as { dimensions: string[]; dataState: string };
      queries.push(body);
      if (body.dimensions.length === 1) {
        return Response.json({
          rows: [
            { keys: ['2026-11-10T00:00:00-08:00'], clicks: 1, impressions: 10, ctr: .1, position: 8 },
            { keys: ['2026-11-11T00:00:00-08:00'], clicks: 3, impressions: 30, ctr: .1, position: 5 },
          ],
          metadata: { first_incomplete_hour: '2026-11-11T00:00:00-08:00' },
        });
      }
      return Response.json({ rows: [
        { keys: ['2026-11-10T00:00:00-08:00', '/outside'], clicks: 1, impressions: 10, ctr: .1, position: 8 },
        { keys: ['2026-11-11T00:00:00-08:00', '/inside'], clicks: 3, impressions: 30, ctr: .1, position: 5 },
      ] });
    }));
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('user', { admin: true } as AppEnv['Variables']['user']);
      c.set('site', { id: 'test-site', created_at: Date.parse('2025-01-01T00:00:00Z'),
        gsc_property: 'sc-domain:example.com' } as Site);
      await next();
    });
    app.get('/gsc', gscSearch);
    const env = { GSC_SERVICE_ACCOUNT_JSON: credentials } as AppEnv['Bindings'];
    const overviewRes = await app.request('/gsc?view=overview&period=24h', undefined, env);
    expect(overviewRes.status).toBe(200);
    const overview = await overviewRes.json() as Record<string, any>;
    expect(overview.granularity).toBe('hour');
    expect(overview.series).toHaveLength(24);
    expect(overview.totals).toMatchObject({ clicks: 3, impressions: 30, position: 5 });
    expect(overview.previous).toMatchObject({ clicks: 1, impressions: 10 });
    expect(overview.incompleteFrom).toBe('2026-11-11T00:00:00-08:00');
    expect(queries[0]).toMatchObject({ dimensions: ['hour'], dataState: 'hourly_all' });

    const breakdownRes = await app.request(
      '/gsc?view=breakdown&period=24h&dimension=page&asOf=' + overview.asOf, undefined, env,
    );
    expect(breakdownRes.status).toBe(200);
    const breakdown = await breakdownRes.json() as Record<string, any>;
    expect(breakdown.rows).toEqual([{ label: '/inside', clicks: 3, impressions: 30, ctr: .1, position: 5 }]);
    expect(queries[1]).toMatchObject({ dimensions: ['hour', 'page'], dataState: 'hourly_all' });
    expect(breakdown.startMs).toBe(overview.startMs);
    expect(breakdown.endMs).toBe(overview.endMs);
  });

});
