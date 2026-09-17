import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateResourceCategoryInput, ResourceCategory } from '../types';

interface UseCreateResourceCategoryOptions {
  onSuccess?: (category: ResourceCategory) => void;
  onError?: (error: Error) => void;
}

export const useCreateResourceCategory = (
  options?: UseCreateResourceCategoryOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateResourceCategoryInput) =>
      apiClient.post<ResourceCategory>('resources/categories', input),
    // Async so `mutateAsync` waits for the refetch — otherwise the dialog can
    // close before the category list has updated behind it.
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.resources.all(),
      });
      toast.success('Category created');
      options?.onSuccess?.(category);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create category');
      options?.onError?.(error);
    },
  });

  return {
    createCategory: mutation.mutate,
    createCategoryAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
