import { apiClient } from '@borradh-workspace/api-client';
import type { GiftCardListResponse } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Thin query hook: gift cards owned by a single client (lead).
 *
 * Defined locally under `features/clients/api` (not the gift-cards feature) so
 * this workstream stays disjoint from the sales/gift-card agent at merge time.
 * Hits the live `GET /gift-cards?leadId=` endpoint.
 */
export const clientGiftCardsQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: ['clients', leadId, 'gift-cards'],
    queryFn: () => {
      const params = new URLSearchParams({ leadId, limit: '100' });
      return apiClient.get<GiftCardListResponse>(
        `gift-cards?${params.toString()}`
      );
    },
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });

export const useClientGiftCards = (leadId: string) => {
  const query = useQuery(clientGiftCardsQueryOptions(leadId));
  return {
    giftCards: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
