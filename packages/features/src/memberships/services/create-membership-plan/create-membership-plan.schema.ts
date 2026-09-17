import {
  membershipPricingTypeValues,
  membershipValidForValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

export const createMembershipPlanSchema = z.object({
  organizationId: z.string().min(1),
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  /** null/undefined = unlimited sessions */
  sessionCount: z.number().int().positive().nullish(),
  pricingType: z.enum(membershipPricingTypeValues).default('one_time'),
  validFor: z.enum(membershipValidForValues).default('1m'),
  priceCents: z.number().int().positive(),
  currency: z.string().default('eur'),
  isActive: z.boolean().default(true),
  serviceIds: z.array(z.string().min(1)).default([]),
});

export type CreateMembershipPlanInput = z.infer<
  typeof createMembershipPlanSchema
>;
