import { useState } from 'react';
import { api } from '../lib/api';
import { fmtAgo } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Code, CopyField } from './Copy';
import { Modal } from './Modal';

interface Grant {
  id: string;
  name: string;
  scopes: string[];
  created_at: number;
  last_used_at: number | null;
}

const CLIENTS = [
  { name: 'Claude Code', how: (url: string) => <Code label="terminal">{`claude mcp add --transport http minilytics ${url}`}</Code> },
  { name: 'Claude (web & desktop)', how: () => <p>Settings → Connectors → Add custom connector, and paste the URL.</p> },
  { name: 'ChatGPT', how: () => <p>Settings → Apps &amp; Connectors → Create (developer mode), and paste the URL with OAuth.</p> },
  {
    name: 'Cursor, VS Code and others',
    how: (url: string) => <Code label="mcp.json">{JSON.stringify({ mcpServers: { minilytics: { url } } }, null, 2)}</Code>,
  },
];

/** Connect AI agents over MCP, and see or disconnect the ones already connected. */
export function AgentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const url = `${window.location.origin}/mcp`;
  const [version, setVersion] = useState(0);
  const { data: grants, error } = useApi<Grant[]>(open ? '/api/oauth/grants' : null, version);

  async function disconnect(g: Grant) {
    if (!confirm(`Disconnect ${g.name}? It will need your approval again to reconnect.`)) return;
    await api(`/api/oauth/grants/${g.id}`, { method: 'DELETE' });
    setVersion((v) => v + 1);
  }

  return (
    <Modal open={open} onClose={onClose} title="AI agents">
      <p className="text-sm text-stone-600">
        Let Claude, ChatGPT, Cursor or any MCP client read your analytics and manage websites, goals and funnels. Add this server URL to the agent; it
        sends you here to approve it, and you choose whether it may make changes.
      </p>
      <div className="mt-4">
        <CopyField value={url} />
      </div>
      <div className="mt-4 space-y-2 text-sm">
        {CLIENTS.map((c) => (
          <details key={c.name} className="rounded-xl border border-stone-200 px-4 py-2.5">
            <summary className="cursor-pointer font-medium">{c.name}</summary>
            <div className="mt-3 text-stone-600">{c.how(url)}</div>
          </details>
        ))}
      </div>

      <h3 className="mt-8 font-semibold">Connected</h3>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {grants && !grants.length && <p className="mt-2 text-sm text-stone-500">No agents connected yet.</p>}
      {!grants && !error && <div className="mt-2 h-12 animate-pulse rounded-xl bg-stone-100" />}
      {!!grants?.length && (
        <ul className="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200">
          {grants.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{g.name}</div>
                <div className="text-xs text-stone-500">
                  {g.scopes.includes('write') ? 'Read & change' : 'Read only'} · connected {fmtAgo(Date.now() - g.created_at)} ago
                  {g.last_used_at ? ` · used ${fmtAgo(Date.now() - g.last_used_at)} ago` : ''}
                </div>
              </div>
              <button className="btn py-1.5 text-red-600" onClick={() => disconnect(g)}>
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
