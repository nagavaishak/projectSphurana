import { apiClient } from '@borradh-workspace/api-client';
import { listMetaCampaignsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListCampaignsResponse } from '../types';

/**
 * Query options for listing campaigns
 * Campaigns are fetched live from Meta API
 */
export const listCampaignsQueryOptions = () => {
  return queryOptions({
    queryKey: ['meta-campaigns'],
    queryFn: async () => {
      return apiClient.get<ListCampaignsResponse>('meta-campaigns', {
        schema: listMetaCampaignsResponseSchema,
      });
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — reduce Meta API calls to avoid rate limits
  });
};

interface UseListCampaignsOptions {
  enabled?: boolean;
}

/**
 * List campaigns hook
 * Returns all campaigns for the current organization from Meta API
 */
export const useListCampaigns = ({
  enabled = true,
}: UseListCampaignsOptions = {}) => {
  const query = useQuery({
    ...listCampaignsQueryOptions(),
    enabled,
  });

  return {
    campaigns: query.data?.campaigns ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
