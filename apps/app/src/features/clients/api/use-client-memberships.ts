import { apiClient } from '@borradh-workspace/api-client';
import type { LeadMembershipWithPlan } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Thin query hook: memberships held by a single client (lead).
 *
 * Defined locally under `features/clients/api` (not the memberships feature) so
 * this workstream stays disjoint from the memberships agent at merge time. Hits
 * the live `GET /lead-memberships?leadId=` endpoint, which returns an array of
 * `LeadMembershipWithPlan` (membership joined with its plan).
 */
export const clientMembershipsQueryOptions = (leadId: string) =>
  queryOptions({
    queryKey: ['clients', leadId, 'memberships'],
    queryFn: () => {
      const params = new URLSearchParams({ leadId });
      return apiClient.get<LeadMembershipWithPlan[]>(
        `lead-memberships?${params.toString()}`
      );
    },
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });

export const useClientMemberships = (leadId: string) => {
  const query = useQuery(clientMembershipsQueryOptions(leadId));
  return {
    memberships: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
