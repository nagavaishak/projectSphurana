import { apiClient } from '@borradh-workspace/api-client';
import type { BatchFaceGroupsResponse } from '@borradh-workspace/api-client/types';
import { batchFaceGroupsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const getBatchFaceGroupsQueryOptions = (batchId: string) =>
  queryOptions({
    queryKey: ['face-groups', 'batch', batchId],
    queryFn: () =>
      apiClient.get<BatchFaceGroupsResponse>(`face-groups/batch/${batchId}`, {
        schema: batchFaceGroupsResponseSchema,
      }),
    enabled: !!batchId,
  });

export const useGetBatchFaceGroups = (batchId: string) => {
  const query = useQuery(getBatchFaceGroupsQueryOptions(batchId));
  return {
    faceGroups: query.data?.faceGroups ?? [],
    status: query.data?.status ?? 'complete',
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
