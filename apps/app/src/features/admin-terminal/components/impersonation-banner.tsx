import { apiClient } from '@borradh-workspace/api-client';
import { ArrowLeft, LoaderCircle, ShieldAlert, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  clearAdminSessionToken,
  getAdminSessionToken,
} from '@/lib/admin-session-token';
import { setAuthTokenAndPersist } from '@/lib/auth-token';
import { useSession } from '@/lib/session';

import { returnToAdminPanel } from '../lib/return-to-admin-panel';

export function ImpersonationBanner() {
  const { data } = useSession();
  const user = data?.user;
  const session = data?.session;
  const [isOpen, setIsOpen] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const impersonatedBy = session?.impersonatedBy;

  const handleStopImpersonating = useCallback(async () => {
    setIsStopping(true);
    try {
      const result = await apiClient.post<{ token?: string }>(
        'admin-terminal/stop-impersonating',
        { adminSessionToken: getAdminSessionToken() }
      );
      // Swap the Bearer back to the restored admin session — the cookie alone
      // is not what this client authenticates with.
      if (result?.token) await setAuthTokenAndPersist(result.token);
      clearAdminSessionToken();
      // Full reload so the restored admin session is picked up, then land
      // straight back in the admin panel.
      returnToAdminPanel();
    } catch {
      setIsStopping(false);
      setIsOpen(true);
      toast.error('Could not return to the admin panel. Please try again.');
    }
  }, []);

  if (!impersonatedBy) return null;

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        if (!isStopping || open) setIsOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          disabled={isStopping}
          aria-label="Open return to admin panel controls"
          className="fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom,0px))] z-[100] size-10 rounded-full p-0 shadow-lg"
        >
          {isStopping ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ArrowLeft className="size-4" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        role="dialog"
        aria-label="Admin impersonation controls"
        side="top"
        align="end"
        sideOffset={8}
        collisionPadding={16}
        onInteractOutside={(event) => {
          if (isStopping) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (isStopping) event.preventDefault();
        }}
        className="z-[100] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl p-0 shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b px-4 py-3.5">
          <div className="bg-destructive/10 text-destructive flex size-9 shrink-0 items-center justify-center rounded-full">
            <ShieldAlert className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Admin impersonation active</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              You are viewing the app as{' '}
              <strong className="text-foreground break-words font-medium">
                {user?.email ?? 'a user'}
              </strong>
              .
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isStopping}
            aria-label="Close return to admin panel controls"
            onClick={() => setIsOpen(false)}
            className="-mt-1 -mr-1"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="p-3">
          <Button
            type="button"
            variant="destructive"
            disabled={isStopping}
            onClick={handleStopImpersonating}
            className="w-full"
          >
            {isStopping ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowLeft className="size-4" />
            )}
            {isStopping ? 'Returning to admin panel' : 'Back to admin panel'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
