import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { TestIntegrationResponse } from '../../types';

/**
 * Test Integration Hook
 * Tests an integration connection
 */
export const useTestIntegration = (options?: {
  onSuccess?: (response: TestIntegrationResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const mutation = useMutation({
    mutationFn: async (integrationId: string) => {
      return apiClient.post<TestIntegrationResponse>(
        `integrations/${integrationId}/test`,
        {}
      );
    },
    onSuccess: (response) => {
      if (response.success) {
        toast.success(response.message || 'Integration test successful');
      } else {
        toast.error(response.error || 'Integration test failed');
      }
      options?.onSuccess?.(response);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to test integration');
      options?.onError?.(error);
    },
  });

  return {
    testIntegration: mutation.mutate,
    testIntegrationAsync: mutation.mutateAsync,
    isTesting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
