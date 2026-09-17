import { addCatalogLocationsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for ADDING branches to a service's assignments.
 *
 * DERIVED from the canonical wire contract (`addCatalogLocationsRequestBase`),
 * extended with the server-injected context: `serviceId` is the route param,
 * `organizationId` comes from the session.
 */
export const addServiceLocationsSchema = addCatalogLocationsRequestBase.extend({
  serviceId: z.string().min(1, 'Service ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type AddServiceLocationsInput = z.infer<
  typeof addServiceLocationsSchema
>;
