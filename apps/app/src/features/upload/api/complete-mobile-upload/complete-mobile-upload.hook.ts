import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';

interface CompleteMobileUploadResponse {
  success: true;
  url: string;
}

/**
 * Mark the scoped upload token's upload complete. The desktop's `mobile-status`
 * poll then flips to done. Auth-free: the token authorizes the call, so the
 * signed-out phone never needs a session (the endpoint is `@Public()`).
 */
export const useCompleteMobileUpload = () => {
  const mutation = useMutation({
    mutationFn: (token: string) =>
      apiClient.post<CompleteMobileUploadResponse>(
        `upload/mobile-complete/${token}`,
        {}
      ),
  });

  return {
    complete: mutation.mutate,
    completeAsync: mutation.mutateAsync,
    isCompleting: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
