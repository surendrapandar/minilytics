/**
 * Owner-managed agent tokens. The plaintext is shown once at creation; only a SHA-256 hash is stored.
 * Scopes are deliberately narrow for now: read-only analytics API access.
 */
export const AGENT_TOKEN_PREFIX = 'mla_';
export const AGENT_TOKEN_SCOPES = ['analytics:read', 'gsc:read'] as const;
export type AgentScope = (typeof AGENT_TOKEN_SCOPES)[number];
export const AGENT_TOKEN_DEFAULT_SCOPES: readonly AgentScope[] = ['analytics:read'];
export const AGENT_TOKEN_EXPIRY_DAYS = [7, 30, 90, 365] as const;
export const AGENT_TOKEN_DEFAULT_EXPIRY_DAYS = 90;

export interface AgentTokenRow {
  id: string;
  owner_id: string;
  owner_admin: number;
  name: string;
  token_hash: string;
  token_suffix: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

export type AgentTokenState = 'active' | 'expired' | 'revoked';

function base64url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateAgentToken(): string {
  return AGENT_TOKEN_PREFIX + base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Last characters kept for the token list, so owners can tell tokens apart without storing secrets. */
export function agentTokenSuffix(token: string): string {
  return token.slice(-6);
}

export function isAgentTokenShape(token: string): boolean {
  return token.startsWith(AGENT_TOKEN_PREFIX) && token.length > AGENT_TOKEN_PREFIX.length + 20 && /^[\w-]+$/.test(token);
}

/** Returns null for anything outside the allowed expiry choices. */
export function parseExpiryDays(value: unknown): number | null {
  if (value === undefined || value === null) return AGENT_TOKEN_DEFAULT_EXPIRY_DAYS;
  const days = Number(value);
  return (AGENT_TOKEN_EXPIRY_DAYS as readonly number[]).includes(days) ? days : null;
}

const ALLOWED_SCOPES = AGENT_TOKEN_SCOPES as readonly string[];

/**
 * Accepts an array or a comma-separated string. Unknown scopes, non-strings and
 * an empty selection return null so callers can answer 400 instead of silently
 * minting a weaker or broader token.
 */
export function parseAgentScopes(value: unknown): AgentScope[] | null {
  if (value === undefined || value === null) return [...AGENT_TOKEN_DEFAULT_SCOPES];
  const parts = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value) ? value : null;
  if (!parts) return null;
  const scopes: AgentScope[] = [];
  for (const part of parts) {
    if (typeof part !== 'string') return null;
    const scope = part.trim();
    if (!scope) continue;
    if (!ALLOWED_SCOPES.includes(scope)) return null;
    if (!scopes.includes(scope as AgentScope)) scopes.push(scope as AgentScope);
  }
  return scopes.length ? scopes : null;
}

/** Stored as a comma-separated list; older rows only contain `analytics:read`. */
export function agentTokenScopeList(row: Pick<AgentTokenRow, 'scopes'>): AgentScope[] {
  return String(row.scopes ?? '')
    .split(',')
    .map((scope) => scope.trim())
    .filter((scope): scope is AgentScope => ALLOWED_SCOPES.includes(scope));
}

export function hasAgentScope(row: Pick<AgentTokenRow, 'scopes'>, scope: AgentScope): boolean {
  return agentTokenScopeList(row).includes(scope);
}

export function agentTokenState(row: Pick<AgentTokenRow, 'expires_at' | 'revoked_at'>, now = Date.now()): AgentTokenState {
  if (row.revoked_at) return 'revoked';
  return row.expires_at <= now ? 'expired' : 'active';
}

/** Looks up an active token by hash. Expired and revoked tokens are rejected without revealing which. */
export async function findAgentToken(db: D1Database, token: string, now = Date.now()): Promise<AgentTokenRow | null> {
  if (!isAgentTokenShape(token)) return null;
  const row = await db.prepare('SELECT * FROM agent_tokens WHERE token_hash = ?').bind(await hashAgentToken(token)).first<AgentTokenRow>();
  if (!row || agentTokenState(row, now) !== 'active') return null;
  return row;
}
