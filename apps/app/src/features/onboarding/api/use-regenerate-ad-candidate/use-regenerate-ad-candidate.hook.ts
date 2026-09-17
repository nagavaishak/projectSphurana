import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  RegenerateAdCandidateInput,
  RegenerateAdCandidateResponse,
} from '../../types';

interface UseRegenerateAdCandidateOptions {
  onSuccess?: (data: RegenerateAdCandidateResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Re-roll ONE ad-picker candidate with the owner's change request. A fresh
 * replacement graphic row is minted (returned id != input id).
 */
export const useRegenerateAdCandidate = (
  options?: UseRegenerateAdCandidateOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ graphicId, prompt }: RegenerateAdCandidateInput) =>
      apiClient.post<RegenerateAdCandidateResponse>(
        `onboarding/ad-candidates/${graphicId}/regenerate`,
        { prompt }
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ['onboarding', 'candidates'],
      });
      // The session's adCandidateGraphicIds now reference the new graphic.
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to regenerate the ad');
      options?.onError?.(error);
    },
  });

  return {
    regenerateAd: mutation.mutate,
    regenerateAdAsync: mutation.mutateAsync,
    isRegenerating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
