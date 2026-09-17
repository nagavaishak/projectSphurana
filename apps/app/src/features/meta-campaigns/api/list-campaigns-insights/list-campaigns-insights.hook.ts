import { apiClient } from '@borradh-workspace/api-client';
import { listCampaignInsightsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  CampaignInsightsParams,
  CampaignInsightsSummary,
  ListCampaignInsightsResponse,
} from '../types';

/**
 * Query options for the batched campaign-insights endpoint.
 *
 * A single request returns insights for every campaign in the org's ad
 * account. This replaces one `getCampaignInsights` request per campaign —
 * the per-campaign fan-out tripped Meta's rate limit on the advertising page.
 */
export const listCampaignInsightsQueryOptions = (
  params: CampaignInsightsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.since) searchParams.set('since', params.since);
  if (params.until) searchParams.set('until', params.until);
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['meta-campaigns', 'insights', params],
    queryFn: async () =>
      apiClient.get<ListCampaignInsightsResponse>(
        `meta-campaigns/insights${qs ? `?${qs}` : ''}`,
        { schema: listCampaignInsightsResponseSchema }
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes — reduce Meta API calls
  });
};

/**
 * List insights for every campaign in one request.
 *
 * Returns a `Map` keyed by Meta campaign ID so callers (the campaign table
 * rows, the stat cards) can look up a campaign's insights without each firing
 * their own request.
 */
export const useListCampaignInsights = (
  params: CampaignInsightsParams = {}
) => {
  const query = useQuery(listCampaignInsightsQueryOptions(params));

  const insightsByCampaignId = useMemo(() => {
    const map = new Map<string, CampaignInsightsSummary>();
    for (const entry of query.data?.insights ?? []) {
      map.set(entry.metaCampaignId, entry);
    }
    return map;
  }, [query.data]);

  return {
    insightsByCampaignId,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
