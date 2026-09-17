import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface SelfServeStripeLink {
  url: string;
  redirectUri: string;
}

/**
 * The onboarding link an operator sends a merchant. Constant per environment,
 * so it is cached for the session rather than refetched per organization.
 */
export const selfServeStripeLinkQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminTerminal.selfServeStripeLink(),
    queryFn: () =>
      apiClient.get<SelfServeStripeLink>(
        'admin-terminal/stripe/self-serve-link'
      ),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

export const useSelfServeStripeLink = () => {
  const query = useQuery(selfServeStripeLinkQueryOptions());
  return {
    link: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
