import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, type Me } from './lib/api';
import { Billing } from './pages/Billing';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Legal } from './pages/Legal';
import { Login } from './pages/Login';
import { Settings } from './pages/Settings';
import { Sites } from './pages/Sites';

export function navigate(to: string) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

const MeContext = createContext<{ me: Me; refresh: () => Promise<Me> } | null>(null);
export function useMe() {
  const m = useContext(MeContext);
  if (!m) throw new Error('useMe outside App');
  return m;
}

export function App() {
  const path = usePath();
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<Me>('/api/auth/me').catch(() => ({ loggedIn: false, hosted: false, user: null }) as Me);
    setMe(r);
    return r;
  }, []);

  useEffect(() => {
    refresh();
    const out = () => setMe((m) => (m ? { ...m, loggedIn: false, user: null } : m));
    window.addEventListener('ml:logout', out);
    return () => window.removeEventListener('ml:logout', out);
  }, [refresh]);

  // Tell Minilytics (when this site tracks itself) who is signed in, and record brand-new signups.
  const userId = me?.user?.id;
  useEffect(() => {
    if (!me?.user || me.user.id === 'admin') return;
    window.minilytics?.('identify', { user_id: me.user.id, email: me.user.email, name: me.user.name });
    const q = new URLSearchParams(window.location.search);
    if (q.get('signup') === '1') {
      window.minilytics?.('goal', 'signup_completed');
      q.delete('signup');
      window.history.replaceState(null, '', window.location.pathname + (q.toString() ? `?${q}` : ''));
    }
    // Only when the signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!me) return null;

  const legal = /^\/(terms|privacy|refund)\/?$/.exec(path);
  if (legal) return <Legal page={legal[1] as 'terms' | 'privacy' | 'refund'} />;

  let page;
  if (!me.loggedIn) {
    page = me.hosted ? <Landing /> : <Login onLogin={refresh} />;
  } else if (me.hosted && !me.user?.paid) {
    // Signed in but hasn't paid yet: the only thing to do is pick the plan.
    page = <Billing />;
  } else if (path.startsWith('/billing')) {
    page = <Billing />;
  } else {
    const settings = /^\/site\/([\w-]+)\/settings\/?$/.exec(path);
    const site = /^\/site\/([\w-]+)\/?$/.exec(path);
    page = settings ? <Settings siteId={settings[1]} /> : site ? <Dashboard siteId={site[1]} /> : <Sites />;
  }
  return <MeContext.Provider value={{ me, refresh }}>{page}</MeContext.Provider>;
}
