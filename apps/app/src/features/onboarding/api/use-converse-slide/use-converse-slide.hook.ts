import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  ConverseOnboardingSlideInput,
  ConverseOnboardingSlideResponse,
} from '../../types';

interface UseConverseSlideOptions {
  onSuccess?: (data: ConverseOnboardingSlideResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Send free text to Claire on a conversational slide (campaign_pitch /
 * intro_offer). Claire ALWAYS answers with a structured slide — check
 * `fallback` for the safe "let's try that again" case.
 */
export const useConverseSlide = (options?: UseConverseSlideOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ConverseOnboardingSlideInput) =>
      apiClient.post<ConverseOnboardingSlideResponse>(
        'onboarding/converse',
        input
      ),
    onSuccess: (data) => {
      // The turn is appended to the session's conversationTurns.
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Claire could not respond — try again');
      options?.onError?.(error);
    },
  });

  return {
    converse: mutation.mutate,
    converseAsync: mutation.mutateAsync,
    reply: mutation.data ?? null,
    isConversing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
};
