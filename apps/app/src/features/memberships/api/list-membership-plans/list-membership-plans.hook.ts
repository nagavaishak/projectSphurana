import { apiClient } from '@borradh-workspace/api-client';
import { listMembershipPlansResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ListedMembershipPlan } from '../types';

export const listMembershipPlansQueryOptions = () =>
  queryOptions({
    queryKey: ['membership-plans', 'list'],
    queryFn: () =>
      apiClient.get<ListedMembershipPlan[]>('membership-plans', {
        schema: listMembershipPlansResponseSchema,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

export const useListMembershipPlans = () => {
  const query = useQuery(listMembershipPlansQueryOptions());
  return {
    plans: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
