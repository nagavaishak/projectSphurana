import { apiClient } from '@borradh-workspace/api-client';
import { getAssetAnalysisResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GetAssetAnalysisResponse } from '../types';

export const getAssetAnalysisQueryOptions = (assetId: string) =>
  queryOptions({
    queryKey: ['assets', assetId, 'analysis'],
    queryFn: () =>
      apiClient.get<GetAssetAnalysisResponse>(`assets/${assetId}/analysis`, {
        schema: getAssetAnalysisResponseSchema,
      }),
    enabled: !!assetId,
    staleTime: 60 * 1000, // 1 minute
  });

export const useGetAssetAnalysis = (assetId: string) => {
  const query = useQuery(getAssetAnalysisQueryOptions(assetId));

  return {
    analysis: query.data?.analysis ?? null,
    linkedServices: query.data?.linkedServices ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
