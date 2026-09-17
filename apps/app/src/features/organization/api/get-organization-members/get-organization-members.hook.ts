import { apiClient } from '@borradh-workspace/api-client';
import { listOrganizationMembersResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Organization member response type
 */
export interface OrganizationMemberResponse {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

/**
 * Query options for get organization members (enables prefetching, invalidation)
 */
export const getOrganizationMembersQueryOptions = (organizationId: string) => {
  return queryOptions({
    queryKey: ['organization', organizationId, 'members'],
    queryFn: async () => {
      return apiClient.get<OrganizationMemberResponse[]>(
        `organizations/${organizationId}/members`,
        { schema: listOrganizationMembersResponseSchema }
      );
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!organizationId,
  });
};

/**
 * Get Organization Members Hook
 * Returns all members of an organization via NestJS API
 *
 * @param organizationId - The organization ID
 */
export const useGetOrganizationMembers = (organizationId: string) => {
  const query = useQuery(getOrganizationMembersQueryOptions(organizationId));

  return {
    members: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
