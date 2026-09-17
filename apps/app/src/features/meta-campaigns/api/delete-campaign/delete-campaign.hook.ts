import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/**
 * Delete campaign hook
 * Deletes a campaign and all its ads
 */
export const useDeleteCampaign = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (campaignId: string) => {
      return apiClient.delete(`meta-campaigns/${campaignId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) toast.success('Campaign deleted successfully');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to delete campaign: ${error.message}`);
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
