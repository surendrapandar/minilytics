import { describe, expect, it } from 'vitest';
import app from '../src/worker/index';

/** D1 as it behaves once the account's free daily row-read limit is used up: every query throws. */
const blockedDb = {
  prepare() {
    throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue.");
  },
  batch() {
    throw new Error('D1_ERROR: unreachable');
  },
};

const env = { DB: blockedDb, ASSETS: { fetch: async () => new Response('') } } as any;
const ctx = { waitUntil() {}, passThroughOnException() {} } as any;

const event = () =>
  new Request('https://analytics.example.com/api/event', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15' },
    body: JSON.stringify({ w: 'site12345', t: 'pageview', u: 'https://example.com/', vid: 'visitor123', sid: 'session123' }),
  });

describe('when the database daily limit is reached', () => {
  it('answers 503 with an explanation instead of a bare 500', async () => {
    const res = await app.fetch(event(), env, ctx);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/daily .*limit.*00:00 UTC/i);
  });
});

describe('any other unexpected failure', () => {
  it('answers 500 with a JSON error the dashboard can show', async () => {
    const res = await app.fetch(event(), { ...env, DB: { prepare() { throw new Error('boom'); } } }, ctx);
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  });
});
