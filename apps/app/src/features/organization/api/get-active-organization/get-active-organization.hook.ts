import { apiClient } from '@borradh-workspace/api-client';
import type { Organization } from '@borradh-workspace/api-client/types';
import { organizationSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

import { setMarketingOrigin } from '@/lib/microsite-url';

/**
 * Query options for active organization (enables prefetching, invalidation)
 */
export const getActiveOrganizationQueryOptions = () => {
  return queryOptions({
    queryKey: ['organization', 'active'],
    queryFn: async () => {
      try {
        const org = await apiClient.get<Organization | null>(
          'organization/active',
          { schema: organizationSchema }
        );
        // The API reports which marketing origin THIS deployment links to.
        // Cached for the synchronous link builders — see lib/microsite-url.ts
        // for why the dashboard cannot derive it on a preview.
        setMarketingOrigin(
          (org as { marketingUrl?: string | null } | null)?.marketingUrl
        );
        return org;
      } catch {
        // Return null if no active organization
        return null;
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });
};

/**
 * Get Active Organization Hook
 * Returns the current user's active organization via NestJS API
 */
export const useGetActiveOrganization = () => {
  const query = useQuery(getActiveOrganizationQueryOptions());

  return {
    data: query.data ?? null,
    isPending: query.isPending,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};

/**
 * Alias for useGetActiveOrganization
 */
export const useActiveOrganization = useGetActiveOrganization;
