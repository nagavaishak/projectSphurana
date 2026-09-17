import { Browser } from '@capacitor/browser';
import { DownloadIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

import { useCheckAppVersion } from '../api/check-app-version';

const openStore = async (url: string) => {
  try {
    await Browser.open({ url });
  } catch {
    // Web, or the plugin is unavailable.
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

/**
 * Blocks or nudges an out-of-date native build.
 *
 * Mounted at the root, above the router: a blocked build must be told so
 * before it can sign in, and the block has to survive navigation.
 *
 * `update_required` renders a full-screen, non-dismissible screen. There is
 * deliberately no escape — the whole point is that this build can no longer
 * talk to the API safely, and a "continue anyway" button would be used.
 *
 * Everything else about this component fails towards letting people in: no
 * check on web, no check while loading, no check when the request fails.
 */
export function AppVersionGate({ children }: { children: React.ReactNode }) {
  const { check } = useCheckAppVersion();
  const nudged = useRef(false);

  const status = check?.status;
  const storeUrl = check?.storeUrl ?? null;

  useEffect(() => {
    // One nudge per app session. This fires on a cold start, when the user is
    // trying to do something else; a toast they can ignore is the right weight
    // for "there is a newer version".
    if (status !== 'update_available' || nudged.current || !storeUrl) return;
    nudged.current = true;

    toast('A new version of Borradh is available', {
      action: {
        label: 'Update',
        onClick: () => void openStore(storeUrl),
      },
    });
  }, [status, storeUrl]);

  if (status === 'update_required') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-8 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-muted">
          <DownloadIcon className="size-7 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Update required</h1>
          <p className="max-w-sm text-muted-foreground">
            This version of Borradh is no longer supported. Update to the latest
            version to keep going.
          </p>
        </div>
        {storeUrl && (
          <Button size="lg" onClick={() => void openStore(storeUrl)}>
            <DownloadIcon />
            Update now
          </Button>
        )}
        {check?.currentVersion && (
          <p className="text-xs text-muted-foreground">
            You have version {check.currentVersion}
            {check.minimumVersion ? ` · minimum ${check.minimumVersion}` : ''}
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
