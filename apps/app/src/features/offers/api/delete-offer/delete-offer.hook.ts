import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteOfferOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteOffer = (options?: UseDeleteOfferOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`offers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] });
      toast.success('Offer deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete offer');
      options?.onError?.(error);
    },
  });

  return {
    deleteOffer: mutation.mutate,
    deleteOfferAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
