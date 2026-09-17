import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface DailyInsight {
  date: string;
  views: number;
  engagements: number;
}

export interface PageInsights {
  pageId: string;
  pageName: string;
  dateRange: { since: string; until: string };
  views: number;
  engagements: number;
  totalFollowers: number;
  daily: DailyInsight[];
}

interface GetPageInsightsParams {
  since?: string;
  until?: string;
}

export const getPageInsightsQueryOptions = (
  params: GetPageInsightsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.since) searchParams.set('since', params.since);
  if (params.until) searchParams.set('until', params.until);
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['integrations', 'meta-ads', 'page-insights', params],
    queryFn: () =>
      apiClient.get<PageInsights>(
        `integrations/meta-ads/page-insights${qs ? `?${qs}` : ''}`
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });
};

interface UseGetPageInsightsOptions {
  params?: GetPageInsightsParams;
  enabled?: boolean;
}

export const useGetPageInsights = ({
  params = {},
  enabled = true,
}: UseGetPageInsightsOptions = {}) => {
  const query = useQuery({
    ...getPageInsightsQueryOptions(params),
    enabled,
  });
  return {
    insights: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
