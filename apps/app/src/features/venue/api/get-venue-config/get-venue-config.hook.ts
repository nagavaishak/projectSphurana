'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import {
  type VenueConfig,
  venueConfigSchema,
} from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * The public venue page view-model.
 *
 * A venue IS a location: with no `locationSlug` the API resolves the org's
 * PRIMARY venue; with one it resolves that specific branch. Both are public
 * (no auth), and the page is indexable, so this is a plain cacheable read.
 */

export const getVenueConfigQueryOptions = (
  organizationSlug: string,
  locationSlug?: string
) =>
  queryOptions({
    queryKey: queryKeys.venue.config(organizationSlug, locationSlug),
    queryFn: () =>
      apiClient.get<VenueConfig>(
        locationSlug
          ? `public/venue/${encodeURIComponent(organizationSlug)}/${encodeURIComponent(locationSlug)}`
          : `public/venue/${encodeURIComponent(organizationSlug)}`,
        { schema: venueConfigSchema }
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
    getVenueConfigQueryOptions(organizationSlug, locationSlug)
  );

  return {
    venue: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
