import { z } from 'zod';

export const getLocationCatalogSchema = z.object({
  locationId: z.string().min(1, 'Location ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetLocationCatalogInput = z.infer<typeof getLocationCatalogSchema>;

/**
 * The ids EXPLICITLY assigned to one branch.
 *
 * Explicit is the operative word, and the reason this is not simply
 * "list services at this location": an entity with no join rows anywhere is
 * available at every branch, so a list scoped by location would include
 * entities this branch has never been assigned. The edit screen needs to
 * distinguish the two — a ticked row means "restricted to branches including
 * this one", an unticked row does NOT mean "unavailable here".
 */
export interface LocationCatalog {
  practitionerIds: string[];
  serviceIds: string[];
  productIds: string[];
  membershipPlanIds: string[];
  offerIds: string[];
}
