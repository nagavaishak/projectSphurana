import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteProductBrandOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteProductBrand = (
  options?: UseDeleteProductBrandOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (brandId: string) =>
      apiClient.delete<{ success: boolean }>(`product-brands/${brandId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      toast.success('Brand deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete brand');
      options?.onError?.(error);
    },
  });

  return {
    deleteProductBrand: mutation.mutate,
    deleteProductBrandAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
