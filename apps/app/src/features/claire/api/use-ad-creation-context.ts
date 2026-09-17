import { apiClient } from '@borradh-workspace/api-client';
import type { AdCreationContextResponse } from '@borradh-workspace/api-client/types';
import { adCreationContextResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const adCreationContextQueryKey = [
  'claire',
  'ad-creation-context',
] as const;

export const adCreationContextQueryOptions = (opts?: {
  pollMs?: number;
}) =>
  queryOptions({
    queryKey: adCreationContextQueryKey,
    queryFn: () =>
      apiClient.get<AdCreationContextResponse>('claire/ad-creation-context', {
        schema: adCreationContextResponseSchema,
      }),
    staleTime: 30 * 1000,
    refetchInterval: opts?.pollMs,
  });

/**
 * Fetches Claire's ad-creation recommendation context for the active org.
 *
 * When `profileState` is `pending` or `missing`, callers should poll until
 * it transitions to `fresh` (classifier is running in the background — see
 * the backend controller).
 */
export const useAdCreationContext = (opts?: { pollMs?: number }) => {
  const query = useQuery(adCreationContextQueryOptions(opts));
  return {
    context: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
