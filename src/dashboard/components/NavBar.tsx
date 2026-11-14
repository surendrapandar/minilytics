import { useEffect, useState } from 'react';
import { navigate, useMe } from '../App';
import { api, type Site } from '../lib/api';
import { useApi } from '../lib/useApi';
import { Favicon } from './Icons';
import { Dropdown } from './Toolbar';

/** Fired after a site is renamed, so the bar shows the new name. */
export const SITES_CHANGED = 'ml:sites-changed';

const Chevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-stone-400">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const item = (active = false) =>
  `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-stone-100 ${active ? 'font-medium text-ink' : 'text-stone-600'}`;

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  window.dispatchEvent(new Event('ml:logout'));
  navigate('/');
}

const Mark = () => (
  <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#1c1917" />
    <path d="M8 22l5-7 4 4 7-10" stroke="#e07b5f" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The bar on a public dashboard seen without logging in. */
export function PublicBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-[1480px] items-center gap-2 px-3 sm:px-6">
        <span className="flex items-center gap-2 px-1.5">
          <Mark />
          <span className="font-semibold tracking-tight">Minilytics</span>
        </span>
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-500">Public dashboard</span>
        <button className="btn ml-auto py-1.5" onClick={() => navigate('/')}>
          Log in
        </button>
      </nav>
    </header>
  );
}

/** The bar at the top of every signed-in page: home, the current site and its pages, and the account menu. */
export function NavBar({ path }: { path: string }) {
  const { me } = useMe();
  const match = /^\/site\/([\w-]+)(\/settings)?\/?$/.exec(path);
  const siteId = match?.[1] ?? null;
  const onSettings = !!match?.[2];

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const on = () => setReloadKey((k) => k + 1);
    window.addEventListener(SITES_CHANGED, on);
    return () => window.removeEventListener(SITES_CHANGED, on);
  }, []);
  // Refetch when the site changes too: it may have just been added or deleted.
  useEffect(() => setReloadKey((k) => k + 1), [siteId]);
  const { data: sites } = useApi<Site[]>(reloadKey ? '/api/sites' : null, reloadKey);
  const site = sites?.find((s) => s.id === siteId);

  const user = me.user;
  const name = user?.name ?? user?.email ?? 'Owner';
  const initial = name.trim().charAt(0).toUpperCase() || 'M';

  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/85 backdrop-blur">
      <nav className="mx-auto flex h-14 max-w-[1480px] items-center gap-1 px-3 sm:gap-2 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
          className="flex shrink-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-stone-100"
          aria-label="All websites"
        >
          <Mark />
          <span className="hidden font-semibold tracking-tight md:inline">Minilytics</span>
        </a>

        {sites && sites.length > 0 && (
          <>
            <span className="hidden text-stone-300 sm:inline">/</span>
            <Dropdown
              button={
                <button className="flex min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 sm:gap-2 sm:px-2 text-sm font-medium hover:bg-stone-100">
                  {site ? (
                    <>
                      <Favicon domain={site.domain} size={18} />
                      <span className="max-w-[72px] truncate sm:max-w-[200px]">{site.name}</span>
                    </>
                  ) : (
                    <span className="text-stone-600">All websites</span>
                  )}
                  <Chevron />
                </button>
              }
            >
              {(close) => (
                <>
                  <button
                    className={item(!site)}
                    onClick={() => {
                      close();
                      navigate('/');
                    }}
                  >
                    All websites
                  </button>
                  <div className="my-1 border-t border-stone-100" />
                  {sites.map((s) => (
                    <button
                      key={s.id}
                      className={item(s.id === siteId)}
                      onClick={() => {
                        close();
                        // Stay on the same page (dashboard or settings), and keep the dashboard's date range.
                        navigate(onSettings ? `/site/${s.id}/settings` : `/site/${s.id}${siteId ? window.location.search : ''}`);
                      }}
                    >
                      <Favicon domain={s.domain} size={16} /> <span className="truncate">{s.name}</span>
                    </button>
                  ))}
                </>
              )}
            </Dropdown>
          </>
        )}

        {site && (
          <div className="tabs shrink-0 sm:ml-3">
            <button className={`tab px-2 sm:px-3 ${onSettings ? '' : 'tab-active'}`} onClick={() => onSettings && navigate(`/site/${site.id}`)}>
              Dashboard
            </button>
            <button className={`tab px-2 sm:px-3 ${onSettings ? 'tab-active' : ''}`} onClick={() => !onSettings && navigate(`/site/${site.id}/settings`)}>
              Settings
            </button>
          </div>
        )}

        <div className="ml-auto shrink-0">
          <Dropdown
            align="right"
            button={
              <button className="flex items-center gap-1.5 rounded-full p-0.5 hover:bg-stone-100" aria-label="Account menu" title={name}>
                {user?.avatar ? (
                  <img src={user.avatar} alt="" className="h-8 w-8 rounded-full" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white">{initial}</span>
                )}
              </button>
            }
          >
            {(close) => (
              <>
                <div className="px-3 py-2">
                  <div className="truncate text-sm font-medium">{name}</div>
                  {user?.email && user.email !== name && <div className="truncate text-xs text-stone-500">{user.email}</div>}
                </div>
                <div className="my-1 border-t border-stone-100" />
                <button
                  className={item(path === '/')}
                  onClick={() => {
                    close();
                    navigate('/');
                  }}
                >
                  All websites
                </button>
                {site && (
                  <button
                    className={item(onSettings)}
                    onClick={() => {
                      close();
                      navigate(`/site/${site.id}/settings`);
                    }}
                  >
                    {site.name} settings
                  </button>
                )}
                {!me.hosted && (
                  <button
                    className={item(path.startsWith('/account'))}
                    onClick={() => {
                      close();
                      navigate('/account');
                    }}
                  >
                    Account & password
                  </button>
                )}
                {me.hosted && (
                  <button
                    className={item(path.startsWith('/billing'))}
                    onClick={() => {
                      close();
                      navigate('/billing');
                    }}
                  >
                    Plan & billing
                  </button>
                )}
                <div className="my-1 border-t border-stone-100" />
                <button
                  className={item()}
                  onClick={() => {
                    close();
                    logout();
                  }}
                >
                  Log out
                </button>
              </>
            )}
          </Dropdown>
        </div>
      </nav>
    </header>
  );
}
