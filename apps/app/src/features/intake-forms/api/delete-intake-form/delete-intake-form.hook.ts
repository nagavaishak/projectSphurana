'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const useDeleteIntakeForm = (options?: { onSuccess?: () => void }) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`intake-forms/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.intakeForms.all() });
      toast.success('Form deleted');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete form');
    },
  });

  return {
    deleteForm: mutation.mutate,
    isDeleting: mutation.isPending,
  };
};
