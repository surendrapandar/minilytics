import { useState } from 'react';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';

/** Log in, or create an account when sign-up is open. */
export function Login({ withEmail, signup, onLogin }: { withEmail: boolean; signup: boolean; onLogin: () => void }) {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const askEmail = withEmail || creating;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(creating ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', json: askEmail ? { email, password } : { password } });
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
        <h1 className="mt-6 text-2xl font-semibold">{creating ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-1 text-sm text-stone-500">Revenue-first analytics for your websites.</p>
        {askEmail && (
          <>
            <label className="label mt-6" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete={creating ? 'email' : 'username'}
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </>
        )}
        <label className={askEmail ? 'label mt-4' : 'label mt-6'} htmlFor="pw">
          Password
        </label>
        <input
          id="pw"
          type="password"
          autoComplete={creating ? 'new-password' : 'current-password'}
          minLength={creating ? 8 : undefined}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus={!askEmail}
        />
        {creating && <p className="mt-1 text-xs text-stone-500">At least 8 characters.</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <button className="btn-dark mt-6 w-full" disabled={busy || !password || (askEmail && !email)}>
          {busy ? (creating ? 'Creating account…' : 'Signing in…') : creating ? 'Create account' : 'Sign in'}
        </button>
        {signup && (
          <p className="mt-4 text-center text-sm text-stone-500">
            {creating ? 'Already have an account?' : 'New here?'}{' '}
            <button
              type="button"
              className="font-medium text-ink underline-offset-2 hover:underline"
              onClick={() => {
                setCreating(!creating);
                setError('');
              }}
            >
              {creating ? 'Log in' : 'Create an account'}
            </button>
          </p>
        )}
      </form>
    </div>
  );
}
