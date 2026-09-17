import { businessTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Schema for seeding default services for an organization
 */
export const seedDefaultServicesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  businessType: z.enum(businessTypeValues),
});

/**
 * Input type inferred from schema
 */
export type SeedDefaultServicesInput = z.infer<
  typeof seedDefaultServicesSchema
>;
