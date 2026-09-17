'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AvailableSlotsResponse } from '../types';

interface GetGeneralBookingSlotsParams {
  organizationSlug: string;
  serviceId: string;
  date: string; // YYYY-MM-DD format
  practitionerId?: string;
}

export const getGeneralBookingSlotsQueryOptions = ({
  organizationSlug,
  serviceId,
  date,
  practitionerId,
}: GetGeneralBookingSlotsParams) => {
  const searchParams = new URLSearchParams();
  searchParams.set('serviceId', serviceId);
  searchParams.set('date', date);
  if (practitionerId) searchParams.set('practitionerId', practitionerId);

  return queryOptions({
    queryKey: [
      'general-booking-slots',
      organizationSlug,
      serviceId,
      date,
      practitionerId,
    ],
    queryFn: async () => {
      return apiClient.get<AvailableSlotsResponse>(
        `public/booking/${organizationSlug}/slots?${searchParams.toString()}`
      );
    },
    enabled: !!organizationSlug && !!serviceId && !!date,
    staleTime: 60 * 1000, // 1 minute
  });
};

export const useGetGeneralBookingSlots = (
  params: GetGeneralBookingSlotsParams
) => {
  const query = useQuery(getGeneralBookingSlotsQueryOptions(params));

  return {
    slotsResponse: query.data ?? null,
    slots: query.data?.slots ?? [],
    byPractitioner: query.data?.byPractitioner ?? undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
