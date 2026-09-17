import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Asset } from '../types';

interface ListAssetsByServiceResponse {
  items: Asset[];
}

export const listAssetsByServiceQueryOptions = (
  serviceId: string,
  type: 'video' | 'image' = 'video'
) =>
  queryOptions({
    queryKey: ['assets', 'by-service', serviceId, type],
    queryFn: () =>
      apiClient.get<ListAssetsByServiceResponse>(
        `assets/by-service/${serviceId}?type=${type}`
      ),
    enabled: !!serviceId,
    staleTime: 5 * 60 * 1000,
  });

export const useListAssetsByService = (
  serviceId: string,
  type: 'video' | 'image' = 'video'
) => {
  const query = useQuery(listAssetsByServiceQueryOptions(serviceId, type));
  return {
    assets: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
