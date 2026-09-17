import { apiClient } from '@borradh-workspace/api-client';
import { listAdsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListAdsParams, ListAdsResponse } from '../types';

/**
 * Query options for listing ads for a campaign
 * campaignId is now the Meta campaign ID
 */
export const listAdsQueryOptions = (params: ListAdsParams) => {
  const queryParams = new URLSearchParams();
  if (params.status) queryParams.set('status', params.status);
  if (params.limit) queryParams.set('limit', params.limit.toString());
  if (params.offset) queryParams.set('offset', params.offset.toString());
  const queryString = queryParams.toString();

  return queryOptions({
    queryKey: ['meta-ads', 'campaign', params.metaCampaignId, params],
    queryFn: async () => {
      return apiClient.get<ListAdsResponse>(
        `meta-ads/campaigns/${params.metaCampaignId}${queryString ? `?${queryString}` : ''}`,
        { schema: listAdsResponseSchema }
      );
    },
    enabled: !!params.metaCampaignId,
    staleTime: 5 * 60 * 1000, // 5 minutes — reduce Meta API calls to avoid rate limits
  });
};

/**
 * List ads hook
 * Returns all ads for a specific Meta campaign
 */
export const useListAds = (params: ListAdsParams) => {
  const query = useQuery(listAdsQueryOptions(params));

  return {
    ads: query.data?.ads ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
