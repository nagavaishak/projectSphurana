import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { setAuthToken } from '@/lib/auth-token';
import { type SessionUser, refetchSession } from '@/lib/session';
import { clearTwoFactorToken, getTwoFactorToken } from '@/lib/two-factor-token';

interface VerifyTotpResponse {
  verified: boolean;
  user?: SessionUser;
  token?: string;
}

interface UseVerifyTotpOptions {
  onSuccess?: (data: VerifyTotpResponse) => void;
  onError?: (error: Error) => void;
}

export function useVerifyTotp(options?: UseVerifyTotpOptions) {
  const mutation = useMutation({
    mutationFn: (input: { code: string }) =>
      apiClient.post<VerifyTotpResponse>('auth/two-factor/verify-totp', {
        code: input.code,
        twoFactorToken: getTwoFactorToken(),
      }),
    onSuccess: async (data) => {
      if (!data.verified) {
        toast.error('Verification failed. Please try again.');
        options?.onError?.(new Error('Verification failed'));
        return;
      }
      clearTwoFactorToken();
      if (data.token) {
        setAuthToken(data.token);
      }
      await refetchSession();
      toast.success('Signed in successfully');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Invalid code. Please try again.');
      options?.onError?.(error);
    },
  });

  return {
    verifyTotp: mutation.mutate,
    isVerifying: mutation.isPending,
  };
}
