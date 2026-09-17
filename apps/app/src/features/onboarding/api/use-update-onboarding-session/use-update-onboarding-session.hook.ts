import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  OnboardingSession,
  UpdateOnboardingSessionInput,
} from '../../types';

interface UseUpdateOnboardingSessionOptions {
  onSuccess?: (session: OnboardingSession) => void;
  onError?: (error: Error) => void;
}

/** Advance the slide pointer and/or record a slide answer. */
export const useUpdateOnboardingSession = (
  options?: UseUpdateOnboardingSessionOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateOnboardingSessionInput) =>
      apiClient.patch<OnboardingSession>('onboarding/session', input),
    onSuccess: (session) => {
      // Write the fresh session through so slide advances feel instant, then
      // invalidate so any other observers refetch.
      queryClient.setQueryData(['onboarding', 'session'], session);
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(session);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save your answer');
      options?.onError?.(error);
    },
  });

  return {
    updateSession: mutation.mutate,
    updateSessionAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
