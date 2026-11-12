import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { UserError } from '../lib/errors';
import { bearerAuth, resourceMetadataUrl, type AgentAuth } from '../oauth';
import { present, validate } from './schema';
import { TOOLS, type ToolContext } from './tools';

/**
 * MCP server over Streamable HTTP, stateless: every POST /mcp carries a bearer token and gets one JSON response,
 * so it runs on any Worker isolate with no sessions or Durable Objects.
 */

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'minilytics', title: 'Minilytics', version: '0.1.0' };

const INSTRUCTIONS = `Minilytics is revenue-first web analytics: it follows each visitor from the source that brought them (tweet, Google, AI chat, campaign) to the goals they complete and the payments they make.

- Start with list_sites to get website ids; every other tool takes "site" (an id or the domain).
- Time ranges: "period" (today, yesterday, 24h, 48h, 7d, 30d, 90d, 12m, all) or from/to dates (YYYY-MM-DD) in the site's timezone. Default 30d.
- "filters" narrows any report to matching visits, like clicking a row in the dashboard: e.g. {"source":"X"} or {"utm_campaign":"launch"}. Use labels exactly as get_breakdown returns them.
- Units: money is in major units of the given currency (29.99, not cents); rates are fractions (0.05 = 5%); durations are seconds; times are ISO 8601 UTC.
- Goals are named events the website records (data-ml-goal attributes, window.minilytics('goal', ...), or record_goal). Funnels are saved, ordered steps of pages and goals.
- Deleting a website, goal or funnel is permanent: only do it when the user clearly asked.`;

type Id = string | number | null;
const rpcResult = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });

function toolList(auth: AgentAuth) {
  return TOOLS.filter((t) => auth.scopes.has(t.scope)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.input,
    annotations: { title: t.title, ...t.annotations },
  }));
}

async function callTool(params: any, ctx: ToolContext) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) return { error: rpcError(null, -32602, `Unknown tool: ${params?.name}`) };
  const text = (s: string, isError = false) => ({ result: { content: [{ type: 'text', text: s }], isError } });
  if (!ctx.scopes.has(tool.scope)) {
    return text(`${tool.name} needs "${tool.scope}" access, which this connection wasn't given. Reconnect and allow changes to use it.`, true);
  }
  const args = validate(tool.input, params.arguments ?? {});
  if (!args.ok) return text(`Invalid input: ${args.error}`, true);
  try {
    const out = await tool.run(args.value, ctx);
    return text(JSON.stringify(present(out)));
  } catch (e) {
    if (e instanceof UserError) return text(e.message, true);
    console.error('mcp tool failed', tool.name, e);
    return text(`${tool.name} failed unexpectedly. Try again, or report it if it keeps happening.`, true);
  }
}

async function handleMessage(msg: any, auth: AgentAuth, c: Context<AppEnv>) {
  if (!msg || typeof msg !== 'object') return rpcError(null, -32600, 'Invalid request');
  const isRequest = 'id' in msg;
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return isRequest ? rpcError(msg.id ?? null, -32600, 'Invalid request') : null;
  // Notifications (initialized, cancelled, …) need no reply.
  if (!isRequest) return null;
  const { id, method, params } = msg as { id: Id; method: string; params?: any };

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: toolList(auth) });
    case 'tools/call': {
      const ctx: ToolContext = { env: c.env, user: auth.user, scopes: auth.scopes, clientName: auth.clientName, origin: new URL(c.req.url).origin };
      const r = await callTool(params, ctx);
      return 'error' in r ? { ...r.error, id } : rpcResult(id, r.result);
    }
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function mcpHandler(c: Context<AppEnv>) {
  if (c.req.method !== 'POST') {
    // No server-to-client stream or sessions to open or close.
    c.header('Allow', 'POST');
    return c.json(rpcError(null, -32000, 'Method not allowed: send JSON-RPC with POST.'), 405);
  }
  const auth = await bearerAuth(c);
  if (!auth) {
    const sent = /^Bearer\s/i.test(c.req.header('authorization') ?? '');
    c.header(
      'WWW-Authenticate',
      `Bearer realm="minilytics", resource_metadata="${resourceMetadataUrl(c)}"${sent ? ', error="invalid_token", error_description="The access token is invalid or expired"' : ''}`,
    );
    return c.json(rpcError(null, -32001, 'Unauthorized: connect with OAuth (see WWW-Authenticate).'), 401);
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(body)) {
    if (!body.length) return c.json(rpcError(null, -32600, 'Invalid request'), 400);
    const replies = (await Promise.all(body.map((m) => handleMessage(m, auth, c)))).filter(Boolean);
    return replies.length ? c.json(replies) : c.body(null, 202);
  }
  const reply = await handleMessage(body, auth, c);
  return reply ? c.json(reply) : c.body(null, 202);
}
