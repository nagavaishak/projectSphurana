import { z } from 'zod';

export const completePractitionerProfileSetupSchema = z.object({
  practitionerId: z.string().min(1, 'Practitioner ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type CompletePractitionerProfileSetupInput = z.infer<
  typeof completePractitionerProfileSetupSchema
>;
