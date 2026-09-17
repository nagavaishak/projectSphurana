import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import type {
  AnalyzeWebsiteInput,
  AnalyzeWebsiteJobStatus,
  AnalyzeWebsiteResponse,
} from '../types';

interface UseAnalyzeWebsiteOptions {
  onSuccess?: (result: AnalyzeWebsiteResponse) => void;
  onError?: (error: Error) => void;
}

const POLL_INTERVAL_MS = 2000;
// The enriched scrape (Firecrawl + Browserbase + GPT merge) runs ~90-120s; the
// backend job TTL is 600s. Poll generously but bail before the TTL expires.
const ANALYZE_TIMEOUT_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Analyze a website and resolve with the result.
 *
 * Backed by the async job endpoints (`POST analyze/start` + poll
 * `GET analyze/:jobId`) rather than the synchronous `POST analyze`. The
 * enriched scrape takes 90-120s, which exceeds the edge/proxy request timeout
 * and 504s when held open — so we kick off a background job and poll instead.
 * The public interface is unchanged: `analyzeWebsiteAsync(input)` resolves with
 * the `AnalyzeWebsiteResponse` (or throws on error/timeout).
 */
export const useAnalyzeWebsite = (options?: UseAnalyzeWebsiteOptions) => {
  const mutation = useMutation({
    mutationFn: async (
      input: AnalyzeWebsiteInput
    ): Promise<AnalyzeWebsiteResponse> => {
      const { jobId } = await apiClient.post<{ jobId: string }>(
        'website-analysis/analyze/start',
        input
      );

      const deadline = Date.now() + ANALYZE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
        const status = await apiClient.get<AnalyzeWebsiteJobStatus>(
          `website-analysis/analyze/${jobId}`
        );
        if (status.status === 'done') {
          if (status.result) return status.result;
          // 'done' without a payload is terminal too — polling further can
          // never produce a result, it just burns the whole deadline.
          throw new Error('Analysis finished without a result');
        }
        if (status.status === 'error') {
          throw new Error(status.error || 'Failed to analyze website');
        }
      }
      throw new Error('Website analysis timed out');
    },
    onSuccess: (result) => {
      toast.success('Website analyzed successfully');
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to analyze website');
      options?.onError?.(error);
    },
  });

  return {
    analyzeWebsite: mutation.mutate,
    analyzeWebsiteAsync: mutation.mutateAsync,
    isAnalyzing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    data: mutation.data,
    reset: mutation.reset,
  };
};
