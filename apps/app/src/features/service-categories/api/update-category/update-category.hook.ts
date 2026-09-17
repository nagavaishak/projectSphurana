import { apiClient } from '@borradh-workspace/api-client';
import type {
  OrganizationServiceCategory,
  UpdateServiceCategoryInput,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseUpdateCategoryOptions {
  onSuccess?: (category: OrganizationServiceCategory) => void;
  onError?: (error: Error) => void;
}

export const useUpdateCategory = (options?: UseUpdateCategoryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      id,
      ...input
    }: UpdateServiceCategoryInput & { id: string }) =>
      apiClient.put<OrganizationServiceCategory>(
        `service-categories/${id}`,
        input
      ),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({
        queryKey: ['service-categories'],
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
    isUpdating: mutation.isPending,
  };
};
