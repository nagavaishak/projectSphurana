import {
  membershipPricingTypeValues,
  membershipValidForValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

export const updateMembershipPlanSchema = z.object({
  organizationId: z.string().min(1),
  planId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().nullish(),
  /** null = unlimited sessions */
  sessionCount: z.number().int().positive().nullish(),
  pricingType: z.enum(membershipPricingTypeValues).optional(),
  validFor: z.enum(membershipValidForValues).optional(),
  priceCents: z.number().int().positive().optional(),
  currency: z.string().optional(),
  isActive: z.boolean().optional(),
  /** When provided, replaces the covered services entirely. */
  serviceIds: z.array(z.string().min(1)).optional(),
});

export type UpdateMembershipPlanInput = z.infer<
  typeof updateMembershipPlanSchema
>;
