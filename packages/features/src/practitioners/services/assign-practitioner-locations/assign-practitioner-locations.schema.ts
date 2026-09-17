import {
  type PractitionerLocationAssignmentRequest,
  assignPractitionerLocationsRequestBase,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for replacing a practitioner's location assignments.
 *
 * DERIVED from the canonical wire contract
 * (`assignPractitionerLocationsRequestBase` in `@borradh-workspace/contracts`)
 * by extending the server-injected context fields onto it: `practitionerId` is
 * the route param and `organizationId` comes from the session. The per-location
 * assignment shape (`locationId` + optional `workingHours` override) lives in
 * the contract too.
 */
export const assignPractitionerLocationsSchema =
  assignPractitionerLocationsRequestBase.extend({
    practitionerId: z.string().min(1, 'Practitioner ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

/** One entry of the `locations` array — re-exported under its historic name. */
export type LocationAssignment = PractitionerLocationAssignmentRequest;

export type AssignPractitionerLocationsInput = z.infer<
  typeof assignPractitionerLocationsSchema
>;
