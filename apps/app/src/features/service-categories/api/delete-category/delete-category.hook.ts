import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteCategoryOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteCategory = (options?: UseDeleteCategoryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`service-categories/${id}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['service-categories'] }),
        queryClient.invalidateQueries({ queryKey: ['organization-services'] }),
      ]);
      toast.success('Category deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete category');
      options?.onError?.(error);
    },
  });

  return {
    deleteCategory: mutation.mutate,
    isDeleting: mutation.isPending,
  };
};
