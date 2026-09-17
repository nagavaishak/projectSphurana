'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { PatientConsentForm } from './types';

const endpoint = (id: string) => `patient/consent-forms/${id}`;

export const getConsentFormQueryOptions = (
  organizationSlug: string,
  id: string
) =>
  queryOptions({
    queryKey: patientPortalKeys.consentForm(organizationSlug, id),
    queryFn: () =>
      patientFetch<PatientConsentForm>(endpoint(id), { organizationSlug }),
    enabled: !!id,
    // 401/404 won't heal on retry.
    retry: false,
    staleTime: 30 * 1000,
  });

export const useGetConsentForm = (id: string) => {
  const { organizationSlug } = usePortal();
  const query = useQuery(getConsentFormQueryOptions(organizationSlug, id));

  return {
    consentForm: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
