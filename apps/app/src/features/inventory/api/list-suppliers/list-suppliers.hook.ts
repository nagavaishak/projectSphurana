import { apiClient } from '@borradh-workspace/api-client';
import { listSuppliersResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Supplier } from '../types';

export const listSuppliersQueryOptions = () =>
  queryOptions({
    queryKey: ['suppliers', 'list'],
    queryFn: () =>
      apiClient.get<Supplier[]>('suppliers', {
        schema: listSuppliersResponseSchema,
      }),
    staleTime: 5 * 60 * 1000,
  });

export const useListSuppliers = () => {
  const query = useQuery(listSuppliersQueryOptions());
  return {
    suppliers: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
