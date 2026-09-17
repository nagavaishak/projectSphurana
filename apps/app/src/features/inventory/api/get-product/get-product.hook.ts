import { apiClient } from '@borradh-workspace/api-client';
import { productSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Product } from '../types';

export const getProductQueryOptions = (productId: string) =>
  queryOptions({
    queryKey: ['products', productId],
    queryFn: () =>
      apiClient.get<Product>(`products/${productId}`, {
        schema: productSchema,
      }),
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  });

export const useGetProduct = (productId: string) => {
  const query = useQuery(getProductQueryOptions(productId));
  return {
    product: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
