import { apiClient } from '@borradh-workspace/api-client';
import { adSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Ad } from '../types';

/**
 * Query options for getting a single ad
 */
export const getAdQueryOptions = (adId: string) => {
  return queryOptions({
    queryKey: ['meta-ads', adId],
    queryFn: async () => {
      return apiClient.get<Ad>(`meta-ads/${adId}`, { schema: adSchema });
    },
    enabled: !!adId,
    staleTime: 30 * 1000,
  });
};

/**
 * Get ad hook
 * Returns a single ad with its video
 */
export const useGetAd = (adId: string) => {
  const query = useQuery(getAdQueryOptions(adId));

  return {
    ad: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
