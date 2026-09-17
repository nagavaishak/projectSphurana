import { apiClient } from '@borradh-workspace/api-client';
import { listProductsResponseSchema } from '@borradh-workspace/contracts';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import type { ListProductsInput, ProductListResponse } from '../types';

export const listProductsQueryOptions = (params: ListProductsInput = {}) => {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set('search', params.search);
  if (params.categoryId) searchParams.set('categoryId', params.categoryId);
  if (params.brandId) searchParams.set('brandId', params.brandId);
  if (params.supplierId) searchParams.set('supplierId', params.supplierId);
  if (params.includeInactive != null) {
    searchParams.set('includeInactive', String(params.includeInactive));
  }
  if (params.limit != null) searchParams.set('limit', String(params.limit));
  if (params.offset != null) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['products', 'list', params],
    queryFn: () =>
      apiClient.get<ProductListResponse>(`products${qs ? `?${qs}` : ''}`, {
        schema: listProductsResponseSchema,
      }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useListProducts = (params: ListProductsInput = {}) => {
  const query = useQuery(listProductsQueryOptions(params));
  return {
    products: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
