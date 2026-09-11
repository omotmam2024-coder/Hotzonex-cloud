import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui/button';

/** A new version is ready: ask, never reload a technician mid-onboarding. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-50 flex flex-wrap items-center gap-3 rounded-lg border bg-popover p-3 text-sm shadow-lg sm:left-auto sm:right-4 sm:max-w-sm">
      <span className="flex-1">A new version of Hotzonex Cloud is available.</span>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
      <Button size="sm" onClick={() => void updateServiceWorker(true)}>
        Reload
      </Button>
    </div>
  );
}
