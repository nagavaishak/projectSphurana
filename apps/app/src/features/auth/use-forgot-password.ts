import { apiClient } from '@borradh-workspace/api-client';
import type { ForgotPasswordInput } from '@borradh-workspace/features/auth/schemas';
import { useMutation } from '@tanstack/react-query';

interface UseForgotPasswordOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useForgotPassword(options?: UseForgotPasswordOptions) {
  const mutation = useMutation({
    mutationFn: (input: ForgotPasswordInput) =>
      apiClient.post<{ success: boolean }>('auth/forgot-password', input),
    onSuccess: () => {
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      // Don't reveal whether the email exists — silently succeed in UI.
      options?.onError?.(error);
    },
  });

  return {
    forgotPassword: mutation.mutate,
    forgotPasswordAsync: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    isSuccess: mutation.isSuccess || mutation.isError,
    /**
     * Clear the settled state so the form comes back. Lets someone who
     * entered the wrong address correct it in place instead of having to
     * navigate away and start over.
     */
    reset: mutation.reset,
  };
}
