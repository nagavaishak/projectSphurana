'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseDeleteLocationOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useDeleteLocation = (options?: UseDeleteLocationOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete(`organization-locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-locations'] });
      toast.success('Location removed');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove location');
      options?.onError?.(error);
    },
  });

  return {
    deleteLocation: mutation.mutate,
    deleteLocationAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
