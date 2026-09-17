import { apiClient } from '@borradh-workspace/api-client';
import type { OnboardingTask } from '@borradh-workspace/api-client/types';
import { getOnboardingTasksResponseSchema } from '@borradh-workspace/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * Single onboarding task status
 */
export interface OnboardingTaskStatus {
  id: OnboardingTask;
  title: string;
  completed: boolean;
}

/**
 * Response type for getting onboarding tasks
 */
export interface GetOnboardingTasksResponse {
  tasks: OnboardingTaskStatus[];
  completedCount: number;
  totalCount: number;
}

/**
 * Query options for getting onboarding tasks
 */
export const getOnboardingTasksQueryOptions = () =>
  queryOptions({
    queryKey: ['onboarding-tasks'],
    queryFn: () =>
      apiClient.get<GetOnboardingTasksResponse>(
        'organization/onboarding-tasks',
        {
          schema: getOnboardingTasksResponseSchema,
        }
      ),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

/**
 * Hook to get onboarding tasks with completion status
 */
export const useGetOnboardingTasks = () => {
  const query = useQuery(getOnboardingTasksQueryOptions());

  return {
    tasks: query.data?.tasks ?? [],
    completedCount: query.data?.completedCount ?? 0,
    totalCount: query.data?.totalCount ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
