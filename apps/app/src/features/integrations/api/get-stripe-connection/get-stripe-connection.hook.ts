import { apiClient } from '@borradh-workspace/api-client';
import type { StripeConnectIntegration } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getStripeConnectionQueryOptions = () =>
  queryOptions({
    queryKey: ['integrations', 'stripe'],
    queryFn: () =>
      apiClient.get<StripeConnectIntegration | null>(
        'integrations/stripe/integration'
      ),
    staleTime: 5 * 60 * 1000,
  });

export const useGetStripeConnection = () => {
  const query = useQuery(getStripeConnectionQueryOptions());
  return {
    connection: query.data ?? null,
    isConnected: !!query.data?.isActive,
    chargesEnabled: query.data?.chargesEnabled ?? false,
    payoutsEnabled: query.data?.payoutsEnabled ?? false,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
