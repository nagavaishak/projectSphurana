import { z } from 'zod';

export const validatePatientSessionSchema = z.object({
  sessionToken: z.string().min(1, 'Session token is required'),
  /**
   * Portal v2: the session is the PERSON (customer_account); which clinic they
   * are acting at comes per-request from the `X-Portal-Org` header.
   */
  organizationSlug: z.string().min(1, 'Organization slug is required'),
});

export type ValidatePatientSessionInput = z.infer<
  typeof validatePatientSessionSchema
>;
