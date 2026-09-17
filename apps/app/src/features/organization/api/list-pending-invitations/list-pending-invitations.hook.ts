import { apiClient } from '@borradh-workspace/api-client';
import { listPendingInvitationsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

export interface PendingInvitationResponse {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  inviterName: string | null;
}

export const listPendingInvitationsQueryOptions = () =>
  queryOptions({
    queryKey: ['invitations', 'pending'],
    queryFn: () =>
      apiClient.get<PendingInvitationResponse[]>(
        'organizations/invitations/pending',
        { schema: listPendingInvitationsResponseSchema }
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

export const useListPendingInvitations = () => {
  const query = useQuery(listPendingInvitationsQueryOptions());

  return {
    invitations: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
