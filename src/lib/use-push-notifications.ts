import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
type PushState = 'checking' | 'enabled' | 'disabled' | 'unsupported' | 'error';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Notification update failed. Please retry.';

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mounted = useRef(false);
  const working = useRef(false);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    if (working.current) return;
    const revision = ++sequence.current;
    try {
      if (!supported()) {
        setState('unsupported');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = await registration?.pushManager.getSubscription();
      if (mounted.current && revision === sequence.current) setState(sub ? 'enabled' : 'disabled');
    } catch {
      if (mounted.current && revision === sequence.current) {
        setState('error');
        setMessage('Could not read notification status. Please retry.');
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      ++sequence.current;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  async function toggle() {
    if (working.current || !supported()) return;
    working.current = true;
    ++sequence.current;
    setBusy(true);
    setMessage('');
    try {
      if (state === 'enabled') {
        const registration = await navigator.serviceWorker.getRegistration();
        const sub = await registration?.pushManager.getSubscription();
        if (sub) {
          // Remove server delivery first. Failure keeps the disable action available.
          await api.unsubscribe(sub.endpoint);
          const removed = await sub.unsubscribe();
          if (!removed && (await registration!.pushManager.getSubscription()))
            throw Error('Could not remove the device subscription. Please retry disabling.');
        }
        if (mounted.current) {
          setState('disabled');
          setMessage('Push notifications disabled for this device.');
        }
      } else {
        // Keep this permission request directly in the user's click handler for iOS.
        if ((await Notification.requestPermission()) !== 'granted')
          throw Error('Notification permission was not granted');
        const { key } = await api.vapidKey();
        if (!key) throw Error('Configure VAPID keys on the server first');
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) throw Error('Reload the installed app to finish notification setup.');
        const existing = await registration.pushManager.getSubscription();
        const bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
          c.charCodeAt(0),
        );
        const sub =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: bytes as BufferSource,
          }));
        try {
          await api.subscribe(sub);
        } catch (error) {
          if (!existing) await sub.unsubscribe();
          throw error;
        }
        if (mounted.current) {
          setState('enabled');
          setMessage('Push notifications enabled for this device.');
        }
      }
    } catch (error) {
      if (mounted.current) setMessage(errorMessage(error));
    } finally {
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { state, busy, message, toggle, refresh };
}
