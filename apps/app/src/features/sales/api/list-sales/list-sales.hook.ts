import { apiClient } from '@borradh-workspace/api-client';
import type {
  SaleListResponse,
  SaleStatus,
} from '@borradh-workspace/api-client/types';
import { saleListResponseSchema } from '@borradh-workspace/contracts';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';

export interface ListSalesParams {
  from?: string;
  to?: string;
  status?: SaleStatus;
  leadId?: string;
  limit?: number;
  offset?: number;
}

export const listSalesQueryOptions = (params: ListSalesParams = {}) => {
  const searchParams = new URLSearchParams();
  if (params.from) searchParams.set('from', params.from);
  if (params.to) searchParams.set('to', params.to);
  if (params.status) searchParams.set('status', params.status);
  if (params.leadId) searchParams.set('leadId', params.leadId);
  if (params.limit != null) searchParams.set('limit', String(params.limit));
  if (params.offset != null) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['sales', 'list', params],
    queryFn: () =>
      apiClient.get<SaleListResponse>(`sales${qs ? `?${qs}` : ''}`, {
        schema: saleListResponseSchema,
      }),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
};

export const useListSales = (params: ListSalesParams = {}) => {
  const query = useQuery(listSalesQueryOptions(params));
  return {
    sales: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
