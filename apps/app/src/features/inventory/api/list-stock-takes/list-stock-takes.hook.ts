import { apiClient } from '@borradh-workspace/api-client';
import { listStockTakesResponseSchema } from '@borradh-workspace/contracts';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';
import type { ListStockTakesInput, StockTakeListResponse } from '../types';

export const listStockTakesQueryOptions = (
  params: ListStockTakesInput = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.status) searchParams.set('status', params.status);
  if (params.locationId) searchParams.set('locationId', params.locationId);
  if (params.limit != null) searchParams.set('limit', String(params.limit));
  if (params.offset != null) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['stock-takes', 'list', params],
    queryFn: () =>
      apiClient.get<StockTakeListResponse>(`stock-takes${qs ? `?${qs}` : ''}`, {
        schema: listStockTakesResponseSchema,
      }),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });
};

export const useListStockTakes = (params: ListStockTakesInput = {}) => {
  const query = useQuery(listStockTakesQueryOptions(params));
  return {
    stockTakes: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
