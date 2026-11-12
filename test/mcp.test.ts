import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/worker/auth';
import { sha256Base64Url } from '../src/worker/lib/crypto';
import { present, validate } from '../src/worker/mcp/schema';
import { TOOLS } from '../src/worker/mcp/tools';
import { redirectMatches, validRedirectUri } from '../src/worker/oauth';

describe('tool input validation', () => {
  const schema = TOOLS.find((t) => t.name === 'create_funnel')!.input;

  it('accepts good input', () => {
    const r = validate(schema, { site: 'abc', name: 'Signup', steps: [{ type: 'page', value: '/' }, { type: 'goal', value: 'signup' }] });
    expect(r.ok).toBe(true);
  });
  it('explains what is wrong', () => {
    expect(validate(schema, { site: 'abc', name: 'x', steps: [{ type: 'page', value: '/' }] })).toEqual({ ok: false, error: 'arguments.steps needs at least 2 items' });
    expect(validate(schema, { site: 'abc', name: 'x', steps: [{ type: 'url', value: '/' }, { type: 'page', value: '/' }] })).toMatchObject({
      ok: false,
      error: expect.stringContaining('arguments.steps[0].type must be one of: page, goal'),
    });
    expect(validate(schema, { name: 'x', steps: [] })).toMatchObject({ ok: false, error: 'arguments is missing "site"' });
    expect(validate(schema, { site: 'a', name: 'x', steps: [{ type: 'page', value: '/' }, { type: 'page', value: '/b' }], color: 'red' })).toMatchObject({ ok: false, error: expect.stringContaining('unknown field "color"') });
  });
  it('accepts numbers and booleans sent as strings', () => {
    const s = TOOLS.find((t) => t.name === 'get_breakdown')!.input;
    expect(validate(s, { site: 'a', dimension: 'source', limit: '5' })).toEqual({ ok: true, value: { site: 'a', dimension: 'source', limit: 5 } });
    expect(validate(s, { site: 'a', dimension: 'nope' }).ok).toBe(false);
    expect(validate(s, { site: 'a', dimension: 'source', limit: 0 }).ok).toBe(false);
  });
  it('treats optional nulls as not given and only allows known filters', () => {
    const s = TOOLS.find((t) => t.name === 'get_overview')!.input;
    expect(validate(s, { site: 'a', period: null })).toEqual({ ok: true, value: { site: 'a' } });
    expect(validate(s, { site: 'a', filters: { source: 'Google' } }).ok).toBe(true);
    expect(validate(s, { site: 'a', filters: { secret: 'x' } }).ok).toBe(false);
  });
  it('every tool has a unique name, a scope and an object schema', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.input.type).toBe('object');
      expect(['read', 'write']).toContain(t.scope);
      // Anything that changes data must not claim to be read-only.
      if (t.scope === 'write') expect(t.annotations.readOnlyHint).toBe(false);
    }
  });
});

describe('present', () => {
  it('converts minor units, timestamps and durations for agents', () => {
    const out = present({
      currency: 'USD',
      current: { revenue: 12345, revenuePerVisitor: 12.345, avgDuration: 61_400 },
      payments: [{ amount: 500, currency: 'JPY', ts: Date.UTC(2026, 0, 2) }],
      props: '{"plan":"pro"}',
    });
    expect(out).toEqual({
      currency: 'USD',
      current: { revenue: 123.45, revenuePerVisitor: 0.1235, avgDurationSeconds: 61 },
      payments: [{ amount: 500, currency: 'JPY', ts: '2026-01-02T00:00:00.000Z' }],
      props: { plan: 'pro' },
    });
  });
});

describe('oauth redirect uris', () => {
  it('allows https, loopback http and app schemes', () => {
    expect(validRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(validRedirectUri('http://localhost:33418/callback')).toBe(true);
    expect(validRedirectUri('http://127.0.0.1/cb')).toBe(true);
    expect(validRedirectUri('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe(true);
  });
  it('rejects remote http, script schemes and fragments', () => {
    expect(validRedirectUri('http://evil.com/cb')).toBe(false);
    expect(validRedirectUri('javascript:alert(1)')).toBe(false);
    expect(validRedirectUri('data:text/html,hi')).toBe(false);
    expect(validRedirectUri('https://ok.com/cb#frag')).toBe(false);
    expect(validRedirectUri('not a url')).toBe(false);
  });
  it('matches exactly, except any port on loopback', () => {
    const reg = ['https://app.example/cb', 'http://localhost:1234/callback'];
    expect(redirectMatches(reg, 'https://app.example/cb')).toBe(true);
    expect(redirectMatches(reg, 'https://app.example/cb2')).toBe(false);
    expect(redirectMatches(reg, 'http://localhost:9999/callback')).toBe(true);
    expect(redirectMatches(reg, 'http://localhost:9999/other')).toBe(false);
    expect(redirectMatches(reg, 'https://app.example:444/cb')).toBe(false);
  });
});

describe('sign-in redirects', () => {
  it('only goes to plain paths on this site', () => {
    expect(safeNext('/oauth/authorize?client_id=mlc_1&scope=read+write&state=a*b')).toBe('/oauth/authorize?client_id=mlc_1&scope=read+write&state=a*b');
    expect(safeNext('//evil.com')).toBeNull();
    expect(safeNext('/\t/evil.com')).toBeNull();
    expect(safeNext('/\\evil.com')).toBeNull();
    expect(safeNext('https://evil.com')).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });
});

describe('pkce', () => {
  it('matches the RFC 7636 S256 example', async () => {
    expect(await sha256Base64Url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    const v = 'x'.repeat(64);
    expect(await sha256Base64Url(v)).toBe(createHash('sha256').update(v).digest('base64url'));
  });
});
