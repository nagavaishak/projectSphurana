import { apiClient } from '@borradh-workspace/api-client';
import { adSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Ad, UpdateAdInput } from '../types';

interface UpdateAdParams {
  adId: string;
  data: UpdateAdInput;
}

/**
 * Update ad hook
 * Updates an existing ad
 */
export const useUpdateAd = (toastOnSuccess = true, toastOnError = true) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ adId, data }: UpdateAdParams) => {
      return apiClient.put<Ad>(`meta-ads/${adId}`, data, { schema: adSchema });
    },
    onSuccess: (_, { adId }) => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'] });
      queryClient.invalidateQueries({ queryKey: ['meta-ads', adId] });
      queryClient.invalidateQueries({ queryKey: ['meta-campaigns'] });
      if (toastOnSuccess) toast.success('Ad updated successfully');
    },
    onError: (error) => {
      if (toastOnError) toast.error(`Failed to update ad: ${error.message}`);
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
