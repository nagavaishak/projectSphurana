import { openIntegrationOAuth } from '@/lib/open-integration-oauth';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { useCallback, useMemo } from 'react';

interface UseInitiateBookingAuthOptions {
  provider: 'calendly' | 'timely';
  returnTo?: string;
}

export function useInitiateBookingAuth(options: UseInitiateBookingAuthOptions) {
  const { provider, returnTo } = options;

  const authUrl = useMemo(
    () =>
      returnTo
        ? resolveApiUrl(
            `integrations/booking/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`
          )
        : resolveApiUrl(`integrations/booking/auth/${provider}`),
    [provider, returnTo]
  );

  const initiateAuth = useCallback(() => {
    const path = returnTo
      ? `integrations/booking/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`
      : `integrations/booking/auth/${provider}`;
    void openIntegrationOAuth(path);
  }, [provider, returnTo]);

  return {
    authUrl,
    initiateAuth,
  };
}
