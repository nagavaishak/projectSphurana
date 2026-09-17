import { apiClient } from '@borradh-workspace/api-client';
import type { GiftCardListResponse } from '@borradh-workspace/api-client/types';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';

export interface ListGiftCardsParams {
  limit?: number;
  offset?: number;
}

export const listGiftCardsQueryOptions = (params: ListGiftCardsParams = {}) => {
  const searchParams = new URLSearchParams();
  if (params.limit != null) searchParams.set('limit', String(params.limit));
  if (params.offset != null) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['gift-cards', 'list', params],
    queryFn: () =>
      apiClient.get<GiftCardListResponse>(`gift-cards${qs ? `?${qs}` : ''}`),
    placeholderData: keepPreviousData,
    staleTime: 30 * 1000,
  });
};

export const useListGiftCards = (params: ListGiftCardsParams = {}) => {
  const query = useQuery(listGiftCardsQueryOptions(params));
  return {
    giftCards: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
