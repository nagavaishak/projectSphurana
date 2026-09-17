import { externalRedirectUrl } from '@borradh-workspace/contracts';
import { z } from 'zod';

export const createCreditsCheckoutSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  creditPackageId: z.string().min(1, 'Credit package ID is required'),
  quantity: z.number().int().positive().optional().default(1),
  successUrl: externalRedirectUrl,
  cancelUrl: externalRedirectUrl,
});

// Input type (what callers provide - optional fields are optional)
export type CreateCreditsCheckoutInput = z.input<
  typeof createCreditsCheckoutSchema
>;

// Output type (after defaults applied - all fields present)
export type CreateCreditsCheckoutParsed = z.output<
  typeof createCreditsCheckoutSchema
>;
