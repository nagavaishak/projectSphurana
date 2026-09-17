import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteProductCategoryOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteProductCategory = (
  options?: UseDeleteProductCategoryOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (categoryId: string) =>
      apiClient.delete<{ success: boolean }>(
        `product-categories/${categoryId}`
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      toast.success('Category deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete category');
      options?.onError?.(error);
    },
  });

  return {
    deleteProductCategory: mutation.mutate,
    deleteProductCategoryAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
