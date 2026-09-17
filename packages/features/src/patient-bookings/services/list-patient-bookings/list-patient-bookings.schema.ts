import { z } from 'zod';

export const listPatientBookingsSchema = z.object({
  /** The signed-in patient's lead.id — from the VALIDATED session, never the client. */
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListPatientBookingsInput = z.infer<
  typeof listPatientBookingsSchema
>;
