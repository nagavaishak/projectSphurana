import { z } from 'zod';

export const connectStripeSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  code: z.string().min(1),
  // NOTE: `state` used to be a required input here so this service could
  // "verify" it. That check was a tautology (see the service) and the field is
  // now genuinely unused — authenticity is established by OAuthStateGuard at
  // the entry point. Leaving a required-but-ignored field would be the same
  // misleading residue as the check itself, so it is gone.
  // Optional settings
});

export type ConnectStripeInput = z.infer<typeof connectStripeSchema>;
