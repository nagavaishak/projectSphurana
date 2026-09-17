import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface ExternalTeamMember {
  externalId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  schedulingUrl?: string;
}

interface ListExternalTeamMembersResponse {
  members: ExternalTeamMember[];
}

export const listExternalTeamMembersQueryOptions = (accountId: string) =>
  queryOptions({
    queryKey: ['booking-accounts', accountId, 'team-members'],
    queryFn: () =>
      apiClient.get<ListExternalTeamMembersResponse>(
        `integrations/booking/accounts/${accountId}/team-members`
      ),
    enabled: !!accountId,
  });

export const useListExternalTeamMembers = (accountId: string) => {
  const query = useQuery(listExternalTeamMembersQueryOptions(accountId));
  return {
    members: query.data?.members ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
