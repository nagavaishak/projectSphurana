import { apiClient } from '@borradh-workspace/api-client';
import type {
  TimeEntryStatus,
  TimeEntryWithBreaks,
} from '@borradh-workspace/api-client/types';
import { timeEntryWithBreaksSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Hook-level params that accept Date objects for convenience.
 * The hook converts Date objects to ISO strings for the API.
 */
export interface UseListTimeEntriesParams {
  from?: Date | string;
  to?: Date | string;
  practitionerId?: string;
  status?: TimeEntryStatus;
}

function toISOString(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;
  return date instanceof Date ? date.toISOString() : date;
}

export const listTimeEntriesQueryOptions = (
  params: UseListTimeEntriesParams = {}
) => {
  const searchParams = new URLSearchParams();

  const from = toISOString(params.from);
  if (from) searchParams.set('from', from);

  const to = toISOString(params.to);
  if (to) searchParams.set('to', to);

  if (params.practitionerId)
    searchParams.set('practitionerId', params.practitionerId);
  if (params.status) searchParams.set('status', params.status);

  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['time-entries', 'list', { ...params, from, to }],
    queryFn: () =>
      apiClient.get<TimeEntryWithBreaks[]>(
        `time-entries${qs ? `?${qs}` : ''}`,
        {
          schema: timeEntryWithBreaksSchema.array(),
        }
      ),
    staleTime: 30 * 1000, // 30 seconds - clock state changes often
  });
};

export const useListTimeEntries = (
  params: UseListTimeEntriesParams = {},
  options: { enabled?: boolean } = {}
) => {
  const query = useQuery({
    ...listTimeEntriesQueryOptions(params),
    enabled: options.enabled,
  });

  return {
    timeEntries: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
