import type { UpdateBlockedTimeTypeInput } from '@borradh-workspace/api-client/types';

import {
  type BlockedTimeTypeFormValues,
  createBlockedTimeTypeBodySchema,
} from '../create-blocked-time-type/create-blocked-time-type.payload';

/**
 * PAYLOAD BUILDER — update blocked time type (PUT /blocked-time-types/:id).
 *
 * Reuses the SAME body schema + radio → boolean coercion as create, so the two
 * operations cannot drift. `id` travels in the route, not the body.
 */

/** Intent accepted by `useUpdateBlockedTimeType().mutate`. */
export interface UpdateBlockedTimeTypeFormInput
  extends BlockedTimeTypeFormValues {
  id: string;
}

/** THE ONLY place an update-blocked-time-type API payload is constructed. */
export function buildUpdateBlockedTimeTypePayload(
  input: UpdateBlockedTimeTypeFormInput
): { id: string; body: UpdateBlockedTimeTypeInput } {
  const body = createBlockedTimeTypeBodySchema.parse({
    name: input.name,
    durationMinutes: input.durationMinutes,
    paid: input.paid === 'paid',
  });
  return { id: input.id, body };
}
