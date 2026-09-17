import { apiClient } from '@borradh-workspace/api-client';
import { createMetaCampaignResponseSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateCampaignInput, CreateCampaignResponse } from '../types';

/**
 * Create campaign hook
 * Creates a new campaign on Meta (returns Meta IDs)
 *
 * @param toastOnSuccess - Show success toast (default: true)
 * @param toastOnError - Show error toast (default: true). Set to false
 *   when the caller handles errors itself (e.g., showing MetaErrorDialog).
 */
export const useCreateCampaign = (
  toastOnSuccess = true,
  toastOnError = true
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: CreateCampaignInput) => {
      return apiClient.post<CreateCampaignResponse>('meta-campaigns', data, {
        schema: createMetaCampaignResponseSchema,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) toast.success('Campaign created successfully');
    },
    onError: (error) => {
      if (toastOnError)
        toast.error(`Failed to create campaign: ${error.message}`);
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
