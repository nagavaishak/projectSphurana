import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Product } from '../types';
import type { ProductWriteIntent } from './create-product.input';
import { buildProductWritePayload } from './create-product.payload';

interface UseCreateProductOptions {
  onSuccess?: (product: Product) => void;
  onError?: (error: Error) => void;
}

export const useCreateProduct = (options?: UseCreateProductOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: ProductWriteIntent) =>
      apiClient.post<Product>('products', buildProductWritePayload(intent)),
    onSuccess: async (product) => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Product created');
      options?.onSuccess?.(product);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create product');
      options?.onError?.(error);
    },
  });

  return {
    createProduct: mutation.mutate,
    createProductAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
