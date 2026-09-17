import type { AssignPractitionerLocationsInput } from '@borradh-workspace/api-client/types';
import { assignPractitionerLocationsRequestSchema } from '@borradh-workspace/contracts';

/**
 * Typed intent + the ONE builder for `PUT practitioners/:id/locations`.
 *
 * Surfaces (the team-member editor's Locations panel, the scheduling
 * team-member menu's unassign) pass just the selected location ids; this
 * builder is the single place `locationIds` are expanded into the
 * `{ locations: [{ locationId }] }` assignment shape, so no surface hand-rolls
 * that mapping differently.
 */
export interface AssignPractitionerLocationsIntent {
  locationIds: string[];
}

/**
 * The schema is NOT declared here — it is the canonical
 * {@link assignPractitionerLocationsRequestSchema} from
 * `@borradh-workspace/contracts`, the same object the backend's
 * `assignPractitionerLocationsSchema` extends with `practitionerId` +
 * `organizationId` and the API DTO validates against, so there is no mirror to
 * drift. The contract also carries the per-location `workingHours` override
 * this builder does not currently send — an omitted optional, not a rejection.
 */
export const assignPractitionerLocationsBodySchema =
  assignPractitionerLocationsRequestSchema;

export function buildAssignPractitionerLocationsPayload(
  intent: AssignPractitionerLocationsIntent
): AssignPractitionerLocationsInput {
  return assignPractitionerLocationsBodySchema.parse({
    locations: intent.locationIds.map((locationId) => ({ locationId })),
  }) as AssignPractitionerLocationsInput;
}
