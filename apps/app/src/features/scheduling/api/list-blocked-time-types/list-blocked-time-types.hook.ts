import { apiClient } from '@borradh-workspace/api-client';
import { listBlockedTimeTypesResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { BlockedTimeType } from '../types';

export const listBlockedTimeTypesQueryOptions = () =>
  queryOptions({
    queryKey: ['blocked-time-types'],
    queryFn: () =>
      apiClient.get<BlockedTimeType[]>('blocked-time-types', {
        schema: listBlockedTimeTypesResponseSchema,
      }),
    staleTime: 5 * 60 * 1000,
  });

export const useListBlockedTimeTypes = () => {
  const query = useQuery(listBlockedTimeTypesQueryOptions());
  return {
    blockedTimeTypes: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
