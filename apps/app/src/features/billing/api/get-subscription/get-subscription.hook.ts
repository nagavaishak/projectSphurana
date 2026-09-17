import { apiClient } from '@borradh-workspace/api-client';
import { subscriptionResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { SubscriptionResponse } from '../types';

export const getSubscriptionQueryOptions = () =>
  queryOptions({
    queryKey: ['billing', 'subscription'],
    queryFn: () =>
      apiClient.get<SubscriptionResponse>('billing/subscription', {
        schema: subscriptionResponseSchema,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

export const useGetSubscription = () => {
  const query = useQuery(getSubscriptionQueryOptions());

  return {
    subscription: query.data?.subscription ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
