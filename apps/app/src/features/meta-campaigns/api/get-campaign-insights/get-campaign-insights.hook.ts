import { apiClient } from '@borradh-workspace/api-client';
import { metaCampaignInsightsSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CampaignInsights, CampaignInsightsParams } from '../types';

/**
 * Query options for getting campaign insights
 * campaignId is the Meta campaign ID
 */
export const getCampaignInsightsQueryOptions = (
  campaignId: string,
  params: CampaignInsightsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.since) searchParams.set('since', params.since);
  if (params.until) searchParams.set('until', params.until);
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['meta-campaigns', campaignId, 'insights', params],
    queryFn: async () => {
      return apiClient.get<CampaignInsights>(
        `meta-campaigns/${campaignId}/insights${qs ? `?${qs}` : ''}`,
        { schema: metaCampaignInsightsSchema }
      );
    },
    enabled: !!campaignId,
    staleTime: 5 * 60 * 1000, // 5 minutes — reduce Meta API calls to avoid rate limits
  });
};

interface UseGetCampaignInsightsOptions {
  campaignId: string;
  params?: CampaignInsightsParams;
  enabled?: boolean;
}

/**
 * Get campaign insights hook
 * Returns performance metrics for a campaign from Meta Ads
 * campaignId is the Meta campaign ID
 */
export const useGetCampaignInsights = ({
  campaignId,
  params = {},
  enabled = true,
}: UseGetCampaignInsightsOptions) => {
  const query = useQuery({
    ...getCampaignInsightsQueryOptions(campaignId, params),
    enabled: enabled && !!campaignId,
  });

  return {
    insights: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
