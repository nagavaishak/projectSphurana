import { apiClient } from '@borradh-workspace/api-client';
import { pauseCampaignResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Pause campaign hook
 * Pauses a running campaign on Meta Ads
 */
export const usePauseCampaign = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (campaignId: string) => {
      return apiClient.post<{ paused: true }>(
        `meta-campaigns/${campaignId}/pause`,
        undefined,
        { schema: pauseCampaignResponseSchema }
      );
    },
    onSuccess: (_, campaignId) => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      queryClient.invalidateQueries({
        queryKey: ['meta-campaigns', campaignId],
      });
      if (toastOnSuccess) toast.success('Campaign paused');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to pause campaign: ${error.message}`);
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
