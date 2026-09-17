import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductCategory } from '../types';
import type { CreateProductCategoryIntent } from './create-product-category.input';
import { buildCreateProductCategoryPayload } from './create-product-category.payload';

interface UseCreateProductCategoryOptions {
  onSuccess?: (category: ProductCategory) => void;
  onError?: (error: Error) => void;
}

export const useCreateProductCategory = (
  options?: UseCreateProductCategoryOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (intent: CreateProductCategoryIntent) =>
      apiClient.post<ProductCategory>(
        'product-categories',
        buildCreateProductCategoryPayload(intent)
      ),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      toast.success('Category created');
      options?.onSuccess?.(category);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create category');
      options?.onError?.(error);
    },
  });

  return {
    createProductCategory: mutation.mutate,
    createProductCategoryAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
