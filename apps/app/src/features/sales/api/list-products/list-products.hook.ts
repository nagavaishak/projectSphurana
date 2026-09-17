import { apiClient } from '@borradh-workspace/api-client';
import type { Product } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface ProductListResponse {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListProductsParams {
  search?: string;
  limit?: number;
}

export const listProductsQueryOptions = (params: ListProductsParams = {}) => {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  searchParams.set('limit', String(params.limit ?? 100));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['products', 'list', params],
    queryFn: () =>
      apiClient.get<ProductListResponse>(`products${qs ? `?${qs}` : ''}`),
    staleTime: 60 * 1000,
  });
};

/** Retail-enabled products for the POS cart picker. */
export const useListProducts = (params: ListProductsParams = {}) => {
  const query = useQuery(listProductsQueryOptions(params));
  return {
    products: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
