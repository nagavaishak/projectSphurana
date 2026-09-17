import { apiClient } from '@borradh-workspace/api-client';
import type { AssetContentType } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UpdateAssetContentTypeInput {
  assetId: string;
  contentType: AssetContentType;
}

export const useUpdateAssetContentType = (options?: {
  onSuccess?: () => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ assetId, contentType }: UpdateAssetContentTypeInput) =>
      apiClient.put(`assets/${assetId}/content-type`, { contentType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      toast.success('Content type updated');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update content type');
    },
  });

  return {
    updateContentType: mutation.mutate,
    updateContentTypeAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
