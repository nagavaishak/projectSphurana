import { apiClient } from '@borradh-workspace/api-client';
import { creditPackagesResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CreditPackagesResponse } from '../types';

export const getCreditPackagesQueryOptions = () =>
  queryOptions({
    queryKey: ['billing', 'credit-packages'],
    queryFn: () =>
      apiClient.get<CreditPackagesResponse>('billing/credits/packages', {
        schema: creditPackagesResponseSchema,
      }),
    staleTime: 30 * 60 * 1000, // 30 minutes - packages rarely change
  });

export const useGetCreditPackages = () => {
  const query = useQuery(getCreditPackagesQueryOptions());

  return {
    packages: query.data?.packages ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
