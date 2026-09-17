import { openIntegrationOAuth } from '@/lib/open-integration-oauth';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { useCallback, useMemo } from 'react';

interface UseInitiateMetaAdsAuthOptions {
  /** URL to redirect back to after OAuth completes */
  returnTo?: string;
}

/**
 * Hook to initiate Meta Ads (Facebook) OAuth flow
 *
 * @example
 * ```tsx
 * const { initiateAuth, authUrl } = useInitiateMetaAdsAuth({
 *   returnTo: '/integrations'
 * });
 *
 * <button onClick={initiateAuth}>Connect Meta Ads</button>
 * ```
 */
export function useInitiateMetaAdsAuth(
  options: UseInitiateMetaAdsAuthOptions = {}
) {
  const { returnTo } = options;

  const authUrl = useMemo(
    () =>
      returnTo
        ? resolveApiUrl(
            `integrations/meta-ads/auth?returnTo=${encodeURIComponent(returnTo)}`
          )
        : resolveApiUrl('integrations/meta-ads/auth'),
    [returnTo]
  );

  /**
   * Initiate the OAuth flow by redirecting to the auth endpoint
   */
  const initiateAuth = useCallback(() => {
    const path = returnTo
      ? `integrations/meta-ads/auth?returnTo=${encodeURIComponent(returnTo)}`
      : 'integrations/meta-ads/auth';
    void openIntegrationOAuth(path);
  }, [returnTo]);

  return {
    /** The full auth URL for the OAuth flow */
    authUrl,
    /** Function to initiate the OAuth redirect */
    initiateAuth,
  };
}
