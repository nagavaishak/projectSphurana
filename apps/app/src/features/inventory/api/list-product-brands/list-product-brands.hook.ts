import { apiClient } from '@borradh-workspace/api-client';
import { listProductBrandsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ProductBrand } from '../types';

export const listProductBrandsQueryOptions = () =>
  queryOptions({
    queryKey: ['product-brands', 'list'],
    queryFn: () =>
      apiClient.get<ProductBrand[]>('product-brands', {
        schema: listProductBrandsResponseSchema,
      }),
    staleTime: 5 * 60 * 1000,
  });

export const useListProductBrands = () => {
  const query = useQuery(listProductBrandsQueryOptions());
  return {
    brands: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
