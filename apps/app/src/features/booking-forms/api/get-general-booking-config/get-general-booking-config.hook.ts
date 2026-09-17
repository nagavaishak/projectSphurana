'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { GeneralBookingConfig } from '../types';

export const getGeneralBookingConfigQueryOptions = (
  organizationSlug: string
) => {
  return queryOptions({
    queryKey: ['general-booking', organizationSlug],
    queryFn: async () => {
      return apiClient.get<GeneralBookingConfig>(
        `public/booking/${organizationSlug}`
      );
    },
    enabled: !!organizationSlug,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

export const useGetGeneralBookingConfig = (organizationSlug: string) => {
  const query = useQuery(getGeneralBookingConfigQueryOptions(organizationSlug));

  return {
    config: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
