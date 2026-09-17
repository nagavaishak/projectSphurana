import { locationCatalogSeedRequestSchema } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for seeding a location's catalogue assignments.
 *
 * DERIVED from the canonical wire contract (`locationCatalogSeedRequestSchema`
 * in `@borradh-workspace/contracts`) by extending the server-injected context:
 * `locationId` is the route param (or the row just created), `organizationId`
 * comes from the session. The additive-only semantics — and why they are a
 * constraint of the data model rather than a simplification — are documented on
 * the contract; do not restate them here.
 */
export const applyLocationCatalogSchema =
  locationCatalogSeedRequestSchema.extend({
    locationId: z.string().min(1, 'Location ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type ApplyLocationCatalogInput = z.infer<
  typeof applyLocationCatalogSchema
>;

/** What was actually written, per entity kind. */
export interface LocationCatalogCounts {
  practitioners: number;
  services: number;
  products: number;
  membershipPlans: number;
  offers: number;
}
