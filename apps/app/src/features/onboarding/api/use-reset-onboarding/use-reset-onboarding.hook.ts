import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { OnboardingSession } from '../../types';

interface UseResetOnboardingOptions {
  onSuccess?: (session: OnboardingSession) => void;
  onError?: (error: Error) => void;
}

/**
 * Full "as if new" reset — deletes the org the flow created and rewinds to
 * the first slide, so the user lands exactly where a fresh sign-up does.
 */
export const useResetOnboarding = (options?: UseResetOnboardingOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiClient.post<OnboardingSession>('onboarding/reset'),
    onSuccess: (session) => {
      // Drop onboarding state AND the org/session-scoped caches — the org the
      // shell was pointed at no longer exists after a reset, and its id is
      // still on the auth session. This used to invalidate `['session']`, a
      // key no query has, so the dead org id survived the reset.
      invalidateKeys(
        queryClient,
        queryKeys.onboarding.all(),
        queryKeys.organization.all(),
        queryKeys.auth.session()
      );
      options?.onSuccess?.(session);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to restart onboarding');
      options?.onError?.(error);
    },
  });

  return {
    resetOnboarding: mutation.mutate,
    resetOnboardingAsync: mutation.mutateAsync,
    isResetting: mutation.isPending,
  };
};
