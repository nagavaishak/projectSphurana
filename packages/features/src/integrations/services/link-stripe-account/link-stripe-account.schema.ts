import { linkStripeAccountRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Derived from the wire contract (requests/organizations.ts) plus the fields
 * the server injects, so the account-id shape rule has exactly one definition.
 * Checking that shape means a pasted secret key, a customer id, or a
 * half-copied string fails as a validation error naming the field, rather than
 * as a Stripe 404 that reads like "we couldn't find your account".
 */
export const linkStripeAccountSchema = linkStripeAccountRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Who performed the link (an onboarding specialist, usually). */
  userId: z.string().min(1).optional(),
});

export type LinkStripeAccountInput = z.input<typeof linkStripeAccountSchema>;
