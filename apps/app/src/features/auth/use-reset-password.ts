import { apiClient } from '@borradh-workspace/api-client';
import type { ResetPasswordInput } from '@borradh-workspace/features/auth/schemas';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UseResetPasswordOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function useResetPassword(options?: UseResetPasswordOptions) {
  const mutation = useMutation({
    mutationFn: (input: ResetPasswordInput) =>
      apiClient.post<{ success: boolean }>('auth/reset-password', input),
    onSuccess: () => {
      toast.success('Password reset successfully. You can now sign in.');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset password');
      options?.onError?.(error);
    },
  });

  return {
    resetPassword: mutation.mutate,
    resetPasswordAsync: mutation.mutateAsync,
    isSubmitting: mutation.isPending,
    isSuccess: mutation.isSuccess,
  };
}
