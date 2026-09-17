'use client';

import { apiClient } from '@borradh-workspace/api-client';
import type { LocationScheduleResult } from '@borradh-workspace/api-client/types';
import { locationScheduleResultSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface UseGetLocationScheduleParams {
  locationId: string | null;
  windowStart: string;
  windowEnd: string;
}

export const getLocationScheduleQueryOptions = (
  params: UseGetLocationScheduleParams
) => {
  const qs = new URLSearchParams({
    windowStart: params.windowStart,
    windowEnd: params.windowEnd,
  }).toString();

  return queryOptions({
    queryKey: [
      'location-opening-hours',
      params.locationId,
      params.windowStart,
      params.windowEnd,
    ] as const,
    queryFn: () =>
      apiClient.get<LocationScheduleResult>(
        `locations/${params.locationId}/opening-hours?${qs}`,
        { schema: locationScheduleResultSchema }
      ),
    enabled: !!params.locationId,
    staleTime: 60 * 1000,
  });
};

export const useGetLocationSchedule = (
  params: UseGetLocationScheduleParams
) => {
  const query = useQuery(getLocationScheduleQueryOptions(params));
  return {
    schedule: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
