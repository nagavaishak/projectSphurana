import { apiClient } from '@borradh-workspace/api-client';
import type { QueryConfig } from '@borradh-workspace/api-client/react-query';
import { getContentBatchResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GetBatchResponse } from '../../types';

export const getCurrentBatchQueryOptions = () =>
  queryOptions({
    queryKey: ['content-batches', 'current'],
    queryFn: async () => {
      return apiClient.get<GetBatchResponse>('content-batches/current', {
        schema: getContentBatchResponseSchema,
      });
    },
    staleTime: 30 * 1000,
    // Poll while the batch is still being produced, so the page reacts without
    // a manual refresh:
    //   - `planning`: the "Create Batch" background seed hasn't landed yet
    //     (no items) — poll for them to appear.
    //   - any pending item whose asset is still rendering — poll so the review
    //     banner flips from "generating" to "ready" the moment renders finish.
    // Stop once every pending item is terminal (`ready`/`failed`).
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data?.batch) return false;
      if (data.batch.status === 'planning') return 3000;
      const anyRendering = data.items.some((i) => {
        if (i.reviewStatus !== 'pending') return false;
        const status =
          i.kind === 'graphic' ? i.graphic?.status : i.video?.status;
        return !status || (status !== 'ready' && status !== 'failed');
      });
      return anyRendering ? 3000 : false;
    },
    retry: (failureCount, error: unknown) => {
      // 404 = no batch this month yet — don't retry, surface as empty state.
      const status =
        error && typeof error === 'object' && 'status' in error
          ? (error as { status?: number }).status
          : undefined;
      if (status === 404) return false;
      return failureCount < 3;
    },
  });

type UseGetCurrentBatchOptions = {
  queryConfig?: QueryConfig<typeof getCurrentBatchQueryOptions>;
};

export const useGetCurrentBatch = ({
  queryConfig,
}: UseGetCurrentBatchOptions = {}) => {
  const query = useQuery({
    ...getCurrentBatchQueryOptions(),
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
