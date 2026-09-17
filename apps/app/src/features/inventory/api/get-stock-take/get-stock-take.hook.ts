import { apiClient } from '@borradh-workspace/api-client';
import { stockTakeWithItemsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { StockTakeWithItems } from '../types';

export const getStockTakeQueryOptions = (stockTakeId: string) =>
  queryOptions({
    queryKey: ['stock-takes', stockTakeId],
    queryFn: () =>
      apiClient.get<StockTakeWithItems>(`stock-takes/${stockTakeId}`, {
        schema: stockTakeWithItemsSchema,
      }),
    enabled: !!stockTakeId,
    staleTime: 60 * 1000,
  });

export const useGetStockTake = (stockTakeId: string) => {
  const query = useQuery(getStockTakeQueryOptions(stockTakeId));
  return {
    stockTake: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
