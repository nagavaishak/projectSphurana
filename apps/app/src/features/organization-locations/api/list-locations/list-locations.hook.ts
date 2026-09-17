'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { listLocationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { useActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';

import type { OrganizationLocation } from '../types';

/**
 * Locations for the active organization.
 *
 * The org id is IN THE KEY. It was not before, so a single cache entry served
 * every organization and switching accounts in one tab showed the previous
 * org's branches for up to `staleTime`.
 *
 * The query is deliberately NOT gated on the org being known. Gating it looks
 * tidier, but the endpoint resolves the org from the session server-side and
 * answers correctly without one — and disabling it leaves every caller (and
 * every test that mocks only the API) stuck in a permanent loading state.
 */
export const listLocationsQueryOptions = (organizationId?: string) =>
  queryOptions({
    queryKey: ['organization-locations', 'list', organizationId],
    queryFn: () =>
      apiClient.get<{ items: OrganizationLocation[] }>(
        'organization-locations',
        { schema: listLocationsResponseSchema }
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

export const useListLocations = () => {
  const { data: organization } = useActiveOrganization();
  const query = useQuery(listLocationsQueryOptions(organization?.id));
  return {
    locations: query.data?.items ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
