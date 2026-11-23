import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { User } from '../src/worker/auth';
import type { Env } from '../src/worker/env';
import { pkceChallenge } from '../src/worker/lib/crypto';
import { DIMENSIONS, handleRpc, humanize, rateLimited, TOOLS } from '../src/worker/mcp';
import { allowedRedirect } from '../src/worker/oauth';

const env = {} as Env;
const user = { id: 'admin', admin: true, paid: true } as User;
const rpc = (method: string, params?: unknown) => handleRpc(env, user, { jsonrpc: '2.0', id: 1, method, params }, 'test');

describe('MCP protocol', () => {
  it('negotiates the protocol version and describes the server', async () => {
    const r: any = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(r.result.protocolVersion).toBe('2025-03-26');
    expect(r.result.serverInfo.name).toBe('minilytics');
    expect(r.result.capabilities.tools).toBeDefined();
    const unknown: any = await rpc('initialize', { protocolVersion: '1999-01-01' });
    expect(unknown.result.protocolVersion).toBe('2025-06-18');
  });
  it('lists read-only tools with valid schemas', async () => {
    const r: any = await rpc('tools/list');
    expect(r.result.tools.map((t: any) => t.name)).toContain('get_overview');
    for (const t of r.result.tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
  it('does not answer notifications and rejects unknown methods/tools', async () => {
    expect(await handleRpc(env, user, { jsonrpc: '2.0', method: 'notifications/initialized' }, 'test')).toBeNull();
    expect(((await rpc('nope')) as any).error.code).toBe(-32601);
    expect(((await rpc('tools/call', { name: 'drop_tables' })) as any).error.code).toBe(-32602);
    expect(((await handleRpc(env, user, { id: 1 } as any, 'test')) as any).error.code).toBe(-32600);
  });
  it('turns bad tool input into a readable tool error', async () => {
    const r: any = await rpc('tools/call', { name: 'get_overview', arguments: {} });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/list_sites/);
  });
  it('offers every dashboard breakdown dimension in the schema', () => {
    const schema = TOOLS.find((t) => t.name === 'get_breakdown')!.inputSchema as any;
    expect(schema.properties.dimension.enum).toEqual(DIMENSIONS);
  });
});

describe('results for AI', () => {
  it('uses major currency units, seconds and ISO dates, and drops secrets', () => {
    const out = humanize({ amount: 1999, spent: 500, avgDuration: 42_000, ts: 0, api_key: 'ml_x', lat: 1, props: '{"plan":"pro"}', name: null }, 2);
    expect(out).toEqual({ amount: 19.99, spent: 5, avgDuration: 42, ts: '1970-01-01T00:00:00.000Z', props: { plan: 'pro' } });
    expect(humanize({ revenue: 1500 }, 0)).toEqual({ revenue: 1500 }); // JPY has no minor unit
  });
});

describe('OAuth', () => {
  it('computes the PKCE S256 challenge (unpadded base64url SHA-256)', async () => {
    for (const v of ['x'.repeat(43), 'dBjftJeZ4CVP-1B0FzmJO58ZNh5yBqNGd8GhEnNoxXs', 'a~b.c_d-e'.repeat(10)]) {
      expect(await pkceChallenge(v)).toBe(createHash('sha256').update(v).digest('base64url'));
    }
  });
  it('only allows safe redirect URIs', () => {
    expect(allowedRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(allowedRedirect('http://localhost:6274/oauth/callback')).toBe(true);
    expect(allowedRedirect('http://127.0.0.1:33418/callback')).toBe(true);
    expect(allowedRedirect('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe(true);
    expect(allowedRedirect('http://evil.com/cb')).toBe(false);
    expect(allowedRedirect('javascript:alert(1)')).toBe(false);
    expect(allowedRedirect('https://ok.com/cb#frag')).toBe(false);
    expect(allowedRedirect('not a url')).toBe(false);
  });
});

describe('rate limit', () => {
  it('allows 150 calls per window per token', () => {
    const now = 1_000_000;
    for (let i = 0; i < 150; i++) expect(rateLimited('k', now)).toBe(false);
    expect(rateLimited('k', now)).toBe(true);
    expect(rateLimited('other', now)).toBe(false);
    expect(rateLimited('k', now + 5 * 60_000 + 1)).toBe(false);
  });
});
