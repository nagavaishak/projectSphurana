import { apiClient } from '@borradh-workspace/api-client';
import type {
  CreateStripeAccountSessionInput,
  StripeAccountSessionResponse,
} from '@borradh-workspace/api-client/types';
import { useMutation } from '@tanstack/react-query';

/**
 * Mints an embedded-components account session client secret. Lazily creates
 * the connected (controller) account server-side on first call. Used as the
 * `fetchClientSecret` for `ConnectComponentsProvider`.
 */
export const useCreateAccountSession = () => {
  const mutation = useMutation({
    mutationFn: (input: CreateStripeAccountSessionInput = {}) =>
      apiClient.post<StripeAccountSessionResponse>(
        'integrations/stripe/account-session',
        input
      ),
  });

  return {
    createAccountSession: mutation.mutate,
    createAccountSessionAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
