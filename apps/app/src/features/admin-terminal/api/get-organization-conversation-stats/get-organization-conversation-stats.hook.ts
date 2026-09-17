import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

interface OrganizationConversationStats {
  today: number;
  last7Days: number;
  total: number;
}

export const getOrganizationConversationStatsQueryOptions = (
  organizationId: string
) =>
  queryOptions({
    queryKey: [
      'admin-terminal',
      'organizations',
      organizationId,
      'conversation-stats',
    ],
    queryFn: () =>
      apiClient.get<OrganizationConversationStats>(
        `admin-terminal/organizations/${organizationId}/conversation-stats`
      ),
    enabled: !!organizationId,
    staleTime: 30 * 1000,
  });

export const useGetOrganizationConversationStats = (organizationId: string) => {
  const query = useQuery(
    getOrganizationConversationStatsQueryOptions(organizationId)
  );
  return {
    stats: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};

export type { OrganizationConversationStats };
