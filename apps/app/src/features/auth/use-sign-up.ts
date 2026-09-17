import { apiClient } from '@borradh-workspace/api-client';
import type {
  SignUpInput,
  SignUpResponse,
} from '@borradh-workspace/features/auth/schemas';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { setAuthToken } from '@/lib/auth-token';
import { intercomLogin } from '@/lib/intercom';
import { refetchSession } from '@/lib/session';

interface UseSignUpOptions {
  onSuccess?: (data: SignUpResponse) => void;
  onError?: (error: Error) => void;
}

export function useSignUp(options?: UseSignUpOptions) {
  const mutation = useMutation({
    mutationFn: (input: SignUpInput) =>
      apiClient.post<SignUpResponse>('auth/sign-up', input),
    onSuccess: async (data) => {
      const token =
        (data as { token?: string }).token ??
        (data as { session?: { token?: string } }).session?.token;
      if (token) {
        setAuthToken(token);
      }
      void intercomLogin(data.user.id, data.user.email, data.user.name);
      await refetchSession();
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create account');
      options?.onError?.(error);
    },
  });

  return {
    signUp: mutation.mutate,
    signUpAsync: mutation.mutateAsync,
    isSigningUp: mutation.isPending,
    isSuccess: mutation.isSuccess,
  };
}
