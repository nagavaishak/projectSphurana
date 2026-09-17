import { z } from 'zod';

export const releaseLeadHoldsSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1),
  /** Keep this hold — used when the caller has just created the replacement. */
  exceptAppointmentId: z.string().min(1).optional(),
});

export type ReleaseLeadHoldsInput = z.input<typeof releaseLeadHoldsSchema>;
