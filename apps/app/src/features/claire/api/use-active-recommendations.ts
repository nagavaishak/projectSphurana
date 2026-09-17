import { apiClient } from '@borradh-workspace/api-client';
import type { AssistantRecommendation } from '@borradh-workspace/api-client/types';
import { listRecommendationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Active recommendations for the current org.
 * Org-wide scope (Decision 5) — every user in the org sees the same rows.
 * Backend returns rows with `state = 'active'`, ordered by priority.
 */
export const activeRecommendationsQueryOptions = () =>
  queryOptions({
    queryKey: ['claire-recommendations'],
    queryFn: () =>
      apiClient.get<AssistantRecommendation[]>('claire/recommendations', {
        schema: listRecommendationsResponseSchema,
      }),
    staleTime: 60_000,
  });

export const useActiveRecommendations = () => {
  const query = useQuery(activeRecommendationsQueryOptions());
  return {
    recommendations: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
