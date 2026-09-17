import { apiClient } from '@borradh-workspace/api-client';
import { stockOrderWithItemsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { StockOrderWithItems } from '../types';

export const getStockOrderQueryOptions = (stockOrderId: string) =>
  queryOptions({
    queryKey: ['stock-orders', stockOrderId],
    queryFn: () =>
      apiClient.get<StockOrderWithItems>(`stock-orders/${stockOrderId}`, {
        schema: stockOrderWithItemsSchema,
      }),
    enabled: !!stockOrderId,
    staleTime: 60 * 1000,
  });

export const useGetStockOrder = (stockOrderId: string) => {
  const query = useQuery(getStockOrderQueryOptions(stockOrderId));
  return {
    stockOrder: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
