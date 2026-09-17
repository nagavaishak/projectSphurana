'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { PatientBookingsResponse } from './types';

export const listPatientBookingsQueryOptions = (organizationSlug: string) =>
  queryOptions({
    queryKey: patientPortalKeys.bookings(organizationSlug),
    queryFn: () =>
      patientFetch<PatientBookingsResponse>(PATIENT_PORTAL_PATHS.bookings, {
        organizationSlug,
      }),
    // 401 means "not signed in" — retrying won't change that.
    retry: false,
    staleTime: 30 * 1000,
  });

export const useListPatientBookings = () => {
  const { organizationSlug } = usePortal();
  const query = useQuery(listPatientBookingsQueryOptions(organizationSlug));

  return {
    upcoming: query.data?.upcoming ?? [],
    past: query.data?.past ?? [],
    // The clinic's timezone, not the browser's. UTC only until the first
    // response lands; every render is gated on `isLoading` anyway.
    timezone: query.data?.timezone ?? 'UTC',
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
