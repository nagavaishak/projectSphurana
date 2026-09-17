import { addCatalogLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for ADDING branches to a membership plan's assignments.
 *
 * DERIVED from the canonical wire contract (`addCatalogLocationsRequestBase`),
 * extended with the server-injected context: `planId` is the route param and
 * `organizationId` comes from the session.
 */
export const addMembershipPlanLocationsSchema =
  addCatalogLocationsRequestBase.extend({
    planId: z.string().min(1, 'Plan ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type AddMembershipPlanLocationsInput = z.infer<
  typeof addMembershipPlanLocationsSchema
>;
