import { apiClient } from '@borradh-workspace/api-client';
import { creditBalanceResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CreditBalanceResponse } from '../types';

export const getCreditBalanceQueryOptions = () =>
  queryOptions({
    queryKey: ['billing', 'credits'],
    queryFn: () =>
      apiClient.get<CreditBalanceResponse>('billing/credits', {
        schema: creditBalanceResponseSchema,
      }),
    staleTime: 60 * 1000, // 1 minute - credits change more frequently
  });

export const useGetCreditBalance = () => {
  const query = useQuery(getCreditBalanceQueryOptions());

  return {
    balance: query.data?.balance ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
