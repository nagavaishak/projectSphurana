import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ProductCategory } from '../types';
import type { UpdateProductCategoryIntent } from './update-product-category.input';
import { buildUpdateProductCategoryPayload } from './update-product-category.payload';

interface UseUpdateProductCategoryOptions {
  onSuccess?: (category: ProductCategory) => void;
  onError?: (error: Error) => void;
}

export const useUpdateProductCategory = (
  options?: UseUpdateProductCategoryOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      categoryId,
      ...intent
    }: UpdateProductCategoryIntent & { categoryId: string }) =>
      apiClient.put<ProductCategory>(
        `product-categories/${categoryId}`,
        buildUpdateProductCategoryPayload(intent)
      ),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      toast.success('Category updated');
      options?.onSuccess?.(category);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update category');
      options?.onError?.(error);
    },
  });

  return {
    updateProductCategory: mutation.mutate,
    updateProductCategoryAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
