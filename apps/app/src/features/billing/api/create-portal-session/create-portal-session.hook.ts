import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CreatePortalSessionInput, PortalSessionResult } from '../types';

interface UseCreatePortalSessionOptions {
  onSuccess?: (result: PortalSessionResult) => void;
  onError?: (error: Error) => void;
}

export const useCreatePortalSession = (
  options?: UseCreatePortalSessionOptions
) => {
  const mutation = useMutation({
    mutationFn: (input: CreatePortalSessionInput) =>
      apiClient.post<PortalSessionResult>('billing/portal', input),
    onSuccess: (result) => {
      options?.onSuccess?.(result);
      // Redirect to Stripe Customer Portal
      if (result.url) {
        window.location.href = result.url;
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to open billing portal');
      options?.onError?.(error);
    },
  });

  return {
    openPortal: mutation.mutate,
    openPortalAsync: mutation.mutateAsync,
    isOpening: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
