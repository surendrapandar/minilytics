import { describe, expect, it } from 'vitest';
import {
  AGENT_TOKEN_DEFAULT_EXPIRY_DAYS,
  AGENT_TOKEN_DEFAULT_SCOPES,
  AGENT_TOKEN_PREFIX,
  agentTokenScopeList,
  agentTokenState,
  agentTokenSuffix,
  generateAgentToken,
  hasAgentScope,
  hashAgentToken,
  isAgentTokenShape,
  parseAgentScopes,
  parseExpiryDays,
  type AgentTokenRow,
} from '../src/worker/lib/agent-tokens';

const row = (patch: Partial<AgentTokenRow> = {}): AgentTokenRow => ({
  id: 'tok_1',
  owner_id: 'admin',
  owner_admin: 1,
  name: 'Claude Code',
  token_hash: '0'.repeat(64),
  token_suffix: 'abcdef',
  scopes: 'analytics:read',
  created_at: 1_000,
  expires_at: 2_000,
  last_used_at: null,
  revoked_at: null,
  ...patch,
});

describe('agent token generation', () => {
  it('generates unique, prefixed, URL-safe tokens', () => {
    const a = generateAgentToken();
    const b = generateAgentToken();
    expect(a.startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
    expect(isAgentTokenShape(a)).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(isAgentTokenShape('')).toBe(false);
    expect(isAgentTokenShape('mla_short')).toBe(false);
    expect(isAgentTokenShape(`mla_${'a'.repeat(40)}?`)).toBe(false);
  });

  it('hashes deterministically to a sha-256 hex string', async () => {
    const token = generateAgentToken();
    const first = await hashAgentToken(token);
    expect(first).toBe(await hashAgentToken(token));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(await hashAgentToken(generateAgentToken()));
  });

  it('keeps only the last six characters as the suffix', () => {
    expect(agentTokenSuffix('mla_1234567890abcdef')).toBe('abcdef');
  });
});

describe('agent token expiry', () => {
  it('accepts the offered choices and defaults only when absent', () => {
    expect(parseExpiryDays(undefined)).toBe(AGENT_TOKEN_DEFAULT_EXPIRY_DAYS);
    expect(parseExpiryDays(null)).toBe(AGENT_TOKEN_DEFAULT_EXPIRY_DAYS);
    expect(parseExpiryDays(7)).toBe(7);
    expect(parseExpiryDays('30')).toBe(30);
    expect(parseExpiryDays(365)).toBe(365);
  });

  it('rejects anything else', () => {
    expect(parseExpiryDays(1)).toBeNull();
    expect(parseExpiryDays(1000)).toBeNull();
    expect(parseExpiryDays('soon')).toBeNull();
  });
});

describe('agent token scopes', () => {
  it('defaults to analytics:read when no scopes are sent', () => {
    expect(parseAgentScopes(undefined)).toEqual([...AGENT_TOKEN_DEFAULT_SCOPES]);
    expect(parseAgentScopes(null)).toEqual(['analytics:read']);
  });

  it('accepts arrays and comma-separated strings, deduplicated', () => {
    expect(parseAgentScopes(['gsc:read', 'analytics:read'])).toEqual(['gsc:read', 'analytics:read']);
    expect(parseAgentScopes('analytics:read,gsc:read')).toEqual(['analytics:read', 'gsc:read']);
    expect(parseAgentScopes(['gsc:read', 'gsc:read'])).toEqual(['gsc:read']);
    expect(parseAgentScopes([' gsc:read '])).toEqual(['gsc:read']);
  });

  it('rejects unknown, empty and non-string scopes', () => {
    expect(parseAgentScopes('analytics:write')).toBeNull();
    expect(parseAgentScopes(['analytics:read', 'admin'])).toBeNull();
    expect(parseAgentScopes([])).toBeNull();
    expect(parseAgentScopes('')).toBeNull();
    expect(parseAgentScopes(42)).toBeNull();
    expect(parseAgentScopes([42])).toBeNull();
  });

  it('reads legacy rows and gates each scope independently', () => {
    expect(agentTokenScopeList(row({ scopes: 'analytics:read' }))).toEqual(['analytics:read']);
    expect(agentTokenScopeList(row({ scopes: 'analytics:read,gsc:read' }))).toEqual(['analytics:read', 'gsc:read']);
    expect(hasAgentScope(row(), 'gsc:read')).toBe(false);
    expect(hasAgentScope(row({ scopes: 'gsc:read' }), 'gsc:read')).toBe(true);
    expect(hasAgentScope(row({ scopes: 'gsc:read' }), 'analytics:read')).toBe(false);
  });
});

describe('agent token state', () => {
  it('is active until the expiry instant', () => {
    expect(agentTokenState(row(), 1_999)).toBe('active');
    expect(agentTokenState(row(), 2_000)).toBe('expired');
  });

  it('reports revocation before expiry', () => {
    expect(agentTokenState(row({ revoked_at: 1_500 }), 1_600)).toBe('revoked');
  });
});
