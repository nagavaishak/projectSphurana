import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteSupplierOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteSupplier = (options?: UseDeleteSupplierOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (supplierId: string) =>
      apiClient.delete<{ success: boolean }>(`suppliers/${supplierId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      toast.success('Supplier deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete supplier');
      options?.onError?.(error);
    },
  });

  return {
    deleteSupplier: mutation.mutate,
    deleteSupplierAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
