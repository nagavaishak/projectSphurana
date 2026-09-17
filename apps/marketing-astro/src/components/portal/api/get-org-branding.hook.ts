'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';

import { patientFetch } from '@/lib/patient-fetch';

import { PATIENT_PORTAL_PATHS, patientPortalKeys } from './paths';
import { usePortal } from './portal-provider';
import type { OrgBranding } from './types';

/** The subset of the public booking-config payload the chrome needs. */
interface BrandingResponse {
  organizationName: string;
  organizationSlug: string;
  organizationLogo: string | null;
}

/**
 * Clinic branding (name/logo) for the portal chrome.
 *
 * Reuses the public booking-config endpoint, exactly as apps/app did. It does
 * NOT reuse `@/features/booking-forms`' hook, though: that one goes through
 * `apiClient`, which calls `api.borradh.io` directly. On a microsite that is
 * cross-origin and `connect-src 'self'` refuses it outright. Every portal
 * request — public ones included — goes through the same-origin proxy.
 *
 * `keep-session`: a failure here says nothing about whether the customer is
 * signed in, so it must never trip the global sign-out handler.
 */
export const getOrgBrandingQueryOptions = (organizationSlug: string) =>
  queryOptions({
    queryKey: patientPortalKeys.branding(organizationSlug),
    queryFn: () =>
      patientFetch<BrandingResponse>(
        PATIENT_PORTAL_PATHS.branding(organizationSlug),
        { organizationSlug, onUnauthorized: 'keep-session' }
      ),
    staleTime: 5 * 60 * 1000,
  });

export const useGetOrgBranding = () => {
  const { organizationSlug } = usePortal();
  const query = useQuery({
    ...getOrgBrandingQueryOptions(organizationSlug),
    select: (config): OrgBranding => ({
      organizationName: config.organizationName,
      organizationSlug: config.organizationSlug,
      organizationLogo: config.organizationLogo,
    }),
  });

  return {
    branding: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
