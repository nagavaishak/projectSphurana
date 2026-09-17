import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ResourceCategory, UpdateResourceCategoryInput } from '../types';

/** `id` is a per-call field so one hook instance can update any category. */
export type UpdateResourceCategoryVariables = UpdateResourceCategoryInput & {
  id: string;
};

interface UseUpdateResourceCategoryOptions {
  onSuccess?: (category: ResourceCategory) => void;
  onError?: (error: Error) => void;
}

export const useUpdateResourceCategory = (
  options?: UseUpdateResourceCategoryOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, ...input }: UpdateResourceCategoryVariables) =>
      apiClient.put<ResourceCategory>(`resources/categories/${id}`, input),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.resources.all(),
      });
      toast.success('Category updated');
      options?.onSuccess?.(category);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update category');
      options?.onError?.(error);
    },
  });

  return {
    updateCategory: mutation.mutate,
    updateCategoryAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
