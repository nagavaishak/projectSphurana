import { apiClient } from '@borradh-workspace/api-client';
import { changePasswordSchema } from '@borradh-workspace/features/auth/schemas';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordResponse {
  success: boolean;
  message: string;
}

interface UseChangePasswordOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export const useChangePassword = (options?: UseChangePasswordOptions) => {
  const mutation = useMutation({
    mutationFn: async (data: ChangePasswordInput) => {
      const validated = changePasswordSchema.parse({
        ...data,
        revokeOtherSessions: true,
      });

      return apiClient.post<ChangePasswordResponse>('auth/change-password', {
        currentPassword: validated.currentPassword,
        newPassword: validated.newPassword,
      });
    },
    onSuccess: () => {
      toast.success('Password changed successfully');
      options?.onSuccess?.();
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to change password');
      options?.onError?.(error);
    },
  });

  return {
    changePassword: mutation.mutate,
    changePasswordAsync: mutation.mutateAsync,
    isChanging: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
