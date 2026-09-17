import { apiClient } from '@borradh-workspace/api-client';
import {
  type QueueDuplicateCampaignResponse,
  queueDuplicateCampaignResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

type QueueDuplicateResponse = QueueDuplicateCampaignResponse;

/**
 * Duplicate campaign hook
 *
 * Enqueues a background job that deep-copies the campaign and all of its ads on
 * Meta (created paused). Because the copy runs on the worker, the new campaign
 * appears once the job finishes — we refetch the list shortly after to surface
 * it without a manual refresh.
 */
export const useDuplicateCampaign = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (metaCampaignId: string) => {
      return apiClient.post<QueueDuplicateResponse>(
        `meta-campaigns/${metaCampaignId}/duplicate`,
        undefined,
        { schema: queueDuplicateCampaignResponseSchema }
      );
    },
    onSuccess: () => {
      if (toastOnSuccess) {
        toast.success(
          'Duplicating campaign in the background — it will appear here shortly (paused).'
        );
      }
      // The job runs asynchronously; give it a head start, then refetch so the
      // new paused campaign shows up without the user refreshing.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
        queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      }, 8000);
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to duplicate campaign: ${error.message}`);
    },
  });

  return {
    ...mutation,
    execute: mutation.mutate,
    executeAsync: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
