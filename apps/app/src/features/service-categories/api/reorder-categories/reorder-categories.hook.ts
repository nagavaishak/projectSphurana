import { apiClient } from '@borradh-workspace/api-client';
import type { ReorderServiceCategoriesInput } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useReorderCategories = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ReorderServiceCategoriesInput) =>
      apiClient.post('service-categories/reorder', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-categories'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reorder categories');
    },
  });

  return {
    reorderCategories: mutation.mutate,
    isReordering: mutation.isPending,
  };
};
