/** Check on resume/reconnect and periodically, without reloading unsaved work. */
export function monitorPwaUpdates(registration: ServiceWorkerRegistration, onError: () => void) {
  let stopped = false,
    busy = false,
    lastCheck = 0;
  const check = async (force = false) => {
    if (
      stopped ||
      busy ||
      !navigator.onLine ||
      document.visibilityState === 'hidden' ||
      (!force && Date.now() - lastCheck < 60_000)
    )
      return;
    busy = true;
    lastCheck = Date.now();
    try {
      await registration.update();
    } catch {
      if (!stopped) onError();
    } finally {
      busy = false;
    }
  };
  const resume = () => {
    void check();
  };
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  document.addEventListener('visibilitychange', resume);
  const timer = window.setInterval(resume, 5 * 60_000);
  return {
    check,
    stop() {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    },
  };
}
