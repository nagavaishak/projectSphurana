import { apiClient } from '@borradh-workspace/api-client';
import type { LeadMembershipWithPlan } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const listLeadMembershipsQueryOptions = () =>
  queryOptions({
    queryKey: ['lead-memberships', 'list'],
    queryFn: () => apiClient.get<LeadMembershipWithPlan[]>('lead-memberships'),
    staleTime: 30 * 1000,
  });

export const useListLeadMemberships = () => {
  const query = useQuery(listLeadMembershipsQueryOptions());
  return {
    memberships: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
