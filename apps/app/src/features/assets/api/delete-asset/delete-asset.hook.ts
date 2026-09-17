import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Asset } from '../types';

/**
 * Delete Asset Hook
 * Deletes an asset by ID
 */
export const useDeleteAsset = (options?: {
  onSuccess?: (asset: Asset) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete<Asset>(`assets/${id}`);
    },
    onSuccess: (asset) => {
      // Invalidate assets list
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success('Asset deleted successfully');
      options?.onSuccess?.(asset);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete asset');
      options?.onError?.(error);
    },
  });

  return {
    deleteAsset: mutation.mutate,
    deleteAssetAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
