import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api.ts';
import './AccountDialog.css';

type Mode = 'login' | 'register' | 'recover' | 'change-password' | 'register-owner';
export default function AccountDialog({
  signedIn,
  registrationOpen,
  ownerSetupAllowed,
  onClose,
}: {
  signedIn: boolean;
  registrationOpen: boolean;
  ownerSetupAllowed: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [mode, setMode] = useState<Mode>(
    signedIn ? 'change-password' : ownerSetupAllowed ? 'register-owner' : 'login',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  const registering = mode === 'register' || mode === 'register-owner';
  const newPassword = registering || mode === 'recover' || mode === 'change-password';
  const title = recoveryCode
    ? 'Save your recovery code'
    : mode === 'login'
      ? 'Welcome to FluxDesk'
      : mode === 'register-owner'
        ? 'Create your owner account'
        : mode === 'register'
          ? 'Create your account'
          : mode === 'recover'
            ? 'Recover your account'
            : 'Change your password';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      fields = new FormData(form);
    const value = (name: string) => String(fields.get(name) ?? '');
    if (newPassword && value('password') !== value('confirm')) {
      setError('The passwords do not match.');
      return;
    }
    setPending(true);
    setError('');
    try {
      const data: Record<string, string> =
        mode === 'change-password'
          ? { currentPassword: value('currentPassword'), newPassword: value('password') }
          : mode === 'recover'
            ? { email: value('email'), recoveryCode: value('recoveryCode'), newPassword: value('password') }
            : {
                email: value('email'),
                password: value('password'),
                ...(registering ? { name: value('name') } : {}),
              };
      const response = await api.account(mode, data);
      form.reset();
      if (response.recoveryCode) setRecoveryCode(response.recoveryCode);
      else window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account request failed. Try again.');
    } finally {
      setPending(false);
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setError('');
  }
  return (
    <dialog
      ref={dialog}
      className="account-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (pending || recoveryCode) event.preventDefault();
        else onClose();
      }}
    >
      <div className="account-heading">
        <div>
          <span className="tiny-label">YOUR FLUXDESK ACCOUNT</span>
          <h2 id={titleId}>{title}</h2>
        </div>
        {!recoveryCode && (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={onClose}
            aria-label="Close account dialog"
          >
            Close
          </button>
        )}
      </div>
      {recoveryCode ? (
        <div className="account-form">
          <p>
            This code lets you reset your password without email. It is shown only now. Save it in your
            password manager.
          </p>
          <code className="account-recovery-code">{recoveryCode}</code>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(recoveryCode)
                .then(() => setCopied(true))
                .catch(() => setError('Select and copy the code above.'));
            }}
          >
            {copied ? 'Copied' : 'Copy recovery code'}
          </button>
          <p className="footnote">
            Keep it private. This code replaces any previous recovery code for your account.
          </p>
          {mode === 'recover' && (
            <p>Your password has been reset. Sign in with the new password after saving this code.</p>
          )}
          {mode === 'register-owner' && (
            <p>Your existing journal and alerts are now attached to this owner account.</p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <button type="button" onClick={() => window.location.reload()}>
            I saved my recovery code
          </button>
        </div>
      ) : (
        <>
          {!signedIn && mode !== 'register-owner' && (
            <div className="account-tabs" aria-label="Account options">
              <button
                type="button"
                className={mode === 'login' ? '' : 'secondary'}
                disabled={pending}
                onClick={() => changeMode('login')}
              >
                Sign in
              </button>
              <button
                type="button"
                className={mode === 'register' ? '' : 'secondary'}
                disabled={pending || !registrationOpen}
                onClick={() => changeMode('register')}
              >
                Register
              </button>
            </div>
          )}
          {mode === 'register-owner' ? (
            <p>
              This protected setup creates the account for your existing journal and alerts. Other users get
              their own empty workspace.
            </p>
          ) : registering ? (
            <p>
              Your journal, alerts and saved markets stay in your own account. Your email is an unverified
              sign-in identifier; password recovery always requires the separate recovery code shown after
              registration.
            </p>
          ) : mode === 'recover' ? (
            <p>Enter the recovery code you saved when you registered or last changed your password.</p>
          ) : signedIn ? (
            <p>Changing your password signs out your other sessions and gives you a new recovery code.</p>
          ) : (
            <p>Markets and the calendar are public. Sign in for your journal, alerts and saved markets.</p>
          )}
          {!registrationOpen && !ownerSetupAllowed && (
            <p className="footnote" role="status">
              Registration opens after the owner finishes account setup.
            </p>
          )}
          <form className="account-form" onSubmit={(event) => void submit(event)}>
            {registering && (
              <label>
                Display name
                <input name="name" autoComplete="nickname" required maxLength={80} disabled={pending} />
              </label>
            )}
            {mode !== 'change-password' && (
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  disabled={pending}
                />
              </label>
            )}
            {mode === 'recover' && (
              <label>
                Recovery code
                <input
                  name="recoveryCode"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  minLength={32}
                  maxLength={32}
                  disabled={pending}
                />
              </label>
            )}
            {mode === 'change-password' && (
              <label>
                Current password
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  disabled={pending}
                />
              </label>
            )}
            <label>
              {newPassword ? 'New password' : 'Password'}
              <input
                name="password"
                type="password"
                autoComplete={newPassword ? 'new-password' : 'current-password'}
                required
                minLength={newPassword ? 12 : undefined}
                maxLength={128}
                disabled={pending}
              />
            </label>
            {newPassword && (
              <>
                <p className="footnote">Use at least 12 characters. A unique passphrase works well.</p>
                <label>
                  Confirm password
                  <input
                    name="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    disabled={pending}
                  />
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button type="submit" disabled={pending}>
              {pending
                ? 'Please wait…'
                : mode === 'login'
                  ? 'Sign in to FluxDesk'
                  : mode === 'register-owner'
                    ? 'Create owner account'
                    : mode === 'register'
                      ? 'Create account'
                      : mode === 'recover'
                        ? 'Reset password'
                        : 'Change password'}
            </button>
          </form>
          {mode === 'login' && (
            <button
              type="button"
              className="account-text-button"
              disabled={pending}
              onClick={() => changeMode('recover')}
            >
              Forgot password? Use your recovery code
            </button>
          )}
          <p className="footnote">
            Use the same email to return to your records. FluxDesk does not claim or verify mailbox ownership,
            and email alone cannot reset a password. Your password and recovery code are never shown to other
            users.
          </p>
        </>
      )}
    </dialog>
  );
}
