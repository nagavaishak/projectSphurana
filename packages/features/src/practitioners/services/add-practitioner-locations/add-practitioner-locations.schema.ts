import { addCatalogLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for ADDING branches a practitioner works at.
 *
 * DERIVED from the canonical wire contract (`addCatalogLocationsRequestBase`),
 * extended with the server-injected context: `practitionerId` is the route
 * param and `organizationId` comes from the session.
 *
 * A bare id list, not the assignment objects `assignPractitionerLocations`
 * takes — `practitioner_location` has no per-branch columns to set.
 */
export const addPractitionerLocationsSchema =
  addCatalogLocationsRequestBase.extend({
    practitionerId: z.string().min(1, 'Practitioner ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type AddPractitionerLocationsInput = z.infer<
  typeof addPractitionerLocationsSchema
>;
