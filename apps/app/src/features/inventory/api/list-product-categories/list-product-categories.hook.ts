import { apiClient } from '@borradh-workspace/api-client';
import { listProductCategoriesResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ProductCategory } from '../types';

export const listProductCategoriesQueryOptions = () =>
  queryOptions({
    queryKey: ['product-categories', 'list'],
    queryFn: () =>
      apiClient.get<ProductCategory[]>('product-categories', {
        schema: listProductCategoriesResponseSchema,
      }),
    staleTime: 5 * 60 * 1000,
  });

export const useListProductCategories = () => {
  const query = useQuery(listProductCategoriesQueryOptions());
  return {
    categories: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
