import { useState } from 'react';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';
import { useT } from '../lib/i18n';

export function Login({ onLogin }: { onLogin: () => void }) {
  const t = useT();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', json: { password } });
      onLogin();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-8">
        <Logo />
        <h1 className="mt-6 text-2xl font-semibold">{t('login.welcome')}</h1>
        <p className="mt-1 text-sm text-stone-500">{t('login.subtitle')}</p>
        <label className="label mt-6" htmlFor="pw">
          {t('login.password')}
        </label>
        <input id="pw" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button className="btn-dark mt-6 w-full" disabled={busy || !password}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>
      </form>
    </div>
  );
}
