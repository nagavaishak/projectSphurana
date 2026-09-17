import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreateIntegrationInput, Integration } from '../../types';

/**
 * Create Integration Hook
 * Creates a new integration
 */
export const useCreateIntegration = (options?: {
  onSuccess?: (integration: Integration) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (input: CreateIntegrationInput) => {
      return apiClient.post<Integration>('integrations', input);
    },
    onSuccess: (integration) => {
      // Invalidate integrations list
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Integration created successfully');
      options?.onSuccess?.(integration);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create integration');
      options?.onError?.(error);
    },
  });

  return {
    createIntegration: mutation.mutate,
    createIntegrationAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
