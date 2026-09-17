import { z } from 'zod';

export const listStripeTaxCodesSchema = z.object({
  // The list itself is global to Stripe, but retaining the active organisation
  // here ensures it is only exposed through an authenticated workspace route.
  organizationId: z.string().min(1),
});

export type ListStripeTaxCodesInput = z.input<typeof listStripeTaxCodesSchema>;
