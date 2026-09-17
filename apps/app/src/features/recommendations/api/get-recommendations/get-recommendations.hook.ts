import { apiClient } from '@borradh-workspace/api-client';
import type {
  GetRecommendationsParams,
  RecommendationsResult,
} from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getRecommendationsQueryOptions = (
  params: GetRecommendationsParams = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.days) searchParams.set('days', String(params.days));
  if (params.limit) searchParams.set('limit', String(params.limit));
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['recommendations', params],
    queryFn: async () => {
      return apiClient.get<RecommendationsResult>(
        `recommendations${qs ? `?${qs}` : ''}`
      );
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
};

interface UseGetRecommendationsOptions {
  params?: GetRecommendationsParams;
  enabled?: boolean;
}

export const useGetRecommendations = ({
  params = {},
  enabled = true,
}: UseGetRecommendationsOptions = {}) => {
  const query = useQuery({
    ...getRecommendationsQueryOptions(params),
    enabled,
  });

  return {
    recommendations: query.data?.recommendations ?? [],
    hasMetaIntegration: query.data?.hasMetaIntegration ?? false,
    analyzedAdsCount: query.data?.analyzedAdsCount ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
