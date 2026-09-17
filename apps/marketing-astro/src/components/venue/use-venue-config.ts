'use client';

import { apiClient } from '@/lib/api-client';
import type { VenueConfig } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * The public venue page view-model, on the marketing app.
 *
 * PORTED from apps/app. The venue page is a public, indexable, customer-facing
 * page, which is the category that moved off the dashboard host with booking
 * and the portal — a customer had no business being sent to app.borradh.io to
 * read a clinic's address.
 *
 * TEMPORARY BY DESIGN: the microsite covers the same ground and supersedes
 * this page once microsites go live. It moves rather than dies now so nothing
 * breaks in between, and so the retirement is a single deletion.
 *
 * A venue IS a location: with no `locationSlug` the API resolves the org's
 * PRIMARY venue; with one it resolves that branch. Both are public, so this is
 * a plain cacheable read through the same-origin `/api` proxy.
 *
 * The response is NOT re-validated with `venueConfigSchema` as the app version did:
 * marketing's minimal client has no schema hook, and adding zod validation on
 * a page scheduled for deletion buys nothing the types do not already give.
 */
export const venueConfigQueryOptions = (
  organizationSlug: string,
  locationSlug?: string
) =>
  queryOptions({
    queryKey: ['venue', 'config', organizationSlug, locationSlug ?? null],
    queryFn: () =>
      apiClient.get<VenueConfig>(
        locationSlug
          ? `public/venue/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(locationSlug)}`
          : `public/venue/${encodeURIComponent(organizationSlug)}`
      ),
    enabled: !!organizationSlug,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

export const useGetVenueConfig = (
  organizationSlug: string,
  locationSlug?: string
) => {
  const query = useQuery(
    venueConfigQueryOptions(organizationSlug, locationSlug)
  );

  return {
    venue: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
