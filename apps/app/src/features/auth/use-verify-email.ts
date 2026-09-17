import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { setAuthToken } from '@/lib/auth-token';
import { refetchSession } from '@/lib/session';

interface VerifyEmailInput {
  token: string;
}

interface VerifyEmailResponse {
  verified: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
  };
  /** Present for mobile (`X-Client-Type: mobile`) when Better Auth auto-signs-in after verify */
  token?: string;
}

interface UseVerifyEmailOptions {
  onSuccess?: (data: VerifyEmailResponse) => void;
  onError?: (error: Error) => void;
}

export function useVerifyEmail(options?: UseVerifyEmailOptions) {
  const mutation = useMutation({
    mutationFn: (input: VerifyEmailInput) =>
      apiClient.post<VerifyEmailResponse>('auth/verify-email', input),
    onSuccess: async (data) => {
      if (data.token) {
        setAuthToken(data.token);
      }
      await refetchSession();
      toast.success('Email verified');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to verify email');
      options?.onError?.(error);
    },
  });

  return {
    verifyEmail: mutation.mutate,
    verifyEmailAsync: mutation.mutateAsync,
    isVerifying: mutation.isPending,
  };
}
