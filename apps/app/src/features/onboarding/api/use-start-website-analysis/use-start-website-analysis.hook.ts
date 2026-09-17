import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  StartOnboardingWebsiteInput,
  StartOnboardingWebsiteResponse,
} from '../../types';

interface UseStartWebsiteAnalysisOptions {
  onSuccess?: (jobId: string) => void;
  onError?: (error: Error) => void;
}

/**
 * Store the website URL on the session + start the analysis background job.
 * Returns a jobId to poll via `useAnalysisJob`.
 */
export const useStartWebsiteAnalysis = (
  options?: UseStartWebsiteAnalysisOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: StartOnboardingWebsiteInput) =>
      apiClient.post<StartOnboardingWebsiteResponse>(
        'onboarding/website',
        input
      ),
    onSuccess: ({ jobId }) => {
      // The session now carries websiteUrl + analysisJobId.
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(jobId);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start website analysis');
      options?.onError?.(error);
    },
  });

  return {
    startAnalysis: mutation.mutate,
    startAnalysisAsync: mutation.mutateAsync,
    isStarting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
};
