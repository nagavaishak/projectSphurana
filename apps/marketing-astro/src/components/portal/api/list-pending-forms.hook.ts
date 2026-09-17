'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { PendingConsentForm } from './types';

/**
 * Pending consent forms for the portal-home banner.
 *
 * ANY failure — including 404, and including a 401 — resolves to an empty
 * list so the banner simply doesn't render. Never surface an error for this,
 * and never let it sign anyone out: the page's own gate query owns that
 * decision, and a nudge banner must not be able to override it.
 */
export const listPendingFormsQueryOptions = (organizationSlug: string) =>
  queryOptions({
    queryKey: patientPortalKeys.pendingForms(organizationSlug),
    queryFn: async (): Promise<PendingConsentForm[]> => {
      try {
        const data = await patientFetch<unknown>(
          PATIENT_PORTAL_PATHS.pendingForms,
          { organizationSlug, onUnauthorized: 'keep-session' }
        );
        if (Array.isArray(data)) return data as PendingConsentForm[];
        // Tolerate an {items: []}-shaped response.
        const items = (data as { items?: unknown })?.items;
        return Array.isArray(items) ? (items as PendingConsentForm[]) : [];
      } catch {
        return [];
      }
    },
    retry: false,
    staleTime: 60 * 1000,
  });

export const useListPendingForms = () => {
  const { organizationSlug } = usePortal();
  const query = useQuery(listPendingFormsQueryOptions(organizationSlug));

  return {
    pendingForms: query.data ?? [],
    isLoading: query.isLoading,
  };
};
