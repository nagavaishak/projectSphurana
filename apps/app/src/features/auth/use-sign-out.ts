import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

import { resetUser } from '@/components/posthog-provider';
import { clearAuthToken } from '@/lib/auth-token';
import { intercomLogout } from '@/lib/intercom';
import { unregisterPushNotifications } from '@/lib/push';
import { clearSessionCache } from '@/lib/session';

interface UseSignOutOptions {
  onSuccess?: () => void;
}

export function useSignOut(options?: UseSignOutOptions) {
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => apiClient.post('auth/sign-out'),
    onSettled: () => {
      void intercomLogout();
      // Delete the server-side push-token row + tell the native plugin to
      // stop receiving notifications. Best-effort, server-side cleanup also
      // happens via DeviceNotRegistered receipts on next push attempt.
      void unregisterPushNotifications();
      // Detach the PostHog distinct_id so the next signed-out session isn't
      // attributed to the user who just left (esp. shared/native devices).
      resetUser();
      clearAuthToken();
      clearSessionCache();

      // Leave the authenticated app. Clearing local state does NOT re-run the
      // router's `beforeLoad` guards, so without this the user sat on a
      // now-unauthenticated page until something else forced a navigation.
      // Only nav-user and nav-org passed an onSuccess that navigated — the
      // header, dashboard-header and signed-in-indicator all stranded you.
      // Done here so every caller gets it; the callers that already navigate
      // to /sign-in are unaffected (same destination).
      void navigate({ to: '/sign-in' });

      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      // sign-out failures still clear local state — server-side may already be invalid
      toast.error(
        error.message || 'Sign out had a problem (session cleared locally)'
      );
    },
  });

  return {
    signOut: mutation.mutate,
    isSigningOut: mutation.isPending,
  };
}
