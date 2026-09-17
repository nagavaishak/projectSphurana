import type { CreateStripeAccountLinkInput } from '@borradh-workspace/api-client/types';
import { createAccountLinkRequestSchema } from '@borradh-workspace/contracts';

/**
 * Typed intent + the ONE builder for `POST integrations/stripe/account-link`.
 *
 * Every surface that starts Stripe-hosted onboarding (the payments settings
 * panel, the sales notification banner) hands over just the absolute base URL
 * the user should land back on; this builder is the single place the
 * `?stripe=return` / `?stripe=refresh` markers are appended, so the two
 * surfaces cannot drift on how the return/refresh URLs are shaped.
 */
export interface CreateAccountLinkIntent {
  /** Absolute URL (origin + path) the user is returned to / refreshed at. */
  baseUrl: string;
}

/**
 * The canonical contract, under its historical name. Both URLs are `.url()`-
 * validated: a relative `baseUrl` produces a link Stripe accepts and a redirect
 * that lands nowhere, so it fails here instead.
 */
export const createAccountLinkBodySchema = createAccountLinkRequestSchema;

export function buildCreateAccountLinkPayload(
  intent: CreateAccountLinkIntent
): CreateStripeAccountLinkInput {
  return createAccountLinkBodySchema.parse({
    returnUrl: `${intent.baseUrl}?stripe=return`,
    refreshUrl: `${intent.baseUrl}?stripe=refresh`,
  });
}
