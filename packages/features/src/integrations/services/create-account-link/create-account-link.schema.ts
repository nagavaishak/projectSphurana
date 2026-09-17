import { createAccountLinkRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for starting Stripe-hosted Connect onboarding.
 *
 * DERIVED from the canonical wire contract (`createAccountLinkRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * fields onto it. The URL rules live in the contract; do not restate them here.
 */
export const createAccountLinkSchema = createAccountLinkRequestBase.extend({
  organizationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  userEmail: z.string().email().optional(),
});

export type CreateAccountLinkInput = z.input<typeof createAccountLinkSchema>;
