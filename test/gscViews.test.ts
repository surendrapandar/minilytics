import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { Hono } from 'hono';
import { gscSearch } from '../src/worker/gsc';
import type { AppEnv, Site } from '../src/worker/env';

afterEach(() => vi.unstubAllGlobals());

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
    const queries: { dimensions: string[] }[] = [];
    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (String(input).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'test-token', expires_in: 3600 });
      }
      const body = JSON.parse(String(init?.body)) as { dimensions: string[] };
      queries.push({ dimensions: body.dimensions });
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

    queries.length = 0;
    const breakdown = await app.request('/gsc?view=breakdown&dimension=page' + range, undefined, env);
    expect(breakdown.status).toBe(200);
    const rows = await breakdown.json() as Record<string, unknown>;
    expect(rows).toHaveProperty('rows');
    expect(rows).not.toHaveProperty('totals');
    expect(rows).not.toHaveProperty('series');
    expect(queries).toEqual([{ dimensions: ['page'] }]);

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
});
