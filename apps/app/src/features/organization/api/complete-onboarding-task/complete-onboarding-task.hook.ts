import { trackEvent } from '@/components/providers';
import { apiClient } from '@borradh-workspace/api-client';
import type { OnboardingTask } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Response type for completing an onboarding task
 */
export interface CompleteOnboardingTaskResponse {
  completedTasks: OnboardingTask[];
}

/**
 * Input type for completing an onboarding task
 */
export interface CompleteOnboardingTaskInput {
  taskId: OnboardingTask;
}

/**
 * Hook options
 */
interface UseCompleteOnboardingTaskOptions {
  onSuccess?: (data: CompleteOnboardingTaskResponse) => void;
  onError?: (error: Error) => void;
  /** If true, show success toast (default: false for silent completion) */
  showSuccessToast?: boolean;
}

/**
 * Hook to mark an onboarding task as completed
 */
export const useCompleteOnboardingTask = (
  options?: UseCompleteOnboardingTaskOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: CompleteOnboardingTaskInput) => {
      return await apiClient.post<CompleteOnboardingTaskResponse>(
        'organization/onboarding-tasks/complete',
        input
      );
    },
    onSuccess: (data) => {
      trackEvent('onboarding_task_completed', {
        taskCount: data.completedTasks.length,
      });

      // Invalidate onboarding tasks query to refetch fresh data
      queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] });
      if (options?.showSuccessToast) {
        toast.success('Task completed');
      }
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to complete task');
      options?.onError?.(error);
    },
  });

  return {
    completeTask: mutation.mutate,
    completeTaskAsync: mutation.mutateAsync,
    isCompleting: mutation.isPending,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
  };
};
