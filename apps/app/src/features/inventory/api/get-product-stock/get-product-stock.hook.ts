import { apiClient } from '@borradh-workspace/api-client';
import { listProductStockResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ProductStock } from '../types';

export const getProductStockQueryOptions = (productId: string) =>
  queryOptions({
    queryKey: ['products', productId, 'stock'],
    queryFn: () =>
      apiClient.get<ProductStock[]>(`products/${productId}/stock`, {
        schema: listProductStockResponseSchema,
      }),
    enabled: !!productId,
    staleTime: 60 * 1000,
  });

export const useGetProductStock = (productId: string) => {
  const query = useQuery(getProductStockQueryOptions(productId));
  return {
    stock: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
