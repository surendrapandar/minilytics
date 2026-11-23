import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Code, CopyField } from './Copy';
import { Modal } from './Modal';

interface Grant {
  id: string;
  type: 'token' | 'app';
  name: string;
  created_at: number;
  last_used_at: number | null;
}

const CLIENTS = ['Claude', 'ChatGPT', 'Claude Code', 'Cursor', 'Other'] as const;
type Client = (typeof CLIENTS)[number];

const EXAMPLES = [
  'Which traffic sources made me the most money this month?',
  'Compare this week with last week. What changed and why?',
  'Who are my last 5 customers and how did they find me?',
  'Where do visitors drop off between /pricing and checkout?',
];

function ago(ts: number | null) {
  if (!ts) return 'never used';
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 60) return m <= 1 ? 'used just now' : `used ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `used ${h}h ago`;
  return `used ${Math.round(h / 24)} days ago`;
}

/** Connect Claude, ChatGPT, Cursor… to this Minilytics over MCP, and manage what has access. */
export function ConnectAI({ open, onClose }: { open: boolean; onClose: () => void }) {
  const url = `${window.location.origin}/mcp`;
  const [client, setClient] = useState<Client>('Claude');
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; token: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Grant[]>('/api/tokens')
      .then(setGrants)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (open) load();
    else setCreated(null);
  }, [open, load]);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ name: string; token: string }>('/api/tokens', { method: 'POST', json: { name: name || client } });
      setCreated(r);
      setName('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revoke(g: Grant) {
    if (!window.confirm(`Disconnect "${g.name}"? It will stop working immediately.`)) return;
    await api(`/api/tokens/${g.id}`, { method: 'DELETE' }).catch((e) => setError((e as Error).message));
    load();
  }

  const token = created?.token ?? '<your-token>';

  return (
    <Modal open={open} onClose={onClose} title="Connect AI" width="max-w-2xl">
      <p className="text-sm text-stone-600">
        Ask Claude, ChatGPT or Cursor about your traffic and revenue in plain words. They get <strong>read-only</strong> access to every website in this
        account, and can't change or delete anything.
      </p>

      <label className="label mt-5">MCP server URL</label>
      <CopyField value={url} />

      <div className="tabs mt-5 flex-wrap">
        {CLIENTS.map((c) => (
          <button key={c} className={`tab ${client === c ? 'tab-active' : ''}`} onClick={() => setClient(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3 text-sm text-stone-600">
        {client === 'Claude' && (
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              In Claude (web or desktop) open <strong>Settings → Connectors</strong> and click <strong>Add custom connector</strong>.
            </li>
            <li>
              Name it <strong>Minilytics</strong>, paste the URL above, and click <strong>Add</strong>.
            </li>
            <li>
              Click <strong>Connect</strong>, sign in here if asked, and choose <strong>Allow access</strong>.
            </li>
            <li>In a chat, turn Minilytics on from the tools menu and ask away.</li>
          </ol>
        )}
        {client === 'ChatGPT' && (
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              In ChatGPT open <strong>Settings → Apps &amp; Connectors → Advanced settings</strong> and turn on <strong>Developer mode</strong>.
            </li>
            <li>
              Click <strong>Create</strong>, name it <strong>Minilytics</strong>, paste the URL above and pick <strong>OAuth</strong> authentication.
            </li>
            <li>
              Sign in here when asked and choose <strong>Allow access</strong>. Then add Minilytics to a chat from the <strong>+</strong> menu.
            </li>
          </ol>
        )}
        {client === 'Claude Code' && (
          <>
            <p>Run this in your terminal, then type <code className="rounded bg-stone-100 px-1">/mcp</code> in Claude Code and pick <strong>Authenticate</strong>:</p>
            <Code label="terminal">{`claude mcp add --transport http minilytics ${url}`}</Code>
            <p>Or skip the browser step with a personal token (create one below):</p>
            <Code label="terminal">{`claude mcp add --transport http minilytics ${url} --header "Authorization: Bearer ${token}"`}</Code>
          </>
        )}
        {client === 'Cursor' && (
          <>
            <p>
              Add this to <code className="rounded bg-stone-100 px-1">~/.cursor/mcp.json</code> (or the project's <code className="rounded bg-stone-100 px-1">.cursor/mcp.json</code>). Cursor
              asks you to sign in the first time:
            </p>
            <Code label="mcp.json">{JSON.stringify({ mcpServers: { minilytics: { url } } }, null, 2)}</Code>
            <p>Or use a personal token (create one below):</p>
            <Code label="mcp.json">{JSON.stringify({ mcpServers: { minilytics: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)}</Code>
          </>
        )}
        {client === 'Other' && (
          <>
            <p>
              Any MCP client that supports <strong>Streamable HTTP</strong> works. Clients with OAuth only need the URL. Otherwise, create a personal token below and send it as a
              header:
            </p>
            <Code label="header">{`Authorization: Bearer ${token}`}</Code>
            <p>Windsurf, VS Code and others that only run local servers can use the mcp-remote bridge:</p>
            <Code label="config">
              {JSON.stringify({ mcpServers: { minilytics: { command: 'npx', args: ['-y', 'mcp-remote', url, '--header', `Authorization: Bearer ${token}`] } } }, null, 2)}
            </Code>
          </>
        )}
      </div>

      <div className="mt-5 rounded-xl bg-stone-50 p-4 text-sm">
        <div className="font-medium">Try asking</div>
        <ul className="mt-1.5 space-y-1 text-stone-600">
          {EXAMPLES.map((q) => (
            <li key={q}>“{q}”</li>
          ))}
        </ul>
      </div>

      <div className="mt-6 border-t border-stone-100 pt-5">
        <div className="font-semibold">Personal tokens</div>
        <p className="mt-1 text-sm text-stone-500">For tools that don't sign in with a browser. Treat a token like a password: it can read all your analytics.</p>
        <form onSubmit={createToken} className="mt-3 flex gap-2">
          <input className="input" placeholder="Name, e.g. Cursor on my laptop" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <button className="btn-dark shrink-0">Create token</button>
        </form>
        {created && (
          <div className="mt-3 space-y-2">
            <p className="text-sm font-medium text-emerald-700">Token “{created.name}” created. Copy it now, it won't be shown again.</p>
            <CopyField value={created.token} />
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <div className="mt-6">
        <div className="font-semibold">What has access</div>
        {grants === null ? (
          <div className="mt-3 h-12 animate-pulse rounded-xl bg-stone-100" />
        ) : grants.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Nothing yet. Connected apps and tokens show up here.</p>
        ) : (
          <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200">
            {grants.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${g.type === 'app' ? 'bg-sky-50 text-sky-700' : 'bg-stone-100 text-stone-600'}`}>
                  {g.type === 'app' ? 'App' : 'Token'}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                <span className="hidden text-xs text-stone-500 sm:inline">{ago(g.last_used_at)}</span>
                <button className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50" onClick={() => revoke(g)}>
                  {g.type === 'app' ? 'Disconnect' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
