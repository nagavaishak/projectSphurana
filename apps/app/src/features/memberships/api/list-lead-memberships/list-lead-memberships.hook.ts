import { apiClient } from '@borradh-workspace/api-client';
import { listLeadMembershipsResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type {
  LeadMembershipWithPlan,
  ListLeadMembershipsInput,
} from '../types';

export const listLeadMembershipsQueryOptions = (
  params: ListLeadMembershipsInput = {}
) => {
  const searchParams = new URLSearchParams();
  if (params.leadId) searchParams.set('leadId', params.leadId);
  if (params.status) searchParams.set('status', params.status);
  const qs = searchParams.toString();

  return queryOptions({
    queryKey: ['lead-memberships', 'list', params],
    queryFn: () =>
      apiClient.get<LeadMembershipWithPlan[]>(
        `lead-memberships${qs ? `?${qs}` : ''}`,
        { schema: listLeadMembershipsResponseSchema }
      ),
    staleTime: 60 * 1000,
  });
};

export const useListLeadMemberships = (
  params: ListLeadMembershipsInput = {}
) => {
  const query = useQuery(listLeadMembershipsQueryOptions(params));
  return {
    memberships: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
