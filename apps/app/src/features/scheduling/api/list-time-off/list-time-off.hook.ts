import { apiClient } from '@borradh-workspace/api-client';
import { listTimeOffResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { TimeOff } from '../types';

export interface ListTimeOffParams {
  /** ISO datetime string — start of the window. */
  from: string;
  /** ISO datetime string — end of the window. */
  to: string;
  practitionerId?: string;
}

export const listTimeOffQueryOptions = (params: ListTimeOffParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set('from', params.from);
  searchParams.set('to', params.to);
  if (params.practitionerId) {
    searchParams.set('practitionerId', params.practitionerId);
  }

  return queryOptions({
    queryKey: ['time-off', 'list', params],
    queryFn: () =>
      apiClient.get<TimeOff[]>(`time-off?${searchParams.toString()}`, {
        schema: listTimeOffResponseSchema,
      }),
    staleTime: 60 * 1000,
    enabled: !!params.from && !!params.to,
  });
};

export const useListTimeOff = (params: ListTimeOffParams) => {
  const query = useQuery(listTimeOffQueryOptions(params));
  return {
    timeOffs: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
