import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Product } from '../types';

interface UseDeleteProductOptions {
  onSuccess?: (product: Product) => void;
  onError?: (error: Error) => void;
}

/** Soft-delete: the API deactivates the product (isActive=false). */
export const useDeleteProduct = (options?: UseDeleteProductOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (productId: string) =>
      apiClient.delete<Product>(`products/${productId}`),
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product deleted');
      options?.onSuccess?.(product);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete product');
      options?.onError?.(error);
    },
  });

  return {
    deleteProduct: mutation.mutate,
    deleteProductAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
