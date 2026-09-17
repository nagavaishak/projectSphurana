import { z } from 'zod';

/**
 * NOTE: at least one of appointmentId/leadId is required — enforced in the
 * service (not via .refine) so the API layer can .omit() cleanly.
 */
export const listConsentFormSubmissionsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  appointmentId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
});

export type ListConsentFormSubmissionsInput = z.infer<
  typeof listConsentFormSubmissionsSchema
>;
