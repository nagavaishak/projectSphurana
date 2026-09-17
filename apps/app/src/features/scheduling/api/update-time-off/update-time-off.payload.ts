import type { UpdateTimeOffInput } from '@borradh-workspace/api-client/types';
import { updateTimeOffRequestSchema } from '@borradh-workspace/contracts';

import {
  type TimeOffFormValues,
  buildTimeOffSharedBody,
} from '../create-time-off/create-time-off.payload';

/**
 * PAYLOAD BUILDER — update time off (PUT /time-off/:id).
 *
 * Reuses the SAME `buildTimeOffSharedBody` as create, so the two operations
 * cannot send different-but-both-valid bodies. `id` travels in the route, not
 * the body. Wall-clock times resolve in the business timezone.
 */

/** Intent accepted by `useUpdateTimeOff().mutate`. */
export interface UpdateTimeOffFormInput extends TimeOffFormValues {
  id: string;
  /** organization.timezone — wall-clock times resolve in THIS zone. */
  timeZone: string;
}

/**
 * `.strict()` wire body (id lives in the route).
 *
 * An ALIAS of the canonical request contract
 * (`packages/contracts/src/requests/scheduling.ts`), which the backend feature
 * schema also derives from — one description of the body, two ends.
 */
export const updateTimeOffBodySchema = updateTimeOffRequestSchema;

/** THE ONLY place an update-time-off API payload is constructed. */
export function buildUpdateTimeOffPayload(input: UpdateTimeOffFormInput): {
  id: string;
  body: UpdateTimeOffInput;
} {
  const body = updateTimeOffBodySchema.parse(
    buildTimeOffSharedBody(input)
  ) as UpdateTimeOffInput;
  return { id: input.id, body };
}
