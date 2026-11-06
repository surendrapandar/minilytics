import { describe, expect, it } from 'vitest';
import {
  AGENT_TOKEN_DEFAULT_EXPIRY_DAYS,
  AGENT_TOKEN_PREFIX,
  agentTokenState,
  agentTokenSuffix,
  generateAgentToken,
  hashAgentToken,
  isAgentTokenShape,
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

describe('agent token state', () => {
  it('is active until the expiry instant', () => {
    expect(agentTokenState(row(), 1_999)).toBe('active');
    expect(agentTokenState(row(), 2_000)).toBe('expired');
  });

  it('reports revocation before expiry', () => {
    expect(agentTokenState(row({ revoked_at: 1_500 }), 1_600)).toBe('revoked');
  });
});
