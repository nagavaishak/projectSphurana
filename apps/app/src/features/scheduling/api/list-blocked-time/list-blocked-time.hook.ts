import { apiClient } from '@borradh-workspace/api-client';
import { listBlockedTimeResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { BlockedTimeWithPractitioners } from '../types';

export interface ListBlockedTimeParams {
  /** ISO datetime string — start of the expansion window. */
  from: string;
  /** ISO datetime string — end of the expansion window. */
  to: string;
  practitionerId?: string;
}

export const listBlockedTimeQueryOptions = (params: ListBlockedTimeParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set('from', params.from);
  searchParams.set('to', params.to);
  if (params.practitionerId) {
    searchParams.set('practitionerId', params.practitionerId);
  }

  return queryOptions({
    queryKey: ['blocked-time', 'list', params],
    queryFn: () =>
      apiClient.get<BlockedTimeWithPractitioners[]>(
        `blocked-time?${searchParams.toString()}`,
        { schema: listBlockedTimeResponseSchema }
      ),
    staleTime: 60 * 1000,
    enabled: !!params.from && !!params.to,
  });
};

export const useListBlockedTime = (params: ListBlockedTimeParams) => {
  const query = useQuery(listBlockedTimeQueryOptions(params));
  return {
    blockedTimes: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
