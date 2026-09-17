import { apiClient } from '@borradh-workspace/api-client';
import type {
  CreateServiceCategoryInput,
  OrganizationServiceCategory,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseCreateCategoryOptions {
  onSuccess?: (category: OrganizationServiceCategory) => void;
  onError?: (error: Error) => void;
}

export const useCreateCategory = (options?: UseCreateCategoryOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: CreateServiceCategoryInput) =>
      apiClient.post<OrganizationServiceCategory>('service-categories', input),
    onSuccess: async (category) => {
      await queryClient.invalidateQueries({
        queryKey: ['service-categories'],
      });
      toast.success('Category added');
      options?.onSuccess?.(category);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to add category');
      options?.onError?.(error);
    },
  });

  return {
    createCategory: mutation.mutate,
    createCategoryAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
