import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { api, type Site } from '../lib/api';
import { fmtNumber } from '../lib/format';
import { useT } from '../lib/i18n';

export function Sites() {
  const t = useT();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api<Site[]>('/api/sites').then((s) => {
      setSites(s);
      if (!s.length) setAdding(true);
    });
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('ml:logout'));
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex gap-2">
          <button className="btn" onClick={logout}>
            {t('sites.logOut')}
          </button>
          <button className="btn-dark" onClick={() => setAdding(true)}>
            {t('sites.addWebsiteBtn')}
          </button>
        </div>
      </div>

      <h1 className="mt-10 text-2xl font-semibold">{t('sites.yourWebsites')}</h1>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites?.map((s) => (
          <button key={s.id} onClick={() => navigate(`/site/${s.id}`)} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center gap-3">
              <Favicon domain={s.domain} size={28} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{s.name}</div>
                <div className="truncate text-sm text-stone-500">{s.domain}</div>
              </div>
            </div>
            <div className="mt-5 flex items-end justify-between">
              <div>
                <div className="text-2xl font-semibold">{fmtNumber(s.visitors24h ?? 0)}</div>
                <div className="text-xs text-stone-500">{t('sites.visitors24h')}</div>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-stone-600">
                <span className={`h-2 w-2 rounded-full ${s.online ? 'animate-pulse bg-green-500' : 'bg-stone-300'}`} />
                {t('sites.online', { n: s.online ?? 0 })}
              </div>
            </div>
          </button>
        ))}
        {sites && !sites.length && (
          <div className="card col-span-full p-10 text-center text-stone-500">{t('sites.empty')}</div>
        )}
      </div>
      <AddSite open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

const CURRENCIES = ['MXN', 'USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY', 'BRL'];

function AddSite({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const site = await api<Site>('/api/sites', { method: 'POST', json: { domain, name, timezone, currency } });
      navigate(`/site/${site.id}/settings`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t('sites.addWebsite')} width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">{t('sites.domain')}</label>
          <input className="input" placeholder={t('sites.domainPlaceholder')} value={domain} onChange={(e) => setDomain(e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-stone-500">{t('sites.subdomainsNote')}</p>
        </div>
        <div>
          <label className="label">{t('sites.name')}</label>
          <input className="input" placeholder={t('sites.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{t('sites.timezone')}</label>
            <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div>
            <label className="label">{t('sites.currency')}</label>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-dark w-full" disabled={!domain}>
          {t('sites.addWebsiteSubmit')}
        </button>
      </form>
    </Modal>
  );
}
