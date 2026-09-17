import { apiClient } from '@borradh-workspace/api-client';
import { listAssetsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AssetSource, AssetType, ListAssetsResponse } from '../types';

interface ListAssetsParams {
  type?: AssetType;
  source?: AssetSource;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * Query options for listing assets
 */
export const listAssetsQueryOptions = (params?: ListAssetsParams) => {
  const queryParams = new URLSearchParams();
  if (params?.type) queryParams.set('type', params.type);
  if (params?.source) queryParams.set('source', params.source);
  if (params?.tags && params.tags.length > 0)
    queryParams.set('tags', params.tags.join(','));
  if (params?.limit) queryParams.set('limit', params.limit.toString());
  if (params?.offset) queryParams.set('offset', params.offset.toString());
  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: [
      'assets',
      params?.type,
      params?.source,
      params?.tags,
      params?.limit,
      params?.offset,
    ],
    queryFn: async () => {
      return apiClient.get<ListAssetsResponse>(
        `assets${queryString ? `?${queryString}` : ''}`,
        { schema: listAssetsResponseSchema }
      );
    },
    staleTime: 30 * 1000, // 30 seconds
  });
};

/**
 * List Assets Hook
 * Returns all assets for the current organization
 */
export const useListAssets = (params?: ListAssetsParams) => {
  const query = useQuery(listAssetsQueryOptions(params));

  return {
    assets: query.data?.items ?? [],
    /** Server-side total for the query — may exceed `assets.length` when the
     *  `limit` truncates the result, so callers can surface "showing N of M". */
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
