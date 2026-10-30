import '../styles/private-login.css';
import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export default function PrivateLogin({ children }: { children: ReactNode }) {
  const query = useQueryClient();
  const [state, setState] = useState<'checking' | 'locked' | 'ready'>('checking');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/auth/session', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Private login is unavailable. Please try again shortly.');
        const body = (await response.json()) as { authenticated?: boolean };
        setState(body.authenticated === true ? 'ready' : 'locked');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError('Cannot verify your session. Check your connection and reload.');
          setState('locked');
        }
      });
    const expired = () => {
      query.clear();
      setPassword('');
      setState('locked');
      setError('Your session has expired. Sign in again.');
    };
    const signedOutElsewhere = (event: StorageEvent) => {
      if (event.key === 'fluxdesk-signout') expired();
    };
    window.addEventListener('storage', signedOutElsewhere);
    window.addEventListener('fluxdesk-session-expired', expired);
    return () => {
      controller.abort();
      window.removeEventListener('fluxdesk-session-expired', expired);
      window.removeEventListener('storage', signedOutElsewhere);
    };
  }, [query]);
  if (state === 'ready')
    return (
      <>
        <div className="login-session">
          <button
            className="subtle"
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const response = await fetch('/api/auth/logout', { method: 'POST', cache: 'no-store' });
                if (!response.ok) throw Error('Could not sign out. Please try again.');
                query.clear();
                setPassword('');
                setState('locked');
                localStorage.setItem('fluxdesk-signout', String(Date.now()));
              } catch {
                setError('Could not sign out. Please try again.');
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Sign out
          </button>
          {error && <span role="alert">{error}</span>}
        </div>
        {children}
      </>
    );
  return (
    <main className="private-login">
      <form
        className="private-login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/api/auth/login', {
              method: 'POST',
              cache: 'no-store',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ password }),
            });
            const body = (await response.json()) as { error?: string; authenticated?: boolean };
            setPassword('');
            if (!response.ok || body.authenticated !== true) throw Error(body.error ?? 'Sign-in failed.');
            query.clear();
            setState('ready');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="eyebrow">FLUXDESK</div>
        <h1>Private workspace</h1>
        <p>Sign in to open your dashboard.</p>
        <label htmlFor="workspace-password">Password</label>
        <input
          id="workspace-password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy || state === 'checking'}
        />
        {error && <p role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy || state === 'checking'}>
          {state === 'checking' ? 'Checking session…' : busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
