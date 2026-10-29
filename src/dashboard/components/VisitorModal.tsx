import { displayName } from '../../shared/names';
import { useDash } from '../lib/context';
import { countryName, fmtAgo, fmtDateTime, fmtDuration } from '../lib/format';
import { useApi } from '../lib/useApi';
import { Avatar, BrowserIcon, DeviceIcon, Flag, OSIcon, SourceIcon } from './Icons';
import { Modal } from './Modal';

interface Profile {
  visitor: { id: string; first_seen: number; name: string | null; email: string | null; user_id: string | null } | null;
  sessions: any[];
  events: { session_id: string; ts: number; type: string; name: string | null; path: string; props: string | null }[];
  payments: any[];
}

export function VisitorModal({ visitorId, onClose }: { visitorId: string | null; onClose: () => void }) {
  const { site, money } = useDash();
  // The parent remounts this per visitor (key), so `data` always belongs to `visitorId`.
  const { data: p } = useApi<Profile>(visitorId ? `/api/sites/${site.id}/visitors/${visitorId}` : null);
  const last = p?.sessions[0];
  const firstSession = p?.sessions[p.sessions.length - 1];
  const paid = p?.payments.reduce((a, x) => a + x.amount, 0) ?? 0;
  const firstPayment = p?.payments.filter((x) => x.kind === 'payment').at(-1);

  // Timeline: each visit with its events and payments, newest first.
  const bySession = new Map<string, Profile['events']>();
  for (const e of p?.events ?? []) {
    if (!bySession.has(e.session_id)) bySession.set(e.session_id, []);
    bySession.get(e.session_id)!.push(e);
  }

  return (
    <Modal open={!!visitorId} onClose={onClose} width="max-w-3xl" title="Visitor profile">
      {!p && <div className="h-60 animate-pulse rounded-xl bg-stone-50" />}
      {p && (
        <div>
          <div className="flex items-center gap-4">
            <Avatar id={visitorId!} size={64} />
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold">{displayName(visitorId!, p.visitor?.name, p.visitor?.email)}</div>
              {p.visitor?.email && p.visitor.name && <div className="text-sm text-stone-500">{p.visitor.email}</div>}
              {last && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-stone-500">
                  <span className="flex items-center gap-1">
                    <Flag cc={last.country} size={15} /> {last.city ? `${last.city}, ` : ''}
                    {countryName(last.country)}
                  </span>
                  <span className="flex items-center gap-1">
                    <DeviceIcon name={last.device} size={15} /> {last.device}
                  </span>
                  <span className="flex items-center gap-1">
                    <OSIcon name={last.os} size={15} /> {last.os}
                  </span>
                  <span className="flex items-center gap-1">
                    <BrowserIcon name={last.browser} size={15} /> {last.browser}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="First source" value={firstSession?.source ?? '—'} />
            <Stat label="Visits" value={String(p.sessions.length)} />
            <Stat label="Total spent" value={money(paid)} accent={paid > 0} />
            <Stat
              label="Time to first payment"
              value={firstPayment && p.visitor ? fmtAgo(firstPayment.ts - p.visitor.first_seen) : '—'}
            />
          </div>

          <div className="mt-8 space-y-6">
            {p.sessions.map((s) => {
              const evs = [...(bySession.get(s.id) ?? [])].reverse();
              const pays = p.payments.filter((x) => x.ts >= s.started_at && x.ts <= s.last_seen_at + 30 * 60_000);
              return (
                <div key={s.id} className="relative border-l-2 border-stone-100 pl-5">
                  <div className="absolute -left-[7px] top-1 h-3 w-3 rounded-full bg-visitors ring-4 ring-white" />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">{fmtDateTime(s.started_at, site.timezone)}</span>
                    <span className="flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-0.5">
                      <SourceIcon source={s.source} domain={s.referrer_domain} size={14} /> {s.source}
                    </span>
                    {s.referrer && <span className="max-w-full truncate text-stone-500 sm:max-w-[260px]">{s.referrer}</span>}
                    {s.utm_campaign && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-700">campaign: {s.utm_campaign}</span>}
                    {s.ref && <span className="rounded-md bg-amber-50 px-2 py-0.5 text-amber-700">ref: {s.ref}</span>}
                    <span className="text-stone-400">{fmtDuration(s.duration)}</span>
                  </div>
                  <ol className="mt-2 space-y-1 text-sm">
                    {evs.map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-14 shrink-0 text-xs leading-5 text-stone-400">
                          {new Intl.DateTimeFormat('en', { timeZone: site.timezone, hour: 'numeric', minute: '2-digit' }).format(e.ts)}
                        </span>
                        {e.type === 'pageview' && <span className="min-w-0 break-words text-stone-700">📄 {e.path}</span>}
                        {e.type === 'goal' && (
                          <span className="min-w-0 break-words font-medium text-violet-700">
                            🎯 {e.name} <span className="font-normal text-stone-400">on {e.path}</span>
                          </span>
                        )}
                        {e.type === 'outbound' && <span className="min-w-0 break-words text-stone-600">↗ Left to {e.name?.replace(/^https?:\/\//, '')}</span>}
                      </li>
                    ))}
                    {pays.map((x) => (
                      <li key={x.id} className="flex items-start gap-2">
                        <span className="w-14 shrink-0 text-xs leading-5 text-stone-400">
                          {new Intl.DateTimeFormat('en', { timeZone: site.timezone, hour: 'numeric', minute: '2-digit' }).format(x.ts)}
                        </span>
                        <span className="font-semibold text-revenue">💰 {x.kind === 'refund' ? 'Refund' : 'Paid'} {money(x.amount)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
            {p.payments.length > 0 && (
              <div className="rounded-xl bg-revenueSoft/40 p-4 text-sm">
                <div className="mb-2 font-semibold">Payments</div>
                {p.payments.map((x) => (
                  <div key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-0.5">
                    <span className="min-w-0">
                      {fmtDateTime(x.ts, site.timezone)} · {x.kind === 'refund' ? 'Refund' : x.renewal ? 'Renewal' : 'Payment'}
                    </span>
                    <span className="font-medium">{money(x.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-stone-50 px-4 py-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-0.5 truncate font-semibold ${accent ? 'text-revenue' : ''}`} title={value}>
        {value}
      </div>
    </div>
  );
}
