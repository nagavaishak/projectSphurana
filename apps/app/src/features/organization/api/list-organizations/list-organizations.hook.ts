import { apiClient } from '@borradh-workspace/api-client';
import type { Organization } from '@borradh-workspace/api-client/types';
import { listOrganizationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Query options for listing organizations (enables prefetching, invalidation)
 */
export const listOrganizationsQueryOptions = () => {
  return queryOptions({
    queryKey: ['organization', 'list'],
    queryFn: async () => {
      const data = await apiClient.get<{ organizations: Organization[] }>(
        'organizations',
        { schema: listOrganizationsResponseSchema }
      );
      return data.organizations;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
};

/**
 * List Organizations Hook
 * Returns all organizations the current user is a member of via NestJS API
 */
export const useListOrganizations = () => {
  const query = useQuery(listOrganizationsQueryOptions());

  return {
    data: query.data ?? [],
    isPending: query.isPending,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};
