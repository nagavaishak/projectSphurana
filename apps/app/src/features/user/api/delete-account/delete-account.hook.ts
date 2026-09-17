'use client';

import { resetUser } from '@/components/posthog-provider';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';

export const useDeleteAccount = (options?: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete('users/me');
      // Sign out to clear session cookie — the DB session is already
      // cascade-deleted, but the cookie must be removed so the auth
      // layout doesn't see a stale token and redirect to onboarding.
      await apiClient.post('auth/sign-out', undefined).catch(() => {});
    },
    onSuccess: () => {
      queryClient.clear();
      resetUser();
      toast.success('Account deleted successfully');

      if (options?.onSuccess) {
        options.onSuccess();
      } else {
        void navigate({ to: '/sign-in' });
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete account');
      options?.onError?.(error);
    },
  });

  return {
    deleteAccount: mutation.mutate,
    deleteAccountAsync: mutation.mutateAsync,
    isDeleting: mutation.isPending,
  };
};
