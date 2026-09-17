import { apiClient } from '@borradh-workspace/api-client';
import { planInfoResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { PlanInfoResponse } from '../types';

export const getPlanInfoQueryOptions = () =>
  queryOptions({
    queryKey: ['billing', 'plan'],
    queryFn: () =>
      apiClient.get<PlanInfoResponse>('billing/plan', {
        schema: planInfoResponseSchema,
      }),
    staleTime: 60 * 60 * 1000, // 1 hour - plan info rarely changes
  });

export const useGetPlanInfo = () => {
  const query = useQuery(getPlanInfoQueryOptions());

  return {
    plan: query.data?.plan ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
