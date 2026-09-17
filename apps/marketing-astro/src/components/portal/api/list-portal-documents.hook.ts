'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { PatientDocumentListResponse } from './types';

/** GET patient/documents — the signed-in patient's own vault. */
export const listPortalDocumentsQueryOptions = (organizationSlug: string) =>
  queryOptions({
    queryKey: patientPortalKeys.documents(organizationSlug),
    queryFn: () =>
      patientFetch<PatientDocumentListResponse>(
        PATIENT_PORTAL_PATHS.documents,
        {
          organizationSlug,
        }
      ),
    // 401 means "not signed in" — the page gate handles that.
    retry: false,
    staleTime: 30 * 1000,
  });

export const useListPortalDocuments = () => {
  const { organizationSlug } = usePortal();
  const query = useQuery(listPortalDocumentsQueryOptions(organizationSlug));

  return {
    documents: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
