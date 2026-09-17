import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { setAuthToken } from '@/lib/auth-token';
import { intercomLogin } from '@/lib/intercom';
import { registerForPushNotifications } from '@/lib/push';
import { type SessionUser, refetchSession } from '@/lib/session';
import { setTwoFactorToken } from '@/lib/two-factor-token';

interface SignInInput {
  email: string;
  password: string;
}

interface SignInResponse {
  user: SessionUser;
  token?: string;
  twoFactorRequired?: boolean;
  twoFactorToken?: string;
}

interface UseSignInOptions {
  onSuccess?: (data: SignInResponse) => void;
  onTwoFactorRequired?: (data: SignInResponse) => void;
  onError?: (error: Error) => void;
}

export function useSignIn(options?: UseSignInOptions) {
  const mutation = useMutation({
    mutationFn: (input: SignInInput) =>
      apiClient.post<SignInResponse>('auth/sign-in', input),
    onSuccess: async (data) => {
      if (data.twoFactorRequired) {
        // Stash the raw cookie pair so the verify-2fa page can forward it.
        if (data.twoFactorToken) {
          setTwoFactorToken(data.twoFactorToken);
        }
        options?.onTwoFactorRequired?.(data);
        return;
      }
      if (data.token) {
        setAuthToken(data.token);
      }
      // Identify in Intercom now without the JWT — `_authed.tsx`'s effect
      // re-calls with `session.intercomJwt` once the session query lands.
      // Non-blocking so a slow native bridge doesn't delay the redirect.
      void intercomLogin(data.user.id, data.user.email, data.user.name);
      // Kick off native push registration; no-op on web. Idempotent.
      void registerForPushNotifications();
      await refetchSession();
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Sign in failed');
      options?.onError?.(error);
    },
  });

  return {
    signIn: mutation.mutate,
    signInAsync: mutation.mutateAsync,
    isSigningIn: mutation.isPending,
    error: mutation.error,
  };
}
