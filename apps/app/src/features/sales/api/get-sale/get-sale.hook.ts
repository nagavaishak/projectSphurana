import { apiClient } from '@borradh-workspace/api-client';
import type { SaleWithRelations } from '@borradh-workspace/api-client/types';
import { saleWithRelationsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getSaleQueryOptions = (saleId: string) =>
  queryOptions({
    queryKey: ['sales', 'detail', saleId],
    queryFn: () =>
      apiClient.get<SaleWithRelations>(`sales/${saleId}`, {
        schema: saleWithRelationsSchema,
      }),
    enabled: !!saleId,
    staleTime: 0,
    // Poll while a processed tender (QR self-checkout / card terminal) is
    // awaiting its Stripe webhook, so the settled status pulls in
    // automatically without the user having to refresh.
    refetchInterval: (query) =>
      query.state.data?.payments?.some((p) => p.status === 'pending')
        ? 3000
        : false,
  });

export const useGetSale = (saleId: string) => {
  const query = useQuery(getSaleQueryOptions(saleId));
  return {
    sale: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
