import { apiClient } from '@borradh-workspace/api-client';
import type {
  ListOffersResponse,
  OfferState,
} from '@borradh-workspace/api-client/types';
import { listOffersResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface ListOffersParams {
  /** Filter by offer state (replaces the old `isActive` boolean). */
  state?: OfferState;
  limit?: number;
  offset?: number;
}

export const listOffersQueryOptions = (params: ListOffersParams = {}) => {
  const searchParams = new URLSearchParams();
  if (params.state) searchParams.set('state', params.state);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.offset) searchParams.set('offset', String(params.offset));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['offers', 'list', params],
    queryFn: () =>
      apiClient.get<ListOffersResponse>(`offers${qs ? `?${qs}` : ''}`, {
        schema: listOffersResponseSchema,
      }),
    staleTime: 60 * 1000,
  });
};

export const useListOffers = (params: ListOffersParams = {}) => {
  const query = useQuery(listOffersQueryOptions(params));
  return {
    offers: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
