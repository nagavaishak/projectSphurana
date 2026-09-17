import { apiClient } from '@borradh-workspace/api-client';
import { adSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Ad, CreateAdInput } from '../types';

/**
 * Create ad hook
 * Creates a new ad in draft status
 */
export const useCreateAd = (toastOnSuccess = true, toastOnError = true) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (data: CreateAdInput) => {
      return apiClient.post<Ad>('meta-ads', data, { schema: adSchema });
    },
    onSuccess: (_, { metaCampaignId }) => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      queryClient.invalidateQueries({
        queryKey: ['meta-ads', 'campaign', metaCampaignId],
      });
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) toast.success('Ad created successfully');
    },
    onError: (error) => {
      if (toastOnError) toast.error(`Failed to create ad: ${error.message}`);
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
