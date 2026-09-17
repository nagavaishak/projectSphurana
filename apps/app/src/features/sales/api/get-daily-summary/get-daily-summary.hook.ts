import { apiClient } from '@borradh-workspace/api-client';
import type { SaleDailySummary } from '@borradh-workspace/api-client/types';
import { saleDailySummarySchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface DailySummaryParams {
  /** Calendar date, YYYY-MM-DD. */
  date: string;
  locationId?: string;
}

export const getDailySummaryQueryOptions = (params: DailySummaryParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set('date', params.date);
  if (params.locationId) searchParams.set('locationId', params.locationId);

  return queryOptions({
    queryKey: ['sales', 'daily-summary', params],
    queryFn: () =>
      apiClient.get<SaleDailySummary>(
        `sales/daily-summary?${searchParams.toString()}`,
        { schema: saleDailySummarySchema }
      ),
    enabled: !!params.date,
    staleTime: 30 * 1000,
  });
};

export const useGetDailySummary = (params: DailySummaryParams) => {
  const query = useQuery(getDailySummaryQueryOptions(params));
  return {
    summary: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
