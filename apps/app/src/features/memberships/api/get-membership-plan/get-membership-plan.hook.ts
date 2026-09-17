import { apiClient } from '@borradh-workspace/api-client';
import { membershipPlanWithServicesSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { MembershipPlanWithServices } from '../types';

export const getMembershipPlanQueryOptions = (planId: string) =>
  queryOptions({
    queryKey: ['membership-plans', planId],
    queryFn: () =>
      apiClient.get<MembershipPlanWithServices>(`membership-plans/${planId}`, {
        schema: membershipPlanWithServicesSchema,
      }),
    enabled: !!planId,
    staleTime: 5 * 60 * 1000,
  });

export const useGetMembershipPlan = (planId: string) => {
  const query = useQuery(getMembershipPlanQueryOptions(planId));
  return {
    plan: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
