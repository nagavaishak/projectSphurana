import type { AssignPractitionerServicesInput } from '@borradh-workspace/api-client/types';
import { assignPractitionerServicesRequestSchema } from '@borradh-workspace/contracts';

/**
 * Typed intent + the ONE builder for `PUT practitioners/:id/services`.
 *
 * Every surface that reassigns a practitioner's services (the team-member
 * editor, onboarding setup-profile, the service form's team-assignment) hands
 * over just the selected service ids; this builder is the single place the wire
 * body is shaped, so the surfaces cannot drift.
 */
export interface AssignPractitionerServicesIntent {
  serviceIds: string[];
}

/**
 * The schema is NOT declared here — it is the canonical
 * {@link assignPractitionerServicesRequestSchema} from
 * `@borradh-workspace/contracts`, the same object the backend's
 * `assignPractitionerServicesSchema` extends with `practitionerId` +
 * `organizationId` and the API DTO validates against. There is no mirror left
 * to drift: the previous hand-written `z.array(z.string())` silently accepted
 * an empty-string id that the server's `.min(1)` rejects.
 */
export const assignPractitionerServicesBodySchema =
  assignPractitionerServicesRequestSchema;

export function buildAssignPractitionerServicesPayload(
  intent: AssignPractitionerServicesIntent
): AssignPractitionerServicesInput {
  return assignPractitionerServicesBodySchema.parse({
    serviceIds: intent.serviceIds,
  }) as AssignPractitionerServicesInput;
}
