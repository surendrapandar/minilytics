import type { Context } from 'hono';
import { subjectOf, userFromSubject, type User } from './auth';
import type { AppEnv, Env } from './env';
import { randomId, sha256Hex } from './lib/crypto';

/**
 * Read-only API tokens for AI assistants (the MCP server at /mcp).
 *  - personal: made in the dashboard and pasted into Claude Code, Cursor…; never expire, revoke any time.
 *  - access / refresh: issued by the OAuth flow when an app such as Claude.ai or ChatGPT connects.
 * Only a SHA-256 hash is stored, so a database leak doesn't leak working tokens.
 */
export type TokenKind = 'personal' | 'access' | 'refresh';

export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 90 * 86_400_000;
const PREFIX: Record<TokenKind, string> = { personal: 'mlp_', access: 'mla_', refresh: 'mlr_' };
const TOUCH_EVERY_MS = 10 * 60_000;

export async function createToken(
  env: Env,
  t: { kind: TokenKind; subject: string; grantId: string; name: string; clientId?: string | null; ttlMs?: number },
): Promise<string> {
  const raw = PREFIX[t.kind] + randomId(24);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO api_tokens (hash, kind, subject, grant_id, name, client_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(await sha256Hex(raw), t.kind, t.subject, t.grantId, t.name.slice(0, 100), t.clientId ?? null, now, t.ttlMs ? now + t.ttlMs : null)
    .run();
  return raw;
}

export interface TokenRow {
  hash: string;
  kind: TokenKind;
  subject: string;
  grant_id: string;
  name: string;
  client_id: string | null;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
}

/** The user behind a Bearer token that may read data (personal or access token), or null. */
export async function userForBearer(c: Context<AppEnv>): Promise<{ user: User; token: TokenRow } | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '');
  if (!m || !/^ml[pa]_/.test(m[1])) return null;
  const now = Date.now();
  const token = await c.env.DB.prepare(
    `SELECT * FROM api_tokens WHERE hash = ? AND kind IN ('personal', 'access') AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(await sha256Hex(m[1]), now)
    .first<TokenRow>();
  if (!token) return null;
  const user = await userFromSubject(c.env, token.subject);
  if (!user) return null;
  // "Last used" in the dashboard, without a database write on every single call.
  if (!token.last_used_at || now - token.last_used_at > TOUCH_EVERY_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE grant_id = ?').bind(now, token.grant_id).run().catch(() => {}),
    );
  }
  return { user, token };
}

// ---------- dashboard: list, create and revoke (login required)

/** Personal tokens and connected OAuth apps of the signed-in user, one row per grant. */
export async function listTokens(c: Context<AppEnv>) {
  const subject = subjectOf(c.env, c.get('user'));
  const now = Date.now();
  const rows = await c.env.DB.prepare(
    `SELECT grant_id, MIN(kind) AS kind, MAX(name) AS name, MIN(created_at) AS created_at, MAX(last_used_at) AS last_used_at
     FROM api_tokens WHERE subject = ? AND (expires_at IS NULL OR expires_at > ?)
     GROUP BY grant_id ORDER BY created_at DESC`,
  )
    .bind(subject, now)
    .all<{ grant_id: string; kind: TokenKind; name: string; created_at: number; last_used_at: number | null }>();
  return c.json(
    rows.results.map((r) => ({
      id: r.grant_id,
      type: r.kind === 'personal' ? 'token' : 'app',
      name: r.name,
      created_at: r.created_at,
      last_used_at: r.last_used_at,
    })),
  );
}

export async function createPersonalToken(c: Context<AppEnv>) {
  const b = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = (b.name ?? '').trim().slice(0, 60) || 'AI assistant';
  const subject = subjectOf(c.env, c.get('user'));
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM api_tokens WHERE subject = ? AND kind = 'personal'`)
    .bind(subject)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= 25) return c.json({ error: 'You have 25 tokens already. Revoke one you no longer use.' }, 400);
  const id = randomId(8);
  const token = await createToken(c.env, { kind: 'personal', subject, grantId: id, name });
  return c.json({ id, name, token });
}

export async function revokeGrant(c: Context<AppEnv>) {
  await c.env.DB.prepare('DELETE FROM api_tokens WHERE subject = ? AND grant_id = ?')
    .bind(subjectOf(c.env, c.get('user')), c.req.param('id'))
    .run();
  return c.json({ ok: true });
}
