import { apiClient } from '@borradh-workspace/api-client';
import type {
  ContentItemMessage,
  ListBatchItemMessagesResponse,
} from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/query-keys';

/**
 * The review thread for one post.
 *
 * Keyed by item, never by batch — the thread is per-post by design, and a
 * batch-wide key would let one post's history bleed into another's panel.
 * Switching posts in the queue swaps this query, which is what makes the
 * thread empty for an untouched post and restored for one already edited.
 */
export const batchItemMessagesQueryOptions = (itemId: string) =>
  queryOptions({
    queryKey: queryKeys.contentBatches.itemMessages(itemId),
    queryFn: () =>
      apiClient.get<ListBatchItemMessagesResponse>(
        `content-batches/items/${itemId}/messages`
      ),
    enabled: !!itemId,
    // The thread only changes through this client's own mutations, which write
    // straight into the cache — so there is nothing to poll for.
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useBatchItemMessages = (itemId: string) => {
  const query = useQuery(batchItemMessagesQueryOptions(itemId));

  return {
    messages: (query.data?.messages ?? []) as ContentItemMessage[],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
};
