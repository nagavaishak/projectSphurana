import { apiClient } from '@borradh-workspace/api-client';
import type { MembershipPlanWithServices } from '@borradh-workspace/api-client/types';
import { queryOptions, useQuery } from '@tanstack/react-query';

export const listMembershipPlansQueryOptions = () =>
  queryOptions({
    queryKey: ['membership-plans', 'list'],
    queryFn: () =>
      apiClient.get<MembershipPlanWithServices[]>('membership-plans'),
    staleTime: 60 * 1000,
  });

/** Active membership plans for the POS cart picker. */
export const useListMembershipPlans = () => {
  const query = useQuery(listMembershipPlansQueryOptions());
  return {
    plans: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
