import { apiClient } from '@borradh-workspace/api-client';
import {
  type ResumeCampaignResponse,
  resumeCampaignResponseSchema,
} from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Resume campaign hook
 * Resumes (activates) a paused campaign on Meta Ads
 */
export const useResumeCampaign = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (campaignId: string) => {
      return apiClient.post<ResumeCampaignResponse>(
        `meta-campaigns/${campaignId}/resume`,
        undefined,
        { schema: resumeCampaignResponseSchema }
      );
    },
    onSuccess: (_, campaignId) => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      queryClient.invalidateQueries({
        queryKey: ['meta-campaigns', campaignId],
      });
      if (toastOnSuccess) toast.success('Campaign resumed');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to resume campaign: ${error.message}`);
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
