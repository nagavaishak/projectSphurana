import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface StartContentBatchResponse {
  batchId: string;
  queued: boolean;
}

interface UseStartContentBatchOptions {
  onSuccess?: (data: StartContentBatchResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Kick the month-of-content generation from the content_source slide.
 * Idempotent server-side (no-ops on an existing batch for the month); the
 * heavy seeding runs in the background and the content-approval slide polls.
 */
export const useStartContentBatch = (options?: UseStartContentBatchOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<StartContentBatchResponse>('onboarding/content-batch', {}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to start content generation');
      options?.onError?.(error);
    },
  });

  return {
    startContentBatch: mutation.mutate,
    startContentBatchAsync: mutation.mutateAsync,
    isStartingContentBatch: mutation.isPending,
    isError: mutation.isError,
  };
};
