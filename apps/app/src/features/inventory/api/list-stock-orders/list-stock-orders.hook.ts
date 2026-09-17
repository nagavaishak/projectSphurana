import { apiClient } from '@borradh-workspace/api-client';
import { listStockOrdersResponseSchema } from '@borradh-workspace/contracts';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import type { ListStockOrdersInput, StockOrderListResponse } from '../types';

export const listStockOrdersQueryOptions = (
  params: ListStockOrdersInput = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.supplierId) searchParams.set('supplierId', params.supplierId);
  if (params.locationId) searchParams.set('locationId', params.locationId);
  if (params.limit != null) searchParams.set('limit', String(params.limit));
  if (params.offset != null) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['stock-orders', 'list', params],
    queryFn: () =>
      apiClient.get<StockOrderListResponse>(
        `stock-orders${qs ? `?${qs}` : ''}`,
        { schema: listStockOrdersResponseSchema }
      ),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useListStockOrders = (params: ListStockOrdersInput = {}) => {
  const query = useQuery(listStockOrdersQueryOptions(params));
  return {
    stockOrders: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
