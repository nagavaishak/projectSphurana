import { openIntegrationOAuth } from '@/lib/open-integration-oauth';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { useCallback, useMemo } from 'react';

interface UseInitiateGoogleCalendarAuthOptions {
  /** URL path to redirect back to after OAuth completes (default: /integrations) */
  returnTo?: string;
}

/**
 * Hook to initiate Google Calendar OAuth flow
 *
 * @example
 * ```tsx
 * const { initiateAuth } = useInitiateGoogleCalendarAuth({
 *   returnTo: '/settings/integrations'
 * });
 *
 * <button onClick={initiateAuth}>Connect Google Calendar</button>
 * ```
 */
export function useInitiateGoogleCalendarAuth(
  options: UseInitiateGoogleCalendarAuthOptions = {}
) {
  const { returnTo } = options;

  const authUrl = useMemo(
    () =>
      returnTo
        ? resolveApiUrl(
            `integrations/calendar/auth/google?returnTo=${encodeURIComponent(returnTo)}`
          )
        : resolveApiUrl('integrations/calendar/auth/google'),
    [returnTo]
  );

  /**
   * Initiate the OAuth flow by redirecting to the auth endpoint
   */
  const initiateAuth = useCallback(() => {
    const path = returnTo
      ? `integrations/calendar/auth/google?returnTo=${encodeURIComponent(returnTo)}`
      : 'integrations/calendar/auth/google';
    void openIntegrationOAuth(path);
  }, [returnTo]);

  return {
    /** The full auth URL for the OAuth flow */
    authUrl,
    /** Function to initiate the OAuth redirect */
    initiateAuth,
  };
}
