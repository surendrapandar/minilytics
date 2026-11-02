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
  window.history.pushState({ app: true }, '', to);
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

const SITE = 'https://minilytics.app';
const HOME_TITLE = 'Minilytics: Revenue-First Web Analytics for Indie Makers';
const HOME_DESCRIPTION =
  'See which tweet, post or AI chat made you money. Minilytics follows every visitor from first click to payment. Open source, privacy-friendly, unlimited sites.';
const LEGAL_META = {
  terms: { title: 'Terms of Service | Minilytics', description: 'The terms for using Minilytics, revenue-first web analytics.' },
  privacy: { title: 'Privacy Policy | Minilytics', description: 'What data Minilytics collects, why, and how long it is kept.' },
  refund: { title: 'Refund Policy | Minilytics', description: 'How refunds work for Minilytics, including the 14-day money-back guarantee.' },
};
const LEGAL = /^\/(terms|privacy|refund)\/?$/;
const APP_PAGE = /^\/(billing(\/.*)?|site\/[\w-]+(\/settings)?\/?)$/;

function setTag(selector: string, create: () => HTMLElement, attr: string, value: string) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}
const meta = (name: string) => () => Object.assign(document.createElement('meta'), { name });

// index.html carries the homepage tags; other pages swap in their own title, canonical URL and robots rule.
function usePageMeta(path: string) {
  useEffect(() => {
    const legal = LEGAL.exec(path)?.[1] as keyof typeof LEGAL_META | undefined;
    // Self-hosted copies are private dashboards: only minilytics.app itself should be in search results.
    const indexable = /(^|\.)minilytics\.app$/.test(window.location.hostname) && (path === '/' || !!legal);
    document.title = legal ? LEGAL_META[legal].title : path === '/' ? HOME_TITLE : 'Minilytics';
    setTag('meta[name="description"]', meta('description'), 'content', legal ? LEGAL_META[legal].description : HOME_DESCRIPTION);
    setTag('meta[name="robots"]', meta('robots'), 'content', indexable ? 'index, follow, max-image-preview:large' : 'noindex');
    setTag('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', SITE + (legal ? `/${legal}` : '/'));
  }, [path]);
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 text-stone-600">This page doesn't exist or has moved.</p>
      <a href="/" className="btn mt-6 inline-flex">
        Go to Minilytics
      </a>
    </div>
  );
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
  usePageMeta(path);

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
      window.history.replaceState(window.history.state, '', window.location.pathname + (q.toString() ? `?${q}` : ''));
    }
    // Only when the signed-in account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!me) return null;

  const legal = LEGAL.exec(path);
  if (legal) return <Legal page={legal[1] as 'terms' | 'privacy' | 'refund'} />;

  if (path !== '/' && !APP_PAGE.test(path)) return <NotFound />;

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
