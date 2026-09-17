import {
  type CatalogLocationAssignmentRequest,
  assignCatalogLocationsRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for replacing a service's branch assignments.
 *
 * DERIVED from the canonical wire contract (`assignCatalogLocationsRequestBase`
 * in `@borradh-workspace/contracts`) by extending the server-injected context:
 * `serviceId` is the route param, `organizationId` comes from the session. The
 * per-branch shape — including the price / duration overrides — lives in the
 * contract; do not restate it here.
 */
export const assignServiceLocationsSchema =
  assignCatalogLocationsRequestBase.extend({
    serviceId: z.string().min(1, 'Service ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

/** One entry of the `locations` array. */
export type ServiceLocationAssignment = CatalogLocationAssignmentRequest;

export type AssignServiceLocationsInput = z.infer<
  typeof assignServiceLocationsSchema
>;
