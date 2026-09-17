import { addCatalogLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for ADDING branches to a promotion's assignments.
 *
 * DERIVED from the canonical wire contract (`addCatalogLocationsRequestBase`),
 * extended with the server-injected context: `offerId` is the route param and
 * `organizationId` comes from the session.
 */
export const addOfferLocationsSchema = addCatalogLocationsRequestBase.extend({
  offerId: z.string().min(1, 'Offer ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type AddOfferLocationsInput = z.infer<typeof addOfferLocationsSchema>;
