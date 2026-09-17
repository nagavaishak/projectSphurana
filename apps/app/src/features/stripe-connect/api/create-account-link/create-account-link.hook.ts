import { apiClient } from '@borradh-workspace/api-client';
import type { StripeAccountLinkResponse } from '@borradh-workspace/api-client/types';
import { useMutation } from '@tanstack/react-query';

import type { CreateAccountLinkIntent } from './create-account-link.payload';
import { buildCreateAccountLinkPayload } from './create-account-link.payload';

/**
 * Mints a Stripe-hosted onboarding Account Link and returns its URL. Lazily
 * creates the connected (controller) account server-side on first call. The
 * caller redirects the browser to the returned `url` — onboarding happens on
 * Stripe, not in an embedded iframe.
 *
 * Callers pass typed intent (`{ baseUrl }`); the return/refresh URLs are shaped
 * exclusively by `buildCreateAccountLinkPayload`.
 */
export const useCreateAccountLink = () => {
  const mutation = useMutation({
    mutationFn: (intent: CreateAccountLinkIntent) =>
      apiClient.post<StripeAccountLinkResponse>(
        'integrations/stripe/account-link',
        buildCreateAccountLinkPayload(intent)
      ),
  });

  return {
    createAccountLink: mutation.mutate,
    createAccountLinkAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
  };
};
