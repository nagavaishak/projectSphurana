import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductWriteIntent } from '../create-product/create-product.input';
import { buildProductWritePayload } from '../create-product/create-product.payload';
import type { Product } from '../types';

interface UseUpdateProductOptions {
  onSuccess?: (product: Product) => void;
  onError?: (error: Error) => void;
}

export const useUpdateProduct = (options?: UseUpdateProductOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      productId,
      ...intent
    }: ProductWriteIntent & { productId: string }) =>
      apiClient.put<Product>(
        `products/${productId}`,
        buildProductWritePayload(intent)
      ),
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product updated');
      options?.onSuccess?.(product);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update product');
      options?.onError?.(error);
    },
  });

  return {
    updateProduct: mutation.mutate,
    updateProductAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
