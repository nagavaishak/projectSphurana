import { apiClient } from '@borradh-workspace/api-client';
import type { StripeConnectStatus } from '@borradh-workspace/api-client/types';
import { stripeConnectStatusSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getAccountStatusQueryOptions = () =>
  queryOptions({
    queryKey: ['integrations', 'stripe', 'account-status'],
    queryFn: () =>
      apiClient.get<StripeConnectStatus>('integrations/stripe/account-status', {
        schema: stripeConnectStatusSchema,
      }),
    staleTime: 60 * 1000,
  });

export const useGetAccountStatus = () => {
  const query = useQuery(getAccountStatusQueryOptions());
  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
