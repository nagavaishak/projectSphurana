import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AnalyzeWebsiteInput, AnalyzeWebsiteJobStatus } from '../types';

interface UseStartAnalyzeWebsiteOptions {
  onSuccess?: (jobId: string) => void;
  onError?: (error: Error) => void;
}

/** Start a website analysis background job. Returns a jobId to poll. */
export const useStartAnalyzeWebsite = (
  options?: UseStartAnalyzeWebsiteOptions
) => {
  const mutation = useMutation({
    mutationFn: (input: AnalyzeWebsiteInput) =>
      apiClient.post<{ jobId: string }>(
        'website-analysis/analyze/start',
        input
      ),
    onSuccess: ({ jobId }) => {
      options?.onSuccess?.(jobId);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    startAnalyze: mutation.mutate,
    startAnalyzeAsync: mutation.mutateAsync,
    isStarting: mutation.isPending,
    reset: mutation.reset,
  };
};

/**
 * Poll a website analysis job every 2s until it finishes.
 * Pass `null` for jobId to disable polling.
 */
export const useAnalyzeWebsiteJob = (jobId: string | null) => {
  const query = useQuery({
    queryKey: ['website-analysis', 'job', jobId],
    queryFn: () =>
      apiClient.get<AnalyzeWebsiteJobStatus>(
        `website-analysis/analyze/${jobId}`
      ),
    enabled: Boolean(jobId),
    refetchInterval: (q) => {
      if (q.state.error) return false;
      const status = q.state.data?.status;
      if (status === 'done' || status === 'error') return false;
      return 2000;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });

  return {
    job: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
