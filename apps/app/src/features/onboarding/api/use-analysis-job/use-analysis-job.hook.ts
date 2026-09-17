import { apiClient } from '@borradh-workspace/api-client';
import { useQuery } from '@tanstack/react-query';
import type { AnalyzeWebsiteJobStatus } from '../../types';

/**
 * Poll the onboarding website-analysis job every 2s until it finishes.
 * Pass `null` for jobId to disable polling. On completion the backend
 * persists the result snapshot onto the session's `analysisResult`.
 */
export const useAnalysisJob = (jobId: string | null) => {
  const query = useQuery({
    queryKey: ['onboarding', 'analysis', jobId],
    queryFn: () =>
      apiClient.get<AnalyzeWebsiteJobStatus>(`onboarding/analysis/${jobId}`),
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
