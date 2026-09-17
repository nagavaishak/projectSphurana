import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { getContentBatchResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GetBatchResponse } from '../../types';

export const getBatchQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ['content-batches', id],
    queryFn: async () => {
      return apiClient.get<GetBatchResponse>(`content-batches/${id}`, {
        schema: getContentBatchResponseSchema,
      });
    },
    enabled: !!id,
    staleTime: 30 * 1000,
  });

type UseGetBatchOptions = {
  id: string;
  queryConfig?: QueryConfig<typeof getBatchQueryOptions>;
};

export const useGetBatch = ({ id, queryConfig }: UseGetBatchOptions) => {
  const query = useQuery({
    ...getBatchQueryOptions(id),
    ...queryConfig,
  });

  return {
    batch: query.data?.batch ?? null,
    items: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
