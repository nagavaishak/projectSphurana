import { apiClient } from '@borradh-workspace/api-client';
import type { InvitationByTokenResponse } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Public invitation-by-token lookup.
 *
 * Powers the Join / Review-and-confirm screens of the invited-member accept
 * flow. Hits `GET /organizations/invitations/token/:token` which is a `@Public`
 * endpoint — it works pre-auth (the invited user has no session yet) and is
 * scoped by the opaque token only. Retries are disabled so an expired / unknown
 * token surfaces its error immediately instead of stalling the Join screen.
 */
export const getInvitationByTokenQueryOptions = (token: string | undefined) =>
  queryOptions({
    queryKey: ['invitations', 'token', token] as const,
    queryFn: () =>
      apiClient.get<InvitationByTokenResponse>(
        `organizations/invitations/token/${token}`
      ),
    enabled: !!token,
    retry: false,
    staleTime: 60 * 1000,
  });

export const useInvitationByToken = (token: string | undefined) => {
  const query = useQuery(getInvitationByTokenQueryOptions(token));
  return {
    invitation: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
  };
};
