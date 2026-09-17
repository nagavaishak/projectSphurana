'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { CurrentPatient } from './types';

export const getCurrentPatientQueryOptions = (organizationSlug: string) =>
  queryOptions({
    // Keyed by clinic: one customer can be a patient at several, and a
    // slug-less key served clinic A's cached payload on clinic B's page for
    // the whole staleTime window.
    queryKey: patientPortalKeys.me(organizationSlug),
    queryFn: () =>
      patientFetch<CurrentPatient>(PATIENT_PORTAL_PATHS.me, {
        organizationSlug,
      }),
    // A 401 means "not signed in" — retrying won't change that.
    retry: false,
    staleTime: 60 * 1000,
  });

/** The signed-in patient, or a 401 that the auth gate turns into a redirect. */
export const useGetCurrentPatient = () => {
  const { organizationSlug } = usePortal();
  const query = useQuery(getCurrentPatientQueryOptions(organizationSlug));

  return {
    patient: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
