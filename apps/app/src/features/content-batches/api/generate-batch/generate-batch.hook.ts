import { apiClient } from '@borradh-workspace/api-client';
import { generateContentBatchResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type {
  GenerateContentBatchInput,
  GenerateContentBatchResponse,
} from '../../types';

type UseGenerateContentBatchOptions = {
  onSuccess?: (response: GenerateContentBatchResponse) => void;
  onError?: (error: Error) => void;
};

/**
 * Manually trigger the monthly content batch.
 *
 * The cron normally runs this on the 1st of each month; this hook fires
 * the same code path on demand. Idempotent on `(organizationId, periodMonth)`
 * by default — calling twice in the same month returns the existing batch
 * with `alreadyExisted: true` and seeds nothing new. Pass `append: true` to
 * top the existing batch up with fresh items, or `replace: true` to wipe the
 * existing batch (deleting its pending items + assets) and regenerate from
 * scratch — what the manual "Create Batch" button does.
 */
export const useGenerateContentBatch = (
  options?: UseGenerateContentBatchOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: GenerateContentBatchInput = {}) => {
      return apiClient.post<GenerateContentBatchResponse>(
        'content-batches/generate',
        input,
        { schema: generateContentBatchResponseSchema }
      );
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['content-batches'] });
      // A replace run deletes the prior batch's graphic/video rows, so refresh
      // the generated-content library too or it shows stale/deleted tiles.
      queryClient.invalidateQueries({ queryKey: ['graphics'] });
      queryClient.invalidateQueries({ queryKey: ['videos'] });

      if (response.alreadyExisted) {
        toast.info(
          `A batch for ${response.batch.periodMonth} already exists — opening it`
        );
      } else if (response.queued) {
        // Async: the seed runs in the background. Items appear in the review
        // queue as they render — the page polls /current and surfaces the
        // review banner once they land.
        toast.success(
          'Generating your batch — content will appear here as it renders.'
        );
      }

      options?.onSuccess?.(response);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to generate content batch');
      options?.onError?.(error);
    },
  });

  return {
    generateBatch: mutation.mutate,
    generateBatchAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
    data: mutation.data,
  };
};
