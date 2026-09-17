import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Integration, UpdateIntegrationInput } from '../../types';

/**
 * Update Integration Hook
 * Updates an existing integration
 */
export const useUpdateIntegration = (options?: {
  onSuccess?: (integration: Integration) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({
      integrationId,
      input,
    }: {
      integrationId: string;
      input: UpdateIntegrationInput;
    }) => {
      return apiClient.patch<Integration>(
        `integrations/${integrationId}`,
        input
      );
    },
    onSuccess: (integration) => {
      // Invalidate integrations list
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      toast.success('Integration updated successfully');
      options?.onSuccess?.(integration);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update integration');
      options?.onError?.(error);
    },
  });

  return {
    updateIntegration: mutation.mutate,
    updateIntegrationAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
