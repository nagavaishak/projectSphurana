import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OnboardingSession } from '../../types';

interface UseCompleteOnboardingOptions {
  onSuccess?: (session: OnboardingSession) => void;
  onError?: (error: Error) => void;
}

/** Mark the onboarding session completed (final slide). */
export const useCompleteOnboarding = (
  options?: UseCompleteOnboardingOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiClient.post<OnboardingSession>('onboarding/complete'),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(session);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to complete onboarding');
      options?.onError?.(error);
    },
  });

  return {
    completeOnboarding: mutation.mutate,
    completeOnboardingAsync: mutation.mutateAsync,
    isCompleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
