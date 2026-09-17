import { apiClient } from '@borradh-workspace/api-client';
import type { OfferWithServices } from '@borradh-workspace/api-client/types';
import { offerWithServicesSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getOfferQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['offers', id],
    queryFn: () =>
      apiClient.get<OfferWithServices>(`offers/${id}`, {
        schema: offerWithServicesSchema,
      }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

export const useGetOffer = (id: string) => {
  const query = useQuery(getOfferQueryOptions(id));
  return {
    data: query.data ?? null,
    offer: query.data?.offer ?? null,
    serviceIds: query.data?.serviceIds ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
