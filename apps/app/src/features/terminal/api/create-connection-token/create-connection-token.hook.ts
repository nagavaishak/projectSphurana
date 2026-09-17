import { apiClient } from '@borradh-workspace/api-client';
import type { TerminalConnectionTokenResponse } from '@borradh-workspace/api-client/types';
import { useMutation } from '@tanstack/react-query';

/**
 * Proxies a Stripe Terminal connection token from the connected account.
 * Consumed by the Capacitor Tap to Pay / physical-reader discovery flow
 * (Wave B mobile). Exposed here so the web POS can also mint one if needed.
 */
export const useCreateConnectionToken = () => {
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post<TerminalConnectionTokenResponse>(
        'terminal/connection-token',
        {}
      ),
  });

  return {
    createConnectionToken: mutation.mutate,
    createConnectionTokenAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
