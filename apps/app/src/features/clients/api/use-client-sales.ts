import { apiClient } from '@borradh-workspace/api-client';
import type { SaleListResponse } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Thin query hook: sales history for a single client (lead).
 *
 * Defined locally under `features/clients/api` (not the sales feature) so this
 * workstream stays disjoint from the sales agent at merge time. Hits the live
 * `GET /sales?leadId=` endpoint, which returns `SaleWithRelations` (items +
 * payments) so the profile can show totals and line details.
 */
export const clientSalesQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: ['clients', leadId, 'sales'],
    queryFn: () => {
      const params = new URLSearchParams({ leadId, limit: '100' });
      return apiClient.get<SaleListResponse>(`sales?${params.toString()}`);
    },
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });

export const useClientSales = (leadId: string) => {
  const query = useQuery(clientSalesQueryOptions(leadId));
  return {
    sales: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
