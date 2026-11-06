import { describe, expect, it } from 'vitest';
import type { Site } from '../src/worker/env';
import { handleRpc } from '../src/worker/mcp';

const site: Site = {
  id: 's1',
  name: 'Example',
  domain: 'example.com',
  timezone: 'UTC',
  currency: 'USD',
  api_key: 'ml_x',
  dodo_webhook_secret: null,
  created_at: Date.UTC(2026, 0, 1),
};
// These calls never touch the database.
const db = {} as D1Database;
const rpc = (method: string, params?: Record<string, unknown>, id: number | undefined = 1) =>
  handleRpc({ jsonrpc: '2.0', id, method, params }, db, site) as Promise<any>;

describe('mcp', () => {
  it('negotiates the protocol version', async () => {
    expect((await rpc('initialize', { protocolVersion: '2025-03-26' })).result.protocolVersion).toBe('2025-03-26');
    const r = (await rpc('initialize', { protocolVersion: '1999-01-01' })).result;
    expect(r.protocolVersion).toBe('2025-06-18');
    expect(r.capabilities).toHaveProperty('tools');
    expect(r.instructions).toContain('example.com');
  });

  it('lists read-only tools with schemas', async () => {
    const { tools } = (await rpc('tools/list')).result;
    expect(tools.map((t: any) => t.name)).toEqual([
      'get_site',
      'get_overview',
      'get_breakdown',
      'get_realtime',
      'get_customers',
      'list_funnels',
      'get_funnel',
      'get_ai_crawlers',
    ]);
    for (const t of tools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.annotations.readOnlyHint).toBe(true);
    }
  });

  it('answers get_site without the database', async () => {
    const r = (await rpc('tools/call', { name: 'get_site', arguments: {} })).result;
    expect(r.structuredContent).toMatchObject({ domain: 'example.com', currency: 'USD' });
    expect(JSON.parse(r.content[0].text).timezone).toBe('UTC');
  });

  it('reports bad input as a tool error, unknown tools and methods as protocol errors', async () => {
    const bad = (await rpc('tools/call', { name: 'get_breakdown', arguments: { dimension: 'nope' } })).result;
    expect(bad.isError).toBe(true);
    expect((await rpc('tools/call', { name: 'drop_tables' })).error.code).toBe(-32602);
    expect((await rpc('resources/list')).error.code).toBe(-32601);
  });

  it('does not answer notifications', async () => {
    expect(await rpc('notifications/initialized', undefined, undefined)).toBeNull();
  });
});
