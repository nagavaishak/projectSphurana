import { apiClient } from '@borradh-workspace/api-client';
import { updateMetaCampaignResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UpdateCampaignInput } from '../types';

/**
 * Update campaign hook
 * Updates a campaign's name and/or daily budget on Meta
 */
export const useUpdateCampaign = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      metaCampaignId,
      ...data
    }: UpdateCampaignInput & { metaCampaignId: string }) => {
      return apiClient.put<{ updated: true }>(
        `meta-campaigns/${metaCampaignId}`,
        data,
        { schema: updateMetaCampaignResponseSchema }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      toast.success('Campaign updated successfully');
      options?.onSuccess?.();
    },
    onError: (error) => {
      toast.error(`Failed to update campaign: ${error.message}`);
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
