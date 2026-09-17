import { apiClient } from '@borradh-workspace/api-client';
import { assetSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { Asset } from '../types';

/**
 * Query options for getting a single asset
 */
export const getAssetQueryOptions = (id: string) => {
  return queryOptions({
    queryKey: ['assets', id],
    queryFn: async () => {
      return apiClient.get<Asset>(`assets/${id}`, { schema: assetSchema });
    },
    enabled: !!id,
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * Get Asset Hook
 * Returns a single asset by ID
 */
export const useGetAsset = (id: string) => {
  const query = useQuery(getAssetQueryOptions(id));

  return {
    asset: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
