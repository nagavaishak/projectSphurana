import { z } from 'zod';

/**
 * Schema for the unified clinic-side patient profile read (ENG-647 Phase 5).
 */
export const getLeadProfileSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leadId: z.string().min(1, 'Lead ID is required'),
});

/**
 * Input type inferred from schema
 */
export type GetLeadProfileInput = z.infer<typeof getLeadProfileSchema>;
