import { useState } from 'react';
import { useMe } from '../App';
import { api } from '../lib/api';

/** The signed-in account: who you are, and changing the password. */
export function Account() {
  const { me } = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDone(false);
    if (next !== repeat) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      await api('/api/auth/password', { method: 'POST', json: { current, next } });
      setDone(true);
      setCurrent('');
      setNext('');
      setRepeat('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-semibold">Account</h1>

      <section className="card p-6">
        <h2 className="text-lg font-semibold">Email</h2>
        <p className="mt-1 text-sm text-stone-600">{me.user?.email ?? 'No email set. Add ADMIN_EMAIL to log in with one.'}</p>
      </section>

      {!me.hosted && (
        <form onSubmit={submit} className="card p-6">
          <h2 className="text-lg font-semibold">Change password</h2>
          <p className="mt-1 text-sm text-stone-500">Other browsers signed in to this account will be logged out.</p>
          <label className="label mt-4" htmlFor="current">
            Current password
          </label>
          <input id="current" type="password" autoComplete="current-password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <label className="label mt-4" htmlFor="next">
            New password
          </label>
          <input id="next" type="password" autoComplete="new-password" minLength={8} className="input" value={next} onChange={(e) => setNext(e.target.value)} />
          <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>
          <label className="label mt-4" htmlFor="repeat">
            Repeat new password
          </label>
          <input id="repeat" type="password" autoComplete="new-password" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          {done && <p className="mt-3 text-sm text-green-700">✓ Password changed.</p>}
          <button className="btn-dark mt-5" disabled={busy || !current || !next || !repeat}>
            {busy ? 'Saving…' : 'Change password'}
          </button>
        </form>
      )}
    </div>
  );
}
