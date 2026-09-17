import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface OrganizationMember {
  id: string;
  userId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string | null;
  };
}

interface OrganizationWithMembers {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  logo: string | null;
  createdAt: string;
  members: OrganizationMember[];
}

export const getOrganizationWithMembersQueryOptions = (
  organizationId: string
) =>
  queryOptions({
    queryKey: ['admin-terminal', 'organizations', organizationId],
    queryFn: () =>
      apiClient.get<OrganizationWithMembers>(
        `admin-terminal/organizations/${organizationId}`
      ),
    enabled: !!organizationId,
    staleTime: 30 * 1000,
  });

export const useGetOrganizationWithMembers = (organizationId: string) => {
  const query = useQuery(
    getOrganizationWithMembersQueryOptions(organizationId)
  );
  return {
    organization: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { OrganizationWithMembers, OrganizationMember };
